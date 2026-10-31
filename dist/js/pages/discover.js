import { bannerMarkup, icon, listRow } from '../ui.js';

export function render({ data }) {
  document.title = '爽玩宝库 · 一局童年';
  const games = data.discover.map(id => data.gamesById.get(id)).filter(Boolean);
  const feature = data.banners.find(banner => banner.id === 'challenge') || data.banners[0];
  const el = document.createElement('div');
  el.className = 'page page-discover';
  el.innerHTML = `<header class="sub-header">
    <h1>爽玩宝库</h1>
  </header>
  <main class="discover-main">
    <a class="feature-banner" href="#/list?section=classic" aria-label="打开速通挑战专题">
      ${bannerMarkup(feature, { staticMode: true })}
    </a>
    <div class="discover-list">
      ${games.map(game => listRow(game, { button: '去玩', showHeat: true, showTags: false, className: 'discover-row' })).join('')}
    </div>
    <p class="discover-foot">${icon('gamepad')}<span>更多经典游戏正在路上</span></p>
  </main>`;
  return { el };
}
