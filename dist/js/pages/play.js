import { createGamePlayer } from '../player.js';
import {
  actionsFor,
  assignGamepads,
  bindingLabel,
  loadBindings,
  playersFor,
  resetBindings,
  saveBindings
} from '../controls.js';
import { escapeHtml, icon, toast } from '../ui.js';

function touchMarkup(platform) {
  const system = platform === 'GBA' || platform === 'FC'
    ? '<button type="button" data-player="0" data-action="select">SELECT</button><button type="button" data-player="0" data-action="start">START</button>'
    : '<button type="button" data-player="0" data-action="coin">投币</button><button type="button" data-player="0" data-action="start">开始</button>';
  const actions = platform === 'GBA'
    ? [['l', 'L'], ['r', 'R'], ['b', 'B'], ['a', 'A']]
    : platform === 'FC'
      ? [['b', 'B'], ['a', 'A']]
      : [['d', 'D'], ['c', 'C'], ['b', 'B'], ['a', 'A']];
  return `<div class="touch-dpad">
      <button type="button" class="key-up" data-player="0" data-action="up" aria-label="上">↑</button>
      <button type="button" class="key-left" data-player="0" data-action="left" aria-label="左">←</button>
      <button type="button" class="key-down" data-player="0" data-action="down" aria-label="下">↓</button>
      <button type="button" class="key-right" data-player="0" data-action="right" aria-label="右">→</button>
    </div>
    <div class="touch-system">${system}</div>
    <div class="touch-actions touch-actions-${actions.length}">${actions.map(([action, label]) => `<button type="button" data-player="0" data-action="${action}">${label}</button>`).join('')}</div>`;
}

function helpMarkup(platform) {
  if (platform === 'FC') {
    return '<p><b>键盘</b> 1P 方向键 + Z / X，2P WASD + G / H；SELECT / START 为 Shift / Enter（2P 为 T / Y）。</p><p><b>双人</b> 连接第二个手柄即可由 2P 操作；按键设置里可以重新绑定。</p>';
  }
  if (platform === '街机') {
    return '<p><b>键盘</b> 1P 方向键 + Z / X / C / V，投币 B，开始 Enter；2P 为 WASD + G / H / J / K，投币 T，开始 Y。</p><p><b>双人</b> 连接第二个手柄即可由 2P 操作；按键设置里可以重新绑定。</p>';
  }
  return '<p><b>键盘</b> 方向键移动 · X 确认 · Z 返回 · Enter 开始 · Shift 选择 · Q / E 对应 L / R。</p><p><b>存档</b> 进度保存在当前浏览器，换设备前请导出 .state 备份。</p>';
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
  if (!game.playable || !game.core) {
    const el = document.createElement('div');
    el.className = 'page page-play';
    el.innerHTML = `<header class="play-nav">
      <button class="nav-back" type="button" data-back aria-label="返回">${icon('back')}</button>
      <div class="play-title"><strong>${escapeHtml(game.name)}</strong><span>即将上线</span></div>
      <a class="play-nav-tail" href="#/details?id=${encodeURIComponent(game.id)}">详情</a>
    </header>
    <div class="play-coming"><h1>即将上线</h1><p>这款游戏还在准备中。</p></div>`;
    document.title = `${game.name} · 一局童年`;
    return { el };
  }

  const platform = game.platform;
  const playerCount = playersFor(platform);
  document.title = `${game.shortName || game.name} · 一局童年`;
  const el = document.createElement('div');
  el.className = 'page page-play is-playable';
  el.innerHTML = `<header class="play-nav">
    <button class="nav-back" type="button" data-back aria-label="返回">${icon('back')}</button>
    <div class="play-title">
      <strong>${escapeHtml(game.shortName || game.name)}</strong>
      <span>${escapeHtml(platform)}${platform === 'FC' ? '' : ` · ${escapeHtml(game.core.gameMode)}`}</span>
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
      <p>首次加载需要下载游戏包，请稍候</p>
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
    <button class="tool-button" type="button" data-action="cheats">${icon('spark')}<span>金手指</span></button>
    <button class="tool-button" type="button" data-action="keys">${icon('keyboard')}<span>按键</span></button>
    <button class="tool-button" type="button" data-action="fullscreen">${icon('fullscreen')}<span>全屏</span></button>
    <button class="tool-button" type="button" data-action="touch" aria-pressed="false">${icon('touch')}<span>屏幕按键</span></button>
  </section>
  <section class="play-panel" id="cheat-panel" hidden>
    <div class="panel-head"><h2>金手指</h2><button type="button" class="panel-link" data-cheat-reset>全部关闭</button></div>
    <div class="cheat-list" id="cheat-list"><p class="panel-empty">开始游戏后可在这里开启金手指。</p></div>
  </section>
  <section class="play-panel" id="keys-panel" hidden>
    <div class="panel-head"><h2>按键设置</h2><button type="button" class="panel-link" data-keys-reset>恢复默认</button></div>
    <div class="key-tabs" id="key-tabs">${Array.from({ length: playerCount }, (_, index) => `<button type="button" data-key-player="${index + 1}" class="${index === 0 ? 'is-active' : ''}">${index + 1}P</button>`).join('')}</div>
    <div class="key-list" id="key-list"></div>
    <p class="panel-empty">点击某项后，按下键盘按键或手柄按钮完成绑定。</p>
  </section>
  <section class="play-touch" id="play-touch" aria-label="屏幕游戏按键" hidden>
    ${touchMarkup(platform)}
  </section>
  <section class="play-help">${helpMarkup(platform)}</section>`;

  return {
    el,
    mount() {
      const stage = el.querySelector('#play-stage');
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
      const cheatPanel = el.querySelector('#cheat-panel');
      const cheatList = el.querySelector('#cheat-list');
      const keysPanel = el.querySelector('#keys-panel');
      const keyList = el.querySelector('#key-list');
      const keyTabs = el.querySelector('#key-tabs');
      let cheatState = { entries: [], selected: {} };
      let keyPlayer = 1;
      let listening = null;
      let gamepadTimer = 0;
      let resourcesUnavailable = false;

      const setToolbarEnabled = enabled => {
        for (const control of toolbar.querySelectorAll('button, select, input')) control.disabled = !enabled;
        toolbar.classList.toggle('is-disabled', !enabled);
      };
      setToolbarEnabled(false);

      const player = createGamePlayer({
        game,
        slotId: query.get('slot'),
        stageId: query.get('stage'),
        cloudSlotId: query.get('cloud'),
        canvas,
        touchPad,
        statusElement: statusEl,
        onRunningChange: running => {
          if (!running) return;
          overlay.classList.add('is-hidden');
          setToolbarEnabled(true);
          statusEl.textContent = `游戏进行中 · ${platform}${resourcesUnavailable ? ' · 金手指资源暂不可用' : ''}`;
        },
        onPauseChange: paused => {
          pauseButton.setAttribute('aria-pressed', String(paused));
          pauseButton.querySelector('span').textContent = paused ? '继续' : '暂停';
        },
        onResourcesUnavailable: () => {
          resourcesUnavailable = true;
          toast('金手指资源暂不可用');
        },
        onCheatsReady: (entries, selected) => {
          cheatState = { entries, selected };
          renderCheats();
        }
      });

      const showTouch = visible => {
        touchPad.hidden = !visible;
        touchButton.setAttribute('aria-pressed', String(visible));
      };
      showTouch(matchMedia('(pointer: coarse)').matches);

      function renderCheats() {
        if (!cheatState.entries.length) {
          cheatList.innerHTML = '<p class="panel-empty">该游戏没有可用的金手指配置。</p>';
          return;
        }
        cheatList.innerHTML = cheatState.entries.map((entry, index) => {
          const value = Number(cheatState.selected[index] ?? entry.default ?? 0);
          if (entry.options.length === 2 && entry.options.some(option => option.value === 0) && entry.options.some(option => option.value === 1)) {
            return `<label class="cheat-row cheat-switch">
              <span>${escapeHtml(entry.name)}</span>
              <input type="checkbox" data-cheat-index="${index}" ${value ? 'checked' : ''}>
              <i></i>
            </label>`;
          }
          return `<label class="cheat-row">
            <span>${escapeHtml(entry.name)}</span>
            <select data-cheat-index="${index}">
              ${entry.options.map(option => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
          </label>`;
        }).join('');
      }

      function stopListening() {
        listening = null;
        if (gamepadTimer) clearInterval(gamepadTimer);
        gamepadTimer = 0;
        player.setInputPaused(keysPanel.hidden ? false : true);
        renderKeys();
      }

      function startListening(playerIndex, action) {
        listening = { player: playerIndex, action };
        player.setInputPaused(true);
        renderKeys();
        if (gamepadTimer) clearInterval(gamepadTimer);
        gamepadTimer = setInterval(() => {
          if (!listening || !navigator.getGamepads) return;
          const pads = assignGamepads(navigator.getGamepads(), { platform, playerCount });
          const pad = pads[listening.player - 1];
          if (!pad) return;
          const button = pad.buttons.findIndex(item => item?.pressed);
          if (button >= 0) {
            const bindings = player.getBindings();
            bindings[`P${listening.player}`][listening.action].pad = button;
            saveBindings(platform, bindings);
            player.reloadBindings();
            stopListening();
            toast(`已绑定手柄 ${button + 1}`);
          }
        }, 80);
      }

      function renderKeys() {
        const bindings = player.getBindings();
        const actions = actionsFor(platform);
        keyList.innerHTML = actions.map(action => `<button type="button" class="key-row ${listening && listening.player === keyPlayer && listening.action === action.id ? 'is-listening' : ''}" data-bind-action="${action.id}">
          <span>${escapeHtml(action.label)}</span>
          <b>${listening && listening.player === keyPlayer && listening.action === action.id ? '按下按键…' : escapeHtml(bindingLabel(bindings[`P${keyPlayer}`]?.[action.id]))}</b>
        </button>`).join('');
      }

      const onBindKey = event => {
        if (!listening) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.code === 'Escape') {
          stopListening();
          return;
        }
        const bindings = player.getBindings();
        bindings[`P${listening.player}`][listening.action].key = event.code;
        saveBindings(platform, bindings);
        player.reloadBindings();
        toast(`已绑定 ${event.code}`);
        stopListening();
      };

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
          if (action === 'cheats') {
            cheatPanel.hidden = !cheatPanel.hidden;
            if (!cheatPanel.hidden) {
              keysPanel.hidden = true;
              stopListening();
              renderCheats();
            }
          }
          if (action === 'keys') {
            keysPanel.hidden = !keysPanel.hidden;
            if (!keysPanel.hidden) {
              cheatPanel.hidden = true;
              renderKeys();
              player.setInputPaused(true);
            } else {
              stopListening();
              player.setInputPaused(false);
            }
          }
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

      const onCheatChange = event => {
        const control = event.target.closest('[data-cheat-index]');
        if (!control) return;
        const index = Number(control.dataset.cheatIndex);
        const value = control.type === 'checkbox' ? (control.checked ? 1 : 0) : Number(control.value);
        player.setCheat(index, value);
        cheatState.selected[index] = value;
        statusEl.textContent = value ? '金手指已开启' : '金手指已关闭';
      };

      const onCheatReset = () => {
        player.resetCheats();
        cheatState.selected = {};
        renderCheats();
        statusEl.textContent = '已关闭全部金手指';
      };

      const onKeyPanelClick = event => {
        const tab = event.target.closest('[data-key-player]');
        if (tab) {
          keyPlayer = Number(tab.dataset.keyPlayer);
          for (const item of keyTabs.querySelectorAll('[data-key-player]')) item.classList.toggle('is-active', Number(item.dataset.keyPlayer) === keyPlayer);
          renderKeys();
          return;
        }
        if (event.target.closest('[data-keys-reset]')) {
          const defaults = resetBindings(platform);
          saveBindings(platform, defaults);
          player.reloadBindings();
          stopListening();
          renderKeys();
          toast('已恢复默认按键');
          return;
        }
        const row = event.target.closest('[data-bind-action]');
        if (row) startListening(keyPlayer, row.dataset.bindAction);
      };

      const onSpeed = () => player.setSpeed(speedSelect.value);
      const onVolume = () => player.setVolume(volumeInput.value);
      const onImport = async () => {
        await player.importState(importInput.files[0]);
        importInput.value = '';
      };
      const onBack = event => {
        if (event.target.closest('.nav-back')) player.destroy();
      };

      startButton.addEventListener('click', onStart);
      toolbar.addEventListener('click', onToolbar);
      cheatList.addEventListener('change', onCheatChange);
      cheatPanel.addEventListener('click', event => {
        if (event.target.closest('[data-cheat-reset]')) onCheatReset();
      });
      keysPanel.addEventListener('click', onKeyPanelClick);
      speedSelect.addEventListener('change', onSpeed);
      volumeInput.addEventListener('input', onVolume);
      importInput.addEventListener('change', onImport);
      window.addEventListener('keydown', onBindKey, true);
      el.addEventListener('click', onBack);
      renderKeys();

      return () => {
        startButton.removeEventListener('click', onStart);
        toolbar.removeEventListener('click', onToolbar);
        cheatList.removeEventListener('change', onCheatChange);
        keysPanel.removeEventListener('click', onKeyPanelClick);
        speedSelect.removeEventListener('change', onSpeed);
        volumeInput.removeEventListener('input', onVolume);
        importInput.removeEventListener('change', onImport);
        window.removeEventListener('keydown', onBindKey, true);
        el.removeEventListener('click', onBack);
        if (gamepadTimer) clearInterval(gamepadTimer);
        player.destroy();
      };
    }
  };
}
