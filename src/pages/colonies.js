import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, leftText } from '../lib/format.js';

/**
 * #/colonies — застройка колоний: постройки, слоты, обустройство среды, проекты.
 * Сервер: v1_colonies_state, v1_build, v1_open_slot, v1_demolish, v1_cancel_project, v1_habitat, v1_abandon.
 */

const CAT = { civ: 'Хозяйство', sci: 'Наука', order: 'Порядок', mil: 'Оборона и армия', faith: 'Вера' };
const KIND = {
  ideal: 'идеальный мир', terrestrial: 'землеподобный', oceanic: 'океанический', desert: 'пустынный', cryo: 'криомир',
  volcanic: 'вулканический', lava: 'лавовый', micro: 'малое тело', exotic: 'экзотический', gasgiant: 'газовый гигант',
  icegiant: 'ледяной гигант', hotgiant: 'горячий гигант', belt: 'пояс астероидов', anomaly: 'аномалия', std: 'обычный мир',
};
const BRANCH = { industry: 'Промышленность', military: 'Оборонзаказ', science: 'Образование' };
const PROJ = { build: 'Постройка', slot: 'Новый слот', habitat: 'Обустройство среды', terraform: 'Терраформ' };

export async function renderColonies(root, ui = { q: '', open: new Set() }) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-grid')}</span><div><h1>Управление колониями</h1><p>Войдите, чтобы застраивать колонии.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Колонии появятся вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.cl-wrap')) root.innerHTML = '<div class="skeleton">Поднимаю планы застройки…</div>';
  let s;
  try { s = await rpc('v1_colonies_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Колонии недоступны</h1><p>${e.missingSchema ? 'Управление колониями ещё не подключено в базе (миграция 18).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s, ui);
}

function draw(root, s, ui) {
  const cat = Object.fromEntries((s.catalog || []).map((b) => [b.btype, b]));
  const cols = s.colonies || [];
  const gc = Number(s.gc) || 0;
  const bm = Number(s.build_mult) || 1;
  const price = (c, base) => Math.max(1, Math.round(base * bm * (Number(c.world?.build) || 1)));
  const used = (c) => c.buildings.length + c.projects.filter((p) => p.kind === 'build').length;
  const totalCells = cols.reduce((a, c) => a + (Number(c.cells) || 0), 0);
  const totalUsed = cols.reduce((a, c) => a + used(c), 0);
  const busy = cols.reduce((a, c) => a + c.projects.length, 0) + (s.terraforms || []).length;

  root.innerHTML = html`<div class="cl-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Управление колониями</h1>
        <p>${cols.length} колоний · застроено <b>${num(totalUsed)} из ${num(totalCells)}</b> ячеек · проектов в работе ${busy}${bm !== 1 ? ` · стройка ×${bm.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} от доктрины` : ''}</p>
      </div>
      <div class="col-treasury"><small>В казне</small><b>${num(gc)} ГС</b></div>
    </section>
    ${(s.terraforms || []).length ? raw(html`<section class="panel note-bar cl-tf">${icon('i-planet')}<span>Идёт терраформ: ${s.terraforms.map((t) => `${t.name} (${leftText(new Date(t.ready_at) - Date.now())})`).join(', ')}</span><a class="btn sm" href="#/colonize">Колонизация</a></section>`) : ''}
    <section class="panel col-sec">
      <div class="sec-h"><h2>Колонии</h2><small>постройка готова через сутки</small>
        <input class="search" type="search" id="cl-q" value="${ui.q}" placeholder="Найти колонию или систему" aria-label="Найти колонию"></div>
      <p class="hint">У каждой постройки 6 слотов. Сколько из них работает, задаёт бюджет державы: гражданские — «Промышленность» (${s.budget ? `уровень ${s.budget.industry + 1} из 5` : ''}), военные — «Оборонзаказ» (${s.budget ? `${s.budget.military + 1} из 5` : ''}), институты и спецслужбы — «Образование» (${s.budget ? `${s.budget.science + 1} из 5` : ''}). Не хватает населения (3 жителя на слот) — слоты урезаются. <a href="#/inner?t=budget">Бюджет державы →</a></p>
      <div class="cl-list" id="cl-list"></div>
    </section></div>`;

  const list = $('#cl-list', root);
  const drawList = () => {
    const q = ui.q.toLowerCase();
    const rows = cols.filter((c) => !q || `${c.name} ${c.system}`.toLowerCase().includes(q));
    list.innerHTML = rows.length ? rows.map((c) => {
      const u = used(c), free = Math.max(0, c.cells - u);
      return html`<details class="cl-col" data-id="${c.id}" ${raw(ui.open.has(c.id) ? 'open' : '')}>
        <summary>
          <span class="cl-name"><b>${c.name}</b>${c.capital ? raw('<em class="cbadge on">Столица</em>') : ''}<small>${c.system || ''} · ${KIND[c.kind] || c.kind}</small></span>
          <span class="cl-cells" title="Застроено ячеек"><i style="--w:${Math.min(100, Math.round((u / Math.max(1, c.cells)) * 100))}%"></i><small>${u}/${c.cells}</small></span>
          ${c.projects.length ? raw(html`<span class="cbadge free">${c.projects.length} в работе</span>`) : ''}
          ${icon('i-down')}
        </summary>
        <div class="cl-body">
          <div class="cl-world">
            <span>Население <b>${num(c.pop)}</b></span>
            ${['pop', 'work', 'sci', 'build'].map((k) => raw(html`<span>${{ pop: 'рост', work: 'работа', sci: 'наука', build: 'стройка' }[k]} <b class="${(k === 'build' ? c.world[k] < 1 : c.world[k] > 1) ? 'good' : c.world[k] === 1 ? '' : 'bad'}">×${Number(c.world?.[k] ?? 1).toLocaleString('ru-RU')}</b></span>`))}
          </div>
          <ul class="cl-blds">${c.buildings.map((b) => raw(bld(b, cat[b.btype], s.can_manage, gc)))}
            ${c.projects.map((p) => raw(html`<li class="proj"><span class="b-n"><b>${PROJ[p.kind] || p.label}${p.btype ? `: ${cat[p.btype]?.name || p.btype}` : p.building_id ? `: ${cat[c.buildings.find((x) => x.id === p.building_id)?.btype]?.name || ''}` : ''}</b><small>готово через ${leftText(new Date(p.ready_at) - Date.now())}</small></span>
              ${s.can_manage ? raw(html`<button type="button" class="btn sm" data-cancel="${p.id}" data-label="${PROJ[p.kind] || p.label}">Отменить</button>`) : ''}</li>`))}
            ${!c.buildings.length && !c.projects.length ? raw('<li class="empty-li">Колония не застроена.</li>') : ''}</ul>
          ${s.can_manage ? raw(html`<div class="cl-acts">
            <button type="button" class="btn sm gold" data-pick="${c.id}" ${raw(free ? '' : 'disabled title="Нет свободных ячеек"')}>${icon('i-wrench')}Построить${free ? ` · свободно ${free}` : ''}</button>
            <button type="button" class="btn sm" data-hab="${c.id}" data-name="${c.name}" ${raw(c.projects.some((p) => p.kind === 'habitat') ? 'disabled' : '')}>+${s.habitat_cells} ячейки · ${num(s.habitat_cost)} ГС</button>
            ${c.capital ? '' : raw(html`<button type="button" class="btn sm danger" data-aban="${c.id}" data-name="${c.name}">Покинуть</button>`)}
          </div>`) : ''}
        </div></details>`;
    }).join('') : '<p class="st-mute">Ничего не найдено.</p>';
  };
  drawList();

  $('#cl-q', root).oninput = (e) => { ui.q = e.target.value.trim(); drawList(); };
  list.addEventListener('toggle', (e) => { const d = e.target.closest('details'); if (d) (d.open ? ui.open.add(d.dataset.id) : ui.open.delete(d.dataset.id)); }, true);

  const run = async (btn, fn, done) => {
    btn.disabled = true;
    try { const r = await fn(); if (done) toast(done(r)); renderColonies(root, ui); } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };

  $('.cl-wrap', root).onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.pick) { pick(cols.find((c) => c.id === d.pick), s, cat, price, gc, (btype) => run(t, () => rpc('v1_build', { p_colony: d.pick, p_btype: btype }), (r) => `Стройка начата за ${num(r.cost)} ГС · готово через сутки`)); return; }
    if (d.demo && await confirmBox(`Снести «${d.name}»? Вернётся половина цены постройки.`, 'Снести')) { run(t, () => rpc('v1_demolish', { p_building: d.demo }), (r) => `Снесено · возврат ${num(r.refund)} ГС`); return; }
    if (d.cancel && await confirmBox(`Отменить «${d.label}»? Деньги вернутся полностью.`, 'Отменить')) { run(t, () => rpc('v1_cancel_project', { p_project: d.cancel }), (r) => `Отменено · возврат ${num(r.refund)} ГС`); return; }
    if (d.hab && await confirmBox(`Обустроить среду на «${d.name}» за ${num(s.habitat_cost)} ГС? +${s.habitat_cells} ячейки через сутки.`, 'Обустроить')) { run(t, () => rpc('v1_habitat', { p_colony: d.hab }), () => 'Обустройство начато'); return; }
    if (d.aban && await confirmBox(`Покинуть колонию «${d.name}»? Все постройки исчезнут, деньги не вернутся.`, 'Покинуть')) { run(t, () => rpc('v1_abandon', { p_colony: d.aban }), () => 'Колония покинута'); }
  };
}

function bld(b, c, can, gc) {
  const name = c?.name || b.btype;
  const pips = Array.from({ length: 6 }, (_, i) => `<i class="${i < b.slots ? 'on' : ''}"></i>`).join('');
  return html`<li><span class="b-n"><b>${name}</b><small>${c?.descr || ''}</small></span>
    <span class="pips" title="Работает слотов: ${b.slots} из 6 — задаёт бюджет («${BRANCH[b.branch] || 'Промышленность'}»)">${raw(pips)}<small>${b.slots}/6</small></span>
    ${can ? raw(html`<button type="button" class="btn sm ghost" data-demo="${b.id}" data-name="${name}" aria-label="Снести ${name}">${icon('i-x')}</button>`) : ''}</li>`;
}

/** Выбор постройки: каталог с ценами для этой колонии. */
function pick(c, s, cat, price, gc, onPick) {
  const veil = document.createElement('div');
  veil.className = 'veil';
  const groups = Object.entries(CAT).map(([k, label]) => [label, (s.catalog || []).filter((b) => b.cat === k)]).filter(([, l]) => l.length);
  veil.innerHTML = html`<div class="panel modal cl-pick" role="dialog" aria-labelledby="cp-t">
    <div class="sec-h"><h2 id="cp-t">Построить на «${c.name}»</h2><button type="button" class="btn sm" data-x aria-label="Закрыть">${icon('i-x')}</button></div>
    ${groups.map(([label, l]) => raw(html`<h3>${label}</h3><ul>${l.map((b) => {
      const p = price(c, b.cost);
      const off = b.frozen || (b.only_on && !b.only_on.includes(c.kind) ? 'Не подходит этот мир' : '') || (gc < p ? 'Не хватает ГС' : '');
      return raw(html`<li class="${off ? 'off' : ''}"><span class="b-n"><b>${b.name}</b><small>${b.descr}</small>${off ? raw(html`<small class="why">${off}</small>`) : ''}</span>
        <button type="button" class="btn sm ${off ? '' : 'gold'}" data-b="${b.btype}" ${raw(off ? 'disabled' : '')}>${num(p)} ГС</button></li>`);
    })}</ul>`))}
  </div>`;
  document.body.appendChild(veil);
  const close = () => veil.remove();
  veil.onclick = (e) => {
    if (e.target === veil || e.target.closest('[data-x]')) { close(); return; }
    const b = e.target.closest('[data-b]');
    if (b) { close(); onPick(b.dataset.b); }
  };
  veil.querySelector('[data-x]').focus();
}
