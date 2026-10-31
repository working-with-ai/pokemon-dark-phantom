import { unzipSync } from 'fflate';
import resources from './resources.json' with { type: 'json' };
import catalog from '../dist/games.json' with { type: 'json' };

const cacheLimit = 10_000_000_000;
const SYNC_CODE = /^[A-Z2-7]{26}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SAVE_BYTES = 4 * 1024 * 1024;
const MAX_SYNC_OBJECTS = 300;
const MAX_SYNC_BYTES = 100 * 1024 * 1024;
const CLOUD_PREFIX = 'cloud-saves/';
const syncLocks = new Map();

const gameMap = new Map(catalog.games.map(game => [game.id, game]));
const evictableKeys = new Set(
  Object.values(resources)
    .filter(resource => resource.source && !resource.key.startsWith('runtime/'))
    .map(resource => resource.key)
);

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip'
};

function corsHeaders(methods = 'GET, HEAD, OPTIONS') {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since, If-Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, X-Save-Label, X-Save-Created-At, X-Save-Seconds',
    'Accept-Ranges': 'bytes'
  });
}

async function listAll(bucket, prefix, options = {}) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, ...options });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function withSyncLock(code, task) {
  const previous = syncLocks.get(code) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tail = run.catch(() => {});
  syncLocks.set(code, tail);
  tail.then(() => {
    if (syncLocks.get(code) === tail) syncLocks.delete(code);
  });
  return run;
}

async function readBodyWithLimit(request) {
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_SAVE_BYTES) return { tooLarge: true };
  if (!request.body) return { body: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SAVE_BYTES) {
        try { await reader.cancel(); } catch {}
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body };
}

export async function makeRoom(bucket, incomingBytes = 0, replacingKey) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  let bytes = objects.reduce((sum, object) => sum + (object.key === replacingKey ? 0 : object.size), 0);
  for (const object of objects.sort((a, b) => a.uploaded - b.uploaded)) {
    if (bytes + incomingBytes <= cacheLimit) return;
    if (object.key === replacingKey) continue;
    // ranking/ and cloud-saves/ are user data and must never be evicted.
    if (!evictableKeys.has(object.key)) continue;
    await bucket.delete(object.key);
    bytes -= object.size;
    console.log(JSON.stringify({ event: 'cache_evicted', key: object.key, bytes: object.size }));
  }
  if (bytes + incomingBytes > cacheLimit) throw new Error('Resource exceeds the 10 GB cache limit');
}

async function fillCache(bucket, resource) {
  const response = await fetch(resource.source);
  if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`);
  const maximumDownload = resource.archive ? 10_000_000 : resource.size;
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumDownload) {
      await reader.cancel();
      throw new Error('Upstream resource exceeds its expected size');
    }
    parts.push(value);
  }
  let contents = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    contents.set(part, offset);
    offset += part.byteLength;
  }
  if (resource.archive) {
    const nestedName = 'kdygqhdmy50expbw/kdygqhdmy50expbw.zip';
    const nested = unzipSync(contents, {
      filter: entry => entry.name === nestedName && entry.originalSize <= 10_000_000
    })[nestedName];
    if (!nested) throw new Error('Expected game archive is missing');
    contents = unzipSync(nested, {
      filter: entry => entry.name === 'kdygqhdmy50expbw.gba' && entry.originalSize === resource.size
    })['kdygqhdmy50expbw.gba'];
  }
  if (!contents || contents.byteLength !== resource.size) throw new Error('Resource size check failed');
  const digest = await crypto.subtle.digest('SHA-256', contents);
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (sha256 !== resource.sha256) throw new Error('Resource checksum check failed');
  await makeRoom(bucket, resource.size, resource.key);
  await bucket.put(resource.key, contents, {
    httpMetadata: { contentType: resource.contentType, cacheControl: 'public, max-age=86400' },
    customMetadata: { sha256 }
  });
  console.log(JSON.stringify({ event: 'cache_filled', key: resource.key, bytes: resource.size }));
}

function notModified(request, etag) {
  return request.headers.get('If-None-Match')?.split(',').some(value => value.trim() === etag || value.trim() === '*');
}

function rangeFor(request, size) {
  const rangeHeader = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  if (!rangeHeader || (ifRange && ifRange !== size.etag && ifRange !== size.uploaded)) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let offset = 0;
  let length;
  if (match[1]) {
    offset = Number(match[1]);
    length = (match[2] ? Math.min(Number(match[2]), size.value - 1) : size.value - 1) - offset + 1;
  } else {
    length = Math.min(Number(match[2]), size.value);
    offset = size.value - length;
  }
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || offset >= size.value || length <= 0) {
    return { invalid: true };
  }
  return { offset, length };
}

async function serveStoredObject(request, env, key, metadata, contentType, cacheControl = 'public, max-age=86400', extraHeaders = {}) {
  const headers = corsHeaders();
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  headers.set('Content-Type', metadata.httpMetadata?.contentType || contentType || 'application/octet-stream');
  headers.set('Cache-Control', cacheControl);
  headers.set('ETag', metadata.httpEtag);
  headers.set('Last-Modified', metadata.uploaded.toUTCString());
  if (notModified(request, metadata.httpEtag)) return new Response(null, { status: 304, headers });
  const range = request.method === 'GET' ? rangeFor(request, {
    value: metadata.size,
    etag: metadata.httpEtag,
    uploaded: metadata.uploaded.toUTCString()
  }) : null;
  if (range?.invalid) {
    headers.set('Content-Range', `bytes */${metadata.size}`);
    return new Response(null, { status: 416, headers });
  }
  const length = range ? range.length : metadata.size;
  headers.set('Content-Length', String(length));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + length - 1}/${metadata.size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });
  const object = await env.RESOURCES.get(key, range ? { range: { offset: range.offset, length } } : undefined);
  if (!object) throw new Error('Object disappeared during download');
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function handleResource(request, env, resource) {
  const headers = corsHeaders();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD, OPTIONS');
    return new Response('Method not allowed', { status: 405, headers });
  }
  try {
    let metadata = await env.RESOURCES.head(resource.key);
    if (!metadata) {
      await fillCache(env.RESOURCES, resource);
      metadata = await env.RESOURCES.head(resource.key);
    }
    if (!metadata) throw new Error('Resource is unavailable after download');
    return await serveStoredObject(request, env, resource.key, metadata, resource.contentType);
  } catch (error) {
    console.error(JSON.stringify({ event: 'resource_error', key: resource.key, message: error.message }));
    headers.set('Cache-Control', 'no-store');
    return new Response('游戏资源暂时无法加载，请稍后重试', { status: 502, headers });
  }
}

async function handleGameAsset(request, env, url) {
  const headers = corsHeaders();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD, OPTIONS');
    return new Response('Method not allowed', { status: 405, headers });
  }
  const match = /^\/games\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match) return new Response('Not found', { status: 404, headers });
  const [, gameId, file] = match;
  const game = gameMap.get(gameId);
  if (!game) return new Response('Not found', { status: 404, headers });
  const base = `ranking/hot/${game.r2Id}`;
  let key = '';
  let contentType = CONTENT_TYPES[file.split('.').pop()] || 'application/octet-stream';
  let cacheControl = 'public, max-age=86400';
  if (file === 'rom.zip') key = `${base}/rom.zip`;
  else if (file === 'resources.zip') key = `${base}/resources.zip`;
  else if (file === 'cover' || file === `cover.${game.coverExt}`) {
    key = `${base}/cover.${game.coverExt}`;
    contentType = CONTENT_TYPES[game.coverExt] || 'image/png';
    cacheControl = 'public, max-age=604800';
  }
  if (!key) return new Response('Not found', { status: 404, headers });
  try {
    const metadata = await env.RESOURCES.head(key);
    if (!metadata) return new Response('Not found', { status: 404, headers });
    return await serveStoredObject(request, env, key, metadata, contentType, cacheControl);
  } catch (error) {
    console.error(JSON.stringify({ event: 'game_asset_error', key, message: error.message }));
    headers.set('Cache-Control', 'no-store');
    return new Response('游戏资源暂时无法加载，请稍后重试', { status: 502, headers });
  }
}

function apiHeaders() {
  return corsHeaders('GET, POST, PUT, DELETE, OPTIONS');
}

function json(data, status = 200, extra = {}) {
  const headers = apiHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(JSON.stringify(data), { status, headers });
}

function syncCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out.slice(0, 26);
}

function saveMetadata(object, code) {
  const rest = object.key.slice(`${CLOUD_PREFIX}${code}/`.length).split('/');
  if (rest.length !== 2) return null;
  const [gameId, slotId] = rest;
  return {
    gameId,
    slotId,
    label: object.customMetadata?.label || '即时存档',
    createdAt: Number(object.customMetadata?.createdAt) || Number(object.uploaded) || 0,
    seconds: Number(object.customMetadata?.seconds) || 0,
    size: object.size,
    uploaded: object.uploaded
  };
}

async function syncCodeId(code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].slice(0, 4).map(value => value.toString(16).padStart(2, '0')).join('');
}

async function addCustomMetadata(bucket, objects) {
  const missing = objects.filter(object => object.customMetadata === undefined);
  await Promise.all(missing.map(async object => {
    const metadata = await bucket.head(object.key);
    if (metadata?.customMetadata) object.customMetadata = metadata.customMetadata;
  }));
  return objects;
}

function parseSavePath(url) {
  const match = /^\/api\/sync\/([A-Z2-7]{26})(?:\/([^/]+)\/([^/]+))?$/.exec(url.pathname);
  if (!match) return null;
  const [, code, gameId, slotId] = match;
  if (!SYNC_CODE.test(code)) return null;
  if (gameId !== undefined && (!SAFE_ID.test(gameId) || !SAFE_ID.test(slotId))) return null;
  return { code, gameId, slotId };
}

async function handleApi(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: apiHeaders() });
  if (url.pathname === '/api/sync') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    return json({ code: syncCode() }, 201);
  }
  const parsed = parseSavePath(url);
  if (!parsed) return json({ error: 'Invalid sync code' }, 400);
  const { code, gameId, slotId } = parsed;
  const prefix = `${CLOUD_PREFIX}${code}/`;
  if (!gameId) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const objects = await addCustomMetadata(
      env.RESOURCES,
      await listAll(env.RESOURCES, prefix, { include: ['customMetadata'] })
    );
    const saves = objects.map(object => saveMetadata(object, code)).filter(Boolean);
    saves.sort((a, b) => b.createdAt - a.createdAt);
    return json({ code, saves });
  }
  const key = `${prefix}${gameId}/${slotId}`;
  if (request.method === 'GET') {
    const metadata = await env.RESOURCES.head(key);
    if (!metadata) return json({ error: 'Not found' }, 404);
    const object = await env.RESOURCES.get(key);
    if (!object) return json({ error: 'Not found' }, 404);
    const saved = saveMetadata(metadata, code);
    const headers = apiHeaders();
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Length', String(metadata.size));
    headers.set('ETag', metadata.httpEtag);
    if (saved?.label) headers.set('X-Save-Label', encodeURIComponent(saved.label));
    if (saved?.createdAt) headers.set('X-Save-Created-At', String(saved.createdAt));
    if (saved?.seconds) headers.set('X-Save-Seconds', String(saved.seconds));
    return new Response(object.body, { headers });
  }
  if (request.method === 'DELETE') {
    const metadata = await env.RESOURCES.head(key);
    if (!metadata) return json({ error: 'Not found' }, 404);
    await env.RESOURCES.delete(key);
    return new Response(null, { status: 204, headers: apiHeaders() });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
  const { body, tooLarge } = await readBodyWithLimit(request);
  if (tooLarge) return json({ error: 'Save is too large' }, 413);
  if (!body.length) return json({ error: 'Empty save' }, 400);
  const label = (url.searchParams.get('label') || '即时存档').slice(0, 80);
  const createdAt = String(Number(url.searchParams.get('createdAt')) || Date.now());
  const seconds = String(Math.max(0, Number(url.searchParams.get('seconds')) || 0));
  return withSyncLock(code, async () => {
    let objects;
    try {
      objects = await listAll(env.RESOURCES, prefix);
    } catch {
      let id = 'unknown';
      try { id = await syncCodeId(code); } catch {}
      console.error(JSON.stringify({ event: 'sync_list_error', syncCodeId: id }));
      return json({ error: 'Sync space is temporarily unavailable' }, 503);
    }
    const existing = objects.find(object => object.key === key);
    const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
    const projectedCount = objects.length + (existing ? 0 : 1);
    const projectedBytes = totalBytes - (existing?.size || 0) + body.length;
    if (projectedCount > MAX_SYNC_OBJECTS || projectedBytes > MAX_SYNC_BYTES) {
      return json({ error: 'Sync space is full' }, 409);
    }
    await env.RESOURCES.put(key, body, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' },
      customMetadata: { label, createdAt, seconds }
    });
    return json({ ok: true, gameId, slotId }, existing ? 200 : 201);
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    if (url.pathname.startsWith('/games/')) return handleGameAsset(request, env, url);
    const resource = resources[url.pathname];
    if (!resource) return env.ASSETS.fetch(request);
    return handleResource(request, env, resource);
  },
  async scheduled(_event, env) {
    await makeRoom(env.RESOURCES);
  }
};
