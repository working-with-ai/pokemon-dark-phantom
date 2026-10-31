import { addPlayTime, addSaveSlot, formatClock, getSaveSlots, recordPlay } from './store.js';

const KEY_MAP = {
  ArrowUp: 1,
  ArrowDown: 2,
  ArrowLeft: 4,
  ArrowRight: 8,
  KeyX: 16,
  KeyZ: 32,
  KeyQ: 1024,
  KeyE: 2048,
  Enter: 1 << 22,
  ShiftLeft: 1 << 23,
  ShiftRight: 1 << 23
};

const SLOT_DB_NAME = 'ra:save-slots';
let activePlayer = null;

if (!window.gameInfo) {
  window.gameInfo = { goldenFingerFiles: '', gameAchievement: '' };
}
window.triggerReady = () => {
  if (activePlayer) activePlayer.handleReady();
};

function openRomDatabase(rootPath) {
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

async function readRomCache(rootPath, path) {
  const database = await openRomDatabase(rootPath);
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('FILE_DATA').objectStore('FILE_DATA').get(path);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeRomCache(rootPath, path, contents) {
  const database = await openRomDatabase(rootPath);
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

function openSlotDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SLOT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('states')) {
        request.result.createObjectStore('states');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeSlotBytes(key, contents) {
  const database = await openSlotDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('states', 'readwrite');
      transaction.objectStore('states').put(contents, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readSlotBytes(key) {
  const database = await openSlotDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('states').objectStore('states').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export function createGamePlayer({
  game,
  slotId,
  canvas,
  touchPad,
  statusElement,
  onRunningChange,
  onPauseChange
}) {
  const core = game.core;
  if (!core) throw new Error('这款游戏还没有可用的模拟器内核');
  const rootPath = core.rootPath;
  const romPath = core.romPath;
  const statePath = core.statePath;
  const importPath = `${rootPath}/imported.state`;
  const slotPath = `${rootPath}/selected.state`;
  const context = canvas.getContext('2d', { alpha: false });
  const controller = new AbortController();

  let emulib = null;
  let emuSound = null;
  let image = null;
  let running = false;
  let starting = false;
  let paused = false;
  let frameTime = 0;
  let frameId = 0;
  let keyboardKeys = 0;
  let touchKeys = 0;
  let pressedKeys = new Set();
  let speed = 1;
  let volume = 0.5;
  let playTimer = 0;
  let sessionSeconds = 0;
  let flushedSeconds = 0;
  let destroyed = false;

  const status = text => {
    if (!destroyed && statusElement) statusElement.textContent = text;
  };

  const flushTime = () => {
    const pending = sessionSeconds - flushedSeconds;
    if (pending > 0) {
      addPlayTime(game.id, pending);
      flushedSeconds = sessionSeconds;
    }
  };

  const stopAudio = () => {
    if (!emuSound) return;
    try {
      emuSound.setVolume(0);
      if (emuSound.resumeTimer) clearInterval(emuSound.resumeTimer);
      if (emuSound.audioCtx && typeof emuSound.audioCtx.close === 'function') {
        emuSound.audioCtx.close().catch(() => {});
      }
    } catch {
      /* audio may already be torn down */
    }
  };

  function handleReady() {
    if (destroyed || !emulib) return;
    canvas.width = emulib._emuGetVideoWidth();
    canvas.height = emulib._emuGetVideoHeight();
    image = context.createImageData(canvas.width, canvas.height);
    running = true;
    starting = false;
    paused = false;
    recordPlay(game.id);
    sessionSeconds = 0;
    flushedSeconds = 0;
    if (playTimer) clearInterval(playTimer);
    playTimer = setInterval(() => {
      if (!running || paused) return;
      sessionSeconds += 1;
      if (sessionSeconds - flushedSeconds >= 10) flushTime();
    }, 1000);
    status('冒险进行中 · VBA');
    if (onRunningChange) onRunningChange(true);
    if (onPauseChange) onPauseChange(false);
    frameId = requestAnimationFrame(renderFrame);
    if (slotId) {
      loadSlot(slotId).catch(error => {
        console.warn('所选存档读取失败', error);
        status(`读档失败：${error.message}`);
      });
    }
  }

  async function loadSlot(id) {
    const contents = await readSlotBytes(`${game.id}:${id}`);
    if (destroyed || !emulib) return;
    if (!contents || !contents.length) throw new Error('所选存档不存在或已损坏');
    emulib.FS.writeFile(slotPath, new Uint8Array(contents));
    emulib.ccall('emuLoadState', null, ['string'], [slotPath]);
    emulib._emuUpdate();
    status('已读取所选存档');
  }

  function renderFrame(time) {
    if (!running || destroyed) return;
    frameId = requestAnimationFrame(renderFrame);
    if (paused) return;
    if (time - frameTime < 1000 / 65) return;
    frameTime = time;
    let keys = keyboardKeys | touchKeys;
    if (navigator.getGamepads) {
      const pad = [...navigator.getGamepads()].find(Boolean);
      if (pad) {
        const mapping = { 0: 16, 1: 32, 4: 1024, 5: 2048, 8: 1 << 23, 9: 1 << 22, 12: 1, 13: 2, 14: 4, 15: 8 };
        for (const [button, value] of Object.entries(mapping)) {
          if (pad.buttons[button]?.pressed) keys |= value;
        }
        if (pad.axes[0] < -0.5) keys |= 4;
        if (pad.axes[0] > 0.5) keys |= 8;
        if (pad.axes[1] < -0.5) keys |= 1;
        if (pad.axes[1] > 0.5) keys |= 2;
      }
    }
    try {
      emulib._emuSetButton(0, keys);
      emulib._emuUpdate();
      const pixels = new Uint16Array(emulib.HEAPU8.buffer, emulib._emuGetVideoData(), canvas.width * canvas.height);
      for (let i = 0; i < pixels.length; i += 1) {
        const color = pixels[i];
        image.data[i * 4] = ((color >> 11) & 31) * 255 / 31;
        image.data[i * 4 + 1] = ((color >> 5) & 63) * 255 / 63;
        image.data[i * 4 + 2] = (color & 31) * 255 / 31;
        image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    } catch (error) {
      console.error(error);
      running = false;
      if (frameId) cancelAnimationFrame(frameId);
      if (playTimer) clearInterval(playTimer);
      flushTime();
      status('模拟器运行出错，请返回重试');
    }
  }

  async function ensureRom() {
    statusElement && (statusElement.textContent = '正在检查本地游戏缓存…');
    let cached = null;
    try {
      cached = await readRomCache(rootPath, romPath);
    } catch {
      cached = null;
    }
    if (cached && cached.contents && cached.contents.length) return;
    const size = core.size ? ` · 约 ${Math.round(core.size / 1024 / 1024)} MB` : '';
    status(`正在加载游戏文件${size}`);
    const response = await fetch(new URL(core.romUrl, document.baseURI));
    if (!response.ok) throw new Error(`游戏下载失败：${response.status}`);
    const contents = new Uint8Array(await response.arrayBuffer());
    try {
      await writeRomCache(rootPath, romPath, contents);
    } catch (error) {
      console.warn('游戏缓存写入失败，将继续本次运行', error);
    }
  }

  async function start() {
    if (running || starting || destroyed) return;
    starting = true;
    status('正在准备模拟器…');
    if (!window.libemu) {
      starting = false;
      throw new Error('模拟器脚本尚未加载');
    }
    try {
      emuSound = new window.EMUSound(null);
    } catch (error) {
      console.warn('音频初始化失败，将静音运行', error);
      emuSound = null;
    }
    window.emuSound = emuSound;
    try {
      const module = await window.libemu({
        locateFile: name => new URL(`runtime/${name}`, document.baseURI).href,
        onAbort: () => status('模拟器加载失败，请刷新重试')
      });
      // 过期的加载只清理自己的音频，不能覆盖新实例写入的全局对象
      if (destroyed) {
        stopAudio();
        return;
      }
      emulib = module;
      window.emulib = module;
      window.emuSound = emuSound;
      if (emuSound) {
        emuSound.emscriptenModule = emulib;
        emuSound.setVolume(volume);
      }
      await ensureRom();
      if (destroyed) {
        stopAudio();
        return;
      }
      status('正在启动 VBA 内核…');
      emulib.ccall('emuSetJson', null, ['string'], [JSON.stringify({
        gameType: 33,
        gameMode: 'VBA',
        romPath,
        rootPath,
        startMode: 0,
        gameID: 'pokemon-dark-phantom'
      })]);
      emulib._emuFast(speed);
    } catch (error) {
      starting = false;
      stopAudio();
      console.error(error);
      status(`加载失败：${error.message}，请刷新重试`);
      throw error;
    }
  }

  function togglePause() {
    if (!running || !emulib) return paused;
    paused = !paused;
    try { emulib._emuPause(paused ? 1 : 0); } catch {}
    if (emuSound) emuSound.setVolume(paused ? 0 : volume);
    status(paused ? '冒险已暂停' : '冒险进行中 · VBA');
    if (onPauseChange) onPauseChange(paused);
    return paused;
  }

  function setSpeed(next) {
    speed = Number(next) || 1;
    if (emulib) emulib._emuFast(speed);
    status(`已切换到 ${speed}× 速度`);
  }

  function setVolume(next) {
    volume = Math.min(1, Math.max(0, Number(next)));
    if (emuSound && !paused) emuSound.setVolume(volume);
  }

  function captureState() {
    if (!emulib || !running) throw new Error('游戏尚未开始');
    emulib.ccall('emuSaveState', null, ['string'], [statePath]);
    emulib._emuUpdate();
    const contents = emulib.FS.readFile(statePath);
    if (!contents.length) throw new Error('存档为空');
    return contents;
  }

  async function saveState() {
    const contents = captureState();
    const createdAt = Date.now();
    const slot = {
      id: `slot-${createdAt}`,
      gameId: game.id,
      label: `即时存档 · ${formatClock(createdAt)}`,
      createdAt,
      seconds: sessionSeconds
    };
    try {
      await writeSlotBytes(`${game.id}:${slot.id}`, contents);
      addSaveSlot(slot);
    } catch (error) {
      console.warn('即时存档写入失败', error);
    }
    status('即时存档已保存到当前浏览器');
    return slot;
  }

  async function loadState() {
    if (!emulib) throw new Error('游戏尚未开始');
    if (emulib.FS.analyzePath(statePath).exists) {
      emulib.ccall('emuLoadState', null, ['string'], [statePath]);
      emulib._emuUpdate();
      status('已读取即时存档');
      return;
    }
    const [latest] = getSaveSlots(game.id);
    if (!latest) throw new Error('还没有即时存档，请先点击「存档」');
    const contents = await readSlotBytes(`${game.id}:${latest.id}`);
    if (!contents || !contents.length) throw new Error('存档数据已损坏');
    emulib.FS.writeFile(statePath, new Uint8Array(contents));
    emulib.ccall('emuLoadState', null, ['string'], [statePath]);
    emulib._emuUpdate();
    status('已读取上次保存的即时存档');
  }

  async function exportState() {
    const contents = captureState();
    const url = URL.createObjectURL(new Blob([contents]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(game.shortName || game.name).replace(/\s+/g, '-')}-VBA.state`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`即时存档已导出 · ${Math.ceil(contents.length / 1024)} KB`);
  }

  async function importState(file) {
    if (!file || !emulib) return;
    try {
      emulib.FS.writeFile(importPath, new Uint8Array(await file.arrayBuffer()));
      emulib.ccall('emuLoadState', null, ['string'], [importPath]);
      emulib._emuUpdate();
      status('已导入 VBA 即时存档');
    } catch (error) {
      status(`导入失败：${error.message}`);
    }
  }

  function bindControls() {
    const signal = controller.signal;
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, event => {
        if (!running || !KEY_MAP[event.code] || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
        event.preventDefault();
        if (type === 'keydown') pressedKeys.add(event.code);
        else pressedKeys.delete(event.code);
        keyboardKeys = [...pressedKeys].reduce((keys, code) => keys | KEY_MAP[code], 0);
      }, { signal });
    }
    window.addEventListener('blur', () => {
      pressedKeys.clear();
      keyboardKeys = 0;
      touchKeys = 0;
    }, { signal });
    if (!touchPad) return;
    for (const button of touchPad.querySelectorAll('[data-key]')) {
      button.addEventListener('pointerdown', event => {
        if (!running) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        touchKeys |= Number(button.dataset.key);
        button.classList.add('is-pressed');
      }, { signal });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, () => {
          touchKeys &= ~Number(button.dataset.key);
          button.classList.remove('is-pressed');
        }, { signal });
      }
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    if (playTimer) clearInterval(playTimer);
    flushTime();
    controller.abort();
    if (emulib) {
      try { emulib._emuPause(1); } catch {}
    }
    stopAudio();
    pressedKeys.clear();
    keyboardKeys = 0;
    touchKeys = 0;
    if (activePlayer === api) activePlayer = null;
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
  }

  bindControls();
  const api = {
    start,
    destroy,
    handleReady,
    togglePause,
    setSpeed,
    setVolume,
    saveState,
    loadState,
    exportState,
    importState,
    isRunning: () => running,
    isPaused: () => paused
  };
  activePlayer = api;
  return api;
}
