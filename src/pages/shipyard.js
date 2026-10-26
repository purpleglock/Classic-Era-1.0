import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/shipyard — конструктор кораблей (основа).
 * Палубная сетка класса: игрок расставляет реакторы, орудия, баки и модули.
 * Сервер: v1_shipyard_state / v1_ship_preview / v1_ship_save / v1_ship_delete.
 * Клиент проверяет клетки сразу (для подсказки), окончательно считает база.
 */

const CELL = 22;
const FOOT = { S: [1, 1], M: [2, 1], L: [2, 2], XL: [3, 2] };
const RANK = { S: 1, M: 2, L: 3, XL: 4 };
const TAG = { reactor: 'Р', weapon: 'О', engine: 'Д', shield: 'Щ', bridge: 'М', quarters: 'Ж', cargo: 'Г', hangar: 'А', sensor: 'Л', fuel_tank: 'Т' };
const KIND_NAME = { engine: 'Двигатели', shield: 'Щиты', bridge: 'Мостик', quarters: 'Экипаж', cargo: 'Трюмы', hangar: 'Ангары', sensor: 'Радары', fuel_tank: 'Баки' };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const pct = (x) => `${Math.round(Number(x || 0) * 100)} %`;

export async function renderShipyard(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-ship')}</span><div><h1>Конструктор кораблей</h1><p>Войдите, чтобы проектировать корабли своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Верфь откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.sy-wrap')) root.innerHTML = '<div class="skeleton">Открываю верфь…</div>';
  let s;
  try { s = await rpc('v1_shipyard_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Верфь недоступна</h1><p>${e.missingSchema ? 'Конструктор кораблей ещё не подключён в базе (миграция 29).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const can = !!s.can_edit;
  const classes = s.classes || [], modules = s.modules || [], reactors = s.reactors || [], weapons = s.weapons || [];
  const alloys = s.alloys || [], fuels = s.fuels || [], rawF = s.raw || [], ships = s.ships || [];
  const LIMIT = s.settings?.max_per_faction || 40;
  const first = classes.find((c) => c.open) || classes[0];
  const st = { cls: first?.id, layout: [], alloy: null, fuel: null, pick: null, rot: 0, sel: -1, hover: null, edit: null, calc: null, seq: 0, tab: 'reactor' };
  const C = () => classes.find((c) => c.id === st.cls);

  // каталог предметов: всё, что можно поставить на сетку
  const catalog = [
    ...reactors.map((r) => ({ t: 'reactor', id: r.id, name: r.name, size: r.size, kind: 'reactor', open: !r.broken, info: `${num(r.power)} ЭЕ · ${fmt(r.mass)} т`, w: FOOT[r.size][0], h: FOOT[r.size][1] })),
    ...weapons.map((w) => ({ t: 'weapon', id: w.id, name: w.name, size: w.size, kind: 'weapon', open: true, info: `${w.kind === 'repair' ? `ремонт ${num(w.heal)}` : `${num(w.damage)} урона`} · ${num(w.energy)} ЭЕ`, w: FOOT[w.size][0], h: FOOT[w.size][1] })),
    ...modules.map((m) => ({ t: 'module', id: m.id, name: m.name, size: m.size, kind: m.kind, open: m.open, tech: m.tech_name, info: modInfo(m), w: m.params.w || 1, h: m.params.h || 1, descr: m.descr })),
  ];
  const byRef = (t, id) => catalog.find((c) => c.t === t && c.id === id);
  const TABS = [['reactor', 'Реакторы'], ['weapon', 'Орудия'], ['engine', 'Двигатели'], ['sys', 'Системы'], ['fuel_tank', 'Баки']];
  const inTab = (c) => (st.tab === 'sys' ? c.t === 'module' && !['engine', 'fuel_tank'].includes(c.kind) : st.tab === 'reactor' || st.tab === 'weapon' ? c.t === st.tab : c.kind === st.tab);

  root.innerHTML = html`<div class="sy-wrap rx-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Конструктор кораблей</h1>
        <p>Выберите класс и расставьте по палубе реакторы, орудия, двигатели и системы. <b>Орудия — у борта, двигатели — у кормы (слева), нос — справа.</b></p>
      </div>
      <div class="col-treasury"><small>Проектов державы</small><b>${ships.length} из ${LIMIT}</b></div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но регистрировать проекты могут только правитель и члены державы с правом «Производство».</p>')}

    <section class="panel sy-classes" aria-label="Класс корабля">
      <div class="sy-cls-row" role="radiogroup" id="sy-cls">${classes.map((c) => raw(html`
        <button type="button" role="radio" class="sy-cls" data-id="${c.id}" ${c.open ? '' : 'disabled'} aria-checked="false" title="${c.open ? c.descr : `Нужна технология «${c.tech_name}»`}">
          ${raw(silhouette(c, 96))}<b>${c.name}</b><small>${c.size} · ${c.w}×${c.h}${c.open ? '' : ' · закрыт'}</small>
        </button>`))}</div>
    </section>

    <section class="panel sy-deck">
      <div class="sy-bar">
        <div class="sy-sel" id="sy-sel"></div>
        <div class="sy-tools">
          <button type="button" class="btn sm" id="sy-rot" title="Повернуть (R)">Повернуть</button>
          <button type="button" class="btn sm danger" id="sy-del" title="Убрать (Delete)">Убрать</button>
          <button type="button" class="btn sm" id="sy-clear" ${can ? '' : 'disabled'}>Очистить палубу</button>
        </div>
      </div>
      <div class="sy-grid-wrap" id="sy-grid"></div>
      <div class="sy-legend">${Object.entries({ reactor: 'реактор', weapon: 'орудие', engine: 'двигатель', shield: 'щит', bridge: 'мостик', quarters: 'жилой', fuel_tank: 'бак', cargo: 'трюм', sensor: 'радар', hangar: 'ангар' }).map(([k, v]) => raw(html`<span><i class="sy-k-${k}">${TAG[k]}</i>${v}</span>`))}</div>
    </section>

    <div class="sy-cols">
      <section class="panel sy-palette" aria-label="Что поставить">
        <div class="tabs sy-tabs" role="tablist">${TABS.map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="false">${t}</button>`))}</div>
        <div id="sy-list" class="sy-list"></div>
        <div class="sy-opts">
          <label>Броня корпуса
            <select id="sy-alloy" ${can ? '' : 'disabled'}><option value="">Стандартная сталь</option>${raw(alloys.map((a) => html`<option value="${a.id}">${a.name} · оценка ${a.grade}</option>`).join(''))}</select></label>
          <label>Топливо в баках
            <select id="sy-fuel" ${can ? '' : 'disabled'}><option value="">— не выбрано —</option>
              ${fuels.length ? raw(html`<optgroup label="Марки державы">${raw(fuels.map((f) => html`<option value="f:${f.id}">${f.name} · оценка ${f.grade}</option>`).join(''))}</optgroup>`) : ''}
              <optgroup label="Сырьё">${raw(rawF.map((r) => html`<option value="r:${r}">${r}</option>`).join(''))}</optgroup>
            </select></label>
        </div>
      </section>

      <aside class="panel rx-card sy-card" aria-live="polite">
        <h2>Паспорт проекта</h2>
        <div id="sy-out"></div>
        <form id="sy-form" class="fu-form">
          <label for="sy-name">Название проекта</label>
          <input id="sy-name" maxlength="48" placeholder="Например: Страж-1" ${can ? '' : 'disabled'}>
          <div class="fu-acts">
            <button type="submit" class="btn gold" id="sy-save" disabled>Зарегистрировать</button>
            <button type="button" class="btn" id="sy-cancel" hidden>Отменить правку</button>
          </div>
        </form>
      </aside>
    </div>

    <section class="panel fu-list sy-ships" aria-labelledby="sy-ships-h">
      <h2 id="sy-ships-h">Проекты державы</h2>
      ${ships.length ? raw(html`<div class="fu-cards">${ships.map((sh) => raw(shipCard(sh, classes, can)))}</div>`)
        : raw('<p class="empty">Пока ни одного. Соберите корабль выше и зарегистрируйте первый проект. Корабли старого образца остаются в реестре.</p>')}
    </section>
  </div>`;

  const gridEl = $('#sy-grid', root), selEl = $('#sy-sel', root), listEl = $('#sy-list', root), out = $('#sy-out', root);
  const save = $('#sy-save', root), nameEl = $('#sy-name', root), cancel = $('#sy-cancel', root);
  const alloyEl = $('#sy-alloy', root), fuelEl = $('#sy-fuel', root);

  // ── геометрия ──
  const isHull = (x, y) => { const c = C(); return x >= 0 && y >= 0 && x < c.w && y < c.h && c.mask[y][x] === '#'; };
  const dims = (ref, r) => (r ? [ref.h, ref.w] : [ref.w, ref.h]);
  const cellsOf = (it, ref) => { const [w, h] = dims(ref, it.r); const out = []; for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([it.x + dx, it.y + dy]); return out; };
  const occupancy = (skip = -1) => {
    const m = new Map();
    st.layout.forEach((it, i) => { if (i === skip) return; const ref = byRef(it.t, it.id); if (ref) cellsOf(it, ref).forEach(([x, y]) => m.set(`${x}:${y}`, i)); });
    return m;
  };
  const check = (it, ref, skip = -1) => {
    const c = C();
    if (RANK[ref.size] > RANK[c.size] && ref.kind !== 'bridge') return `не встанет на класс ${c.size}`;
    const occ = occupancy(skip);
    let edge = false, stern = false;
    for (const [x, y] of cellsOf(it, ref)) {
      if (!isHull(x, y)) return 'выходит за корпус';
      if (occ.has(`${x}:${y}`)) return 'клетка занята';
      if (!isHull(x - 1, y)) { stern = true; edge = true; }
      if (!isHull(x + 1, y) || !isHull(x, y - 1) || !isHull(x, y + 1)) edge = true;
    }
    if (ref.t === 'weapon' && !edge) return 'орудие ставится у борта';
    if (ref.kind === 'engine' && !stern) return 'двигатель ставится у кормы';
    return '';
  };

  // ── отрисовка ──
  const drawGrid = () => {
    const c = C(); if (!c) return;
    const W = c.w * CELL, H = c.h * CELL;
    const errIdx = new Set((st.calc?.errors || []).map((e) => e.i));
    let cells = '';
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      if (c.mask[y][x] !== '#') continue;
      const sternCell = !isHull(x - 1, y), edgeCell = sternCell || !isHull(x + 1, y) || !isHull(x, y - 1) || !isHull(x, y + 1);
      const hint = st.pick ? (st.pick.t === 'weapon' && edgeCell ? ' hint' : st.pick.kind === 'engine' && sternCell ? ' hint' : '') : '';
      cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" class="c${edgeCell ? ' e' : ''}${hint}" data-x="${x}" data-y="${y}"/><circle cx="${x * CELL + CELL / 2}" cy="${y * CELL + CELL / 2}" r="1.6" class="d"/>`;
    }
    const items = st.layout.map((it, i) => {
      const ref = byRef(it.t, it.id); if (!ref) return '';
      const [w, h] = dims(ref, it.r);
      const k = it.t === 'module' ? ref.kind : it.t;
      return `<g class="it sy-k-${k}${i === st.sel ? ' sel' : ''}${errIdx.has(i) ? ' err' : ''}" data-i="${i}"><title>${esc(ref.name)}</title>
        <rect x="${it.x * CELL + 2}" y="${it.y * CELL + 2}" width="${w * CELL - 4}" height="${h * CELL - 4}" rx="5"/>
        <text x="${it.x * CELL + (w * CELL) / 2}" y="${it.y * CELL + (h * CELL) / 2 + 4}" text-anchor="middle">${TAG[k] || '?'}</text></g>`;
    }).join('');
    let ghost = '';
    if (st.pick && st.hover) {
      const it = { x: st.hover[0], y: st.hover[1], r: st.rot };
      const bad = check(it, st.pick);
      const [w, h] = dims(st.pick, st.rot);
      ghost = `<rect x="${it.x * CELL + 1}" y="${it.y * CELL + 1}" width="${w * CELL - 2}" height="${h * CELL - 2}" rx="5" class="ghost${bad ? ' bad' : ''}"/>`;
    }
    gridEl.innerHTML = `<svg viewBox="-16 -6 ${W + 32} ${H + 12}" class="sy-svg" style="width:100%;max-width:${c.w * 36}px;min-width:${c.w * 15}px" role="img" aria-label="Палуба: ${esc(c.name)}">
      <g class="cells">${cells}</g><g class="items">${items}</g>${ghost}
      <text x="-6" y="${H / 2}" class="ax" text-anchor="middle" transform="rotate(-90 -6 ${H / 2})">корма</text>
      <text x="${W + 6}" y="${H / 2}" class="ax" transform="rotate(90 ${W + 6} ${H / 2})" text-anchor="middle">нос</text></svg>`;
  };

  const drawSel = () => {
    if (st.pick) {
      const bad = st.hover ? check({ x: st.hover[0], y: st.hover[1], r: st.rot }, st.pick) : '';
      selEl.innerHTML = html`<b>Ставлю: ${st.pick.name}</b><small>${st.pick.w}×${st.pick.h}${st.rot ? ' · повёрнут' : ''} · щёлкните по палубе${bad ? ` · ${bad}` : ''}. Esc — отмена</small>`;
    } else if (st.sel >= 0) {
      const it = st.layout[st.sel], ref = byRef(it.t, it.id);
      const err = (st.calc?.errors || []).find((e) => e.i === st.sel);
      selEl.innerHTML = html`<b>${ref?.name || 'Предмет удалён'}</b><small>${ref?.info || ''}${err ? ` · ${err.msg}` : ''}</small>`;
    } else {
      const c = C();
      selEl.innerHTML = html`<b>${c?.name || ''}</b><small>${c ? `${c.descr} Клеток палубы: ${c.mask.join('').split('#').length - 1}.` : ''}</small>`;
    }
    $('#sy-rot', root).disabled = !can || (!st.pick && st.sel < 0);
    $('#sy-del', root).disabled = !can || st.sel < 0;
  };

  const drawList = () => {
    $$('.sy-tabs [role=tab]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
    const c = C();
    const list = catalog.filter(inTab);
    const empty = { reactor: html`Своих реакторов пока нет. <a href="#/reactor">Собрать реактор →</a>`, weapon: html`Своих орудий пока нет. <a href="#/weapon">Собрать орудие →</a>` }[st.tab];
    listEl.innerHTML = list.length ? list.map((ref) => {
      const tooBig = c && RANK[ref.size] > RANK[c.size] && ref.kind !== 'bridge';
      const off = !can || !ref.open || tooBig;
      const isPick = st.pick && st.pick.t === ref.t && st.pick.id === ref.id;
      return html`<button type="button" class="sy-item${isPick ? ' on' : ''}" data-t="${ref.t}" data-id="${ref.id}" ${off ? 'disabled' : ''}>
        <i class="sy-k-${ref.t === 'module' ? ref.kind : ref.t}">${TAG[ref.t === 'module' ? ref.kind : ref.t]}</i>
        <span><b>${ref.name}</b><small>${ref.size} · ${ref.w}×${ref.h} · ${ref.info}${!ref.open && ref.tech ? ` · нужна «${ref.tech}»` : ''}${tooBig ? ' · велик для класса' : ''}</small></span></button>`;
    }).join('') : html`<p class="empty">${raw(empty || 'Пусто.')}</p>`;
  };

  // ── расчёт ──
  let timer;
  const recalc = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++st.seq;
      const r = await rpc('v1_ship_preview', { p_class: st.cls, p_cfg: cfg() }).catch((e) => ({ ok: false, error: e.message }));
      if (my !== st.seq) return;
      st.calc = r; paint(); drawGrid(); drawSel();
    }, 250);
  };
  const cfg = () => ({ layout: st.layout, alloy: st.alloy, fuel: st.fuel });

  const paint = () => {
    const c = st.calc;
    save.disabled = !can || !c?.ok || !c.registrable || nameEl.value.trim().length < 3;
    if (!c) { out.innerHTML = '<p class="empty">Считаю…</p>'; return; }
    if (!c.ok) { out.innerHTML = html`<p class="empty warn">${c.error}</p>`; return; }
    out.innerHTML = passport(c);
  };

  const refresh = () => { drawGrid(); drawSel(); drawList(); recalc(); };

  // ── события ──
  $('#sy-cls', root).onclick = async (e) => {
    const b = e.target.closest('[role=radio]'); if (!b || b.disabled || b.dataset.id === st.cls) return;
    if (st.layout.length && !(await confirmBox('Сменить класс? Расстановка на палубе будет очищена.', 'Сменить'))) return;
    st.cls = b.dataset.id; st.layout = []; st.sel = -1; st.pick = null;
    syncCls(); refresh();
  };
  const syncCls = () => $$('#sy-cls [role=radio]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === st.cls)));

  root.querySelector('.sy-tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; st.tab = b.dataset.tab; drawList(); };
  listEl.onclick = (e) => {
    const b = e.target.closest('.sy-item'); if (!b || b.disabled) return;
    const ref = byRef(b.dataset.t, b.dataset.id);
    st.pick = st.pick && st.pick.id === ref.id && st.pick.t === ref.t ? null : ref; st.sel = -1; st.rot = 0;
    drawList(); drawSel(); drawGrid();
  };

  const cellAt = (e) => {
    const svg = gridEl.querySelector('svg'); if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.floor(p.x / CELL), Math.floor(p.y / CELL)];
  };
  gridEl.onmousemove = (e) => {
    if (!st.pick) return;
    const c = cellAt(e); if (!c) return;
    if (!st.hover || c[0] !== st.hover[0] || c[1] !== st.hover[1]) { st.hover = c; drawGrid(); drawSel(); }
  };
  gridEl.onmouseleave = () => { if (st.hover) { st.hover = null; drawGrid(); } };
  gridEl.onclick = (e) => {
    if (!can) return;
    if (st.pick) {
      const [x, y] = cellAt(e) || [];
      const it = { t: st.pick.t, id: st.pick.id, x, y, r: st.rot };
      const bad = check(it, st.pick);
      if (bad) { toast(bad, 'err'); return; }
      st.layout.push(it); st.hover = [x, y];
      refresh();
      return;
    }
    const g = e.target.closest('g.it');
    st.sel = g ? Number(g.dataset.i) : -1;
    drawGrid(); drawSel();
  };

  const rotate = () => {
    if (st.pick) { st.rot = st.rot ? 0 : 1; drawGrid(); drawSel(); return; }
    if (st.sel < 0) return;
    const it = st.layout[st.sel], ref = byRef(it.t, it.id);
    const next = { ...it, r: it.r ? 0 : 1 };
    const bad = ref && check(next, ref, st.sel);
    if (bad) { toast(`Не повернуть: ${bad}`, 'err'); return; }
    st.layout[st.sel] = next; refresh();
  };
  const remove = () => { if (st.sel < 0) return; st.layout.splice(st.sel, 1); st.sel = -1; refresh(); };
  $('#sy-rot', root).onclick = rotate;
  $('#sy-del', root).onclick = remove;
  $('#sy-clear', root).onclick = async () => {
    if (!st.layout.length || !(await confirmBox('Убрать всё с палубы?', 'Очистить'))) return;
    st.layout = []; st.sel = -1; refresh();
  };
  const onKey = (e) => {
    if (!document.body.contains(gridEl)) { document.removeEventListener('keydown', onKey); return; }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') { e.preventDefault(); rotate(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (st.sel >= 0) { e.preventDefault(); remove(); } }
    if (e.key === 'Escape') { st.pick = null; st.sel = -1; drawList(); drawSel(); drawGrid(); }
  };
  document.addEventListener('keydown', onKey);

  alloyEl.onchange = () => { st.alloy = alloyEl.value || null; recalc(); };
  fuelEl.onchange = () => { const v = fuelEl.value; st.fuel = v.startsWith('f:') ? { kind: 'fuel', id: v.slice(2) } : v.startsWith('r:') ? { kind: 'res', res: v.slice(2) } : null; recalc(); };
  nameEl.oninput = () => paint();

  const load = (sh, copy) => {
    st.edit = copy ? null : sh.id; st.cls = sh.class;
    st.layout = (sh.cfg.layout || []).map((x) => ({ ...x })); st.alloy = sh.cfg.alloy || null; st.fuel = sh.cfg.fuel || null;
    alloyEl.value = st.alloy || '';
    fuelEl.value = st.fuel ? (st.fuel.kind === 'fuel' ? `f:${st.fuel.id}` : `r:${st.fuel.res}`) : '';
    nameEl.value = copy ? '' : sh.name; save.textContent = copy ? 'Зарегистрировать' : 'Сохранить изменения'; cancel.hidden = copy;
    st.sel = -1; st.pick = null; syncCls(); refresh();
    $('.sy-deck', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  cancel.onclick = () => { st.edit = null; nameEl.value = ''; save.textContent = 'Зарегистрировать'; cancel.hidden = true; paint(); };

  $('#sy-form', root).onsubmit = async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await rpc('v1_ship_save', { p_id: st.edit, p_name: nameEl.value, p_class: st.cls, p_cfg: cfg() });
      toast(st.edit ? 'Проект обновлён' : `Проект «${nameEl.value.trim()}» зарегистрирован`);
      renderShipyard(root);
    } catch (err) { toast(err.message, 'err'); paint(); }
  };

  $('.sy-ships', root).onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const sh = ships.find((x) => x.id === b.closest('[data-id]').dataset.id); if (!sh) return;
    if (b.dataset.act === 'edit') load(sh, false);
    if (b.dataset.act === 'copy') load(sh, true);
    if (b.dataset.act === 'del') {
      if (!(await confirmBox(`Удалить проект «${sh.name}»?`, 'Удалить'))) return;
      try { await rpc('v1_ship_delete', { p_id: sh.id }); toast('Проект удалён'); renderShipyard(root); } catch (err) { toast(err.message, 'err'); }
    }
  };

  syncCls(); refresh();
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function modInfo(m) {
  const p = m.params || {};
  const bits = [];
  if (p.thrust) bits.push(`тяга ${num(p.thrust)}`);
  if (p.shield) bits.push(`щит ${num(p.shield)}`);
  if (p.crew) bits.push(`экипаж +${p.crew}`);
  if (p.radar) bits.push(`радар +${p.radar}`);
  if (p.cargo) bits.push(`груз ${p.cargo}`);
  if (p.craft) bits.push(`${p.craft} звена`);
  if (p.capacity) bits.push(`${p.capacity} ед. топлива`);
  if (p.energy) bits.push(`${num(p.energy)} ЭЕ`);
  return bits.join(' · ');
}

function silhouette(c, width) {
  const cs = width / c.w, H = c.h * cs;
  let d = '';
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.mask[y][x] === '#') d += `M${(x * cs).toFixed(1)} ${(y * cs).toFixed(1)}h${cs.toFixed(1)}v${cs.toFixed(1)}h-${cs.toFixed(1)}z`;
  return `<svg viewBox="0 0 ${width} ${H.toFixed(1)}" class="sy-sil" aria-hidden="true"><path d="${d}"/></svg>`;
}

function bar(label, value, max, cls = '', text = fmt(value)) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return html`<div class="fu-bar ${cls}"><span>${label}</span><b>${text}</b><i><em style="width:${w}%"></em></i></div>`;
}

function passport(c) {
  const r = c.resist || {};
  const billTxt = Object.entries(c.bill || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  return html`
    <div class="sy-head"><b>${c.class_name}</b><span class="fu-stab">${c.size}</span><small>палуба ${c.used} из ${c.cells} клеток</small></div>
    ${raw(bar('Энергия: расход / выработка', c.energy_use, c.power, c.energy_use > c.power ? 'bad' : c.energy_use > c.power * 0.9 ? 'warn' : '', `${num(c.energy_use)} / ${num(c.power)}`))}
    ${raw(bar('Экипаж: нужно / мест', c.crew, c.crew_cap, c.crew > c.crew_cap ? 'warn' : '', `${num(c.crew)} / ${num(c.crew_cap)}`))}
    <dl class="fu-derived sy-stats">
      <div><dt>Прочность</dt><dd>${num(c.hp)}</dd></div>
      <div><dt>Щит</dt><dd>${num(c.shield)}</dd></div>
      <div><dt>Урон за ход</dt><dd>${num(c.damage)}${c.heal ? raw(html`<small>ремонт ${num(c.heal)}</small>`) : ''}</dd></div>
      <div><dt>Дальность огня</dt><dd>${fmt(c.dalnost)}</dd></div>
      <div><dt>Скорость</dt><dd>${fmt(c.speed)}</dd></div>
      <div><dt>Масса</dt><dd>${num(c.mass)} т</dd></div>
      <div><dt>Броня</dt><dd>К ${pct(r.kinetic)} · Э ${pct(r.energy)} · Р ${pct(r.missile)}<small>${c.alloy_name}</small></dd></div>
      <div><dt>Радар · груз</dt><dd>${c.radar} · ${num(c.cargo)}${c.craft ? raw(html`<small>${c.craft} звена в ангарах</small>`) : ''}</dd></div>
      <div><dt>Баки</dt><dd>${num(c.tank)} ед.${c.tank ? raw(html`<small>${c.fuel_name || 'топливо не выбрано'} · ${c.jumps} прыж.${c.autonomy ? ` · ${fmt(c.autonomy)} сут.` : ''}</small>`) : ''}</dd></div>
      <div><dt>Цена</dt><dd>${num(c.cost)} ГС</dd></div>
    </dl>
    ${billTxt ? raw(html`<p class="rx-bill"><span>Сырьё на постройку</span>${billTxt}</p>`) : ''}
    ${c.errors?.length ? raw(html`<ul class="fu-warns sy-errs">${c.errors.map((e) => raw(html`<li>${e.msg}</li>`))}</ul>`) : ''}
    ${c.warnings?.length ? raw(html`<ul class="fu-warns">${c.warnings.map((w) => raw(html`<li>${w}</li>`))}</ul>`) : ''}`;
}

function shipCard(sh, classes, can) {
  const c = sh.stats || {}, cl = classes.find((x) => x.id === sh.class);
  return html`<article class="fu-fuel sy-ship" data-id="${sh.id}">
    ${cl ? raw(silhouette(cl, 220)) : ''}
    <header><div><b>${sh.name}</b><small>${c.class_name || sh.class} · ${c.size || ''}</small></div></header>
    <dl><div><dt>Прочность</dt><dd>${num(c.hp)}</dd></div><div><dt>Урон</dt><dd>${num(c.damage)}</dd></div>
      <div><dt>Скорость</dt><dd>${fmt(c.speed)}</dd></div><div><dt>Цена</dt><dd>${num(c.cost)} ГС</dd></div></dl>
    ${c.registrable === false ? raw('<ul class="fu-warns"><li>Часть узлов изменилась — откройте проект и поправьте.</li></ul>') : ''}
    ${can ? raw(html`<div class="fu-acts"><button type="button" class="btn sm" data-act="edit">Изменить</button><button type="button" class="btn sm" data-act="copy">Взять за основу</button><button type="button" class="btn sm danger" data-act="del">Удалить</button></div>`) : ''}
  </article>`;
}
