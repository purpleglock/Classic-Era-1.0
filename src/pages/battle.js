import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { num } from '../lib/format.js';
import { cellOf, dist, hexLine, edgeNeighbors } from '../lib/hexmap.js';
import { BattleMap, CELLS } from '../ui/battle-map.js';
import { GroundMap, cellInfo } from '../ui/ground-map.js';

/**
 * #/battle?id=… — сражение на гекс-карте (космос или земля), 2D и 3D.
 * Обзор считает сервер: отряды противника вне обзора не приходят вовсе.
 * Пометки «?» — где сторона в последний раз видела отряд противника.
 * Ход: выберите свой отряд → подсветятся досягаемые клетки и цели в дальности;
 * клик по клетке — движение, по цели — огонь. Импульс радара — кнопкой.
 * Сервер: v1_battle_state, v1_battle_act, v1_battle_end_turn, v1_battle_retreat(_cancel).
 */
const ST = { fighting: 'в бою', retreating: 'отступает', retreated: 'отступила', defeated: 'разбита', won: 'победила' };
const UT = { ship: 'корабли', inf: 'пехота', tank: 'техника', art: 'артиллерия', aa: 'ПВО', air: 'авиация' };
let mode = '2d';

/** Цена клетки для отряда — как v1_hex_cost на сервере (null — непроходимо). */
function cost(kind, u, c) {
  if (c == null) return null;
  if (kind !== 'ground') {
    if (c === 'R' || c === 'P') return null;
    if (c === 'a') return u.size === 'S' || u.utype === 'air' ? 1 : null;
    if (c === 'g') return 2;
    if (c === 'd') return u.size === 'L' || u.size === 'XL' ? 2 : 1;
    return 1;
  }
  if (u.utype === 'air') return 1;
  if (u.utype === 'inf') return 'WLX'.includes(c) ? null : c === 'M' || c === 'w' ? 2 : 1;
  if ('MWLXSC'.includes(c)) return null;
  return c === 'r' ? 0.5 : 'FRhw'.includes(c) ? 2 : 1;
}

/** Досягаемые клетки: поиск по цене местности в пределах скорости, сквозь врага нельзя, на занятую — нельзя. */
function reachOf(b, u, units) {
  const m = b.map, budget = Number(u.stats?.speed || 0), best = new Map([[`${u.x},${u.y}`, 0]]), out = new Set();
  const foes = new Set(units.filter((x) => x.side !== u.side).map((x) => `${x.x},${x.y}`));
  const busy = new Set(units.map((x) => `${x.x},${x.y}`));
  let q = [[u.x, u.y]];
  while (q.length) {
    const nq = [];
    for (const [x, y] of q) {
      const here = best.get(`${x},${y}`);
      for (const [nx, ny] of edgeNeighbors(x, y)) {
        const k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || foes.has(k)) continue;
        const c = cost(b.kind, u, cellOf(m, nx, ny));
        if (c == null || here + c > budget || here + c >= (best.get(k) ?? 1e9)) continue;
        best.set(k, here + c); nq.push([nx, ny]);
        if (!busy.has(k)) out.add(k);
      }
    }
    q = nq;
  }
  return out;
}

/** Можно ли стрелять: дальность и линия огня (как на сервере). */
function canFire(b, u, t) {
  if (dist([u.x, u.y], [t.x, t.y]) > Number(u.stats?.rng || 0)) return false;
  const m = b.map, ground = b.kind === 'ground', blk = ground ? 'M' : 'RP';
  if (u.utype === 'art' || u.utype === 'air' || t.utype === 'air' || (ground && cellOf(m, u.x, u.y) === 'M')) return true;
  return !hexLine([u.x, u.y], [t.x, t.y]).some(([x, y]) => blk.includes(cellOf(m, x, y)));
}

export async function renderBattle(root) {
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  if (!id || !session.user) { location.hash = '/'; return; }
  let st = null, sel = null, timer = 0, view = null, v3 = null, sig3 = '', busy = false;
  root.innerHTML = '<div class="skeleton">Загружаю бой…</div>';

  const load = async () => {
    if (busy) return;
    try { st = await rpc('v1_battle_state', { p_battle: id }); draw(); }
    catch (e) { clearInterval(timer); root.innerHTML = html`<section class="panel gate"><div><h1>Бой недоступен</h1><p>${e.missingSchema ? 'Новая база сражений ещё не подключена.' : e.message}</p></div><a class="btn" href="#/fleet">К флотам</a></section>`; }
  };
  const call = async (fn, args, keep) => {
    busy = true;
    try { const r = await rpc(fn, { p_battle: id, ...args }); if (r?.battle) st = r; else st = await rpc('v1_battle_state', { p_battle: id }); if (!keep) sel = null; }
    catch (e) { toast(e.message, 'err'); }
    busy = false; draw();
  };

  const meOf = () => st.me || (st.staff && st.battle.kind === 'test' ? st.battle.side_to_move : null);
  const live = () => st.units.filter((u) => u.alive && !u.left_field);

  function viewUnits() {
    const b = st.battle, me = meOf();
    return live().map((u) => ({
      id: u.id, side: u.side, x: u.x, y: u.y, size: u.size, radar: u.radar, cls: u.class, type: u.utype, utype: u.utype,
      air: u.utype === 'air', pulse: u.pulse_turn === b.turn_no, seen: !!me && u.side !== me,
      label: u.qty > 1 ? `×${u.qty}` : '',
    }));
  }

  function marks() {
    const b = st.battle, me = meOf(), units = live(), u = units.find((x) => x.id === sel);
    const mk = { contacts: st.contacts || [], turn: b.turn_no };
    if (u && u.side === me) {
      mk.sel = [u.x, u.y];
      if (b.side_to_move === me && b.status === 'active') {
        if (!u.moved) mk.reach = reachOf(b, u, units);
        if (!u.fired) mk.targets = units.filter((t) => t.side !== me && canFire(b, u, t)).map((t) => [t.x, t.y]);
      }
    }
    return mk;
  }

  function onCell(c) {
    if (!c || !st) return;
    const b = st.battle, me = meOf(), [x, y] = c, units = live();
    const cur = units.find((u) => u.x === x && u.y === y);
    if (cur && cur.side === me) { sel = cur.id === sel ? null : cur.id; draw(); return; }
    const u = units.find((v) => v.id === sel);
    if (!u || b.status !== 'active' || b.side_to_move !== me) { sel = cur ? null : sel; draw(); return; }
    if (cur) {
      if (u.fired) return toast('Этот отряд уже стрелял.', 'err');
      call('v1_battle_act', { p_unit: u.id, p_kind: 'fire', p_x: null, p_y: null, p_target: cur.id }, true);
    } else {
      if (u.moved) return toast('Этот отряд уже ходил.', 'err');
      if (!reachOf(b, u, units).has(`${x},${y}`)) return toast('Сюда отряд за этот ход не дойдёт.', 'err');
      call('v1_battle_act', { p_unit: u.id, p_kind: 'move', p_x: x, p_y: y, p_target: null }, true);
    }
  }

  function tipFor(c, px, py, w) {
    const tip = $('#bt-tip', root);
    if (!c) { tip.hidden = true; return; }
    const b = st.battle, t = cellOf(b.map, c[0], c[1]);
    const [name, rule] = b.kind === 'ground' ? cellInfo(b.map.biome, t) : [(CELLS[t] || CELLS['.']).name, (CELLS[t] || CELLS['.']).rule];
    const u = live().find((v) => v.x === c[0] && v.y === c[1]);
    tip.hidden = false;
    tip.innerHTML = html`${u ? raw(html`<b>${u.name}</b><small>${u.class || UT[u.utype]} · ×${u.qty}${u.side !== meOf() ? ` · износ ~${u.wear ?? 0} %` : ''}</small>`) : ''}<b>${name}</b><small>${rule}</small>`;
    tip.style.left = `${Math.min(px + 14, w - 230)}px`; tip.style.top = `${py + 14}px`;
  }

  function build() {
    const b = st.battle, ground = b.kind === 'ground';
    root.innerHTML = html`
      <section class="panel guide-head"><span class="m-ic">${icon(ground ? 'i-planet' : 'i-sword')}</span>
        <div><h1>${b.arena ? 'Арена · ' : ''}${ground ? 'Наземный бой' : 'Космическое сражение'}</h1><p id="bt-sub"></p></div>
        <a class="btn sm" href="${b.arena ? '#/arena' : st.staff && !st.me ? '#/admin?s=battles' : '#/fleet'}">${icon('i-back')}Назад</a></section>
      <div class="bt-wrap">
        <div class="panel bt-board">
          <div class="bt-bar"><div class="bm-meta" id="bt-meta"></div>
            <div class="seg bm-mode" role="group" aria-label="Вид"><button type="button" data-mode="2d">2D</button><button type="button" data-mode="3d">3D</button></div></div>
          <div class="bm-canvas"><canvas id="bt-cv" aria-label="Поле боя"></canvas><div class="bm-3d" id="bt-3d" hidden></div><div class="bm-tip" id="bt-tip" hidden></div></div>
          <p class="hint" id="bt-hint"></p>
        </div>
        <aside class="panel bt-side"><div id="bt-sides"></div><div class="acts" id="bt-acts"></div><div id="bt-unit"></div><div id="bt-mine"></div>
          <h3 class="sub-h">Журнал</h3><ol class="bt-log" id="bt-log"></ol></aside>
      </div>`;
    const cv = $('#bt-cv', root);
    view = ground ? new GroundMap(cv) : new BattleMap(cv);
    view.setMap(b.map);
    cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); onCell(view.cellAt(e.clientX - r.left, e.clientY - r.top)); });
    cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(), c = view.cellAt(e.clientX - r.left, e.clientY - r.top); view.set({ hover: c }); tipFor(c, e.clientX - r.left, e.clientY - r.top, r.width); });
    cv.addEventListener('mouseleave', () => { $('#bt-tip', root).hidden = true; view.set({ hover: null }); });
    $$('[data-mode]', root).forEach((x) => (x.onclick = () => setMode(x.dataset.mode)));
    addEventListener('resize', () => view?.draw(), { passive: true });
    setMode(mode);
  }

  async function setMode(m) {
    mode = m;
    $$('[data-mode]', root).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === m)));
    const host = $('#bt-3d', root), cv = $('#bt-cv', root);
    cv.hidden = m === '3d'; host.hidden = m !== '3d'; $('#bt-tip', root).hidden = true;
    if (m !== '3d') { view.draw(); return; }
    try {
      if (!v3) {
        const ground = st.battle.kind === 'ground';
        const mod = ground ? await import('../ui/ground-3d.js') : await import('../ui/battle-3d.js');
        v3 = new (ground ? mod.Ground3D : mod.Battle3D)(host);
        v3.onHover = (c, x, y) => tipFor(c, x, y, host.clientWidth);
        v3.onPick = (c) => onCell(c);
        sig3 = JSON.stringify(viewUnits());
        await v3.setMap(st.battle.map, { units: viewUnits(), fog: meOf(), autoRotate: false });
      }
    } catch (e) {
      console.error(e); toast('3D не запустился: браузер не поддерживает WebGL или не загрузилась библиотека', 'err'); setMode('2d');
    }
  }

  function draw() {
    if (!st) return;
    const b = st.battle, me = meOf(), ground = b.kind === 'ground';
    if (!root.querySelector('.bt-wrap')) build();
    const mySide = st.sides.find((s) => s.side === me), myTurn = b.status === 'active' && b.side_to_move === me;
    const leftMin = b.turn_deadline ? Math.max(0, Math.round((new Date(b.turn_deadline) - Date.now()) / 60000)) : null;
    const sname = (s) => (s.faction_id === 'arena_bot' ? '«Жнец» — бот арены' : s.name || s.faction_id);
    const nameOf = (side) => st.sides.filter((s) => s.side === side).map(sname).join(', ');
    $('#bt-sub', root).textContent = `${st.system || ''}${st.colony ? ` · колония «${st.colony}»` : ''} · ход ${b.turn_no} · ${b.status === 'active'
      ? `${myTurn ? 'ваш ход' : `ходит ${nameOf(b.side_to_move)}`}${leftMin != null ? ` · осталось ~${leftMin} мин` : ''}`
      : `окончен: ${b.result?.why || ''}`}`;
    const units = live(), mine = units.filter((u) => u.side === me), foesSeen = units.filter((u) => me && u.side !== me);
    $('#bt-meta', root).innerHTML = html`
      <span class="bm-chip">${icon('i-map')}${ground ? (b.map.planet?.name || st.colony || 'Поверхность') : (b.map.site?.name || st.system || 'Система')}</span>
      <span class="bm-chip">Своих отрядов: ${mine.length}</span>
      <span class="bm-chip ${foesSeen.length ? 'hot' : ''}">Противник в обзоре: ${foesSeen.length}</span>
      ${(st.contacts || []).length ? raw(html`<span class="bm-chip">Последних контактов: ${st.contacts.length}</span>`) : ''}`;
    $('#bt-sides', root).innerHTML = st.sides.map((s) => html`<div class="bt-sd ${s.side === me ? 'me' : ''}"><b>${sname(s)}</b><small>${b.arena ? 'арена' : s.role === 'attacker' ? 'наступает' : 'обороняется'}</small><span class="tag ${s.status === 'retreating' ? 'new' : ''}">${ST[s.status] || s.status}${s.status === 'retreating' ? ` · уйдёт на ${s.retreat_at_turn}-м ходу` : ''}</span></div>`).join('');
    const u = units.find((x) => x.id === sel && x.side === me);
    const pulseOk = u && !u.fired && (!ground || u.utype === 'air') && (u.pulse_turn ?? -99) <= b.turn_no - (st.pulse_every || 3);
    $('#bt-acts', root).innerHTML = b.status !== 'active' || !me ? '' : html`
      <button type="button" class="btn gold sm" id="bt-end" ${raw(myTurn ? '' : 'disabled')}>Завершить ход</button>
      ${u && myTurn && (!ground || u.utype === 'air') ? raw(html`<button type="button" class="btn sm" id="bt-pulse" ${raw(pulseOk ? '' : 'disabled')} title="Обзор отряда ×2 на этот ход, но отряд себя выдаёт. Раз в ${st.pulse_every || 3} хода.">Импульс радара</button>`) : ''}
      ${mySide?.status === 'retreating' ? raw('<button type="button" class="btn sm" id="bt-stay">Отменить отступление</button>') : raw(html`<button type="button" class="btn sm danger" id="bt-ret">${ground ? 'Отойти с планеты' : 'Отступить'}</button>`)}`;
    $('#bt-end', root)?.addEventListener('click', () => call('v1_battle_end_turn', {}));
    $('#bt-pulse', root)?.addEventListener('click', () => call('v1_battle_act', { p_unit: u.id, p_kind: 'pulse', p_x: null, p_y: null, p_target: null }, true));
    $('#bt-ret', root)?.addEventListener('click', async () => {
      const text = ground ? 'Начать отход? Отряды продержатся ещё 3 хода и сойдут с планеты, армия останется в системе.'
        : 'Начать отступление? Отряды продержатся ещё 3 хода и уйдут с поля, а флот улетит в соседнюю систему.';
      if (await confirmBox(text, 'Отступить')) call('v1_battle_retreat', { p_dest: null });
    });
    $('#bt-stay', root)?.addEventListener('click', () => call('v1_battle_retreat_cancel', {}));
    $('#bt-unit', root).innerHTML = u ? html`<div class="grp"><h4>${u.name}</h4>
      <p class="hint">${u.class || UT[u.utype]} · ${UT[u.utype] || ''} · ×${u.qty} из ${u.qty_start}</p>
      <p class="hint">Прочность ${num(u.hp)}${u.shield_max ? ` · щит ${num(u.shield)} / ${num(u.shield_max)}` : ''}</p>
      <p class="hint">Ход ${num(u.stats?.speed)} · дальность ${num(u.stats?.rng)} · обзор ${u.radar} · урон ${num(u.stats?.dmg)}</p>
      <p class="hint">${u.moved ? 'Уже ходил. ' : 'Может ходить. '}${u.fired ? 'Уже стрелял.' : 'Может стрелять.'}${u.revealed_turn >= b.turn_no ? ' Выдал себя — противник его видит.' : ''}</p></div>` : '';
    $('#bt-mine', root).innerHTML = me && mine.length ? html`<ul class="bt-units">${mine.map((x) => raw(html`<li><button type="button" data-u="${x.id}" class="${x.id === sel ? 'on' : ''}">
      <b>${x.name}</b><small>×${x.qty} · ${x.moved ? '✓ ход' : 'ход'} · ${x.fired ? '✓ огонь' : 'огонь'}</small></button></li>`))}</ul>` : '';
    $$('[data-u]', root).forEach((x) => (x.onclick = () => { sel = x.dataset.u === sel ? null : x.dataset.u; draw(); }));
    $('#bt-hint', root).textContent = !me ? 'Наблюдение: команда проекта видит всё поле.' : myTurn
      ? (u ? 'Золотые клетки — куда отряд дойдёт за ход, красные прицелы — цели в дальности. «?» — где противника видели в последний раз.' : 'Выберите свой отряд на поле или в списке отрядов.')
      : b.status === 'active' ? 'Ход противника. Поле обновляется само.' : '';
    $('#bt-log', root).innerHTML = st.log.slice().reverse().map((l) => html`<li><time>ход ${l.turn_no}</time>${l.text}</li>`).join('');
    const vu = viewUnits();
    view.set({ units: vu, fog: me, marks: marks() });
    if (v3) { const sig = JSON.stringify(vu); if (sig !== sig3) { sig3 = sig; v3.set({ units: vu, fog: me }); } }
  }

  await load();
  timer = setInterval(() => {
    if (!root.querySelector('.bt-wrap')) { clearInterval(timer); v3?.dispose?.(); return; }
    load();
  }, 5000);
}
