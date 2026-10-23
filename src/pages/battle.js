import { html, raw, icon, $, toast } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { num } from '../lib/format.js';

/**
 * Поле боя на новой базе. Своё видно целиком, у противника — только класс,
 * позиция и примерный износ. Отступление: кнопка → 3 хода → флот уходит из системы.
 * Состояние обновляется раз в 5 секунд (живые обновления подключим вместе с правилами боя).
 */
const SIDE = { a: 'A', b: 'B' };
const ST = { fighting: 'в бою', retreating: 'отступает', retreated: 'отступила', defeated: 'разбита', won: 'победила' };

export async function renderBattle(root) {
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  if (!id || !session.user) { location.hash = '/'; return; }
  let st = null, sel = null, timer = 0;
  root.innerHTML = '<div class="skeleton">Загружаю бой…</div>';

  const load = async () => {
    try { st = await rpc('v1_battle_state', { p_battle: id }); draw(); }
    catch (e) { clearInterval(timer); root.innerHTML = html`<section class="panel gate"><div><h1>Бой недоступен</h1><p>${e.missingSchema ? 'Новая база сражений ещё не подключена в базе (миграция 11).' : e.message}</p></div><a class="btn" href="#/">На главную</a></section>`; }
  };
  const call = async (fn, args) => { try { st = await rpc(fn, { p_battle: id, ...args }); sel = null; draw(); } catch (e) { toast(e.message, 'err'); } };

  function draw() {
    const b = st.battle;
    const me = st.me || (st.staff && b.kind === 'test' ? b.side_to_move : null);
    const mySide = st.sides.find((s) => s.side === me);
    const myTurn = b.status === 'active' && b.side_to_move === me;
    const left = b.turn_deadline ? Math.max(0, Math.round((new Date(b.turn_deadline) - Date.now()) / 60000)) : null;
    const units = st.units.filter((u) => u.alive && !u.left_field);
    if (!root.querySelector('.bt-wrap')) {
      root.innerHTML = html`
        <section class="panel guide-head"><span class="m-ic">${icon('i-sword')}</span>
          <div><h1>Сражение</h1><p id="bt-sub"></p></div><a class="btn sm" href="${st.staff ? '#/admin?s=battles' : '#/cabinet'}">${icon('i-back')}Назад</a></section>
        <div class="bt-wrap">
          <div class="panel bt-board"><canvas id="bt-cv" aria-label="Поле боя"></canvas><p class="hint" id="bt-hint"></p></div>
          <aside class="panel bt-side"><div id="bt-sides"></div><div class="acts" id="bt-acts"></div><div id="bt-unit"></div><h3 class="sub-h">Журнал</h3><ol class="bt-log" id="bt-log"></ol></aside>
        </div>`;
      const cv = $('#bt-cv', root);
      cv.addEventListener('click', (e) => {
        const r = cv.getBoundingClientRect(), cs = r.width / st.battle.board_w;
        const x = Math.floor((e.clientX - r.left) / cs), y = Math.floor((e.clientY - r.top) / cs);
        const cur = st.units.find((u) => u.alive && !u.left_field && u.x === x && u.y === y);
        const meNow = st.me || (st.staff && st.battle.kind === 'test' ? st.battle.side_to_move : null);
        if (cur && cur.side === meNow) { sel = cur.id; draw(); return; }
        if (!sel) { sel = null; draw(); return; }
        if (cur) call('v1_battle_act', { p_unit: sel, p_kind: 'fire', p_x: null, p_y: null, p_target: cur.id });
        else call('v1_battle_act', { p_unit: sel, p_kind: 'move', p_x: x, p_y: y, p_target: null });
      });
    }
    $('#bt-sub', root).textContent = `${b.kind === 'test' ? 'Тестовый бой' : 'Бой'} · ход ${b.turn_no} · ${b.status === 'active' ? `ходит сторона ${SIDE[b.side_to_move]}${left != null ? ` · на ход осталось ~${left} мин` : ''}` : `окончен: ${b.result?.why || ''}`}`;
    $('#bt-sides', root).innerHTML = st.sides.map((s) => html`<div class="bt-sd ${s.side === me ? 'me' : ''}"><b>${SIDE[s.side]} · ${s.name || s.faction_id}</b><span class="tag ${s.status === 'retreating' ? 'new' : ''}">${ST[s.status] || s.status}${s.status === 'retreating' ? ` · уйдёт на ${s.retreat_at_turn}-м ходу (через ${s.retreat_at_turn - b.turn_no})` : ''}</span></div>`).join('');
    const acts = $('#bt-acts', root);
    acts.innerHTML = b.status !== 'active' || !me ? '' : html`
      <button type="button" class="btn gold sm" id="bt-end" ${raw(myTurn ? '' : 'disabled')}>Завершить ход</button>
      ${mySide?.status === 'retreating' ? raw('<button type="button" class="btn sm" id="bt-stay">Отменить отступление</button>') : raw('<button type="button" class="btn sm danger" id="bt-ret">Отступить</button>')}`;
    $('#bt-end', root)?.addEventListener('click', () => call('v1_battle_end_turn', {}));
    $('#bt-ret', root)?.addEventListener('click', async () => {
      const { confirmBox } = await import('../lib/dom.js');
      if (await confirmBox('Начать отступление? Отряды продержатся ещё 3 хода и уйдут с поля, а флот улетит в соседнюю систему.', 'Отступить')) call('v1_battle_retreat', { p_dest: null });
    });
    $('#bt-stay', root)?.addEventListener('click', () => call('v1_battle_retreat_cancel', {}));
    const u = st.units.find((x) => x.id === sel);
    $('#bt-unit', root).innerHTML = u ? html`<div class="grp"><h4>${u.name}</h4><p class="hint">${u.class} · кораблей ${u.qty}/${u.qty_start} · прочность ${num(u.hp)} · щит ${num(u.shield)}</p>
      <p class="hint">Скорость ${u.stats?.speed}, дальность ${u.stats?.rng}, урон ${num(u.stats?.dmg)}. ${u.moved ? 'Уже ходил. ' : ''}${u.fired ? 'Уже стрелял.' : ''}</p></div>` : '';
    $('#bt-hint', root).textContent = myTurn ? 'Выберите свой отряд, затем пустую клетку — движение, или противника — огонь.' : b.status === 'active' ? 'Ход противника. Поле обновляется само.' : '';
    $('#bt-log', root).innerHTML = st.log.slice().reverse().map((l) => html`<li><time>ход ${l.turn_no}</time>${l.text}</li>`).join('');
    paint(units, me);
  }

  function paint(units, me) {
    const b = st.battle, cv = $('#bt-cv', root), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
    const w = cv.clientWidth, cs = w / b.board_w, h = cs * b.board_h;
    cv.style.height = `${h}px`;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#030303'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(233,185,73,0.08)';
    for (let i = 0; i <= b.board_w; i++) { ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, h); ctx.stroke(); }
    for (let j = 0; j <= b.board_h; j++) { ctx.beginPath(); ctx.moveTo(0, j * cs); ctx.lineTo(w, j * cs); ctx.stroke(); }
    const su = units.find((u) => u.id === sel);
    if (su?.stats) {
      ctx.fillStyle = 'rgba(233,185,73,0.10)';
      for (let x = 0; x < b.board_w; x++) for (let y = 0; y < b.board_h; y++) if (Math.max(Math.abs(x - su.x), Math.abs(y - su.y)) <= su.stats.speed && !su.moved) ctx.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
      ctx.strokeStyle = 'rgba(255,107,94,0.35)'; ctx.setLineDash([4, 4]);
      const r = su.stats.rng; ctx.strokeRect((su.x - r) * cs, (su.y - r) * cs, (2 * r + 1) * cs, (2 * r + 1) * cs); ctx.setLineDash([]);
    }
    for (const u of units) {
      const x = (u.x + 0.5) * cs, y = (u.y + 0.5) * cs, mine = u.side === me;
      ctx.fillStyle = mine ? '#e9b949' : '#ff6b5e';
      ctx.beginPath();
      if (u.side === 'a') { ctx.moveTo(x + cs * 0.35, y); ctx.lineTo(x - cs * 0.3, y - cs * 0.28); ctx.lineTo(x - cs * 0.3, y + cs * 0.28); }
      else { ctx.moveTo(x - cs * 0.35, y); ctx.lineTo(x + cs * 0.3, y - cs * 0.28); ctx.lineTo(x + cs * 0.3, y + cs * 0.28); }
      ctx.closePath(); ctx.fill();
      if (u.id === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(u.x * cs + 2, u.y * cs + 2, cs - 4, cs - 4); ctx.lineWidth = 1; }
      ctx.fillStyle = '#000'; ctx.font = `800 ${Math.max(9, cs * 0.28)}px Manrope, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.qty), x - (u.side === 'a' ? cs * 0.05 : -cs * 0.05), y);
      const frac = mine && u.hp_ship ? u.hp / (u.hp_ship * u.qty_start) : 1 - (u.wear || 0) / 100;
      ctx.fillStyle = '#ffffff22'; ctx.fillRect(u.x * cs + 4, (u.y + 1) * cs - 6, cs - 8, 3);
      ctx.fillStyle = mine ? '#e9b949' : '#ff6b5e'; ctx.fillRect(u.x * cs + 4, (u.y + 1) * cs - 6, (cs - 8) * Math.max(0, frac), 3);
    }
  }

  await load();
  timer = setInterval(() => { if (!root.querySelector('#bt-cv')) { clearInterval(timer); return; } load(); }, 5000);
}
