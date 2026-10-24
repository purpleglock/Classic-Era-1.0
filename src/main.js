import { SPRITE } from './ui/icons.svg.js';
import { html, icon } from './lib/dom.js';
import { initSession, onSession, session } from './lib/session.js';
import { route, startRouter, render, setRouteListener, currentPath, setGuard } from './lib/router.js';
import { renderBanned } from './pages/banned.js';
import { renderHeader, renderFooter } from './ui/header.js';
import { renderHome } from './pages/home.js';
import { renderCabinet } from './pages/cabinet.js';
import { renderAdmin } from './pages/admin.js';
import { renderGuide, renderRules } from './pages/guide.js';
import { renderApply } from './pages/apply.js';
import { renderAccount } from './pages/account.js';
import { renderMap } from './pages/map.js';
import { renderNews } from './pages/news.js';
import { renderRegistry } from './pages/registry.js';
import { renderBattle } from './pages/battle.js';
import { renderHistory, renderWiki, renderLoreLink } from './pages/lore.js';
import { renderLegal } from './pages/legal.js';
import { renderStats } from './pages/stats.js';
import { renderColonize } from './pages/colonize.js';
import { renderResearch } from './pages/research.js';
import { renderColonies } from './pages/colonies.js';
import { renderOuter } from './pages/outer.js';
import { renderInner } from './pages/inner.js';
import { checkConsent } from './ui/consent.js';

const SOON = {
  wiki: 'Вики фракций', history: 'История', characters: 'Персонажи', help: 'Помощь',
  fleet: 'Флот и войска',
  designs: 'Конструкторы', techs: 'Конструктор технологий', war: 'Война', intel: 'Разведка', mining: 'Добыча ресурсов', trade: 'Торговля',
  arena: 'Арена', bar: 'Ресторан-бар «Классикал»',
};

document.body.insertAdjacentHTML('afterbegin', SPRITE);
document.getElementById('app').innerHTML = `
  <div class="page">
    <header class="panel top" id="top"></header>
    <main id="view" class="view"></main>
    <footer class="panel foot" id="foot"></footer>
  </div>`;

const view = () => document.getElementById('view');

// заблокированным — экран блокировки; правила и документы остаются доступны
setGuard(async (path) => {
  if (!session.user || !session.banned || session.role === 'team' || ['/rules', '/legal'].includes(path)) return false;
  await renderBanned(view());
  return true;
});

route('/', () => renderHome(view()));
route('/cabinet', () => renderCabinet(view()));
route('/admin', () => renderAdmin(view()));
route('/guide', () => renderGuide(view()));
route('/rules', () => renderRules(view()));
route('/apply', () => renderApply(view()));
route('/account', () => renderAccount(view()));
route('/map', () => renderMap(view()));
route('/news', () => renderNews(view()));
route('/registry', () => renderRegistry(view()));
route('/battle', () => renderBattle(view()));
route('/history', () => renderHistory(view()));
route('/wiki', () => renderWiki(view()));
route('/lore', () => renderLoreLink(view()));
route('/legal', () => renderLegal(view()));
route('/stats', () => renderStats(view()));
route('/colonize', () => renderColonize(view()));
route('/research', () => renderResearch(view()));
route('/colonies', () => renderColonies(view()));
route('/outer', () => renderOuter(view()));
route('/inner', () => renderInner(view()));
route('/soon', () => {
  const key = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  const title = SOON[key] || 'Раздел';
  view().innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-clock')}</span>
    <div><h1>${title}</h1><p>Раздел переносим на новый движок. Он появится здесь, как только будет готов.</p></div>
    <a class="btn" href="${session.user ? '#/cabinet' : '#/'}">${session.user ? 'В кабинет' : 'На главную'}</a>
    <a class="btn" href="#/guide">Гайдбук</a></section>`;
});

setRouteListener(() => { renderHeader(); checkConsent(); });
renderFooter();

initSession().then(() => {
  startRouter();
  // вход/выход меняет роль — перерисовываем текущую страницу
  let lastUser = session.user?.id;
  onSession(() => {
    if (session.user?.id !== lastUser) {
      lastUser = session.user?.id;
      if (!session.user && ['/cabinet', '/admin', '/account', '/apply'].includes(currentPath())) location.hash = '/';
      else render();
    }
    checkConsent();
  });
});
