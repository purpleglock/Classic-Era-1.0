import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { isTeam } from '../lib/session.js';
import { act } from '../lib/act.js';
import { loadGalaxy, dropGalaxyCache, STAR_NAME, newSystemId, solid } from '../lib/galaxy.js';
import { GalaxyView } from '../ui/galaxy-view.js';

const MODES = [
  ['select', 'Выбор и перенос', 'Клик — открыть систему. Перетащите звезду, чтобы перенести её.'],
  ['add', 'Новая звезда', 'Клик по пустому месту — новая система.'],
  ['link', 'Проложить путь', 'Клик по первой звезде, затем по второй.'],
  ['unlink', 'Удалить путь', 'Клик по линии гиперпути.'],
  ['sector', 'Секторы', 'Клик по звёздам — добавить или убрать их из сектора.'],
];
const GROUPS = { terrestrial: 'Землеподобная', oceanic: 'Океаническая', desert: 'Пустынная', volcanic: 'Вулканическая', lava: 'Лавовая', cryo: 'Криомир', micro: 'Малое тело', exotic: 'Экзотическая', gasgiant: 'Газовый гигант', icegiant: 'Ледяной гигант', hotgiant: 'Горячий гигант', belt: 'Пояс астероидов', anomaly: 'Аномалия', gaia: 'Идеальный мир' };
const AMOUNTS = ['следы', 'мало', 'умеренно', 'много', 'очень много', 'колоссально'];

let view = null;

export async function renderMap(root) {
  view?.destroy();
  root.innerHTML = html`
    <section class="panel map-head">
      <span class="m-ic">${icon('i-map')}</span>
      <div><h1>Карта галактики</h1><p id="map-sub">Загружаю карту…</p></div>
      <div class="acts">
        <input class="search" type="search" id="m-q" placeholder="Найти систему" aria-label="Найти систему" list="m-list"><datalist id="m-list"></datalist>
        ${isTeam() ? raw(html`<button type="button" class="btn sm" id="m-edit" aria-pressed="false">${icon('i-wrench')}Редактировать карту</button>`) : ''}
      </div>
    </section>
    <div class="panel map-tools" id="m-tools" hidden>
      <div class="seg" role="group" aria-label="Инструмент">${MODES.map(([k, t]) => raw(html`<button type="button" data-mode="${k}" aria-pressed="${String(k === 'select')}">${t}</button>`))}</div>
      <span class="hint" id="m-hint">${MODES[0][2]}</span>
    </div>
    <div class="map-wrap">
      <div class="panel map-stage">
        <canvas id="m-cv" aria-label="Карта галактики"></canvas>
        <div class="map-zoom"><button type="button" class="ib" id="z-in" aria-label="Приблизить">+</button><button type="button" class="ib" id="z-out" aria-label="Отдалить">−</button><button type="button" class="ib" id="z-fit" aria-label="Показать всю карту">${icon('i-map')}</button></div>
      </div>
      <aside class="panel map-side" id="m-side"><p class="empty">Выберите систему на карте.</p></aside>
    </div>`;

  let data;
  try { data = await loadGalaxy(); } catch (e) { $('#map-sub', root).textContent = `Не удалось загрузить карту: ${e.message}`; return; }
  const sub = () => { $('#map-sub', root).textContent = `${data.systems.length} систем · ${data.lanes.length} гиперпутей · ${data.sectors.length} секторов · ${data.systems.filter((s) => s.faction).length} под властью держав`; };
  sub();
  $('#m-list', root).innerHTML = data.systems.map((s) => html`<option value="${s.name}">`).join('');

  const side = $('#m-side', root);
  let editing = false, mode = 'select';
  const resCatalog = buildResCatalog(data);

  view = new GalaxyView($('#m-cv', root), data, {
    draggable: false,
    onPick: (s, ev) => {
      if (editing && mode === 'add' && !s) return addStar(ev.world);
      if (editing && mode === 'link' && s) return linkClick(s);
      if (editing && mode === 'sector' && s) return sectorToggle(s);
      view.selected = s; view.draw();
      if (editing && mode === 'select' && s) editForm(s); else if (!editing || mode === 'select') info(s);
    },
    onLane: (l) => { if (editing && mode === 'unlink') unlink(l); },
    onDrag: async (s, x, y, done) => {
      if (!done) return;
      try { const r = await act('map.system.move', s.id, { x, y }, null, { quiet: true }); if (r.status === 'pending') await reload(); }
      catch { await reload(); }
    },
  });
  view.draw();
  $('#m-cv', root).addEventListener('pointermove', (e) => { if (view.linkFrom) { view.setMouse(e); view.draw(); } });

  // зум и поиск
  $('#z-in', root).onclick = () => view.zoom(1.4);
  $('#z-out', root).onclick = () => view.zoom(1 / 1.4);
  $('#z-fit', root).onclick = () => view.reset();
  $('#m-q', root).onchange = (e) => {
    const s = data.systems.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (!s) { toast('Такой системы нет', 'err'); return; }
    view.k = Math.max(view.k, view.k0 * 3); view.selected = s; view.centerOn(s);
    editing && mode === 'select' ? editForm(s) : info(s);
  };

  // режим редактирования
  const editBtn = $('#m-edit', root);
  if (editBtn) editBtn.onclick = () => {
    editing = !editing;
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.lastChild.textContent = editing ? 'Готово' : 'Редактировать карту';
    $('#m-tools', root).hidden = !editing;
    setMode('select');
  };
  $('#m-tools', root).onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
  function setMode(m) {
    mode = m;
    $$('#m-tools [data-mode]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $('#m-hint', root).textContent = MODES.find(([k]) => k === m)[2];
    view.o.draggable = editing && m === 'select';
    view.o.laneClicks = editing && m === 'unlink';
    view.linkFrom = null; view.hotLane = null;
    view.draft = editing && m === 'sector' ? { id: null, name: 'Новый сектор', color: 'rgba(233,185,73,0.5)', lore: '', system_ids: [] } : null;
    view.draw();
    if (view.draft) sectorForm(); else if (view.selected) (editing ? editForm : info)(view.selected); else side.innerHTML = '<p class="empty">Выберите систему на карте.</p>';
  }

  async function reload() {
    dropGalaxyCache();
    data = await loadGalaxy(true);
    view.data = data;
    if (view.selected) view.selected = data.byId[view.selected.id] || null;
    view.draw(); sub();
  }

  // ── просмотр ──
  function info(s) {
    if (!s) { side.innerHTML = '<p class="empty">Выберите систему на карте.</p>'; return; }
    const owner = s.faction && data.factions[s.faction];
    const sec = data.sectors.find((x) => x.system_ids.includes(s.id));
    side.innerHTML = html`
      <span class="fac"><i style="background:${STAR_COLOR_CSS(s)}"></i>${STAR_NAME[s.star_type] || 'Звезда'}${s.is_giant ? ' · гигант' : ''}</span>
      <h2>${s.name}</h2>
      <dl class="kv"><dt>Владелец</dt><dd>${owner ? raw(html`<i class="sw" style="background:${solid(owner.color)}"></i>${owner.name}`) : 'ничья'}</dd>
        <dt>Сектор</dt><dd>${sec?.name || '—'}</dd><dt>Планет</dt><dd>${s.planets.length}</dd>
        <dt>Соседи</dt><dd>${neighbours(s).map((n) => n.name).join(', ') || '—'}</dd></dl>
      ${s.description ? raw(html`<p class="who">${s.description}</p>`) : ''}
      <ol class="planets">${s.planets.map((p) => raw(html`<li><b>${p.name || 'Без названия'}</b><span>${p.type || GROUPS[p.g] || ''}${p.slotsK ? ` · ячеек ${p.slotsK}` : ''}</span>
        ${(p.resources || []).length ? raw(html`<small>${p.resources.map((r) => `${r.name} — ${r.amt}`).join(', ')}</small>`) : ''}</li>`))}</ol>`;
  }
  const neighbours = (s) => data.lanes.filter((l) => l.a_id === s.id || l.b_id === s.id).map((l) => data.byId[l.a_id === s.id ? l.b_id : l.a_id]).filter(Boolean);

  // ── редактор системы ──
  function editForm(s) {
    if (!s) return;
    const owner = s.faction && data.factions[s.faction];
    const planets = structuredClone(s.planets);
    side.innerHTML = html`
      <h2>${s.name}</h2><p class="who">${s.id} · x ${s.x}, y ${s.y}</p>
      <label for="e-name">Название</label><input id="e-name" type="text" value="${s.name}">
      <div class="row2"><div><label for="e-star">Звезда</label><select id="e-star">${Object.entries(STAR_NAME).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === s.star_type ? 'selected' : '')}>${v}</option>`))}</select></div>
        <label class="check" for="e-giant"><input id="e-giant" type="checkbox" ${raw(s.is_giant ? 'checked' : '')}> Гигант</label></div>
      <label for="e-desc">Описание</label><textarea id="e-desc" rows="3">${s.description || ''}</textarea>
      <h3 class="sub-h">Планеты</h3><div id="e-planets"></div>
      <button type="button" class="btn sm" id="e-add-p">+ Планета</button>
      <h3 class="sub-h">Владелец</h3>
      <div class="give"><select id="e-owner"><option value="">ничья</option>${Object.entries(data.factions).map(([id, f]) => raw(html`<option value="${id}" ${raw(id === s.faction ? 'selected' : '')}>${f.name}</option>`))}</select><button type="button" class="btn sm" id="e-owner-save">Сменить</button></div>
      <p class="hint">Сейчас: ${owner?.name || 'ничья'}. Смена владельца — игровое действие, у админа она идёт через одобрение.</p>
      <div class="acts"><button type="button" class="btn gold sm" id="e-save">Сохранить</button><button type="button" class="btn sm danger" id="e-del">Удалить систему</button></div>`;
    const box = $('#e-planets', side);
    const drawPlanets = () => {
      box.innerHTML = planets.map((p, i) => html`<div class="pl" data-i="${i}">
        <div class="give"><input type="text" data-f="name" value="${p.name || ''}" placeholder="Название" aria-label="Название планеты">
          <select data-f="g" aria-label="Тип планеты"><option value="" ${raw(p.g ? '' : 'selected')}>${p.type || 'тип не задан'}</option>${Object.entries(GROUPS).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === p.g ? 'selected' : '')}>${v}</option>`))}</select>
          <input type="number" data-f="slotsK" value="${p.slotsK ?? 6}" min="0" max="12" aria-label="Ячейки" title="Ячейки"><button type="button" class="ib" data-del aria-label="Удалить планету">${icon('i-x')}</button></div>
        <div class="res">${(p.resources || []).map((r, j) => raw(html`<span class="tag" data-j="${j}">${r.name} — ${r.amt} <button type="button" data-rdel aria-label="Убрать ресурс">×</button></span>`))}
          <select data-radd aria-label="Добавить ресурс"><option value="">+ ресурс</option>${Object.keys(resCatalog).sort().map((n) => raw(html`<option>${n}</option>`))}</select>
          <select data-ramt aria-label="Запас">${AMOUNTS.map((a) => raw(html`<option ${raw(a === 'умеренно' ? 'selected' : '')}>${a}</option>`))}</select></div></div>`).join('') || '<p class="empty">Планет нет.</p>';
    };
    drawPlanets();
    box.oninput = (e) => {
      const pl = e.target.closest('.pl'); const f = e.target.dataset.f; if (!pl || !f) return;
      const p = planets[pl.dataset.i];
      p[f] = f === 'slotsK' ? Number(e.target.value || 0) : e.target.value;
      if (f === 'g' && !p.g) p.g = null;
      if (f === 'g' && p.g) { p.type = GROUPS[p.g]; p.kind = p.g === 'belt' ? 'belt' : 'planet'; }
    };
    box.onclick = (e) => {
      const pl = e.target.closest('.pl'); if (!pl) return;
      const p = planets[pl.dataset.i];
      if (e.target.closest('[data-del]')) { planets.splice(pl.dataset.i, 1); drawPlanets(); }
      if (e.target.closest('[data-rdel]')) { p.resources.splice(e.target.closest('[data-j]').dataset.j, 1); drawPlanets(); }
    };
    box.onchange = (e) => {
      if (!e.target.matches('[data-radd]') || !e.target.value) return;
      const p = planets[e.target.closest('.pl').dataset.i];
      const amt = e.target.closest('.res').querySelector('[data-ramt]').value;
      (p.resources ||= []).push({ ...resCatalog[e.target.value], name: e.target.value, amt });
      drawPlanets();
    };
    $('#e-add-p', side).onclick = () => {
      const pid = Math.max(0, ...planets.map((p) => p.pid || 0)) + 1;
      planets.push({ pid, name: `${s.name} ${toRoman(pid)}`, g: 'terrestrial', type: GROUPS.terrestrial, kind: 'planet', slotsK: 6, slotsP: 0, resources: [], moons: 0, rings: 0 });
      drawPlanets();
    };
    $('#e-save', side).onclick = async () => {
      const payload = { name: $('#e-name', side).value.trim(), star_type: $('#e-star', side).value, is_giant: $('#e-giant', side).checked, description: $('#e-desc', side).value, planets, x: s.x, y: s.y };
      const r = await act('map.system.save', s.id, payload).catch(() => null);
      if (r) { await reload(); editForm(view.selected); }
    };
    $('#e-del', side).onclick = async () => {
      if (!(await confirmBox(`Удалить систему «${s.name}» вместе с её гиперпутями?`, 'Удалить'))) return;
      const r = await act('map.system.delete', s.id).catch(() => null);
      if (r?.status === 'done') { view.selected = null; await reload(); side.innerHTML = '<p class="empty">Система удалена.</p>'; }
    };
    $('#e-owner-save', side).onclick = async () => {
      const v = $('#e-owner', side).value;
      if (!(await confirmBox(`Сменить владельца «${s.name}» на «${v ? data.factions[v].name : 'ничья'}»?`, 'Сменить'))) return;
      const r = await act('map.system.owner', s.id, { faction: v }).catch(() => null);
      if (r?.status === 'done') { await reload(); editForm(view.selected); }
    };
  }

  async function addStar([x, y]) {
    const id = newSystemId();
    const r = await act('map.system.save', id, { name: 'Новая система', star_type: 'yellow', x, y, is_giant: false, description: '', planets: [] }).catch(() => null);
    if (!r) return;
    await reload();
    view.selected = data.byId[id] || null; view.draw();
    setMode('select');
    if (view.selected) editForm(view.selected);
  }

  async function linkClick(s) {
    if (!view.linkFrom) { view.linkFrom = s; view.draw(); return; }
    if (view.linkFrom === s) { view.linkFrom = null; view.draw(); return; }
    const a = view.linkFrom.id, b = s.id;
    view.linkFrom = null;
    const r = await act('map.lane.add', null, { a, b }, null, { quiet: true }).catch(() => null);
    if (r) { await reload(); toast(r.status === 'pending' ? 'Заявка отправлена' : `Путь проложен: ${data.byId[a]?.name} — ${data.byId[b]?.name}`); }
    view.draw();
  }

  async function unlink(l) {
    view.hotLane = l.id; view.draw();
    const a = data.byId[l.a_id]?.name, b = data.byId[l.b_id]?.name;
    if (!(await confirmBox(`Удалить гиперпуть ${a} — ${b}?`, 'Удалить'))) { view.hotLane = null; view.draw(); return; }
    const r = await act('map.lane.delete', l.id).catch(() => null);
    view.hotLane = null;
    if (r?.status === 'done') await reload(); else view.draw();
  }

  // ── секторы ──
  function sectorToggle(s) {
    const ids = view.draft.system_ids;
    const i = ids.indexOf(s.id);
    if (i >= 0) ids.splice(i, 1); else ids.push(s.id);
    view.draw(); sectorForm();
  }
  function sectorForm() {
    const d = view.draft;
    side.innerHTML = html`
      <h2>Сектор</h2>
      <label for="s-pick">Изменить существующий</label>
      <select id="s-pick"><option value="">— новый сектор —</option>${data.sectors.map((x) => raw(html`<option value="${x.id}" ${raw(x.id === d.id ? 'selected' : '')}>${x.name} (${x.system_ids.length})</option>`))}</select>
      <label for="s-name">Название</label><input id="s-name" type="text" value="${d.name}">
      <label for="s-color">Цвет</label><input id="s-color" type="color" value="${hexOf(d.color)}">
      <label for="s-lore">Лор сектора</label><textarea id="s-lore" rows="5">${d.lore || ''}</textarea>
      <p class="hint">Систем в секторе: ${d.system_ids.length}. Кликайте по звёздам на карте, чтобы добавить или убрать их.</p>
      <div class="acts"><button type="button" class="btn gold sm" id="s-save">Сохранить сектор</button>${d.id ? raw('<button type="button" class="btn sm danger" id="s-del">Удалить сектор</button>') : ''}</div>`;
    $('#s-pick', side).onchange = (e) => {
      const x = data.sectors.find((q) => q.id === e.target.value);
      view.draft = x ? { ...x, system_ids: [...x.system_ids] } : { id: null, name: 'Новый сектор', color: 'rgba(233,185,73,0.5)', lore: '', system_ids: [] };
      view.draw(); sectorForm();
    };
    $('#s-name', side).oninput = (e) => { d.name = e.target.value; };
    $('#s-lore', side).oninput = (e) => { d.lore = e.target.value; };
    $('#s-color', side).oninput = (e) => { d.color = rgbaOf(e.target.value, 0.5); view.draw(); };
    $('#s-save', side).onclick = async () => {
      if (!d.system_ids.length) { toast('Добавьте в сектор хотя бы одну систему', 'err'); return; }
      const id = d.id || crypto.randomUUID();
      const r = await act('map.sector.save', id, { name: d.name, color: d.color, lore: d.lore, system_ids: d.system_ids }).catch(() => null);
      if (r?.status === 'done') { await reload(); view.draft = { ...data.sectors.find((x) => x.id === id), system_ids: [...(data.sectors.find((x) => x.id === id)?.system_ids || [])] }; view.draw(); sectorForm(); }
    };
    $('#s-del', side)?.addEventListener('click', async () => {
      if (!(await confirmBox(`Удалить сектор «${d.name}»? Системы останутся на карте.`, 'Удалить'))) return;
      const r = await act('map.sector.delete', d.id).catch(() => null);
      if (r?.status === 'done') { await reload(); setMode('sector'); }
    });
  }
}

const STAR_COLOR_CSS = (s) => ({ yellow: '#ffd76a', red: '#ff8a5c', blue: '#8fb8ff', white: '#f4f1ea', green: '#9fe0a8' }[s.star_type] || '#fff');
function buildResCatalog(data) {
  const out = {};
  for (const s of data.systems) for (const p of s.planets) for (const r of p.resources || []) if (r.name && !out[r.name]) out[r.name] = { r: r.r, rname: r.rname, icon: r.icon };
  return out;
}
function toRoman(n) { return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n - 1] || String(n); }
function hexOf(c) { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^#/.test(c) ? c : '#e9b949'; return '#' + m[1].split(',').slice(0, 3).map((x) => Math.round(parseFloat(x)).toString(16).padStart(2, '0')).join(''); }
function rgbaOf(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`; }
