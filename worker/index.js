import { unzipSync } from 'fflate';
import resources from './resources.json';

const cacheLimit = 10_000_000_000;

async function makeRoom(bucket, incomingBytes = 0, replacingKey) {
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
    if (object.key.startsWith('runtime/') || object.key === replacingKey) continue;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const resource = resources[url.pathname];
    if (!resource) return env.ASSETS.fetch(request);
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since, If-Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
      'Accept-Ranges': 'bytes'
    });
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
      headers.set('Content-Type', resource.contentType);
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('ETag', metadata.httpEtag);
      headers.set('Last-Modified', metadata.uploaded.toUTCString());
      if (request.headers.get('If-None-Match')?.split(',').some(value => value.trim() === metadata.httpEtag || value.trim() === '*')) {
        return new Response(null, { status: 304, headers });
      }
      const rangeHeader = request.headers.get('Range');
      const ifRange = request.headers.get('If-Range');
      const range = request.method === 'GET' && rangeHeader && (!ifRange || ifRange === metadata.httpEtag || ifRange === metadata.uploaded.toUTCString());
      let offset = 0;
      let length = metadata.size;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match || (!match[1] && !match[2])) {
          headers.set('Content-Range', `bytes */${metadata.size}`);
          return new Response(null, { status: 416, headers });
        }
        if (match[1]) {
          offset = Number(match[1]);
          length = (match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1) - offset + 1;
        } else {
          length = Math.min(Number(match[2]), metadata.size);
          offset = metadata.size - length;
        }
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || offset >= metadata.size || length <= 0) {
          headers.set('Content-Range', `bytes */${metadata.size}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${metadata.size}`);
      }
      headers.set('Content-Length', String(length));
      if (request.method === 'HEAD') return new Response(null, { headers });
      const object = await env.RESOURCES.get(resource.key, range ? { range: { offset, length } } : undefined);
      if (!object) throw new Error('Resource was evicted during download');
      return new Response(object.body, { status: range ? 206 : 200, headers });
    } catch (error) {
      console.error(JSON.stringify({ event: 'resource_error', key: resource.key, message: error.message }));
      headers.set('Cache-Control', 'no-store');
      return new Response('游戏资源暂时无法加载，请稍后重试', { status: 502, headers });
    }
  },
  async scheduled(_event, env) {
    await makeRoom(env.RESOURCES);
  }
};
