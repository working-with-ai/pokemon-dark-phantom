import { createGamePlayer } from '../player.js';
import { escapeHtml, icon, toast } from '../ui.js';

function unavailablePage(game) {
  const el = document.createElement('div');
  el.className = 'page page-play';
  el.innerHTML = `<header class="play-nav">
    <button class="nav-back" type="button" data-back aria-label="返回">${icon('back')}</button>
    <div class="play-title"><strong>${escapeHtml(game.name)}</strong><span>即将上线</span></div>
    <a class="play-nav-tail" href="#/details?id=${encodeURIComponent(game.id)}">详情</a>
  </header>
  <div class="play-coming">
    <span class="coming-art">${icon('gamepad')}</span>
    <h1>即将上线</h1>
    <p>这款游戏还在准备中，先去玩玩《漆黑的魅影》吧。</p>
    <a class="primary-pill" href="#/details?id=pokemon-dark-phantom">看看能玩的游戏</a>
  </div>`;
  document.title = `${game.name} · 一局童年`;
  return { el };
}

export function render({ data, query }) {
  const game = data.gamesById.get(query.get('id'));
  if (!game) {
    const el = document.createElement('div');
    el.className = 'page page-play';
    el.innerHTML = `<header class="play-nav">
      <button class="nav-back" type="button" data-back aria-label="返回">${icon('back')}</button>
      <div class="play-title"><strong>游戏不存在</strong></div>
    </header>
    <div class="play-coming"><h1>没有找到这款游戏</h1><a class="primary-pill" href="#/">回到首页</a></div>`;
    document.title = '游戏不存在 · 一局童年';
    return { el };
  }
  if (!game.playable || !game.core) return unavailablePage(game);

  document.title = `${game.shortName || game.name} · 一局童年`;
  const el = document.createElement('div');
  el.className = 'page page-play is-playable';
  el.innerHTML = `<header class="play-nav">
    <button class="nav-back" type="button" data-back aria-label="返回">${icon('back')}</button>
    <div class="play-title">
      <strong>${escapeHtml(game.shortName || game.name)}</strong>
      <span>${escapeHtml(game.platform)} · VBA</span>
    </div>
    <a class="play-nav-tail" href="#/details?id=${encodeURIComponent(game.id)}">详情</a>
  </header>
  <div class="play-status" id="play-status" role="status">准备就绪 · 点击开始</div>
  <section class="play-stage" id="play-stage">
    <canvas id="play-canvas" width="240" height="160" aria-label="${escapeHtml(game.name)}游戏画面"></canvas>
    <div class="play-overlay" id="play-overlay">
      <span class="play-overlay-mark">${icon('gamepad')}</span>
      <strong>${escapeHtml(game.shortName || game.name)}</strong>
      <button class="play-start" id="play-start" type="button">开始游戏</button>
      <p>首次加载约 32 MB，请稍候</p>
    </div>
  </section>
  <section class="play-toolbar" id="play-toolbar" aria-label="游戏工具栏">
    <button class="tool-button" type="button" data-action="pause" aria-pressed="false">${icon('pause')}<span>暂停</span></button>
    <label class="tool-select">${icon('speed')}<span>倍速</span>
      <select id="play-speed" aria-label="游戏倍速">
        <option value="1">1×</option>
        <option value="2">2×</option>
        <option value="3">3×</option>
        <option value="4">4×</option>
      </select>
    </label>
    <button class="tool-button" type="button" data-action="save">${icon('save')}<span>存档</span></button>
    <button class="tool-button" type="button" data-action="load">${icon('load')}<span>读档</span></button>
    <button class="tool-button" type="button" data-action="export">${icon('download')}<span>导出</span></button>
    <label class="tool-button import-tool">${icon('upload')}<span>导入</span>
      <input id="play-import" type="file" accept=".state" hidden>
    </label>
    <label class="tool-range">${icon('volume')}<input id="play-volume" type="range" min="0" max="1" step="0.05" value="0.5" aria-label="游戏音量"></label>
    <button class="tool-button" type="button" data-action="fullscreen">${icon('fullscreen')}<span>全屏</span></button>
    <button class="tool-button" type="button" data-action="touch" aria-pressed="false">${icon('touch')}<span>屏幕按键</span></button>
  </section>
  <section class="play-touch" id="play-touch" aria-label="屏幕游戏按键" hidden>
    <div class="touch-dpad">
      <button data-key="1" class="key-up" aria-label="上">↑</button>
      <button data-key="4" class="key-left" aria-label="左">←</button>
      <button data-key="2" class="key-down" aria-label="下">↓</button>
      <button data-key="8" class="key-right" aria-label="右">→</button>
    </div>
    <div class="touch-system">
      <button data-key="8388608">SELECT</button>
      <button data-key="4194304">START</button>
    </div>
    <div class="touch-actions">
      <button data-key="1024">L</button>
      <button data-key="2048">R</button>
      <button data-key="32">B</button>
      <button data-key="16">A</button>
    </div>
  </section>
  <section class="play-help">
    <p><b>键盘</b> 方向键移动 · X 确认 · Z 返回 · Enter 开始 · Shift 选择 · Q / E 对应 L / R</p>
    <p><b>存档</b> 进度保存在当前浏览器，换设备前请导出 .state 备份。</p>
  </section>`;

  return {
    el,
    mount() {
      const canvas = el.querySelector('#play-canvas');
      const overlay = el.querySelector('#play-overlay');
      const startButton = el.querySelector('#play-start');
      const statusEl = el.querySelector('#play-status');
      const toolbar = el.querySelector('#play-toolbar');
      const pauseButton = el.querySelector('[data-action="pause"]');
      const speedSelect = el.querySelector('#play-speed');
      const volumeInput = el.querySelector('#play-volume');
      const importInput = el.querySelector('#play-import');
      const touchPad = el.querySelector('#play-touch');
      const touchButton = el.querySelector('[data-action="touch"]');

      const setToolbarEnabled = enabled => {
        for (const control of toolbar.querySelectorAll('button, select, input')) control.disabled = !enabled;
        toolbar.classList.toggle('is-disabled', !enabled);
      };
      setToolbarEnabled(false);

      const player = createGamePlayer({
        game,
        slotId: query.get('slot'),
        canvas,
        touchPad,
        statusElement: statusEl,
        onRunningChange: running => {
          if (!running) return;
          overlay.classList.add('is-hidden');
          setToolbarEnabled(true);
          statusEl.textContent = '冒险进行中 · VBA';
        },
        onPauseChange: paused => {
          pauseButton.setAttribute('aria-pressed', String(paused));
          pauseButton.querySelector('span').textContent = paused ? '继续' : '暂停';
        }
      });

      const showTouch = visible => {
        touchPad.hidden = !visible;
        touchButton.setAttribute('aria-pressed', String(visible));
      };
      showTouch(matchMedia('(pointer: coarse)').matches);

      const onStart = async () => {
        startButton.disabled = true;
        startButton.textContent = '正在加载…';
        statusEl.textContent = '正在准备模拟器…';
        try {
          await player.start();
        } catch (error) {
          startButton.disabled = false;
          startButton.textContent = '重新开始';
          toast('游戏加载失败，请重试');
        }
      };

      const onToolbar = async event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        try {
          if (action === 'pause') player.togglePause();
          if (action === 'save') await player.saveState();
          if (action === 'load') await player.loadState();
          if (action === 'export') await player.exportState();
          if (action === 'fullscreen') {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await el.requestFullscreen();
          }
          if (action === 'touch') showTouch(touchPad.hidden);
        } catch (error) {
          statusEl.textContent = `${action === 'load' ? '读档' : action === 'save' ? '存档' : '操作'}失败：${error.message}`;
          toast(error.message);
        }
      };

      const onSpeed = () => player.setSpeed(speedSelect.value);
      const onVolume = () => player.setVolume(volumeInput.value);
      const onImport = async () => {
        await player.importState(importInput.files[0]);
        importInput.value = '';
      };
      const onBack = event => {
        const backButton = event.target.closest('.nav-back');
        if (backButton) player.destroy();
      };

      startButton.addEventListener('click', onStart);
      toolbar.addEventListener('click', onToolbar);
      speedSelect.addEventListener('change', onSpeed);
      volumeInput.addEventListener('input', onVolume);
      importInput.addEventListener('change', onImport);
      el.addEventListener('click', onBack);

      return () => {
        startButton.removeEventListener('click', onStart);
        toolbar.removeEventListener('click', onToolbar);
        speedSelect.removeEventListener('change', onSpeed);
        volumeInput.removeEventListener('input', onVolume);
        importInput.removeEventListener('change', onImport);
        el.removeEventListener('click', onBack);
        player.destroy();
      };
    }
  };
}
