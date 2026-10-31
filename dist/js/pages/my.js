import { formatPlayTime, formatRelativeTime, getHistory } from '../store.js';
import { avatarMarkup, coverMarkup, emptyState, escapeHtml, icon, launchButton } from '../ui.js';

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
  return { el };
}
