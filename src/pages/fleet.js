import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';
import { uploadMedia } from '../lib/upload.js';

/**
 * #/fleet — «Флот и войска» на новом движке.
 * Флоты: герб, девиз, основная база; полёт по гиперлиниям с запасом хода, стойка «Оборона»
 * (перехват врага на пролёте), заправка на верфи, отзыв в пути. Прибытие к врагу — бой
 * на гекс-карте, к беззащитной системе врага — оккупация.
 * Армии: создаются из готовых войск на своей колонии, перебрасываются на 2 системы
 * по своей и оккупированной части региона, высаживаются на планеты врага (каждую — отдельно).
 * Производство: заказ кораблей по своим проектам на верфях.
 * Сервер: v1_fleet_state, v1_fleet_* и v1_army_* (миграция 40), v1_production_*.
 */

const STATUS = { idle: 'на стоянке', transit: 'в пути', v1_transit: 'в пути', v1_clearing: 'зачистка планеты', battle: 'в бою' };
const SIZE = { S: 'малый', M: 'средний', L: 'крупный', XL: 'тяжёлый' };
const COLORS = ['#e9b949', '#d9d4c7', '#c0563f', '#7aa7d9', '#7fc79a', '#b48ad9', '#e08a3c', '#5ec4c4'];
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const hhmm = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
let tab = 'fleets', poll = 0;

export async function renderFleet(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-ship')}</span><div><h1>Флот и войска</h1><p>Войдите, чтобы командовать флотами своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Флоты откроются вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  const tabQ = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  if (tabQ) tab = tabQ;
  if (!root.querySelector('.fl-wrap')) root.innerHTML = '<div class="skeleton">Собираю доклад адмиралтейства…</div>';
  let s;
  try { s = await rpc('v1_fleet_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Адмиралтейство недоступно</h1><p>${e.missingSchema ? 'Новый движок флотов ещё не подключён в базе.' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  const keep = window.scrollY;
  draw(root, s);
  window.scrollTo(0, keep);
  clearInterval(poll);
  // полёты и зачистки идут сами — раз в 30 секунд обновляем доклад, пока страница открыта
  poll = setInterval(() => {
    if (!root.querySelector('.fl-wrap') || !location.hash.startsWith('#/fleet')) { clearInterval(poll); return; }
    if (document.querySelector('.veil') || root.querySelector('form:focus-within')) return;
    renderFleet(root);
  }, 30000);
}

const left = (t) => {
  const ms = new Date(t) - Date.now();
  if (ms <= 0) return 'вот-вот';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : h ? `${h} ч ${m} мин` : `${Math.max(1, m)} мин`;
};

/** Герб: картинка или монограмма в цвете отряда. */
function crest(x, big = false) {
  const c = x.color || '#e9b949';
  if (x.emblem) return html`<span class="fl-crest${big ? ' big' : ''}" style="--c:${c}"><img src="${x.emblem}" alt="" loading="lazy"></span>`;
  const ini = String(x.name || '?').replace(/[«»"'\d-]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '★';
  return html`<span class="fl-crest mono${big ? ' big' : ''}" style="--c:${c}">${ini}</span>`;
}

function modal(title, body, wide = false) {
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.innerHTML = html`<article class="panel modal ${wide ? 'wide' : ''} fl-modal" role="dialog" aria-label="${title}">
    <button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button><h2>${title}</h2><div class="fl-mb">${raw(body)}</div></article>`;
  document.body.appendChild(veil);
  const close = () => { veil.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-close]')) close(); });
  return { box: veil.querySelector('.fl-mb'), close };
}

/** Поля «название · герб · цвет · девиз» (создание и правка флота или армии). */
function metaFields(x = {}, what = 'флота') {
  const col = x.color || COLORS[0];
  return html`<div class="fl-meta">
    <div class="fl-crest-pick">${raw(crest({ ...x, color: col }, true))}
      <div class="fl-cp"><label class="btn sm">${icon('i-image')}Герб или арт<input type="file" name="file" accept="image/*" hidden></label>
      <button type="button" class="btn sm" data-noimg ${raw(x.emblem ? '' : 'hidden')}>Убрать</button>
      <small>Квадратная картинка, до 15 МБ. Без картинки — монограмма.</small></div>
      <input type="hidden" name="emblem" value="${x.emblem || ''}"></div>
    <label><span>Название ${what}</span><input name="name" value="${x.name || ''}" maxlength="48" required placeholder="${what === 'флота' ? '1-я ударная эскадра' : '7-й гвардейский легион'}"></label>
    <label><span>Девиз (необязательно)</span><input name="motto" value="${x.motto || ''}" maxlength="120" placeholder="Сквозь тьму — к победе"></label>
    <div class="fl-colors" role="radiogroup" aria-label="Цвет">${COLORS.map((c) => raw(html`<label><input type="radio" name="color" value="${c}" ${raw(c === col ? 'checked' : '')}><i style="background:${c}"></i></label>`))}</div>
  </div>`;
}
function wireMeta(form, x = {}) {
  const prev = () => {
    const pick = $('.fl-crest-pick', form), emb = form.emblem.value;
    pick.querySelector('.fl-crest').outerHTML = crest({ name: form.name.value || x.name, emblem: emb, color: form.querySelector('[name=color]:checked')?.value }, true);
    $('[data-noimg]', form).hidden = !emb;
  };
  form.file.onchange = async () => {
    const f = form.file.files[0]; if (!f) return;
    try { toast('Загружаю герб…'); const r = await uploadMedia(f, { own: true, max: 512 }); form.emblem.value = r.url; prev(); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('[data-noimg]', form).onclick = () => { form.emblem.value = ''; prev(); };
  $$('[name=color]', form).forEach((r) => (r.onchange = prev));
  form.name.addEventListener('input', () => { if (!form.emblem.value) prev(); });
}
const metaVals = (form) => ({ name: form.name.value, emblem: form.emblem.value || null, color: form.querySelector('[name=color]:checked')?.value || null, motto: form.motto.value || null });

/** Полоса полёта: пройденные системы, текущее плечо, время прибытия. */
function flightBar(fl) {
  const t0 = new Date(fl.depart_at), t1 = new Date(fl.arrive_at), now = Date.now();
  const frac = Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)));
  const at = fl.route_at || [], route = fl.route || [fl.from, fl.to];
  let leg = 0; at.forEach((t, i) => { if (new Date(t) <= now) leg = i; });
  return html`<div class="fl-flight">
    <div class="fl-route">${route.map((n, i) => raw(html`<span class="${i <= leg ? 'past' : i === leg + 1 ? 'next' : ''}">${n}</span>`))}</div>
    <div class="fl-prog"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
    <small>${icon('i-clock')}прибытие ${hhmm(fl.arrive_at)} · через ${left(fl.arrive_at)}${fl.old ? ' · старый маршрут' : ''}</small></div>`;
}

function draw(root, s) {
  const can = !!s.can_edit, canArmy = !!s.can_army;
  const fleets = s.fleets || [], designs = s.designs || [], yards = s.shipyards || [], queue = s.queue || [], armies = s.armies || [];
  const battles = s.battles || [], pool = s.pool || [], colonies = s.colonies || [];
  const cfg = s.settings || {};
  const W = cfg.weight || { S: 1, M: 2, L: 4, XL: 8 }, K = cfg.market_k || 1.5, MAXQ = cfg.max_qty || 50;
  const ships = fleets.reduce((a, f) => a + f.ships.reduce((b, x) => b + x.qty, 0), 0);
  const legacy = fleets.reduce((a, f) => a + f.legacy.reduce((b, x) => b + (x.qty || 0), 0), 0);
  const moving = fleets.filter((f) => f.flight).length + armies.filter((a) => a.status === 'v1_transit').length;
  const reload = () => renderFleet(root);
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); reload(); return r; } catch (e) { toast(e.message, 'err'); } };

  const shipRow = (f, x) => {
    const peers = fleets.filter((g) => g.id !== f.id && g.system_id === f.system_id && g.status === 'idle' && !g.in_battle);
    return html`<li class="fl-ship">
      <span class="fl-q">×${num(x.qty)}</span>
      <span class="fl-n"><b>${x.name}</b><small>${x.class_name || x.class} · ${SIZE[x.size] || x.size}${x.jumps ? ` · ход ${x.jumps} пр.` : ''}</small></span>
      <span class="fl-st"><i>${num(x.hp)} ПЗ</i><i>${num(x.damage)} урона</i><i>${fmt(x.speed)} скор.</i></span>
      ${can && peers.length && f.status === 'idle' && !f.in_battle ? raw(html`<span class="fl-mv">
        <input type="number" min="1" max="${x.qty}" value="${x.qty}" aria-label="Сколько перевести" data-q="${f.id}:${x.ship_id}">
        <select aria-label="В какой флот" data-to="${f.id}:${x.ship_id}">${peers.map((g) => raw(html`<option value="${g.id}">${g.name}</option>`))}</select>
        <button type="button" class="btn sm" data-mv="${f.id}:${x.ship_id}">Перевести</button></span>`) : ''}
    </li>`;
  };

  const fleetCard = (f) => {
    const empty = !f.ships.length && !f.legacy.length, idle = f.status === 'idle' && !f.in_battle;
    const st = f.in_battle ? 'в бою' : (STATUS[f.status] || f.status);
    const cap = Number(f.fuel_cap || 0), fuel = Math.max(0, Number(f.fuel || 0));
    return html`<article class="panel fl-card${f.in_battle ? ' war' : ''}${f.stance === 'defend' ? ' guard' : ''}" data-fleet="${f.id}" style="--c:${f.color || '#e9b949'}">
      <header class="fl-h">
        ${raw(crest(f))}
        <div class="fl-ht"><h3>${f.name}${f.is_station ? raw(' <span class="pill">станция</span>') : ''}${f.stance === 'defend' ? raw(' <span class="pill guard">оборона</span>') : ''}</h3>
          ${f.motto ? raw(html`<em class="fl-motto">«${f.motto}»</em>`) : ''}
          <small>${icon('i-map')}${f.flight ? `${f.flight.from || '—'} → ${f.flight.to || '—'}` : (f.system || f.system_id || '—')} · ${st}</small>
          <small>${icon('i-flag')}Основная база: ${f.home || '—'}</small></div>
      </header>
      ${f.flight ? raw(flightBar(f.flight)) : ''}
      ${f.in_battle ? raw(html`<a class="btn sm danger fl-tobattle" href="#/battle?id=${f.battle}">${icon('i-sword')}К сражению</a>`) : ''}
      ${cap && !f.is_station ? raw(html`<div class="fl-fuel" title="Запас хода — сколько гиперпрыжков флот сделает без заправки">
        <span>${icon('i-fuel')}Запас хода</span><div class="fl-prog fuel"><i style="width:${Math.min(100, (fuel / cap) * 100).toFixed(1)}%"></i></div><b>${fmt(fuel, 0)} / ${fmt(cap, 0)} пр.</b></div>`) : ''}
      ${can && !f.is_station ? raw(html`<div class="fl-orders">
        ${idle && !empty ? raw(html`<button type="button" class="btn sm gold" data-send="${f.id}">${icon('i-ship')}Отправить</button>`) : ''}
        ${f.status === 'v1_transit' ? raw(html`<button type="button" class="btn sm" data-recall="${f.id}">${icon('i-back')}Отозвать</button>`) : ''}
        ${idle && f.shipyard_here && fuel < cap ? raw(html`<button type="button" class="btn sm" data-refuel="${f.id}">${icon('i-fuel')}Заправить</button>`) : ''}
        ${idle ? raw(html`<button type="button" class="btn sm" data-stance="${f.id}" aria-pressed="${f.stance === 'defend'}" title="В обороне флот перехватывает вражеские флоты, пролетающие через его систему">${icon('i-shield')}${f.stance === 'defend' ? 'В обороне' : 'Оборона'}</button>`) : ''}
        ${idle && f.system_id && f.system_id !== f.home_sys ? raw(html`<button type="button" class="btn sm" data-base="${f.id}">${icon('i-flag')}Сделать базой</button>`) : ''}
      </div>`) : ''}
      ${f.ships.length ? raw(html`<p class="fl-sub">Новый образец</p><ul class="fl-list">${f.ships.map((x) => raw(shipRow(f, x)))}</ul>`) : ''}
      ${f.legacy.length ? raw(html`<p class="fl-sub old">Старый образец</p><ul class="fl-list old">${f.legacy.map((x) => raw(html`<li class="fl-ship">
          <span class="fl-q">×${num(x.qty)}</span><span class="fl-n"><b>${x.name || 'Без названия'}</b><small>${x.class || 'корабль'}</small></span>
          <span class="fl-st">${x.hp != null ? raw(html`<i>${num(x.hp)} ПЗ</i>`) : ''}${x.damage != null ? raw(html`<i>${num(x.damage)} урона</i>`) : ''}</span></li>`))}</ul>`) : ''}
      ${empty ? raw('<p class="empty">Флот пуст. Переведите сюда корабли или назначьте его целью заказа на верфи.</p>') : ''}
      ${can ? raw(html`<footer class="fl-foot"><button type="button" class="btn sm" data-edit="${f.id}">Герб и название</button>${empty ? raw(html`<button type="button" class="btn sm" data-dis="${f.id}">Распустить</button>`) : ''}</footer>`) : ''}
    </article>`;
  };

  const armyCard = (a) => {
    const idle = a.status === 'idle' && !a.battle, enemy = (a.enemy_here || []).filter((c) => c.war && !c.taken);
    const where = a.status === 'v1_transit' ? `${a.system || '—'} → ${a.dest || '—'}` : `${a.system || '—'}${a.colony ? ` · ${a.colony}` : ' · на орбите'}`;
    return html`<article class="panel fl-card${a.battle ? ' war' : ''}" style="--c:${a.color || '#e9b949'}">
      <header class="fl-h">${raw(crest(a))}
        <div class="fl-ht"><h3>${a.name}</h3>${a.motto ? raw(html`<em class="fl-motto">«${a.motto}»</em>`) : ''}
          <small>${icon('i-planet')}${where} · ${a.battle ? 'в бою' : STATUS[a.status] || a.status}</small>
          <small>${icon('i-flag')}Основная база: ${a.home || '—'}</small></div></header>
      ${a.status === 'v1_transit' && a.arrive_at ? raw(html`<p class="fl-eta">${icon('i-clock')}Переброска: прибытие ${hhmm(a.arrive_at)} · через ${left(a.arrive_at)}</p>`) : ''}
      ${a.clearing ? raw(html`<p class="fl-eta hot">${icon('i-sword')}Зачистка «${a.clearing.colony}»: готово ${hhmm(a.clearing.ready)} · через ${left(a.clearing.ready)}</p>`) : ''}
      ${a.battle ? raw(html`<a class="btn sm danger fl-tobattle" href="#/battle?id=${a.battle}">${icon('i-sword')}К сражению</a>`) : ''}
      ${canArmy ? raw(html`<div class="fl-orders">
        ${idle ? raw(html`<button type="button" class="btn sm gold" data-amove="${a.id}">${icon('i-map')}Перебросить</button>`) : ''}
        ${idle && enemy.length ? raw(html`<button type="button" class="btn sm danger" data-aland="${a.id}">${icon('i-sword')}Высадка · ${enemy.length}</button>`) : ''}
        ${a.status === 'v1_clearing' ? raw(html`<button type="button" class="btn sm" data-acancel="${a.id}">Прервать зачистку</button>`) : ''}
        ${idle && a.colony_own && a.colony_id !== a.home_colony ? raw(html`<button type="button" class="btn sm" data-abase="${a.id}">${icon('i-flag')}Сделать базой</button>`) : ''}
      </div>`) : ''}
      <ul class="fl-list">${(a.units || []).map((u) => raw(html`<li class="fl-ship"><span class="fl-q">×${num(u.qty)}</span><span class="fl-n"><b>${u.name || 'Без названия'}</b><small>${u.category === 'aviation' ? 'авиация' : 'наземные войска'}</small></span></li>`))}</ul>
      ${canArmy ? raw(html`<footer class="fl-foot"><button type="button" class="btn sm" data-aedit="${a.id}">Герб и название</button>${idle && a.colony_own ? raw(html`<button type="button" class="btn sm" data-adis="${a.id}">Распустить</button>`) : ''}</footer>`) : ''}
    </article>`;
  };

  const sysOpts = [...new Map([...yards.map((y) => [y.system_id, y.name]), ...fleets.filter((f) => f.system_id).map((f) => [f.system_id, f.system || f.system_id])]).entries()];
  const okDesigns = designs.filter((d) => d.ok);

  root.innerHTML = html`<div class="fl-wrap rx-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Флот и войска</h1>
        <p>Флоты летают по гиперлиниям региона, стоят в обороне, вступают в бой и занимают системы врага. Армии перебрасываются по своей части региона и зачищают планеты. Корабли строятся по проектам из <a href="#/shipyard">конструктора</a>.</p>
      </div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Казна</small><b>${num(s.gc)} ГС</b></div>
        <div class="col-treasury"><small>В пути</small><b>${num(moving)}</b></div>
        <div class="col-treasury"><small>Слотов верфей</small><b>${num(s.capacity)}</b></div>
      </div>
    </section>
    ${battles.length ? raw(html`<section class="panel fl-battles"><b>${icon('i-sword')}Идут сражения</b>${battles.map((b) => raw(html`<a class="bm-chip ${b.my_turn ? 'hot' : ''}" href="#/battle?id=${b.id}">${b.kind === 'ground' ? `Высадка · ${b.colony || b.system}` : b.system} · ход ${b.turn}${b.my_turn ? ' · ваш ход' : ''}</a>`))}</section>`) : ''}
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но приказы флотам отдают правитель и члены державы с правом «Флот» или «Производство».</p>')}

    <section class="panel fl-body">
      <div class="tabs" role="tablist">
        ${[['fleets', `Флоты · ${fleets.length}`], ['army', `Армии · ${armies.length}`], ['prod', `Производство${queue.length ? ` · ${queue.length}` : ''}`]].map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}
      </div>

      <div class="fl-pane" data-pane="fleets" ${tab === 'fleets' ? '' : raw('hidden')}>
        <div class="fl-sum"><span><b>${num(ships)}</b> кораблей нового образца</span><span><b>${num(legacy)}</b> старого образца</span>
          ${can && sysOpts.length ? raw('<button type="button" class="btn sm gold fl-newbtn" id="fl-new">Новая флотилия</button>') : ''}
        </div>
        <div class="fl-grid">${fleets.length ? fleets.map((f) => raw(fleetCard(f))) : raw('<p class="empty">У державы пока нет флотов. Первый появится сам, когда верфь сдаст заказ.</p>')}</div>
        <p class="fl-note">Запас хода — в гиперпрыжках: у кораблей нового образца он берётся из проекта, у старых — 8. Заправка — в своей системе с верфью: сырьё со склада, недостающее — с рынка ×${String(K).replace('.', ',')}. Через закрытые границы флот не пройдёт (кроме войны). Флот врага в стойке «Оборона» перехватывает пролёт через свою систему. Прибытие туда, где стоит флот противника, начинает сражение; беззащитная система врага оккупируется.</p>
      </div>

      <div class="fl-pane" data-pane="army" ${tab === 'army' ? '' : raw('hidden')}>
        <div class="fl-sum"><span><b>${num(pool.reduce((a, p) => a + Number(p.qty || 0), 0))}</b> войск в резерве</span>
          ${canArmy && colonies.length ? raw(html`<button type="button" class="btn sm gold fl-newbtn" id="ar-new" ${raw(pool.length ? '' : 'disabled title="В резерве нет готовых войск: закажите их в производстве колоний"')}>Новая армия</button>`) : ''}</div>
        <div class="fl-grid">${armies.length ? armies.map((a) => raw(armyCard(a))) : raw('<p class="empty">Армий нет. Соберите первую из готовых войск резерва на одной из своих колоний.</p>')}</div>
        <p class="fl-note">Армия не тратит топливо, но перебрасывается не дальше чем на ${num(cfg.army_jumps || 2)} системы за раз — только по своей части региона и по системам, которые оккупировал ваш флот. В оккупированной системе врага армия высаживается на планеты: если на планете стоят войска защитника — начнётся наземный бой, если нет — зачистка по таймеру (столица держится дольше). Каждую планету, включая столицу, нужно зачищать отдельно. Занятая колония переходит к вам через несколько дней, если армия её удержит.</p>
      </div>

      <div class="fl-pane" data-pane="prod" ${tab === 'prod' ? '' : raw('hidden')}>
        ${!yards.length ? raw('<p class="note warn">У державы нет верфей. Постройте верфь в «Управлении колониями» — каждый открытый слот строит за сутки один малый корабль.</p>') : ''}
        ${!okDesigns.length ? raw('<p class="note">Нет готовых проектов. Соберите корабль в <a href="#/shipyard">конструкторе кораблей</a> — сюда попадают проекты без ошибок.</p>') : ''}
        ${can && yards.length && okDesigns.length ? raw(html`<form class="fl-order" id="fl-order">
          <label><span>Проект</span><select name="ship">${okDesigns.map((d) => raw(html`<option value="${d.id}">${d.name} · ${d.class_name || d.class}</option>`))}</select></label>
          <label><span>Количество</span><input name="qty" type="number" min="1" max="${MAXQ}" value="1"></label>
          <label><span>Верфь</span><select name="sys">${yards.map((y) => raw(html`<option value="${y.system_id}">${y.name || y.system_id} · слотов ${y.slots}</option>`))}</select></label>
          <label><span>Куда сдать</span><select name="fleet"></select></label>
          <div class="fl-est" id="fl-est"></div>
          <button class="btn gold">Заказать</button>
        </form>`) : ''}
        <p class="fl-note">Скорость общая для державы: все слоты верфей вместе строят за сутки ${num(s.capacity)} «малых» корабля. Средний весит как ${W.M}, крупный — ${W.L}, тяжёлый — ${W.XL}. Заказы идут по очереди. Сырьё берётся со склада, недостающее докупается по рыночной цене ×${String(K).replace('.', ',')}. Отмена возвращает всё.</p>
        <h3 class="fl-h3">Очередь верфей</h3>
        ${queue.length ? raw(html`<ul class="fl-queue">${queue.map((q, i) => raw(html`<li>
          <span class="fl-q">×${q.qty}</span><span class="fl-n"><b>${q.name}</b><small>${q.system || '—'} → ${q.fleet || 'Резерв верфи'}</small></span>
          <span class="fl-t">${icon('i-clock')}${i === 0 || new Date(q.started_at) <= new Date() ? left(q.ready_at) : `ждёт · ${left(q.ready_at)}`}</span>
          <span class="fl-c">${num(q.cost)} ГС</span>
          ${can ? raw(html`<button type="button" class="btn sm" data-cancel="${q.id}">Отменить</button>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Очередь пуста.</p>')}
        ${(s.done || []).length ? raw(html`<p class="fl-sub">Недавно сданы</p><ul class="fl-done">${s.done.map((d) => raw(html`<li>${d.name} ×${d.qty}<small>${hhmm(d.done_at)}</small></li>`))}</ul>`) : ''}
      </div>
    </section>
  </div>`;

  $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }));
  const fleetOf = (id) => fleets.find((x) => x.id === id), armyOf = (id) => armies.find((x) => x.id === id);

  // ── флоты: создание и правка ──
  $('#fl-new', root)?.addEventListener('click', () => {
    const m = modal('Новая флотилия', html`<form class="fl-mform" id="mf">${raw(metaFields({}, 'флота'))}
      <label><span>Где собрать</span><select name="sys">${sysOpts.map(([id, n]) => raw(html`<option value="${id}">${n}</option>`))}</select></label>
      <p class="hint">Флот появится пустым — переведите в него корабли из другого флота в той же системе или назначьте его целью заказа на верфи. Система сбора станет его основной базой.</p>
      <div class="acts"><button class="btn gold">Создать</button></div></form>`);
    const fm = $('#mf', m.box); wireMeta(fm); fm.name.focus();
    fm.onsubmit = (e) => { e.preventDefault(); const v = metaVals(fm); m.close(); run(() => rpc('v1_fleet_new', { p_system: fm.sys.value, p_name: v.name, p_emblem: v.emblem, p_color: v.color, p_motto: v.motto }), 'Флотилия создана.'); };
  });
  $$('[data-edit]', root).forEach((b) => (b.onclick = () => {
    const f = fleetOf(b.dataset.edit);
    const m = modal('Герб и название флота', html`<form class="fl-mform" id="mf">${raw(metaFields(f, 'флота'))}<div class="acts"><button class="btn gold">Сохранить</button></div></form>`);
    const fm = $('#mf', m.box); wireMeta(fm, f);
    fm.onsubmit = (e) => { e.preventDefault(); const v = metaVals(fm); m.close(); run(() => rpc('v1_fleet_meta_save', { p_fleet: f.id, p_name: v.name, p_emblem: v.emblem, p_color: v.color, p_motto: v.motto }), 'Сохранено.'); };
  }));
  $$('[data-dis]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Распустить пустой флот?', 'Распустить'))) return;
    run(() => rpc('v1_fleet_disband', { p_fleet: b.dataset.dis }), 'Флот распущен.');
  }));
  $$('[data-mv]', root).forEach((b) => (b.onclick = () => {
    const [from, ship] = b.dataset.mv.split(':');
    const q = $(`[data-q="${b.dataset.mv}"]`, root).value, to = $(`[data-to="${b.dataset.mv}"]`, root).value;
    run(() => rpc('v1_fleet_transfer', { p_from: from, p_to: to, p_ship: ship, p_qty: Number(q) || null }), 'Корабли переведены.');
  }));

  // ── флоты: приказы ──
  $$('[data-send]', root).forEach((b) => (b.onclick = async () => {
    const f = fleetOf(b.dataset.send);
    let list;
    try { list = await rpc('v1_fleet_targets', { p_fleet: f.id }); } catch (e) { toast(e.message, 'err'); return; }
    const m = modal(`Куда отправить «${f.name}»`, html`
      <p class="hint">Из системы ${f.system} · запас хода ${fmt(f.fuel, 0)} пр. Путь — кратчайший по времени; через закрытые границы флот не пройдёт.</p>
      <input class="fl-search" type="search" placeholder="Найти систему…" aria-label="Поиск системы">
      <ul class="fl-targets">${list.length ? list.map((t) => raw(html`<li><button type="button" data-to="${t.id}" data-name="${t.name.toLowerCase()}">
        <b>${t.name}</b><small>${t.owner_name ? t.owner === s.fid ? 'своя система' : t.owner_name : 'ничья'}${t.war ? raw(' <span class="tag bad">война</span>') : ''}</small>
        <span class="fl-tm">${t.jumps} пр. · ~${fmt(t.hours)} ч</span>
        <em>${(t.path || []).join(' → ')}</em></button></li>`)) : raw('<li class="empty">С таким запасом хода лететь некуда — заправьтесь на верфи.</li>')}</ul>`, true);
    const q = $('.fl-search', m.box); q.focus();
    q.oninput = () => $$('[data-to]', m.box).forEach((x) => (x.parentElement.hidden = !x.dataset.name.includes(q.value.trim().toLowerCase())));
    $$('[data-to]', m.box).forEach((x) => (x.onclick = async () => {
      const t = list.find((y) => y.id === x.dataset.to);
      const warn = t.war ? ' Это система противника: если там флоты врага — начнётся бой, если нет — система будет оккупирована.' : '';
      if (!(await confirmBox(`Отправить «${f.name}» в ${t.name}? ${t.jumps} пр., ~${fmt(t.hours)} ч в пути.${warn}`, 'Отправить'))) return;
      m.close();
      run(() => rpc('v1_fleet_send', { p_fleet: f.id, p_dest: t.id }), (r) => `Флот в пути: прибытие через ~${fmt(r.hours)} ч.`);
    }));
  }));
  $$('[data-recall]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Отозвать флот? Он развернётся и вернётся по пройденному пути, непройденные прыжки вернутся в баки.', 'Отозвать'))) return;
    run(() => rpc('v1_fleet_recall', { p_fleet: b.dataset.recall }), (r) => `Флот возвращается: прибытие ${hhmm(r.arrive_at)}.`);
  }));
  $$('[data-refuel]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Заправить флот до полного запаса хода? Сырьё возьмётся со склада, недостающее — с рынка.', 'Заправить'))) return;
    run(() => rpc('v1_fleet_refuel', { p_fleet: b.dataset.refuel }), (r) => `Баки полны${r?.market ? `: докуплено сырья на ${num(r.market)} ГС` : ''}.`);
  }));
  $$('[data-stance]', root).forEach((b) => (b.onclick = () => {
    const f = fleetOf(b.dataset.stance), next = f.stance === 'defend' ? 'normal' : 'defend';
    run(() => rpc('v1_fleet_stance', { p_fleet: f.id, p_stance: next }), next === 'defend' ? 'Флот встал в оборону: вражеские флоты на пролёте будут перехвачены.' : 'Флот снят с обороны.');
  }));
  $$('[data-base]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_fleet_base', { p_fleet: b.dataset.base }), 'Основная база перенесена.')));

  // ── армии ──
  $('#ar-new', root)?.addEventListener('click', () => {
    const m = modal('Новая армия', html`<form class="fl-mform" id="mf">${raw(metaFields({}, 'армии'))}
      <label><span>Колония сбора — станет основной базой</span><select name="colony">${colonies.map((c) => raw(html`<option value="${c.id}">${c.name} · ${c.system || ''}${c.capital ? ' · столица' : ''}</option>`))}</select></label>
      <p class="fl-sub">Войска из резерва</p>
      <ul class="fl-pool">${pool.map((p) => raw(html`<li><span class="fl-n"><b>${p.name}</b><small>${p.category === 'aviation' ? 'авиация' : 'наземные'} · в резерве ${num(p.qty)}</small></span>
        <input type="number" min="0" max="${p.qty}" value="0" data-unit="${p.unit_id}" aria-label="Сколько взять"><button type="button" class="btn sm" data-all="${p.unit_id}">Все</button></li>`))}</ul>
      <div class="acts"><button class="btn gold">Собрать армию</button></div></form>`, true);
    const fm = $('#mf', m.box); wireMeta(fm); fm.name.focus();
    $$('[data-all]', fm).forEach((x) => (x.onclick = () => { const i = $(`[data-unit="${x.dataset.all}"]`, fm); i.value = i.max; }));
    fm.onsubmit = (e) => {
      e.preventDefault();
      const units = $$('[data-unit]', fm).map((i) => ({ unit_id: i.dataset.unit, qty: Math.max(0, Math.min(Number(i.max), Number(i.value) || 0)) })).filter((u) => u.qty > 0);
      if (!units.length) { toast('Выберите хотя бы один отряд из резерва.', 'err'); return; }
      const v = metaVals(fm); m.close();
      run(() => rpc('v1_army_new', { p_colony: fm.colony.value, p_name: v.name, p_units: units, p_emblem: v.emblem, p_color: v.color, p_motto: v.motto }), 'Армия собрана.');
    };
  });
  $$('[data-aedit]', root).forEach((b) => (b.onclick = () => {
    const a = armyOf(b.dataset.aedit);
    const m = modal('Герб и название армии', html`<form class="fl-mform" id="mf">${raw(metaFields(a, 'армии'))}<div class="acts"><button class="btn gold">Сохранить</button></div></form>`);
    const fm = $('#mf', m.box); wireMeta(fm, a);
    fm.onsubmit = (e) => { e.preventDefault(); const v = metaVals(fm); m.close(); run(() => rpc('v1_army_meta_save', { p_army: a.id, p_name: v.name, p_emblem: v.emblem, p_color: v.color, p_motto: v.motto }), 'Сохранено.'); };
  }));
  $$('[data-amove]', root).forEach((b) => (b.onclick = async () => {
    const a = armyOf(b.dataset.amove);
    let list;
    try { list = await rpc('v1_army_targets', { p_army: a.id }); } catch (e) { toast(e.message, 'err'); return; }
    const m = modal(`Переброска «${a.name}»`, html`<p class="hint">Не дальше ${num(cfg.army_jumps || 2)} систем по своей и оккупированной части региона. Можно встать на свою колонию или остаться на орбите — из оккупированной системы врага армия высаживается на планеты.</p>
      <ul class="fl-targets">${list.map((t) => raw(html`<li><div class="fl-tg">
        <b>${t.name}</b><small>${t.jumps ? `${t.jumps} пр. · ~${fmt(t.hours)} ч` : 'армия здесь'}${t.occupied ? raw(' · <span class="tag bad">оккупирована вами</span>') : ''}</small>
        <div class="fl-tacts">${t.jumps ? raw(html`<button type="button" class="btn sm" data-go="${t.id}">На орбиту</button>`) : ''}
          ${(t.colonies || []).filter((c) => c.own && c.id !== a.colony_id).map((c) => raw(html`<button type="button" class="btn sm" data-go="${t.id}" data-col="${c.id}">${c.name}${c.capital ? ' ★' : ''}</button>`))}</div></div></li>`))}</ul>`, true);
    $$('[data-go]', m.box).forEach((x) => (x.onclick = () => {
      m.close();
      run(() => rpc('v1_army_move', { p_army: a.id, p_dest: x.dataset.go, p_colony: x.dataset.col || null }), (r) => r?.instant ? 'Армия заняла позицию.' : `Армия в пути: ~${fmt(r.hours)} ч.`);
    }));
  }));
  $$('[data-aland]', root).forEach((b) => (b.onclick = () => {
    const a = armyOf(b.dataset.aland), list = (a.enemy_here || []).filter((c) => c.war && !c.taken);
    const m = modal(`Высадка: «${a.name}»`, html`<p class="hint">Каждую планету зачищают отдельно, в том числе столицу. Если на планете стоят войска защитника — начнётся наземный бой.</p>
      <ul class="fl-targets">${list.map((c) => raw(html`<li><button type="button" data-col="${c.id}"><b>${c.name}${c.capital ? ' ★ столица' : ''}</b>
        <small>${c.owner}${c.defended ? raw(' · <span class="tag bad">гарнизон</span>') : ' · без гарнизона'}</small>
        <span class="fl-tm">${c.defended ? 'бой' : c.capital ? `зачистка ~${num(cfg.clear_capital_h || 8)} ч` : `зачистка ~${num(cfg.clear_h || 4)} ч`}</span></button></li>`))}</ul>`, true);
    $$('[data-col]', m.box).forEach((x) => (x.onclick = async () => {
      const c = list.find((y) => y.id === x.dataset.col);
      if (!(await confirmBox(`Высадиться на «${c.name}»?${c.defended ? ' Защитники примут бой.' : ''}`, 'Высадиться'))) return;
      m.close();
      const r = await run(() => rpc('v1_army_land', { p_army: a.id, p_colony: c.id }), (r) => r?.battle ? 'Высадка: начался наземный бой.' : `Зачистка началась: ~${fmt(r.hours)} ч.`);
      if (r?.battle) location.hash = `/battle?id=${r.battle}`;
    }));
  }));
  $$('[data-acancel]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Прервать зачистку? Таймер сбросится, армия останется на орбите.', 'Прервать'))) return;
    run(() => rpc('v1_army_cancel', { p_army: b.dataset.acancel }), 'Зачистка прервана.');
  }));
  $$('[data-abase]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_army_base', { p_army: b.dataset.abase }), 'Основная база перенесена.')));
  $$('[data-adis]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Распустить армию? Войска вернутся в резерв державы.', 'Распустить'))) return;
    run(() => rpc('v1_army_disband', { p_army: b.dataset.adis }), 'Армия распущена, войска в резерве.');
  }));

  // ── производство ──
  $$('[data-cancel]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Отменить заказ? Деньги и сырьё вернутся полностью, очередь сдвинется.', 'Отменить заказ'))) return;
    run(() => rpc('v1_production_cancel', { p_id: b.dataset.cancel }), 'Заказ отменён, всё возвращено.');
  }));
  const of = $('#fl-order', root);
  if (!of) return;
  const fillFleets = () => {
    const here = fleets.filter((f) => f.system_id === of.sys.value);
    of.fleet.innerHTML = html`<option value="">Резерв верфи (создастся сам)</option>${here.map((f) => raw(html`<option value="${f.id}">${f.name}</option>`))}`;
  };
  const estimate = () => {
    const d = okDesigns.find((x) => x.id === of.ship.value);
    const q = Math.max(1, Math.min(MAXQ, Number(of.qty.value) || 1));
    if (!d) return;
    let market = 0; const shortList = [];
    for (const [k, v] of Object.entries(d.bill || {})) {
      const need = Math.ceil(v * q), have = Math.max(0, Number(s.stock?.[k] || 0)), short = Math.max(0, need - have);
      if (short) { market += short * Number(s.prices?.[k] || 10) * K; shortList.push(k); }
    }
    market = Math.round(market);
    const cost = Number(d.cost || 0) * q, total = cost + market;
    const hours = Math.max(1, (W[d.size] || 2) * q * 24 / Math.max(1, s.capacity));
    const tail = queue.length ? Math.max(0, new Date(queue[queue.length - 1].ready_at) - Date.now()) / 3600e3 : 0;
    $('#fl-est', root).innerHTML = html`
      <span><small>Цена проекта</small><b>${num(cost)} ГС</b></span>
      <span><small>Докупка сырья</small><b class="${market ? 'warn' : ''}">${num(market)} ГС</b></span>
      <span><small>Итого</small><b class="${total > s.gc ? 'bad' : 'good'}">${num(total)} ГС</b></span>
      <span><small>Срок</small><b>${fmt(hours + tail)} ч</b></span>
      ${shortList.length ? raw(html`<em>Не хватает на складе: ${shortList.join(', ')}.</em>`) : raw('<em>Сырья на складе хватает.</em>')}`;
  };
  of.sys.onchange = fillFleets;
  of.ship.onchange = of.qty.oninput = estimate;
  fillFleets(); estimate();
  of.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await rpc('v1_production_order', { p_ship: of.ship.value, p_qty: Number(of.qty.value), p_system: of.sys.value, p_fleet: of.fleet.value || null });
      toast(`Заказ принят: ${num(r.cost + r.market)} ГС, сдача через ${fmt(r.hours)} ч работы верфей.`);
    });
  };
}
