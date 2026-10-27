import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { session, isTeam, roleTitle } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, signed, plain, dateShort, untilText, starDate } from '../lib/format.js';
import { rich } from '../lib/rich.js';
import { crest } from './home.js';
import { applyArt, settings } from '../lib/settings.js';

/** Редкие ресурсы подсвечиваются ярким золотом. */
const RARE = new Set(['Старвис', 'Реликтовое дерево', 'Стелларит', 'Хтонит', 'Ионит', 'Гравиядро', 'Рагенод', 'Ихор', 'Программируемая материя', 'Странный фрагмент']);

// Раскрывающийся список в плитке «Конструкторы»: без адреса — на переработке.
const CONSTRUCTORS = [
  ['i-ship', 'Конструктор кораблей', 'Палуба, модули, вооружение', '#/shipyard'],
  ['i-cube', 'Конструктор наземной техники', 'Танки, шагоходы, транспорт'],
  ['i-shield', 'Конструктор корпусов', 'Сплавы брони и корпуса', '#/hull'],
  ['i-fuel', 'Конструктор топлива', 'Свои марки топлива для кораблей', '#/fuel'],
  ['i-spark', 'Конструктор реактора', 'Энергия для систем и орудий', '#/reactor'],
  ['i-sword', 'Конструктор орудий', 'Пушки, лучи и ракеты', '#/weapon'],
];

const GROUPS = [
  ['Земля и власть', [
    ['stats', 'i-stat', 'Статистика державы', 'Казна, доходы, армия и достижения', '#/stats'],
    ['inner', 'i-crown', 'Внутренняя политика', 'Порядок, волнения, курс, вера', '#/inner'],
    ['outer', 'i-flag', 'Внешняя политика', 'Войны, союзы, кредиты, Сообщество', '#/outer'],
    ['colonize', 'i-planet', 'Колонизация', 'Захват систем и заселение планет', '#/colonize'],
    ['colonies', 'i-grid', 'Управление колониями', 'Застройка планет, ячейки и слоты', '#/colonies'],
    ['research', 'i-flask', 'Исследования', 'Дерево технологий и очередь', '#/research'],
    ['news', 'i-news', 'Вестник державы', 'Написать новость, мои публикации', '#/news'],
  ]],
  ['Флот и война', [
    ['map', 'i-map', 'Карта галактики', 'Системы, границы и маршруты', '#/map'],
    ['fleet', 'i-ship', 'Флот и войска', 'Флоты, армии и производство', '#/fleet'],
    ['registry', 'i-list', 'Реестр', 'Свои и общедоступные проекты', '#/registry'],
    ['constructors', 'i-wrench', 'Конструкторы', 'Корабли, техника, корпуса, топливо, реакторы, орудия', null, 'drop'],
    ['war', 'i-sword', 'Война', 'Ноты, сражения, оккупация'],
    ['intel', 'i-eye', 'Разведка', 'Агенты и тайные операции'],
  ]],
  ['Достаток', [
    ['mining', 'i-pick', 'Добыча ресурсов', 'Залежи, рабочие, концессии'],
    ['trade', 'i-cart', 'Торговля', 'Караваны, рынок, обмен'],
  ]],
  ['Досуг', [
    ['arena', 'i-arena', 'Арена', 'Космические и наземные поединки'],
    ['bar', 'i-glass', 'Ресторан-бар «Классикал»', 'Встречи, игры на удачу и слухи сектора'],
  ]],
];
const SOON = [['i-trend', 'Биржа', 'На переработке, вернётся в патче'], ['i-planet', 'Георазведка', 'На переработке']];

export async function renderCabinet(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-shield')}</span><div><h1>Кабинет державы</h1><p>Войдите, чтобы управлять своей державой.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (session.banned) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-shield')}</span><div><h1>Доступ ограничен</h1><p>Аккаунт заблокирован командой проекта. Напишите в Discord, если считаете это ошибкой.</p></div></section>`;
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`
      <section class="panel gate">
        <span class="m-ic">${icon('i-flag')}</span>
        <div><span class="role-badge" data-role="${session.role}">${roleTitle()}</span><h1>У вас пока нет державы</h1>
          <p>Подайте заявку: команда проекта рассмотрит анкету и откроет кабинет. Пока можно читать вестник и лор.</p></div>
        <a class="btn gold" href="#/apply">Подать заявку на державу</a>
      </section>
      ${session.schemaMissing ? raw(html`<p class="note warn">Роли ещё не подключены в базе: примените миграцию 20261023_01_roles.sql.</p>`) : ''}`;
    return;
  }

  root.innerHTML = html`<div class="skeleton">Загружаю державу…</div>`;
  const fid = session.factionId;
  const [eco, app, inc] = await Promise.all([
    sb.from('faction_economy').select('faction_id,gc,science,resources,last_tick,agents').eq('faction_id', fid).maybeSingle(),
    sb.from('faction_applications').select('name,gov,regime,race,planet_name,system_name,herald_url,color').eq('faction_id', fid).eq('status', 'approved').limit(1).maybeSingle(),
    sb.from('income_history').select('gc_net,sci,tick_at').eq('faction_id', fid).order('tick_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const e = eco.data || {}, a = app.data || {}, i = inc.data;
  const name = a.name || 'Держава';
  const sub = [a.gov, a.planet_name && `столица ${a.planet_name}`, a.race && a.race.toLowerCase()].filter(Boolean).join(' · ');
  const nextTick = e.last_tick ? new Date(e.last_tick).getTime() + 864e5 : null;
  const pct = nextTick ? Math.min(100, Math.max(0, 100 - ((nextTick - Date.now()) / 864e5) * 100)) : 0;
  const res = Object.entries(e.resources || {}).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);

  root.innerHTML = html`
    <section class="panel state">
      <div class="state-bg" aria-hidden="true">${crest(a.herald_url)}</div>
      <div class="state-head">
        <div class="state-name">
          <span class="role-badge" data-role="${session.role}">${roleTitle()}</span>
          <h1>${name}</h1>
          <p>${sub}</p>
        </div>
        <div class="state-acts">
          <a class="btn sm" href="#/guide">${icon('i-guide')}Как играть</a>
          <a class="btn sm" href="#/account">${icon('i-users')}Аккаунт</a>
          ${isTeam() ? raw(html`<a class="btn sm" href="#/admin">${icon('i-shield')}Админ-панель</a>`) : ''}
        </div>
      </div>
      <div class="money">
        <div><span class="m-ic">${icon('i-coin')}</span><span><small>Галактический стандарт</small><b>${num(e.gc)} ГС</b></span></div>
        <div><span class="m-ic">${icon('i-flask')}</span><span><small>Очки науки</small><b>${num(e.science)} ОН</b></span></div>
        <div><span class="m-ic">${icon('i-trend')}</span><span><small>Доход за сутки</small>
          <b>${i ? `${signed(i.gc_net)} ГС · ${signed(i.sci)} ОН` : '—'}</b>
          <span class="tick"><i style="--p:${pct.toFixed(0)}%"></i><em id="tick-left">${nextTick ? untilText(nextTick - Date.now()) : ''}</em></span></span></div>
      </div>
    </section>

    <section class="panel res" aria-label="Ресурсы планет">
      <div class="sec-h"><h2>Ресурсы планет</h2><small>${res.length} видов</small>${res.length > 12 ? raw(html`<button type="button" class="more" id="res-more" aria-expanded="false">Показать все ${icon('i-down')}</button>`) : ''}</div>
      <ul class="chips-res" id="res"></ul>
    </section>

    <div class="cab-cols">
      <div class="groups">
        ${GROUPS.map(([title, tiles], gi) => raw(html`<section aria-labelledby="g${gi}"><h2 class="g-h" id="g${gi}">${title}</h2><div class="tiles">
          ${tiles.map(([key, ic, t, s, href, kind]) => raw(kind === 'drop'
            ? html`<button type="button" class="tile tile-drop" aria-expanded="false" aria-controls="drop-${key}">${icon(ic)}<span><b>${t}</b><small>${s}</small></span>${icon('i-down', 'i chev')}</button>
              <div class="tile-menu" id="drop-${key}" hidden>${CONSTRUCTORS.map(([cic, ct, cs, chref], i) => raw(chref
                ? html`<a class="tile" href="${chref}">${icon(cic)}<span><b>${i + 1}. ${ct}</b><small>${cs}</small></span></a>`
                : html`<div class="tile off" title="Пересобираем с нуля">${icon(cic)}<span><b>${i + 1}. ${ct}</b><small>${cs} · на переработке</small></span></div>`))}</div>`
            : html`<a class="tile" href="${href || `#/soon?s=${key}`}">${icon(ic)}<span><b>${t}</b><small>${s}</small></span></a>`))}
        </div></section>`))}
        <section aria-labelledby="g-soon"><h2 class="g-h" id="g-soon">В разработке</h2><div class="tiles">
          ${SOON.map(([ic, t, s]) => raw(html`<div class="tile off">${icon(ic)}<span><b>${t}</b><small>${s}</small></span></div>`))}
        </div></section>
      </div>
      <aside class="panel feedbox" aria-label="Лента событий">
        <div class="tabs" role="tablist" aria-label="Лента">
          <button type="button" role="tab" id="t-sec" aria-selected="true" aria-controls="p-sec">Сектор</button>
          <button type="button" role="tab" id="t-you" aria-selected="false" aria-controls="p-you">О вас</button>
          <button type="button" role="tab" id="t-ach" aria-selected="false" aria-controls="p-ach">Достижения</button>
        </div>
        <ol class="ev" id="p-sec" role="tabpanel" aria-labelledby="t-sec"><li><p>Загружаю…</p></li></ol>
        <ol class="ev" id="p-you" role="tabpanel" aria-labelledby="t-you" hidden><li><p>Загружаю…</p></li></ol>
        <div id="p-ach" role="tabpanel" aria-labelledby="t-ach" hidden></div>
      </aside>
    </div>`;

  if (!a.herald_url) applyArt($('.state', root), 'cabinet');
  // напомнить задать имя, если его ещё нет
  sb.from('v1_names').select('user_id').eq('user_id', session.user.id).maybeSingle().then(({ data, error }) => {
    if (error || data) return;
    $('.state', root)?.insertAdjacentHTML('afterend', html`<p class="panel note-bar name-nudge">${icon('i-users')}<span>Задайте имя в игре — так вас будут видеть другие игроки.</span><a class="btn sm gold" href="#/account">Задать имя</a></p>`);
  });

  // ресурсы
  let all = false;
  const drawRes = () => {
    $('#res', root).innerHTML = (all ? res : res.slice(0, 12)).map(([k, v]) => html`<li class="${RARE.has(k) ? 'rare' : ''}"><i></i><b>${num(v)}</b><span>${k}</span></li>`).join('')
      || '<li><span>Склады пусты.</span></li>';
  };
  drawRes();
  const rm = $('#res-more', root);
  if (rm) rm.onclick = () => { all = !all; drawRes(); rm.setAttribute('aria-expanded', String(all)); rm.firstChild.textContent = all ? 'Свернуть ' : 'Показать все '; };

  // таймер до начисления
  if (nextTick) {
    const t = setInterval(() => {
      const el = document.getElementById('tick-left');
      if (!el) { clearInterval(t); return; }
      el.textContent = untilText(nextTick - Date.now());
    }, 30000);
  }

  // раскрывающиеся плитки («Конструкторы»)
  $$('.tile-drop', root).forEach((b) => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    $('#' + b.getAttribute('aria-controls'), root).hidden = !open;
  }));

  // вкладки ленты
  const tabs = $$('.tabs [role=tab]', root);
  tabs.forEach((tb) => tb.addEventListener('click', () => tabs.forEach((x) => {
    const on = x === tb; x.setAttribute('aria-selected', String(on)); $('#' + x.getAttribute('aria-controls'), root).hidden = !on;
  })));
  loadFeed(root, fid);
}

/** Вид сводки по заголовку: значок и подпись слева в ленте. */
const KIND = [
  [/Достижение/i, 'i-crown', 'Достижение'],
  [/Биржа/i, 'i-trend', 'Биржа'],
  [/Арена|Бойцовский клуб/i, 'i-arena', 'Арена'],
  [/войн|сражен|капитуляц|оккупац/i, 'i-sword', 'Война'],
  [/вер[аы]\b|храм|секта/i, 'i-spark', 'Вера'],
  [/флот|корабл|вооружени|верф/i, 'i-ship', 'Флот'],
  [/колонизац|колони[яи]\b|заселен|систем[аыу]\b/i, 'i-planet', 'Колонии'],
];
const kindOf = (title, from = '') => {
  if (/СЛУХИ/i.test(from)) return ['i-eye', 'Слухи'];
  const k = KIND.find(([re]) => re.test(title)); return k ? [k[1], k[2]] : ['i-news', 'Хроника'];
};
// старое название «Бойцовский клуб» в сводках показываем как «Арена»
const clean = (t) => plain(t || '').replace(/Бойцовский клуб/gi, 'Арена').replace(/клуба\b/gi, 'арены').replace(/^[^\p{L}\p{N}«]+/u, '');

async function loadFeed(root, fid) {
  const [sec, you, ach] = await Promise.all([
    sb.from('faction_news').select('id,title,body,excerpt,faction_id,faction_name,published_at,created_at').eq('status', 'approved').eq('kind', 'bulletin').order('created_at', { ascending: false }).limit(8),
    sb.from('faction_news').select('id,kind,title,body,excerpt,faction_id,faction_name,published_at,created_at').eq('status', 'approved').contains('mentions', [fid]).order('created_at', { ascending: false }).limit(8),
    sb.from('faction_achievements').select('ach_id,reward,earned_at').eq('faction_id', fid).order('earned_at', { ascending: false }).limit(8),
  ]);
  const [catRes, cfg] = await Promise.all([sb.from('v1_achievements').select('id,name,old_name,description'), settings().catch(() => ({}))]);
  const cat = Object.fromEntries((catRes?.data || []).map((x) => [x.id, x]));
  const st = cfg?.achievements?.status || 'rework';
  const achName = (id) => cat[id]?.name || cat[id]?.old_name || id;

  const secRows = (sec.data || []).filter((r) => !/^.?\s*Биржа/i.test(plain(r.title)));
  const youRows = you.data || [];
  const achRows = ach.data || [];
  const row = (key, i, title, at, [ic, label], gold = false) => html`<li><button type="button" class="ev-i${gold ? ' gold' : ''}" data-ev="${key}:${i}">
    <span class="ev-ic">${icon(ic)}</span><span class="ev-t"><small>${label}</small><b>${title}</b></span><time>${dateShort(at)}</time>${icon('i-down', 'i ev-go')}</button></li>`;

  $('#p-sec', root).innerHTML = secRows.map((r, i) => row('sec', i, clean(r.title), r.published_at || r.created_at, kindOf(r.title, r.faction_name))).join('') || '<li class="ev-none"><p>В секторе тихо.</p></li>';
  $('#p-you', root).innerHTML = youRows.map((r, i) => row('you', i, clean(r.title), r.published_at || r.created_at,
    r.kind === 'news' ? ['i-news', r.faction_name || 'Вестник'] : kindOf(r.title, r.faction_name), r.faction_id && r.faction_id !== fid)).join('') || '<li class="ev-none"><p>О вашей державе пока не писали.</p></li>';
  const banner = st === 'live' ? '' : html`<p class="note ach-note">${st === 'off' ? 'Достижения временно выключены.' : 'Система достижений на переработке: новые названия и награды скоро. Полученные достижения сохранены.'}</p>`;
  $('#p-ach', root).innerHTML = banner + (achRows.length
    ? html`<ol class="ev">${achRows.map((x, i) => raw(row('ach', i, `«${achName(x.ach_id)}»`, x.earned_at, ['i-crown', x.reward ? `+${num(x.reward)} ГС` : 'Достижение'], true)))}</ol>`
    : html`<div class="ev-empty">${icon('i-crown')}<p>Достижений пока нет. Первое появится здесь.</p></div>`);

  $('.feedbox', root).onclick = (e) => {
    const b = e.target.closest('[data-ev]'); if (!b) return;
    const [key, i] = b.dataset.ev.split(':');
    if (key === 'ach') {
      const x = achRows[i], a = cat[x.ach_id] || {};
      readBox({ label: 'Достижение державы', tag: x.reward ? `+${num(x.reward)} ГС` : '', at: x.earned_at, title: achName(x.ach_id),
        body: a.description || 'Описание достижения появится вместе с обновлённой системой достижений.',
        foot: a.old_name && a.name && a.old_name !== a.name ? `Прежнее название: «${a.old_name}».` : '' });
      return;
    }
    const r = (key === 'sec' ? secRows : youRows)[i];
    const [, label] = r.kind === 'news' ? [null, 'Вестник'] : kindOf(r.title, r.faction_name);
    readBox({ label: r.kind === 'news' ? (r.faction_name || 'Вестник') : label === 'Слухи' ? 'Слухи сектора' : 'Хроника сектора', tag: label, at: r.published_at || r.created_at,
      title: clean(r.title), body: clean(r.body || r.excerpt || ''), rich: r.kind === 'news', link: r.kind === 'news' ? `#/news?id=${r.id}` : '' });
  };
}

/** Окно чтения сводки поверх кабинета. */
function readBox({ label, tag, at, title, body, foot = '', rich: isRich = false, link = '' }) {
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.innerHTML = html`<article class="panel modal wide rule-modal ev-read" role="dialog" aria-label="${title}">
    <button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button>
    <div class="meta"><b>${label}</b>${tag ? raw(html`<span class="tag">${tag}</span>`) : ''}<time>${starDate(at)}</time></div>
    <h2>${title}</h2>
    <div class="rich">${raw(isRich ? rich(body) : body.split(/\n{2,}/).map((p) => html`<p>${p}</p>`).join(''))}</div>
    ${foot ? raw(html`<p class="note">${foot}</p>`) : ''}
    ${link ? raw(html`<a class="btn sm" href="${link}">Открыть страницей</a>`) : ''}
  </article>`;
  document.body.appendChild(veil);
  const close = () => { veil.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-close]') || e.target.closest('a[href]')) close(); });
  veil.querySelector('[data-close]').focus();
}
