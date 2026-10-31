import { unzipSync } from '../vendor/fflate.js';

function openDatabase(rootPath) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(rootPath, 21);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('FILE_DATA')) {
        const store = database.createObjectStore('FILE_DATA');
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache(rootPath, path) {
  const database = await openDatabase(rootPath);
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('FILE_DATA').objectStore('FILE_DATA').get(path);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeCache(rootPath, path, contents) {
  const database = await openDatabase(rootPath);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('FILE_DATA', 'readwrite');
      transaction.objectStore('FILE_DATA').put({ contents, mode: 33206, timestamp: new Date() }, path);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function fetchArchive(url, label, status) {
  if (status) status(`正在下载${label}…`);
  const response = await fetch(new URL(url, document.baseURI));
  if (!response.ok) throw new Error(`${label}下载失败：${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadArchive(game, kind, status) {
  const core = game.core;
  const rootPath = core.rootPath;
  const legacyRom = kind === 'rom' && core.legacy;
  const cachePath = legacyRom ? core.romPath : `${rootPath}/${kind}.zip`;
  const url = kind === 'rom' ? core.romUrl : core.resourcesUrl;
  if (!url) return null;
  let cached = null;
  try {
    cached = await readCache(rootPath, cachePath);
  } catch {
    cached = null;
  }
  if (cached?.contents?.length) return new Uint8Array(cached.contents);
  const contents = await fetchArchive(url, kind === 'rom' ? '游戏包' : '金手指资源', status);
  try {
    await writeCache(rootPath, cachePath, contents);
  } catch (error) {
    console.warn('游戏文件缓存失败，将继续本次运行', error);
  }
  return contents;
}

function extractZip(contents) {
  const entries = unzipSync(contents);
  const files = new Map();
  for (const [name, data] of Object.entries(entries)) {
    if (!data || !data.length) continue;
    const clean = name.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
    if (!clean || clean.startsWith('/') || clean.includes('..') || clean.startsWith('__MACOSX/')) continue;
    files.set(clean, data);
  }
  return files;
}

export function ensureFsDirectory(emulib, path) {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    try {
      if (!emulib.FS.analyzePath(current).exists) emulib.FS.mkdir(current);
    } catch {
      /* directory may already exist */
    }
  }
}

export async function writeFilesToDb(rootPath, files) {
  const database = await openDatabase(rootPath);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('FILE_DATA', 'readwrite');
      const store = transaction.objectStore('FILE_DATA');
      for (const [path, contents] of files) {
        const fullPath = path.startsWith('/') ? path : `/${path}`;
        store.put({ contents, mode: 33206, timestamp: new Date() }, fullPath);
      }
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStageLabels(bytes) {
  const labels = new Map();
  if (!bytes?.length) return labels;
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const index = text.indexOf('{"check_point"');
    if (index < 0) return labels;
    const data = JSON.parse(text.slice(index));
    for (const point of data.check_point || []) {
      const name = String(point.name || '').trim();
      const label = String(point.point_name || '').trim();
      if (name && label) labels.set(name, label);
    }
  } catch {
    /* keep numbered labels */
  }
  return labels;
}

function chineseNumber(value) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return String(value);
  if (number < 10) return digits[number];
  if (number < 20) return `十${number % 10 ? digits[number % 10] : ''}`;
  if (number < 100) return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ''}`;
  return String(number);
}

export function parseStages(resourceFiles, packageName, gameMode) {
  const wanted = gameMode === 'FBA_V2' ? 'combine_stage_v2.zip' : 'combine_stage.zip';
  const stageKey = [...resourceFiles.keys()].find(path => path.split('/').pop().toLowerCase() === wanted);
  if (!stageKey) return [];
  const files = extractZip(resourceFiles.get(stageKey));
  const checkPoint = [...files.entries()].find(([name]) => /check_point\.json$/i.test(name));
  const labels = parseStageLabels(checkPoint?.[1]);
  const pattern = new RegExp(`^${escapeRegExp(packageName)}\\.(\\d+)$`);
  const stages = [];
  for (const [name, state] of files) {
    const match = pattern.exec(name);
    if (!match) continue;
    const id = match[1];
    const imageEntry = [...files.entries()].find(([file]) => file === `${name}.jpg` || file === `${name}.png`);
    stages.push({
      id,
      file: name,
      label: labels.get(name) || `第${chineseNumber(Number(id))}关`,
      state,
      image: imageEntry?.[1] || null
    });
  }
  return stages.sort((a, b) => Number(a.id) - Number(b.id));
}

export function parseCheats(text) {
  const entries = [];
  let current = null;
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cheat = /^cheat\s+"(.+)"\s*$/.exec(line);
    if (cheat) {
      current = { name: cheat[1], default: 0, options: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const defaultValue = /^default\s+(\d+)/.exec(line);
    if (defaultValue) {
      current.default = Number(defaultValue[1]);
      continue;
    }
    const option = /^(\d+)\s+"([^"]*)"\s*,?\s*(.*)$/.exec(line);
    if (option) {
      let code = option[3].trim().replace(/,\s*$/, '');
      if (code.startsWith('"') && code.endsWith('"')) code = code.slice(1, -1);
      current.options.push({
        value: Number(option[1]),
        label: option[2],
        code
      });
    }
  }
  return entries.filter(entry => entry.options.length > 0);
}

export function findIni(files, packageName) {
  const exact = `${packageName}/${packageName}.ini`;
  const entry = files.has(exact) ? [exact, files.get(exact)] : [...files.entries()].find(([name]) => name.endsWith('.ini'));
  return entry ? new TextDecoder('utf-8', { fatal: false }).decode(entry[1]) : '';
}

export function findPadSetting(files) {
  const entry = [...files.entries()].find(([name]) => /(^|\/)pad_setting\.json$/i.test(name));
  if (!entry) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(entry[1]));
  } catch {
    return null;
  }
}

export async function loadResourcesInfo(game, status) {
  if (!game.core?.resourcesUrl) {
    return { iniText: '', padSetting: null, cheats: [], stages: [], files: new Map() };
  }
  const contents = await loadArchive(game, 'resources', status);
  const files = contents ? extractZip(contents) : new Map();
  const iniText = findIni(files, game.package);
  return {
    files,
    iniText,
    padSetting: findPadSetting(files),
    cheats: parseCheats(iniText),
    stages: parseStages(files, game.package, game.core.gameMode)
  };
}

export async function prepareGameAssets(game, status) {
  const rom = await loadArchive(game, 'rom', status);
  let resources;
  try {
    resources = await loadResourcesInfo(game, status);
  } catch (error) {
    console.warn('金手指资源加载失败，降级为无金手指模式', error);
    if (status) status('金手指资源暂不可用');
    resources = { iniText: '', padSetting: null, cheats: [], stages: [], files: new Map(), unavailable: true };
  }
  if (game.core.legacy) {
    return {
      ...resources,
      resourcesUnavailable: Boolean(resources.unavailable),
      romFiles: new Map([[game.core.romPath, rom]]),
      legacyRom: true
    };
  }
  return {
    ...resources,
    resourcesUnavailable: Boolean(resources.unavailable),
    romFiles: rom ? extractZip(rom) : new Map(),
    legacyRom: false
  };
}
