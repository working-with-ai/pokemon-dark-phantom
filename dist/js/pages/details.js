import { formatPlayTime, formatRelativeTime, getSaveSlots } from '../store.js';
import { coverMarkup, emptyState, escapeHtml, formatPlayers, icon } from '../ui.js';

function screenshotArt(game, shot, index) {
  return `<div class="shot-art shot-tone-${escapeHtml(shot.tone || 'forest')} shot-index-${index}">
    <span class="shot-sun"></span>
    <span class="shot-hills"></span>
    <span class="shot-ghost">${escapeHtml((game.shortName || game.name).slice(0, 1))}</span>
    <span class="shot-scan"></span>
    <span class="shot-label">${escapeHtml(shot.label || '游戏截图')}</span>
  </div>`;
}

function mediaChrome(game) {
  return `<span class="shot-center">${icon('play')}</span>
    <span class="shot-controls">
      <span class="shot-progress"><i></i></span>
      <span class="shot-control-row">
        <span class="shot-time">00:00 <em>/ 00:00</em></span>
        <span class="shot-icons">${icon('volume')}${icon('fullscreen')}</span>
      </span>
    </span>`;
}

function saveRows(game) {
  const slots = getSaveSlots(game.id);
  if (!slots.length) {
    return emptyState(
      game.playable ? '还没有本地存档' : '游戏上线后即可存档',
      game.playable ? '进入游戏后点击「存档」，进度会显示在这里' : '当前为占位条目'
    );
  }
  return `<div class="save-list">${slots.slice(0, 4).map(slot => `<article class="save-row">
    <a class="card-hit" href="#/play?id=${encodeURIComponent(game.id)}&amp;slot=${encodeURIComponent(slot.id)}" aria-label="继续 ${escapeHtml(slot.label)}"></a>
    ${coverMarkup(game, { variant: 'save' })}
    <div class="save-info">
      <h3>${escapeHtml(slot.label || '即时存档')}</h3>
      <p>${formatRelativeTime(slot.createdAt)} · 游玩 ${formatPlayTime(slot.seconds)}</p>
    </div>
    <button class="launch-btn save-go" type="button" data-launch="${escapeHtml(game.id)}" data-slot="${escapeHtml(slot.id)}">去玩</button>
  </article>`).join('')}</div>`;
}

function notFound() {
  const el = document.createElement('div');
  el.className = 'page page-details';
  el.innerHTML = `<header class="detail-nav is-scrolled">
    <button class="nav-back" type="button" data-back-home aria-label="返回">${icon('back')}</button>
    <span class="detail-nav-title">游戏详情</span>
  </header>
  <div class="detail-missing">
    ${emptyState('没有找到这款游戏', '它可能已经下架，或链接有误')}
    <a class="primary-pill" href="#/">回到首页</a>
  </div>`;
  document.title = '游戏详情 · 一局童年';
  return { el };
}

export function render({ data, query }) {
  const game = data.gamesById.get(query.get('id'));
  if (!game) return notFound();
  document.title = `${game.shortName || game.name} · 一局童年`;
  const shots = (game.screenshots && game.screenshots.length ? game.screenshots : [
    { label: '游戏画面', tone: 'forest' },
    { label: '冒险途中', tone: 'city' },
    { label: '挑战时刻', tone: 'dungeon' }
  ]).slice(0, 3);
  const available = Boolean(game.playable && game.core);

  const el = document.createElement('div');
  el.className = `page page-details ${available ? 'is-playable' : 'is-coming'}`;
  el.innerHTML = `<header class="detail-nav">
    <button class="nav-back" type="button" data-back aria-label="返回">${icon('back')}</button>
    <span class="detail-nav-title">${escapeHtml(game.name)}</span>
  </header>
  <main class="detail-main">
    <section class="detail-hero">
      ${coverMarkup(game, { variant: 'hero' })}
      <div class="detail-hero-copy">
        <h1>${escapeHtml(game.name)}</h1>
        <p><span>${escapeHtml(game.platform)}</span><i>·</i>${formatPlayers(game.players)}人在玩</p>
        ${available ? '' : '<span class="coming-badge">即将上线</span>'}
      </div>
      <div class="score-card">
        <span>评分</span>
        <strong>${Number(game.score || 0).toFixed(1)}</strong>
      </div>
    </section>
    <div class="shots-scroll" aria-label="游戏截图">
      ${shots.map((shot, index) => `<figure class="shot-slide">
        ${screenshotArt(game, shot, index)}
        <button class="shot-hit" type="button" data-launch="${escapeHtml(game.id)}" aria-label="${available ? '启动游戏' : '游戏即将上线'}"></button>
        ${mediaChrome(game)}
      </figure>`).join('')}
    </div>
    <section class="detail-copy">
      <div class="desc-wrap">
        <p class="detail-desc">${escapeHtml(game.desc || '这款游戏正在准备中。')}</p>
        <button class="desc-toggle" type="button">更多</button>
      </div>
    </section>
    <section class="cloud-save">
      <div class="cloud-head">
        <h2>云存档</h2>
        <span>保存在本机浏览器</span>
      </div>
      ${saveRows(game)}
    </section>
  </main>
  <div class="detail-bottom-bar">
    <button class="primary-launch" type="button" data-launch="${escapeHtml(game.id)}">
      <span>${icon('gamepad')}</span>启动游戏
    </button>
  </div>`;

  return {
    el,
    mount() {
      const nav = el.querySelector('.detail-nav');
      const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 112);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();

      const descWrap = el.querySelector('.desc-wrap');
      const toggle = el.querySelector('.desc-toggle');
      const onToggle = () => {
        const expanded = descWrap.classList.toggle('is-expanded');
        toggle.textContent = expanded ? '收起' : '更多';
      };
      toggle.addEventListener('click', onToggle);

      return () => {
        window.removeEventListener('scroll', onScroll);
        toggle.removeEventListener('click', onToggle);
      };
    }
  };
}
