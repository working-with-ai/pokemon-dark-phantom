import { formatPlayTime, formatRelativeTime, getHistory } from '../store.js';
import {
  clearSyncCode,
  createSyncCode,
  getSyncCode,
  listCloudSaves,
  normalizeSyncCode,
  setSyncCode,
  syncLocalSaves
} from '../cloud.js';
import { avatarMarkup, coverMarkup, emptyState, escapeHtml, icon, launchButton, toast } from '../ui.js';

function syncMarkup() {
  const code = getSyncCode();
  if (!code) {
    return `<p class="sync-copy">生成一个同步码，在另一台设备输入它，就能读取同一份云存档。</p>
      <div class="sync-actions">
        <button type="button" class="sync-primary" data-sync-create>生成同步码</button>
      </div>
      <div class="sync-connect">
        <input id="sync-code-input" maxlength="26" placeholder="输入 26 位同步码" autocomplete="off">
        <button type="button" data-sync-connect>绑定</button>
      </div>`;
  }
  return `<p class="sync-copy">已开启跨设备同步。每次存档会自动上传，也可以在另一台设备输入这个同步码。</p>
    <div class="sync-code-row">
      <code data-sync-code>${escapeHtml(code)}</code>
      <button type="button" class="sync-copy-button" data-sync-copy>复制</button>
    </div>
    <div class="sync-actions">
      <button type="button" class="sync-primary" data-sync-now>立即同步</button>
      <button type="button" class="sync-secondary" data-sync-stop>停止同步</button>
    </div>`;
}

export function render({ data }) {
  document.title = '我的 · 一局童年';
  const history = getHistory();
  const recent = history
    .map(item => ({ ...item, game: data.gamesById.get(item.id) }))
    .filter(item => item.game)
    .slice(0, 4);
  const playedCount = history.length;
  const totalSeconds = history.reduce((sum, item) => sum + item.seconds, 0);

  const el = document.createElement('div');
  el.className = 'page page-my';
  el.innerHTML = `<div class="my-topbar">
    <a class="my-icon-button" href="licenses.html" aria-label="模拟器来源与许可">?</a>
    <button class="my-icon-button" type="button" data-toast="更多功能即将开放" aria-label="更多">${icon('more')}</button>
  </div>
  <header class="my-profile">
    ${avatarMarkup('my-avatar')}
    <div class="my-profile-copy">
      <h1>一局童年玩家</h1>
      <p>本地档案 · 无需登录</p>
    </div>
    <button class="my-chevron" type="button" data-toast="账号功能暂未开放" aria-label="账号">${icon('chevron')}</button>
  </header>
  <button class="vip-card" type="button" data-toast="VIP 功能暂未开放，敬请期待">
    <span class="vip-copy">
      <strong>超级VIP专属</strong>
      <span>金手指 · 无限畅玩</span>
    </span>
    <span class="vip-buy">立即购买</span>
    <span class="vip-orbit orbit-one"></span>
    <span class="vip-orbit orbit-two"></span>
  </button>
  <section class="sync-card" id="sync-card">
    <div class="sync-head">
      <h2>云存档同步</h2>
      <span>跨设备</span>
    </div>
    <div id="sync-body">${syncMarkup()}</div>
  </section>
  <section class="my-recent">
    <div class="recent-head">
      <h2>最近在玩</h2>
      <p>玩过游戏 <b>${playedCount}</b><i>|</i>游戏时长 <b>${formatPlayTime(totalSeconds)}</b></p>
    </div>
    ${recent.length ? `<div class="recent-list">
      ${recent.map(item => `<article class="recent-row">
        <a class="card-hit" href="#/details?id=${encodeURIComponent(item.game.id)}" aria-label="查看 ${escapeHtml(item.game.name)}"></a>
        ${coverMarkup(item.game, { variant: 'recent' })}
        <div class="recent-info">
          <h3>${escapeHtml(item.game.name)}</h3>
          <p>${item.seconds ? `已玩 ${formatPlayTime(item.seconds)}` : '刚刚开始'} · ${formatRelativeTime(item.lastPlayed)}</p>
        </div>
        ${launchButton(item.game, '去玩')}
      </article>`).join('')}
    </div>` : emptyState('暂无游戏记录', '去首页挑一款游戏开始吧')}
  </section>`;

  return {
    el,
    mount() {
      const card = el.querySelector('#sync-card');
      const body = el.querySelector('#sync-body');
      const refresh = () => { body.innerHTML = syncMarkup(); };
      const onClick = async event => {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.dataset.syncCreate !== undefined) {
          target.disabled = true;
          try {
            const code = await createSyncCode();
            setSyncCode(code);
            refresh();
            toast('同步码已生成');
          } catch (error) {
            toast(`生成失败：${error.message}`);
            target.disabled = false;
          }
          return;
        }
        if (target.dataset.syncConnect !== undefined) {
          const input = card.querySelector('#sync-code-input');
          const code = normalizeSyncCode(input?.value);
          if (code.length !== 26) {
            toast('请输入 26 位同步码');
            return;
          }
          target.disabled = true;
          try {
            await listCloudSaves(code);
            setSyncCode(code);
            refresh();
            toast('已绑定同步码');
          } catch (error) {
            toast(`绑定失败：${error.message}`);
            target.disabled = false;
          }
          return;
        }
        if (target.dataset.syncCopy !== undefined) {
          const code = getSyncCode();
          try {
            await navigator.clipboard.writeText(code);
            toast('同步码已复制');
          } catch {
            window.prompt('复制同步码：', code);
          }
          return;
        }
        if (target.dataset.syncNow !== undefined) {
          target.disabled = true;
          try {
            const count = await syncLocalSaves();
            toast(count ? `已同步 ${count} 条存档` : '还没有可同步的本地存档');
          } catch (error) {
            toast(`同步失败：${error.message}`);
          } finally {
            target.disabled = false;
          }
          return;
        }
        if (target.dataset.syncStop !== undefined) {
          clearSyncCode();
          refresh();
          toast('已停止云同步');
        }
      };
      card.addEventListener('click', onClick);
      return () => card.removeEventListener('click', onClick);
    }
  };
}
