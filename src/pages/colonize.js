import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, dateTime, leftText } from '../lib/format.js';
import { STAR_COLOR, STAR_NAME } from '../lib/galaxy.js';

/**
 * #/colonize — захват соседних систем и заселение планет.
 * Сервер: v1_colonize_state (сводка), v1_claim_system, v1_colonize. Цены — в v1_settings.colonize.
 */

const GROUP = {
  lava: 'лавовый', volcanic: 'вулканический', terrestrial: 'землеподобный', oceanic: 'океанический', desert: 'пустынный',
  cryo: 'криомир', micro: 'малое тело', exotic: 'экзотический', gasgiant: 'газовый гигант', icegiant: 'ледяной гигант',
  hotgiant: 'горячий гигант', belt: 'пояс астероидов', anomaly: 'аномалия', unknown: 'неизвестный тип',
};

// типы, которые сами по себе название группы — второй раз не пишем
const CLASS_TYPES = new Set(['Лавовые миры', 'Вулканические', 'Землеподобные', 'Океанические', 'Пустынные', 'Криомиры', 'Газовые гиганты', 'Ледяные гиганты', 'Горячие гиганты', 'Экзотические', 'Малые тела', 'Аномалии']);

export async function renderColonize(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-planet')}</span><div><h1>Колонизация</h1><p>Войдите, чтобы расширять державу.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Колонизация откроется, когда команда проекта одобрит заявку.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  root.innerHTML = '<div class="skeleton">Смотрю карту владений…</div>';
  let s;
  try { s = await rpc('v1_colonize_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Колонизация недоступна</h1><p>${e.missingSchema ? 'Колонизация ещё не подключена в базе (миграция 16).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s, ui = { q: '', free: true, open: new Set() }) {
  const r = s.rules || {}, c = s.claim || {};
  const left = Math.max(0, (Number(c.pool) || 1) - (Number(c.used) || 0));
  const cd = c.cooldown_until ? new Date(c.cooldown_until) : null;
  const gc = Number(s.gc) || 0;
  const canClaim = s.can_manage && !cd && left > 0 && gc >= Number(r.system_cost);
  const envs = r.native_all ? 'все миры' : (r.envs || []).map((g) => GROUP[g] || g).join(', ');
  const stations = [r.belt && `пояса (${r.belt} яч.)`, r.giant && `гиганты (${r.giant} яч.)`, r.anomaly && `аномалии (${r.anomaly} яч.)`].filter(Boolean);
  const systems = s.systems || [];
  const freeIn = (sys) => sys.bodies.filter((b) => !b.colony && (b.mode === 'colony' || b.mode === 'station')).length;
  const totalFree = systems.reduce((a, x) => a + freeIn(x), 0);

  root.innerHTML = html`<div class="col-wrap">
    <section class="panel st-hero col-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Колонизация</h1>
        <p>Родные миры: <b>${envs}</b>${stations.length ? ` · станции: ${stations.join(', ')}` : ' · станции не изучены'}</p>
      </div>
      <div class="col-treasury"><small>В казне</small><b>${num(gc)} ГС</b></div>
    </section>

    <section class="col-prices" aria-label="Цены">
      <div class="panel"><span class="kpi-ic">${icon('i-map')}</span><span><small>Захват системы</small><b>${num(r.system_cost)} ГС</b></span></div>
      <div class="panel"><span class="kpi-ic">${icon('i-planet')}</span><span><small>Колония на планете</small><b>${num(r.planet_cost)} ГС</b></span></div>
      <div class="panel"><span class="kpi-ic">${icon('i-cube')}</span><span><small>Станция</small><b>${num(r.station_cost)} ГС</b></span></div>
      <div class="panel ${cd ? 'cd' : ''}"><span class="kpi-ic">${icon('i-clock')}</span><span><small>Захватов доступно</small>
        <b>${cd ? `перерыв ${leftText(cd - Date.now())}` : `${left} из ${c.pool}`}</b>${cd ? raw(html`<em>до ${dateTime(cd)}</em>`) : raw(html`<em>затем перерыв ${r.claim_cd_days} дн.</em>`)}</span></div>
    </section>
    ${s.can_manage ? '' : raw('<p class="panel note-bar">Вы участник державы без права колонизации: смотреть можно, действовать — нет.</p>')}

    <section class="panel col-sec">
      <div class="sec-h"><h2>Новые системы по соседству</h2><small>${(s.frontier || []).length} ничьих систем на границе</small></div>
      ${(s.frontier || []).length ? raw(html`<div class="col-front">${s.frontier.map((f) => raw(html`
        <article class="col-sys">
          <span class="star" style="--sc:${STAR_COLOR[f.star_type] || '#e9b949'}" title="${STAR_NAME[f.star_type] || 'Звезда'}"></span>
          <div class="col-sys-b"><b>${f.name}</b>
            <small>${f.bodies} ${plural(f.bodies, 'тело', 'тела', 'тел')} · можно заселить ${f.open}</small>
            <small class="from">граничит с: ${(f.from || []).join(', ')}</small></div>
          <button type="button" class="btn sm gold" data-claim="${f.id}" data-name="${f.name}" ${raw(canClaim ? '' : 'disabled')}>Захватить</button>
        </article>`))}</div>`)
        : raw('<p class="st-mute">Свободных систем по соседству нет: все соседние системы уже заняты.</p>')}
    </section>

    <section class="panel col-sec">
      <div class="sec-h"><h2>Ваши системы</h2><small>${systems.length} систем · свободных миров ${totalFree}</small>
        <label class="check col-free"><input type="checkbox" id="col-free" ${raw(ui.free ? 'checked' : '')}> <span>Только с местом для колонии</span></label>
        <input class="search" type="search" id="col-q" value="${ui.q}" placeholder="Найти систему" aria-label="Найти систему"></div>
      <div class="col-list" id="col-list"></div>
    </section></div>`;

  const list = $('#col-list', root);
  const drawList = () => {
    const q = ui.q.toLowerCase();
    const rows = systems.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!ui.free || freeIn(x) > 0));
    list.innerHTML = rows.length ? rows.map((x) => {
      const free = freeIn(x), mine = x.bodies.filter((b) => b.colony?.mine).length;
      return html`<details class="col-own" data-id="${x.id}" ${raw(ui.open.has(x.id) ? 'open' : '')}>
        <summary><span class="star" style="--sc:${STAR_COLOR[x.star_type] || '#e9b949'}"></span><b>${x.name}</b>
          <small>колоний ${mine} · свободно ${free}</small>${icon('i-down')}</summary>
        <ul>${x.bodies.filter((b) => b.mode !== 'hidden').map((b) => raw(body(x, b, s, gc)))}</ul></details>`;
    }).join('') : `<p class="st-mute">${ui.free ? 'Во всех ваших системах уже нет места для новых колоний.' : 'Ничего не найдено.'}</p>`;
  };
  drawList();

  $('#col-q', root).oninput = (e) => { ui.q = e.target.value.trim(); drawList(); };
  $('#col-free', root).onchange = (e) => { ui.free = e.target.checked; drawList(); };
  list.addEventListener('toggle', (e) => { const d = e.target.closest('details'); if (d) (d.open ? ui.open.add(d.dataset.id) : ui.open.delete(d.dataset.id)); }, true);

  $('.col-wrap', root).onclick = async (e) => {
    const cl = e.target.closest('[data-claim]');
    const co = e.target.closest('[data-col]');
    if (!cl && !co) return;
    const btn = cl || co;
    let ok;
    if (cl) ok = await confirmBox(`Захватить систему «${cl.dataset.name}» за ${num(r.system_cost)} ГС?`, 'Захватить');
    else ok = await confirmBox(`${co.dataset.kind === 'station' ? 'Построить станцию' : 'Основать колонию'} на «${co.dataset.name}» за ${num(co.dataset.cost)} ГС?`, co.dataset.kind === 'station' ? 'Построить' : 'Основать');
    if (!ok) return;
    btn.disabled = true;
    try {
      if (cl) {
        const res = await rpc('v1_claim_system', { p_system_id: cl.dataset.claim });
        toast(`Система «${cl.dataset.name}» теперь ваша.${res.left ? ` Захватов осталось: ${res.left}.` : ' Начался перерыв.'}`);
        ui.open.add(cl.dataset.claim);
      } else {
        const res = await rpc('v1_colonize', { p_system_id: co.dataset.sys, p_pid: Number(co.dataset.col) });
        toast(`${res.mode === 'station' ? 'Станция' : 'Колония'} «${res.name}» основана · ${res.cells} яч.`);
        ui.open.add(co.dataset.sys);
      }
      const fresh = await rpc('v1_colonize_state');
      draw(root, fresh, ui);
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };
}

function body(sys, b, s, gc) {
  const kind = GROUP[b.grp] || b.type || 'мир';
  let state, act = '';
  if (b.colony) {
    state = b.colony.mine ? html`<span class="cbadge on">${b.colony.capital ? 'Столица' : 'Ваша колония'} · ${b.colony.cells} яч.</span>` : html`<span class="cbadge">Занято другой державой</span>`;
  } else if (b.mode === 'colony' || b.mode === 'station') {
    const isSt = b.mode === 'station';
    state = html`<span class="cbadge free">${isSt ? 'Станция' : 'Родной мир'} · ${b.cells} яч.</span>`;
    act = s.can_manage ? html`<button type="button" class="btn sm ${gc >= Number(b.cost) ? 'gold' : ''}" data-col="${b.pid}" data-sys="${sys.id}" data-name="${b.name}" data-kind="${b.mode}" data-cost="${b.cost}" ${raw(gc >= Number(b.cost) ? '' : 'disabled title="Не хватает ГС"')}>${isSt ? 'Станция' : 'Заселить'} · ${num(b.cost)}</button>` : '';
  } else if (b.mode === 'need_station') {
    state = html`<span class="cbadge dim">Нужна технология «${b.tech}»</span>`;
  } else if (b.mode === 'terraform') {
    state = html`<span class="cbadge dim">Не родной — нужен терраформ</span>`;
  } else {
    state = html`<span class="cbadge dim">Мёртвый мир</span>`;
  }
  const sub = b.type && !CLASS_TYPES.has(b.type) ? `${kind} · ${b.type}` : kind;
  return html`<li class="${b.colony ? 'taken' : ''}"><span class="b-n"><b>${b.name}</b><small>${sub}</small></span>${raw(state)}${raw(act)}</li>`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

