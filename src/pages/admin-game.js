import { html, raw, $, toast, confirmBox } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { act } from '../lib/act.js';
import { num } from '../lib/format.js';
import { settings, dropSettings } from '../lib/settings.js';

const ST = { rework: 'на переработке', live: 'выдаётся', off: 'выключено' };

// ═ Достижения: переименование и новые награды ═
export async function achievements(sec, q = '') {
  const { data, error } = await sb.from('v1_achievements').select('*').order('sort');
  if (error) { sec.innerHTML = '<p class="empty warn">Достижения ещё не перенесены в базу: примените миграцию 20261023_10_achievements.sql.</p>'; return; }
  const s = await settings(true);
  const sys = s.achievements?.status || 'rework';
  const rows = (data || []).filter((a) => !q || `${a.id} ${a.name} ${a.old_name} ${a.cond}`.toLowerCase().includes(q.toLowerCase()));
  const done = (data || []).filter((a) => a.name.trim()).length;
  const sumOld = (data || []).reduce((t, a) => t + a.reward_old, 0), sumNew = (data || []).reduce((t, a) => t + a.reward, 0);
  sec.innerHTML = html`
    <div class="sec-h"><h2>Достижения</h2><small>переименовано ${done} из ${data.length}</small>
      <input class="search" type="search" id="ac-q" placeholder="Поиск" aria-label="Поиск" value="${q}"></div>
    <div class="grp"><h4>Система достижений</h4>
      <div class="give"><select id="ac-sys" aria-label="Состояние системы">${Object.entries(ST).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === sys ? 'selected' : '')}>${v}</option>`))}</select>
        <span class="hint">Сейчас: ${ST[sys]}. В кабинете игроки видят «${sys === 'rework' ? 'Система достижений на переработке' : sys === 'off' ? 'Достижения выключены' : 'обычный список'}».</span></div>
      <h4>Награды</h4>
      <p class="hint">Все награды вместе: было ${num(sumOld)} ГС, сейчас ${num(sumNew)} ГС. Массовый пересчёт: новая = старая × k (округление до сотен), потом можно поправить каждую вручную.</p>
      <div class="acts">${[2, 3, 5, 10].map((k) => raw(html`<button type="button" class="btn sm" data-k="${k}">× ${k}</button>`))}</div></div>
    <div class="tbl ach-tbl"><table><thead><tr><th>Было</th><th>Условие</th><th>Новое название</th><th>Награда, ГС</th><th>Статус</th></tr></thead><tbody>
      ${rows.map((a) => raw(html`<tr data-id="${a.id}"><td><b>${a.old_name || a.id}</b><small>${a.id} · было ${num(a.reward_old)}</small></td>
        <td><input type="text" data-f="cond" value="${a.cond}" aria-label="Условие"></td>
        <td><input type="text" data-f="name" value="${a.name}" placeholder="придумать" aria-label="Новое название"><input type="text" data-f="description" value="${a.description}" placeholder="описание" aria-label="Описание"></td>
        <td><input type="number" data-f="reward" value="${a.reward}" min="0" step="500" aria-label="Награда"></td>
        <td><select data-f="status" aria-label="Статус">${Object.entries(ST).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === a.status ? 'selected' : '')}>${v}</option>`))}</select></td></tr>`))}
    </tbody></table></div>
    <p class="hint">Изменения сохраняются сами, когда уходите из поля.</p>`;
  const inp = $('#ac-q', sec);
  inp.onkeydown = (e) => { if (e.key === 'Enter') achievements(sec, inp.value.trim()); };
  sec.onchange = async (e) => {
    if (e.target.id === 'ac-sys') {
      const r = await act('settings.save', 'achievements', { status: e.target.value }).catch(() => null);
      if (r) { dropSettings(); achievements(sec, q); }
      return;
    }
    const tr = e.target.closest('tr[data-id]'); const f = e.target.dataset.f; if (!tr || !f) return;
    const v = f === 'reward' ? Number(e.target.value || 0) : e.target.value;
    await act('ach.save', tr.dataset.id, { [f]: v }, null, { quiet: true }).then(() => toast('Сохранено')).catch(() => {});
  };
  sec.onclick = async (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    if (!(await confirmBox(`Пересчитать ВСЕ награды: старая × ${b.dataset.k}? Ручные правки наград пропадут.`, 'Пересчитать'))) return;
    const r = await act('ach.scale', null, { k: Number(b.dataset.k) }).catch(() => null);
    if (r?.status === 'done') achievements(sec, q);
  };
}

// ═ Сражения: тестовый бой на новой базе ═
export async function battles(sec) {
  const { rpc } = await import('../lib/supabase.js');
  let cands, list;
  try { [cands, list] = await Promise.all([rpc('v1_battle_candidates'), rpc('v1_battle_list')]); }
  catch (e) { sec.innerHTML = html`<p class="empty warn">${e.missingSchema ? 'Новая база сражений ещё не подключена: примените миграцию 20261023_11_battles.sql.' : e.message}</p>`; return; }
  sec.innerHTML = html`
    <div class="sec-h"><h2>Сражения</h2><small>новая база боя</small></div>
    <div class="grp"><h4>Тестовый бой</h4>
      <p class="hint">Флоты двух держав, стоящие в одной системе, выходят на поле. Тестовый бой ничего не меняет во флотах: потери и отступление не записываются. Команда проекта может ходить за обе стороны.</p>
      ${cands.length ? raw(html`<div class="give"><select id="bt-sys" aria-label="Система">${cands.map((c, i) => raw(html`<option value="${i}">${c.name} · флотов ${c.fleets.length}</option>`))}</select></div><div id="bt-fl"></div>
        <div class="acts"><button type="button" class="btn gold sm" id="bt-go">Начать тестовый бой</button></div>`)
        : raw('<p class="empty">Нет систем, где стоят флоты двух держав.</p>')}</div>
    <h3 class="sub-h">Бои</h3>
    <div class="tbl"><table><thead><tr><th>Когда</th><th>Тип</th><th>Стороны</th><th>Ход</th><th>Статус</th><th></th></tr></thead><tbody>
      ${list.length ? '' : raw('<tr><td colspan="6" class="empty">Боёв на новой базе ещё не было.</td></tr>')}
      ${list.map((b) => raw(html`<tr><td>${new Date(b.created_at).toLocaleString('ru-RU')}</td><td>${b.kind}</td><td>${(b.sides || []).map((s) => `${s.side.toUpperCase()}: ${s.faction_id} (${s.status})`).join(' · ')}</td><td>${b.turn_no}</td><td><span class="tag">${b.status}</span></td><td><a class="btn sm" href="#/battle?id=${b.id}">Открыть</a></td></tr>`))}
    </tbody></table></div>`;
  if (!cands.length) return;
  const drawFleets = () => {
    const c = cands[Number($('#bt-sys', sec).value)];
    const facs = [...new Map(c.fleets.map((f) => [f.faction_id, f.faction || f.faction_id])).entries()];
    $('#bt-fl', sec).innerHTML = html`<div class="row2 bt-sides">${['a', 'b'].map((side, si) => raw(html`<div><b>Сторона ${side.toUpperCase()}</b>
      <select data-side="${side}" aria-label="Держава стороны ${side}">${facs.map(([id, n], i) => raw(html`<option value="${id}" ${raw(i === si ? 'selected' : '')}>${n}</option>`))}</select></div>`))}</div>
      <ul class="bt-list">${c.fleets.map((f) => raw(html`<li>${f.faction || f.faction_id} — ${f.name} (${f.ships} кор.)</li>`))}</ul>`;
  };
  drawFleets();
  $('#bt-sys', sec).onchange = drawFleets;
  $('#bt-go', sec).onclick = async () => {
    const c = cands[Number($('#bt-sys', sec).value)];
    const fa = $('[data-side=a]', sec).value, fb = $('[data-side=b]', sec).value;
    if (fa === fb) { toast('Выберите разные державы', 'err'); return; }
    try {
      const id = await rpc('v1_battle_create', { p_kind: 'test', p_system: c.system_id,
        p_fleets_a: c.fleets.filter((f) => f.faction_id === fa).map((f) => f.id), p_fleets_b: c.fleets.filter((f) => f.faction_id === fb).map((f) => f.id) });
      location.hash = `/battle?id=${id}`;
    } catch (e) { toast(e.message, 'err'); }
  };
}
