import { html, raw, icon, $, esc } from '../lib/dom.js';
import { session, isTeam, roleTitle, roleShort, signOut } from '../lib/session.js';
import { go, currentPath } from '../lib/router.js';
import { openLogin } from './login.js';
import { sb } from '../lib/supabase.js';
import { dateShort } from '../lib/format.js';
import { settings } from '../lib/settings.js';
import { openRuleUpdate } from './rule-update.js';

const SEEN_KEY = 'ce.notif.seen';
function seenAt() { try { return localStorage.getItem(SEEN_KEY) || '1970-01-01'; } catch { return '1970-01-01'; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* приватный режим */ } }

let notifCache = null;
async function loadNotifications() {
  if (notifCache) return notifCache;
  const { data } = await sb.from('rules_updates').select('id,at,title,tag').order('at', { ascending: false }).limit(6);
  notifCache = data || [];
  return notifCache;
}

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

export function renderHeader() {
  const el = $('#top');
  const path = currentPath();
  const logged = !!session.user;
  el.innerHTML = html`
    <a class="brand" href="#/" aria-label="Классическая эра, главная"><span class="mark" id="mark">КЭ</span><b>Классическая эра</b></a>
    <ul class="nav" id="nav" aria-label="Главное меню">
      <li><a href="#/cabinet" data-play ${raw(path === '/cabinet' ? 'aria-current="page"' : '')}>${icon('i-play')}<span>Начать игру</span></a></li>
      <li>
        <button type="button" class="dd" id="lore-btn" aria-expanded="false" aria-controls="lore-menu">${icon('i-lore')}<span>Лор</span>${icon('i-down')}</button>
        <ul class="menu" id="lore-menu" hidden>
          <li><a href="#/wiki">Вики фракций</a></li>
          <li><a href="#/arsenal">Арсенал</a></li>
          <li><a href="#/history">История</a></li>
          <li><a href="#/soon?s=characters">Персонажи</a></li>
        </ul>
      </li>
      <li><a href="#/" data-vestnik>${icon('i-news')}<span>Вестник</span></a></li>
      <li><a href="#/guide" ${raw(path === '/guide' ? 'aria-current="page"' : '')}>${icon('i-guide')}<span>Гайдбук</span></a></li>
      <li><a href="#/rules" ${raw(path === '/rules' ? 'aria-current="page"' : '')}>${icon('i-rules')}<span>Правила</span></a></li>
      <li><a href="#/soon?s=help">${icon('i-help')}<span>Помощь</span></a></li>
    </ul>
    <div class="tools">
      <button type="button" class="ib burger" id="burger" aria-label="Меню" aria-expanded="false" aria-controls="nav">${icon('i-menu')}</button>
      <div class="bell-wrap">
        <button type="button" class="ib" id="bell" aria-label="Уведомления" aria-expanded="false" aria-controls="notif">${icon('i-bell')}</button>
        <div class="notif panel" id="notif" hidden>
          <div class="notif-h"><b>Уведомления</b><button type="button" class="more" id="read-all">Прочитать все</button></div>
          <ol id="notif-list"><li><p>Загружаю…</p></li></ol>
        </div>
      </div>
      ${logged ? raw(html`
        ${isTeam() ? raw(html`<a class="ib admin-btn" href="#/admin" aria-label="Админ-панель" title="Админ-панель">${icon('i-shield')}${session.pendingRequests ? raw(`<span class="badge">${session.pendingRequests}</span>`) : ''}</a>`) : ''}
        <a class="cab" href="#/cabinet" title="${roleTitle()}"><i>${session.avatar ? raw(html`<img src="${session.avatar}" alt="">`) : initials(session.displayName)}${session.discord ? raw(html`<em class="cab-ds" title="Подтверждён через Discord: ${session.discord}">${icon('i-check')}</em>`) : ''}</i><span><small>${roleShort()}</small><b>${session.displayName || 'Кабинет'}</b></span></a>
        <a class="ib" href="#/account" aria-label="Аккаунт и Discord" title="Аккаунт и Discord">${icon('i-users')}</a>
        <button type="button" class="ib" id="logout" aria-label="Выйти" title="Выйти">${icon('i-logout')}</button>`)
      : raw(html`<button type="button" class="btn gold sm" id="login-btn">Войти</button>`)}
    </div>`;

  // меню «Лор»
  const lb = $('#lore-btn', el), lm = $('#lore-menu', el);
  lb.onclick = (e) => { e.stopPropagation(); const o = lm.hidden; lm.hidden = !o; lb.setAttribute('aria-expanded', String(o)); };
  // бургер
  const nav = $('#nav', el), bur = $('#burger', el);
  bur.onclick = () => { const o = !nav.classList.contains('open'); nav.classList.toggle('open', o); bur.setAttribute('aria-expanded', String(o)); };
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); lm.hidden = true; } });
  // «Начать игру»: гость → вход, игрок → кабинет
  $('[data-play]', el).onclick = (e) => { if (!session.user) { e.preventDefault(); openLogin(); } };
  $('[data-vestnik]', el).onclick = (e) => {
    e.preventDefault();
    const scroll = () => document.getElementById('vestnik')?.scrollIntoView({ behavior: 'smooth' });
    if (currentPath() === '/') scroll(); else { go('/'); setTimeout(scroll, 300); }
  };
  // вход и выход
  $('#login-btn', el)?.addEventListener('click', () => openLogin());
  $('#logout', el)?.addEventListener('click', async () => { await signOut(); go('/'); });

  // уведомления: изменения правил и механик
  const bell = $('#bell', el), notif = $('#notif', el);
  loadNotifications().then((items) => {
    const since = seenAt();
    const unread = items.filter((x) => x.at > since).length;
    if (unread) bell.insertAdjacentHTML('beforeend', `<span class="badge">${unread}</span>`);
    bell.setAttribute('aria-label', unread ? `Уведомления: ${unread} новых` : 'Уведомления');
    $('#notif-list', el).innerHTML = items.length
      ? items.map((x) => html`<li class="${x.at > since ? 'unread' : ''}"><button type="button" class="notif-i" data-rid="${x.id}"><span class="tag ${x.at > since ? 'new' : ''}">${x.tag || 'правила'}</span><p>${x.title}</p><time>${dateShort(x.at)}</time></button></li>`).join('')
      : '<li><p>Пока нет уведомлений.</p></li>';
  }).catch(() => { $('#notif-list', el).innerHTML = '<li><p>Не удалось загрузить уведомления.</p></li>'; });
  $('#notif-list', el).onclick = (e) => { const b = e.target.closest('[data-rid]'); if (b) { notif.hidden = true; openRuleUpdate(b.dataset.rid); } };
  bell.onclick = (e) => { e.stopPropagation(); const o = notif.hidden; notif.hidden = !o; bell.setAttribute('aria-expanded', String(o)); };
  $('#read-all', el).onclick = () => {
    markSeen();
    notif.querySelectorAll('.unread').forEach((li) => { li.classList.remove('unread'); li.querySelector('.tag')?.classList.remove('new'); });
    bell.querySelector('.badge')?.remove();
    bell.setAttribute('aria-label', 'Уведомления');
  };
  // логотип из «Артов страниц»
  settings().then((st) => {
    const url = st.arts?.logo;
    if (url) $('#mark', el).innerHTML = html`<img src="${url}" alt="">`;
    $('#mark', el).classList.toggle('has-img', !!url);
    fitHeader();
  }).catch(() => {});
  fitHeader();
}

/**
 * Шапка-капсула ужимается по шагам, пока всё не влезет: компактнее пункты →
 * мельче шрифт меню → без надписи у логотипа → пункты меню только иконками. Считаем по факту, а не по
 * ширине экрана: состав шапки у гостя, игрока и команды проекта разный.
 */
export function fitHeader() {
  const el = document.getElementById('top');
  if (!el) return;
  const steps = ['t1', 't2', 't3', 't4'];
  el.classList.remove(...steps);
  if (matchMedia('(max-width: 760px)').matches) return; // на телефоне — бургер
  for (const s of steps) {
    const nav = el.querySelector('.nav');
    if (el.scrollWidth <= el.clientWidth + 1 && (!nav || nav.scrollWidth <= nav.clientWidth + 1)) break;
    el.classList.add(s);
  }
}
let fitT = 0;
addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitHeader, 80); });
// шрифт Manrope шире запасного: пересчитать, когда он догрузится
document.fonts?.ready.then(() => fitHeader());

// закрывать выпадашки кликом мимо
document.addEventListener('click', (e) => {
  const lm = document.getElementById('lore-menu');
  if (lm && !lm.hidden && !lm.contains(e.target)) { lm.hidden = true; document.getElementById('lore-btn')?.setAttribute('aria-expanded', 'false'); }
  const n = document.getElementById('notif');
  if (n && !n.hidden && !n.contains(e.target)) { n.hidden = true; document.getElementById('bell')?.setAttribute('aria-expanded', 'false'); }
});

export function renderFooter() {
  $('#foot').innerHTML = html`
    <a class="ds" href="https://discord.gg/jApCDH2zyM" target="_blank" rel="noopener"><i class="ds-ava"><img src="assets/ce-mark.png" alt=""></i><span>Discord<small>discord.gg/jApCDH2zyM</small></span></a>
    <nav class="docs" aria-label="Документы"><a href="#/legal?d=privacy">Политика конфиденциальности</a><a href="#/legal?d=terms">Пользовательское соглашение</a><a href="#/legal?d=consent">Согласие на обработку персональных данных</a></nav>
    <span class="copy">© 2025–2026 Classic Era</span>`;
}

export { esc };
