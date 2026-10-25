const statusLabel = document.querySelector('#status');
const shareButton = document.querySelector('#share');
const startButton = document.querySelector('#start-game');
const canvas = document.querySelector('#game-canvas');
const context = canvas.getContext('2d', { alpha: false });
const rootPath = '/pokemon-dark-phantom-vba';
const romPath = `${rootPath}/pokemon-dark.gba`;
const statePath = `${rootPath}/adventure.state`;
let running = false;
let paused = false;
let keyboardKeys = 0;
let touchKeys = 0;
let frameTime = 0;
let image;

shareButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    shareButton.textContent = '链接已复制 ✓';
    setTimeout(() => { shareButton.innerHTML = '复制游戏链接 <span aria-hidden="true">↗</span>'; }, 2200);
  } catch {
    window.prompt('复制这个链接，分享给朋友：', location.href);
  }
});

window.gameInfo = { goldenFingerFiles: '', gameAchievement: '' };
window.triggerReady = () => {
  canvas.width = emulib._emuGetVideoWidth();
  canvas.height = emulib._emuGetVideoHeight();
  image = context.createImageData(canvas.width, canvas.height);
  running = true;
  document.body.dataset.game = 'running';
  startButton.hidden = true;
  document.querySelector('#game-toolbar').hidden = false;
  statusLabel.textContent = '冒险进行中 · VBA';
  requestAnimationFrame(renderFrame);
};

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  startButton.textContent = '正在加载…';
  statusLabel.textContent = '正在准备模拟器…';
  window.emuSound = new EMUSound(null);
  try {
    window.emulib = await libemu({
      locateFile: name => new URL(`runtime/${name}`, document.baseURI).href,
      onAbort: () => { statusLabel.textContent = '模拟器加载失败，请刷新重试'; }
    });
    emuSound.emscriptenModule = emulib;
    emuSound.setVolume(0.5);
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(rootPath, 21);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('FILE_DATA');
        store.createIndex('timestamp', 'timestamp', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const cached = await new Promise((resolve, reject) => {
      const request = database.transaction('FILE_DATA').objectStore('FILE_DATA').get(romPath);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!cached) {
      statusLabel.textContent = '正在加载游戏文件 · 约 32 MB';
      const response = await fetch('https://opencode.accemarket.com/pokemon-dark-phantom/pokemon-dark.gba');
      if (!response.ok) throw new Error(`游戏下载失败：${response.status}`);
      const contents = new Uint8Array(await response.arrayBuffer());
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('FILE_DATA', 'readwrite');
        transaction.objectStore('FILE_DATA').put({ contents, mode: 33206, timestamp: new Date() }, romPath);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    }
    database.close();
    statusLabel.textContent = '正在启动 VBA 内核…';
    emulib.ccall('emuSetJson', null, ['string'], [JSON.stringify({
      gameType: 33, gameMode: 'VBA', romPath, rootPath, startMode: 0, gameID: 'pokemon-dark-phantom'
    })]);
    emulib._emuFast(1);
  } catch (error) {
    console.error(error);
    statusLabel.textContent = `加载失败：${error.message}，请刷新重试`;
    startButton.textContent = '加载失败，请刷新';
  }
});

const keyMap = {
  ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8,
  KeyX: 16, KeyZ: 32, KeyQ: 1024, KeyE: 2048, Enter: 1 << 22, ShiftLeft: 1 << 23, ShiftRight: 1 << 23
};
const pressedKeys = new Set();
for (const type of ['keydown', 'keyup']) {
  window.addEventListener(type, event => {
    if (!running || !keyMap[event.code] || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    event.preventDefault();
    if (type === 'keydown') pressedKeys.add(event.code);
    else pressedKeys.delete(event.code);
    keyboardKeys = [...pressedKeys].reduce((keys, code) => keys | keyMap[code], 0);
  });
}
window.addEventListener('blur', () => {
  pressedKeys.clear();
  keyboardKeys = touchKeys = 0;
});
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', event => {
    if (!running) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchKeys |= Number(button.dataset.key);
    button.classList.add('pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, () => {
      touchKeys &= ~Number(button.dataset.key);
      button.classList.remove('pressed');
    });
  }
}

function renderFrame(time) {
  requestAnimationFrame(renderFrame);
  if (time - frameTime < 1000 / 65) return;
  frameTime = time;
  let keys = keyboardKeys | touchKeys;
  const pad = [...navigator.getGamepads()].find(Boolean);
  if (pad) {
    const mapping = { 0: 16, 1: 32, 4: 1024, 5: 2048, 8: 1 << 23, 9: 1 << 22, 12: 1, 13: 2, 14: 4, 15: 8 };
    for (const [button, value] of Object.entries(mapping)) if (pad.buttons[button]?.pressed) keys |= value;
    if (pad.axes[0] < -0.5) keys |= 4;
    if (pad.axes[0] > 0.5) keys |= 8;
    if (pad.axes[1] < -0.5) keys |= 1;
    if (pad.axes[1] > 0.5) keys |= 2;
  }
  emulib._emuSetButton(0, keys);
  emulib._emuUpdate();
  const pixels = new Uint16Array(emulib.HEAPU8.buffer, emulib._emuGetVideoData(), canvas.width * canvas.height);
  for (let i = 0; i < pixels.length; i++) {
    const color = pixels[i];
    image.data[i * 4] = ((color >> 11) & 31) * 255 / 31;
    image.data[i * 4 + 1] = ((color >> 5) & 63) * 255 / 63;
    image.data[i * 4 + 2] = (color & 31) * 255 / 31;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

document.querySelector('#pause').addEventListener('click', event => {
  paused = !paused;
  emulib._emuPause(paused ? 1 : 0);
  event.currentTarget.textContent = paused ? '继续' : '暂停';
  statusLabel.textContent = paused ? '冒险已暂停' : '冒险进行中 · VBA';
});
document.querySelector('#speed').addEventListener('change', event => {
  emulib._emuFast(Number(event.target.value));
});
document.querySelector('#volume').addEventListener('input', event => {
  emuSound.setVolume(Number(event.target.value));
});
function saveState() {
  emulib.ccall('emuSaveState', null, ['string'], [statePath]);
  emulib._emuUpdate();
  const contents = emulib.FS.readFile(statePath);
  if (!contents.length) throw new Error('存档为空');
  return contents;
}

document.querySelector('#save-state').addEventListener('click', () => {
  try {
    saveState();
    statusLabel.textContent = '即时存档已保存到当前浏览器';
  } catch (error) {
    statusLabel.textContent = `存档失败：${error.message}`;
  }
});
document.querySelector('#load-state').addEventListener('click', () => {
  if (!emulib.FS.analyzePath(statePath).exists) {
    statusLabel.textContent = '还没有即时存档，请先点击「存档」';
    return;
  }
  emulib.ccall('emuLoadState', null, ['string'], [statePath]);
  emulib._emuUpdate();
  statusLabel.textContent = '已读取即时存档';
});
document.querySelector('#export-state').addEventListener('click', () => {
  try {
    const contents = saveState();
    const url = URL.createObjectURL(new Blob([contents]));
    const link = document.createElement('a');
    link.href = url;
    link.download = '漆黑的魅影-VBA.state';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    statusLabel.textContent = `即时存档已导出 · ${Math.ceil(contents.length / 1024)} KB`;
  } catch (error) {
    statusLabel.textContent = `导出失败：${error.message}`;
  }
});
document.querySelector('#import-state').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const importedPath = `${rootPath}/imported.state`;
    emulib.FS.writeFile(importedPath, new Uint8Array(await file.arrayBuffer()));
    emulib.ccall('emuLoadState', null, ['string'], [importedPath]);
    emulib._emuUpdate();
    statusLabel.textContent = '已导入 VBA 即时存档';
  } catch (error) {
    statusLabel.textContent = `导入失败：${error.message}`;
  }
  event.target.value = '';
});
document.querySelector('#fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.querySelector('#game-player').requestFullscreen();
});
const touchPad = document.querySelector('#touch-pad');
touchPad.hidden = !matchMedia('(pointer: coarse)').matches;
document.querySelector('#toggle-touch').setAttribute('aria-pressed', String(!touchPad.hidden));
document.querySelector('#toggle-touch').addEventListener('click', event => {
  touchPad.hidden = !touchPad.hidden;
  event.currentTarget.setAttribute('aria-pressed', String(!touchPad.hidden));
});
statusLabel.textContent = '准备就绪 · 点击开始';
