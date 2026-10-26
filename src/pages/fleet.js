import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/fleet — «Флот и войска» на новом движке (первая версия).
 * Флоты: состав старого образца (только просмотр) и корабли нового образца.
 * Производство: заказ кораблей по своим проектам из конструктора на верфях.
 * Армии: пока только просмотр, наземная часть ждёт переработки.
 * Сервер: v1_fleet_state, v1_production_order/cancel, v1_fleet_rename/create/transfer/disband.
 */

const STATUS = { idle: 'на стоянке', moving: 'в пути', battle: 'в бою', stalled: 'стоит без топлива' };
const SIZE = { S: 'малый', M: 'средний', L: 'крупный', XL: 'тяжёлый' };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
let tab = 'fleets';

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
  if (!root.querySelector('.fl-wrap')) root.innerHTML = '<div class="skeleton">Собираю доклад адмиралтейства…</div>';
  let s;
  try { s = await rpc('v1_fleet_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Адмиралтейство недоступно</h1><p>${e.missingSchema ? 'Новый движок флотов ещё не подключён в базе (миграция 33).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

const left = (t) => {
  const ms = new Date(t) - Date.now();
  if (ms <= 0) return 'сдаётся';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : `${h} ч ${m} мин`;
};

function draw(root, s) {
  const can = !!s.can_edit;
  const fleets = s.fleets || [], designs = s.designs || [], yards = s.shipyards || [], queue = s.queue || [], armies = s.armies || [];
  const cfg = s.settings || {};
  const W = cfg.weight || { S: 1, M: 2, L: 4, XL: 8 }, K = cfg.market_k || 1.5, MAXQ = cfg.max_qty || 50;
  const ships = fleets.reduce((a, f) => a + f.ships.reduce((b, x) => b + x.qty, 0), 0);
  const legacy = fleets.reduce((a, f) => a + f.legacy.reduce((b, x) => b + (x.qty || 0), 0), 0);
  const reload = () => renderFleet(root);
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); reload(); } catch (e) { toast(e.message, 'err'); } };

  const shipRow = (f, x) => {
    const peers = fleets.filter((g) => g.id !== f.id && g.system_id === f.system_id && g.status === 'idle' && !g.in_battle);
    return html`<li class="fl-ship">
      <span class="fl-q">×${num(x.qty)}</span>
      <span class="fl-n"><b>${x.name}</b><small>${x.class_name || x.class} · ${SIZE[x.size] || x.size}</small></span>
      <span class="fl-st"><i>${num(x.hp)} ПЗ</i><i>${num(x.damage)} урона</i><i>${fmt(x.speed)} скор.</i></span>
      ${can && peers.length && f.status === 'idle' && !f.in_battle ? raw(html`<span class="fl-mv">
        <input type="number" min="1" max="${x.qty}" value="${x.qty}" aria-label="Сколько перевести" data-q="${f.id}:${x.ship_id}">
        <select aria-label="В какой флот" data-to="${f.id}:${x.ship_id}">${peers.map((g) => raw(html`<option value="${g.id}">${g.name}</option>`))}</select>
        <button type="button" class="btn sm" data-mv="${f.id}:${x.ship_id}">Перевести</button></span>`) : ''}
    </li>`;
  };

  const fleetCard = (f) => {
    const empty = !f.ships.length && !f.legacy.length;
    const st = f.in_battle ? 'в бою' : (STATUS[f.status] || f.status);
    return html`<article class="panel fl-card${f.in_battle ? ' war' : ''}" data-fleet="${f.id}">
      <header class="fl-h">
        <div><h3>${f.name}${f.is_station ? raw(' <span class="pill">станция</span>') : ''}</h3>
          <small>${icon('i-map')}${f.system || f.system_id || '—'} · ${st}${f.fuel_cap ? ` · топливо ${fmt(f.fuel, 0)} / ${fmt(f.fuel_cap, 0)}` : ''}</small></div>
        ${can ? raw(html`<div class="fl-act"><button type="button" class="btn sm" data-ren="${f.id}">Переименовать</button>${empty ? raw(html`<button type="button" class="btn sm" data-dis="${f.id}">Распустить</button>`) : ''}</div>`) : ''}
      </header>
      ${f.ships.length ? raw(html`<p class="fl-sub">Новый образец</p><ul class="fl-list">${f.ships.map((x) => raw(shipRow(f, x)))}</ul>`) : ''}
      ${f.legacy.length ? raw(html`<p class="fl-sub old">Старый образец · до переноса только просмотр</p><ul class="fl-list old">${f.legacy.map((x) => raw(html`<li class="fl-ship">
          <span class="fl-q">×${num(x.qty)}</span><span class="fl-n"><b>${x.name || 'Без названия'}</b><small>${x.class || 'корабль'}</small></span>
          <span class="fl-st">${x.hp != null ? raw(html`<i>${num(x.hp)} ПЗ</i>`) : ''}${x.damage != null ? raw(html`<i>${num(x.damage)} урона</i>`) : ''}</span></li>`))}</ul>`) : ''}
      ${empty ? raw('<p class="empty">Флот пуст. Переведите сюда корабли или назначьте его целью заказа на верфи.</p>') : ''}
    </article>`;
  };

  const sysOpts = [...new Map([...yards.map((y) => [y.system_id, y.name]), ...fleets.map((f) => [f.system_id, f.system || f.system_id])]).entries()];
  const okDesigns = designs.filter((d) => d.ok);

  root.innerHTML = html`<div class="fl-wrap rx-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Флот и войска</h1>
        <p>Новый движок: корабли строятся по вашим проектам из <a href="#/shipyard">конструктора кораблей</a> на верфях колоний. Перелёты и сражения подключатся вместе с новыми картами боёв.</p>
      </div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Казна</small><b>${num(s.gc)} ГС</b></div>
        <div class="col-treasury"><small>Слотов верфей</small><b>${num(s.capacity)}</b></div>
      </div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но заказывать корабли и распоряжаться флотами могут только правитель и члены державы с правом «Производство».</p>')}

    <section class="panel fl-body">
      <div class="tabs" role="tablist">
        ${[['fleets', `Флоты · ${fleets.length}`], ['prod', `Производство${queue.length ? ` · ${queue.length}` : ''}`], ['army', `Армии · ${armies.length}`]].map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}
      </div>

      <div class="fl-pane" data-pane="fleets" ${tab === 'fleets' ? '' : raw('hidden')}>
        <div class="fl-sum"><span><b>${num(ships)}</b> кораблей нового образца</span><span><b>${num(legacy)}</b> старого образца</span>
          ${can ? raw(html`<form class="fl-new" id="fl-new"><input name="name" placeholder="Название нового флота" maxlength="48" required>
            <select name="sys" aria-label="Система">${sysOpts.map(([id, n]) => raw(html`<option value="${id}">${n}</option>`))}</select>
            <button class="btn sm gold">Создать флот</button></form>`) : ''}
        </div>
        <div class="fl-grid">${fleets.length ? fleets.map((f) => raw(fleetCard(f))) : raw('<p class="empty">У державы пока нет флотов. Первый появится сам, когда верфь сдаст заказ.</p>')}</div>
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
        ${(s.done || []).length ? raw(html`<p class="fl-sub">Недавно сданы</p><ul class="fl-done">${s.done.map((d) => raw(html`<li>${d.name} ×${d.qty}<small>${new Date(d.done_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></li>`))}</ul>`) : ''}
      </div>

      <div class="fl-pane" data-pane="army" ${tab === 'army' ? '' : raw('hidden')}>
        <p class="note">Наземные войска ждут переработки вместе с наземными сражениями. Пока армии видны здесь только для просмотра.</p>
        <div class="fl-grid">${armies.length ? armies.map((a) => raw(html`<article class="panel fl-card">
          <header class="fl-h"><div><h3>${a.name}</h3><small>${icon('i-planet')}${a.colony || '—'}${a.system ? ` · ${a.system}` : ''} · ${STATUS[a.status] || a.status}</small></div></header>
          <ul class="fl-list old">${(a.units || []).map((u) => raw(html`<li class="fl-ship"><span class="fl-q">×${num(u.qty)}</span><span class="fl-n"><b>${u.name || 'Без названия'}</b></span></li>`))}</ul>
        </article>`)) : raw('<p class="empty">Армий нет.</p>')}</div>
      </div>
    </section>
  </div>`;

  $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }));

  // ── флоты ──
  $$('[data-ren]', root).forEach((b) => (b.onclick = () => {
    const f = fleets.find((x) => x.id === b.dataset.ren);
    const card = b.closest('.fl-card'), h3 = $('h3', card);
    h3.innerHTML = html`<form class="fl-rn"><input value="${f.name}" maxlength="48" aria-label="Название флота"><button class="btn sm gold">Сохранить</button></form>`;
    const fm = $('form', h3), inp = $('input', fm);
    inp.focus(); inp.select();
    fm.onsubmit = (e) => { e.preventDefault(); run(() => rpc('v1_fleet_rename', { p_fleet: f.id, p_name: inp.value }), 'Флот переименован.'); };
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
  const nf = $('#fl-new', root);
  if (nf) nf.onsubmit = (e) => { e.preventDefault(); run(() => rpc('v1_fleet_create', { p_system: nf.sys.value, p_name: nf.name.value }), 'Флот создан.'); };

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
    let market = 0, shortList = [];
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
