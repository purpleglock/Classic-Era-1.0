import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { session, isTeam, roleTitle } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, signed, plain, dateShort, untilText } from '../lib/format.js';
import { crest } from './home.js';
import { applyArt, settings } from '../lib/settings.js';

/** Редкие ресурсы подсвечиваются ярким золотом. */
const RARE = new Set(['Старвис', 'Реликтовое дерево', 'Стелларит', 'Хтонит', 'Ионит', 'Гравиядро', 'Рагенод', 'Ихор', 'Программируемая материя', 'Странный фрагмент']);

// Раскрывающийся список в плитке «Конструкторы»: без адреса — на переработке.
const CONSTRUCTORS = [
  ['i-ship', 'Конструктор кораблей', 'Корпус, модули, вооружение'],
  ['i-cube', 'Конструктор наземной техники', 'Танки, шагоходы, транспорт'],
  ['i-shield', 'Конструктор корпусов', 'Сплавы брони и корпуса', '#/hull'],
  ['i-fuel', 'Конструктор топлива', 'Свои марки топлива для кораблей', '#/fuel'],
  ['i-spark', 'Конструктор реактора', 'Энергия для систем и орудий', '#/reactor'],
  ['i-sword', 'Конструктор орудий', 'Пушки, лучи и ракеты'],
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
    ['fleet', 'i-ship', 'Флот и войска', 'Флоты, армии и производство'],
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

async function loadFeed(root, fid) {
  const item = (n, gold) => html`<li><span class="dot ${gold ? 'gold' : ''}"></span><p>${n.title}</p><time>${dateShort(n.published_at || n.created_at)}</time></li>`;
  const [sec, you, ach] = await Promise.all([
    sb.from('faction_news').select('title,published_at,created_at').eq('status', 'approved').eq('kind', 'bulletin').order('created_at', { ascending: false }).limit(8),
    sb.from('faction_news').select('title,published_at,created_at,faction_id').eq('status', 'approved').contains('mentions', [fid]).order('created_at', { ascending: false }).limit(8),
    sb.from('faction_achievements').select('ach_id,reward,earned_at').eq('faction_id', fid).order('earned_at', { ascending: false }).limit(8),
  ]);
  const [cat, st] = await Promise.all([
    sb.from('v1_achievements').select('id,name,old_name').then((r) => Object.fromEntries((r.data || []).map((x) => [x.id, x]))),
    settings().then((s) => s.achievements?.status || 'rework'),
  ]);
  const achName = (id) => cat[id]?.name || cat[id]?.old_name || id;
  // старое название «Бойцовский клуб» в сводках показываем как «Арена»
  const fix = (r) => ({ ...r, title: plain(r.title).replace(/^🥊\s*/, '').replace(/Бойцовский клуб/gi, 'Арена').replace(/^[^\p{L}\p{N}]+/u, '') });
  const secRows = (sec.data || []).filter((r) => !/^.?\s*Биржа/i.test(plain(r.title))).map(fix);
  $('#p-sec', root).innerHTML = secRows.map((r) => item(r)).join('') || '<li><p>В секторе тихо.</p></li>';
  $('#p-you', root).innerHTML = (you.data || []).map((r) => item(fix(r), r.faction_id !== fid)).join('') || '<li><p>О вашей державе пока не писали.</p></li>';
  const a = ach.data || [];
  const banner = st === 'live' ? '' : html`<p class="note ach-note">${st === 'off' ? 'Достижения временно выключены.' : 'Система достижений на переработке: новые названия и награды скоро. Полученные достижения сохранены.'}</p>`;
  $('#p-ach', root).innerHTML = banner + (a.length
    ? html`<ol class="ev">${a.map((x) => raw(html`<li><span class="dot gold"></span><p>«${achName(x.ach_id)}»${x.reward ? ` · +${num(x.reward)} ГС` : ''}</p><time>${dateShort(x.earned_at)}</time></li>`))}</ol>`
    : html`<div class="ev-empty">${icon('i-crown')}<p>Достижений пока нет. Первое появится здесь.</p></div>`);
}
