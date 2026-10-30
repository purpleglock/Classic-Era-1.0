import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
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
    <div class="sec-h"><h2>Сражения</h2><small>новая база боя</small><a class="btn sm gold" href="#/battlemap">Космические карты</a><a class="btn sm gold" href="#/groundmap">Наземные карты</a></div>
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

// ═ Лор: летопись и вики фракций ═
export async function lore(sec, openId = null) {
  const { BLOCK_LABEL, renderBlocks } = await import('../lib/blocks.js');
  const { wireRich } = await import('../lib/rich.js');
  const { loadHeralds } = await import('./home.js');
  const { pickImage } = await import('./admin-media.js');
  const { data, error } = await sb.from('v1_lore').select('*').order('kind').order('sort').order('title');
  if (error) { sec.innerHTML = '<p class="empty warn">Лор ещё не подключён в базе: примените миграцию 20261023_13_lore.sql.</p>'; return; }
  const H = await loadHeralds().catch(() => ({}));
  openId ||= new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  const pages = data || [];
  const noPage = Object.entries(H).filter(([fid]) => !pages.some((p) => p.faction_id === fid));
  sec.innerHTML = html`
    <div class="sec-h"><h2>Лор</h2><small>летопись и вики фракций</small></div>
    <div class="split lore-split">
      <div class="tree" id="lr-tree">
        <b>История</b>${pages.filter((p) => p.kind === 'history').map((p) => raw(html`<button type="button" data-id="${p.id}">${p.published ? '' : '◌ '}${p.title}</button>`))}
        <button type="button" data-new="history">+ Новая эра</button>
        <b>Фракции</b>${pages.filter((p) => p.kind === 'faction').map((p) => raw(html`<button type="button" data-id="${p.id}">${p.published ? '' : '◌ '}${p.title}</button>`))}
        ${noPage.length ? raw(html`<select id="lr-newfac" aria-label="Создать страницу фракции"><option value="">+ Страница фракции…</option>${noPage.map(([fid, h]) => raw(html`<option value="${fid}">${h.name}</option>`))}</select>`) : ''}
      </div>
      <div class="detail" id="lr-ed"><p class="empty">Выберите страницу слева.</p></div>
    </div>`;
  const ed = $('#lr-ed', sec);
  const STYLES = { '': 'обычный', 'h-gold': 'золотой', 'h-glitch': 'глитч', 'h-scan': 'сканер' };

  const open = (p) => {
    sec.querySelectorAll('#lr-tree button').forEach((b) => b.classList.toggle('sel', b.dataset.id === p.id));
    const blocks = structuredClone(p.blocks || []);
    const field = (b, i) => {
      const t = (k, v, ph = '', rows = 4) => html`<textarea data-i="${i}" data-k="${k}" rows="${rows}" placeholder="${ph}">${v || ''}</textarea>`;
      const inp = (k, v, ph = '') => html`<input type="text" data-i="${i}" data-k="${k}" value="${v || ''}" placeholder="${ph}">`;
      switch (b.type) {
        case 'text': return t('content', b.content, 'Текст. Разметка как в новостях: **жирный**, [c:gold]цвет[/c], [center]…[/center], [fac:id|flag]Держава[/fac]', 6);
        case 'heading': return html`<div class="give">${raw(inp('text', b.text, 'Заголовок'))}<select data-i="${i}" data-k="style">${Object.entries(STYLES).map(([k, v]) => raw(html`<option value="${k}" ${raw((b.style || '') === k ? 'selected' : '')}>${v}</option>`))}</select></div>`;
        case 'quote': return raw(t('text', b.text, 'Цитата', 2) + inp('author', b.author, 'Автор'));
        case 'callout': return raw(inp('title', b.title, 'Заголовок врезки') + t('content', b.content, 'Текст'));
        case 'alert': return raw(inp('title', b.title, 'Заголовок') + t('content', b.content, 'Текст'));
        case 'divider': case 'toc': return html`<p class="hint">${b.type === 'toc' ? 'Оглавление собирается само из заголовков.' : 'Разделительная линия.'}</p>`;
        default: { const { id, type, ...rest } = b; return html`<textarea data-i="${i}" data-json rows="8">${JSON.stringify(rest, null, 2)}</textarea><p class="hint">Сложный блок — правится как данные. Сохраняйте структуру.</p>`; }
      }
    };
    const draw = () => {
      ed.innerHTML = html`
        <label for="lr-title">Название</label><input id="lr-title" type="text" value="${p.title}">
        <label>Обложка</label><div class="lr-cover">${p.cover_url ? raw(html`<img src="${p.cover_url}" alt="">`) : raw('<span>нет</span>')}
          <div class="acts"><button type="button" class="btn sm" id="lr-cov">Выбрать из медиатеки</button>${p.cover_url ? raw('<button type="button" class="btn sm" id="lr-cov-x">Убрать</button>') : ''}</div></div>
        <div class="row2"><label class="check"><input type="checkbox" id="lr-pub" ${raw(p.published !== false ? 'checked' : '')}> Опубликовано</label>
          ${p.kind === 'history' ? raw(html`<label>Порядок <input type="number" id="lr-sort" value="${p.sort || 0}" step="10" style="width:90px"></label>`) : ''}</div>
        <h3 class="sub-h">Блоки</h3>
        <ol class="lr-blocks">${blocks.map((b, i) => raw(html`<li class="lr-b"><div class="lr-bh"><b>${BLOCK_LABEL[b.type] || b.type}</b>
          <span><button type="button" class="ib" data-up="${i}" aria-label="Выше">↑</button><button type="button" class="ib" data-down="${i}" aria-label="Ниже">↓</button><button type="button" class="ib" data-del="${i}" aria-label="Удалить блок">${icon('i-x')}</button></span></div>${raw(field(b, i))}</li>`))}</ol>
        <div class="acts lr-add">${['text', 'heading', 'quote', 'callout', 'alert', 'divider', 'toc'].map((k) => raw(html`<button type="button" class="btn sm" data-add="${k}">+ ${BLOCK_LABEL[k]}</button>`))}</div>
        <div class="acts"><button type="button" class="btn gold sm" id="lr-save">Сохранить</button><button type="button" class="btn sm" id="lr-prev">Предпросмотр</button>
          <a class="btn sm" href="${p.kind === 'history' ? `#/history?s=${p.slug || ''}` : `#/wiki?f=${p.faction_id}`}">Открыть на сайте</a></div>
        <div class="panel lore-page lr-preview" id="lr-pv" hidden></div>`;
    };
    draw();
    ed.oninput = (e) => {
      const i = e.target.dataset.i; if (i == null) return;
      if (e.target.dataset.json != null) { try { const v = JSON.parse(e.target.value); blocks[i] = { id: blocks[i].id, type: blocks[i].type, ...v }; e.target.classList.remove('bad'); } catch { e.target.classList.add('bad'); } return; }
      blocks[i][e.target.dataset.k] = e.target.value;
    };
    ed.onchange = (e) => { const i = e.target.dataset.i; if (i != null && e.target.dataset.k) blocks[i][e.target.dataset.k] = e.target.value; };
    ed.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      const sync = () => { p.title = $('#lr-title', ed).value; p.published = $('#lr-pub', ed).checked; const so = $('#lr-sort', ed); if (so) p.sort = Number(so.value || 0); };
      if (t.dataset.add) { sync(); blocks.push({ id: Math.random().toString(36).slice(2, 9), type: t.dataset.add, ...(t.dataset.add === 'divider' ? { style: 'stars' } : {}) }); p.blocks = blocks; draw(); return; }
      if (t.dataset.del) { sync(); blocks.splice(Number(t.dataset.del), 1); p.blocks = blocks; draw(); return; }
      if (t.dataset.up || t.dataset.down) {
        sync(); const i = Number(t.dataset.up ?? t.dataset.down), j = t.dataset.up ? i - 1 : i + 1;
        if (j >= 0 && j < blocks.length) [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        p.blocks = blocks; draw(); return;
      }
      if (t.id === 'lr-cov') { sync(); const { data: m } = await sb.from('v1_media').select('url,name,mime').order('created_at', { ascending: false }).limit(300); const u = await pickImage(m || [], 'page'); if (u) { p.cover_url = u; p.blocks = blocks; draw(); } return; }
      if (t.id === 'lr-cov-x') { sync(); p.cover_url = null; p.blocks = blocks; draw(); return; }
      if (t.id === 'lr-prev') {
        const pv = $('#lr-pv', ed); pv.hidden = !pv.hidden;
        if (!pv.hidden) { pv.innerHTML = `<div class="rich lore-body">${renderBlocks(blocks, { heralds: H }).html}</div>`; wireRich(pv); }
        return;
      }
      if (t.id === 'lr-save') {
        sync();
        if (ed.querySelector('textarea.bad')) { toast('В одном из сложных блоков ошибка в данных', 'err'); return; }
        const r = await act('lore.save', p.id, { kind: p.kind, slug: p.slug, title: p.title, cover_url: p.cover_url || '', blocks, faction_id: p.faction_id || '', sort: p.sort || 0, published: p.published !== false }).catch(() => null);
        if (r?.status === 'done') lore(sec, p.id);
      }
    };
  };

  $('#lr-tree', sec).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.new === 'history') {
      const slug = `era-${Date.now().toString(36)}`;
      open({ id: `history/${slug}`, kind: 'history', slug, title: 'Новая эра', blocks: [{ id: 'q1', type: 'quote', text: '', author: '' }, { id: 't1', type: 'text', content: '' }], sort: (pages.filter((p) => p.kind === 'history').at(-1)?.sort || 0) + 10, published: false });
      return;
    }
    const p = pages.find((x) => x.id === b.dataset.id); if (p) open(p);
  };
  $('#lr-newfac', sec)?.addEventListener('change', (e) => {
    const fid = e.target.value; if (!fid) return;
    open({ id: `faction/${fid}`, kind: 'faction', title: H[fid]?.name || 'Фракция', faction_id: fid, blocks: [{ id: 'ib', type: 'infobox', label: 'Фракция', title: H[fid]?.name || '', sections: [{ name: 'Основное', rows: [{ key: 'Столица', val: '' }] }] }, { id: 'h1', type: 'heading', text: 'История', style: 'h-gold' }, { id: 't1', type: 'text', content: '' }], published: true });
  });
  const first = pages.find((p) => p.id === openId);
  if (first) open(first);
}

// ═ Политика держав: объединения, порядок колоний, цены ═
export async function politics(sec) {
  const s = await settings(true);
  const pol = s.politics || {};
  const [{ data: merges }, { data: apps }] = await Promise.all([
    sb.from('v1_merge_requests').select('*').in('status', ['agreed', 'proposed']).order('created_at', { ascending: false }),
    sb.from('faction_applications').select('faction_id,name').eq('status', 'approved'),
  ]);
  const nm = Object.fromEntries((apps || []).map((a) => [a.faction_id, a.name]));
  const EDIT = [
    ['colonize', 'Колонизация', 'system_cost, planet_cost, station_cost, claim_cd_days'],
    ['colonies', 'Управление колониями', 'habitat_cost, terraform (цены по сложности), refund_share'],
    ['course', 'Курсы', 'cd_days, axes, points'],
    ['politics', 'Порядок и волнения', 'пороги, решения, служба безопасности'],
    ['war', 'Война', 'capitulation_share — порог капитуляции'],
    ['council', 'Межгалактическое сообщество', 'длительность голосования, последствия резолюций'],
  ];
  sec.innerHTML = html`
    <div class="sec-h"><h2>Политика держав</h2></div>
    <div class="grp"><h4>Объединения держав (старшая уния)</h4>
      ${(merges || []).length ? raw(html`<ul class="op-list">${merges.map((m) => raw(html`<li><span class="b-n"><b>${nm[m.minor_fid] || m.minor_fid} → ${nm[m.lead_fid] || m.lead_fid}</b>
        <small>${m.status === 'agreed' ? 'обе стороны согласны — ждёт утверждения' : 'ждёт согласия младшей стороны'}</small></span>
        ${m.status === 'agreed' ? raw(html`<button type="button" class="btn sm gold" data-mg="approve" data-id="${m.id}" data-name="${nm[m.minor_fid] || ''}">Утвердить слияние</button><button type="button" class="btn sm" data-mg="decline" data-id="${m.id}">Отклонить</button>`) : ''}</li>`))}</ul>`)
        : raw('<p class="hint">Заявок на объединение нет.</p>')}
      <p class="hint">Слияние необратимо: всё имущество младшей державы переходит старшей, её правитель становится соправителем. Утверждает только суперадмин.</p></div>
    <div class="grp"><h4>Порядок колоний и восстания</h4>
      <div class="give"><label class="check"><input type="checkbox" id="pl-live" ${raw(pol.live ? 'checked' : '')}> <span>Боевой режим: восставшие колонии отделяются</span></label>
        <button type="button" class="btn sm" id="pl-tick">Прогнать суточный тик сейчас</button></div>
      <p class="hint">Сейчас ${pol.live ? 'включён боевой режим' : 'режим просмотра: порядок, волнения и решения работают, но колонии не отделяются'}. Тик сам идёт каждый день в 00:20 по UTC.</p></div>
    <div class="grp"><h4>Числа механик</h4>
      <p class="hint">Цены и пороги лежат в настройках сайта. Изменения действуют сразу.</p>
      <div class="give"><select id="pl-key" aria-label="Настройка">${EDIT.map(([k, l, d]) => raw(html`<option value="${k}">${l} — ${d}</option>`))}</select></div>
      <textarea id="pl-json" rows="12" spellcheck="false" class="mono" aria-label="Настройка в JSON"></textarea>
      <div class="acts"><button type="button" class="btn sm gold" id="pl-save">Сохранить</button></div></div>`;
  const keySel = $('#pl-key', sec), area = $('#pl-json', sec);
  const fill = () => { area.value = JSON.stringify(s[keySel.value] || {}, null, 2); };
  keySel.onchange = fill; fill();
  $('#pl-save', sec).onclick = async () => {
    let v;
    try { v = JSON.parse(area.value); } catch { toast('Неверный JSON', 'err'); return; }
    const r = await act('settings.save', keySel.value, v).catch(() => null);
    if (r) { dropSettings(); toast('Сохранено'); politics(sec); }
  };
  $('#pl-live', sec).onchange = async (e) => {
    if (e.target.checked && !(await confirmBox('Включить боевой режим? Колонии, где восстание не подавлено за 5 дней, будут отделяться от держав.', 'Включить'))) { e.target.checked = false; return; }
    const r = await act('settings.save', 'politics', { ...pol, live: e.target.checked }).catch(() => null);
    if (r) { dropSettings(); politics(sec); }
  };
  $('#pl-tick', sec).onclick = async () => { const r = await act('politics.tick', 'all', {}).catch(() => null); if (r) toast('Тик выполнен'); };
  sec.onclick = async (e) => {
    const b = e.target.closest('[data-mg]');
    if (!b) return;
    if (b.dataset.mg === 'approve' && !(await confirmBox(`Утвердить слияние? Держава «${b.dataset.name}» перестанет существовать.`, 'Утвердить'))) return;
    const r = await act(b.dataset.mg === 'approve' ? 'diplo.merge_approve' : 'diplo.merge_decline', b.dataset.id, {}).catch(() => null);
    if (r) politics(sec);
  };
}

// ═ Экономика: режим нового тика и торговые корабли ═
export async function economy(sec) {
  const { rpc } = await import('../lib/supabase.js');
  const s = await settings(true);
  const eco = s.economy || {}, trade = s.trade || { ships: [] };
  let cand;
  try { cand = await rpc('v1_trade_ship_candidates'); } catch (e) { sec.innerHTML = html`<p class="empty warn">${e.message}</p>`; return; }
  const chosen = new Set((cand.chosen || []).map((x) => x.id));
  const row = (x) => html`<li><label class="check"><input type="checkbox" data-ship="${x.id}" data-src="${x.src}" ${raw(chosen.has(x.id) ? 'checked' : '')}>
    <span><b>${x.name}</b><small>${x.class || 'корабль'}${x.faction ? ` · ${x.faction}` : ' · общедоступный'} · груз ${x.cargo != null ? num(x.cargo) : 'по размеру'}${x.cost != null ? ` · ${num(x.cost)} ГС` : ''}${x.ok === false ? ' · проект с ошибками' : ''}</small></span></label></li>`;
  sec.innerHTML = html`
    <div class="sec-h"><h2>Экономика</h2></div>
    <div class="grp"><h4>Суточный тик</h4>
      <p class="hint">${eco.live ? 'Новый тик экономики начисляет по-настоящему.' : 'Новый тик в режиме просмотра: каждый день в 00:09 UTC он считает сутки держав и пишет итог, но не начисляет — начисляет старый тик. Включается в день переезда миграцией, которая выключает старый тик.'}</p></div>
    <div class="grp"><h4>Торговые корабли</h4>
      <p class="hint">Только эти проекты возят грузы: караван — флот, целиком собранный из них. Отмеченные проекты может строить любая держава на своих верфях. Выбор действует сразу.</p>
      <input class="search" type="search" id="ts-q" placeholder="Поиск проекта" aria-label="Поиск проекта">
      <h4 class="sub-h">Общедоступные проекты реестра</h4>
      <ul class="op-list" id="ts-pub">${(cand.public || []).length ? cand.public.map((x) => raw(row(x))) : raw('<li class="hint">Общедоступных кораблей пока нет.</li>')}</ul>
      <h4 class="sub-h">Проекты конструктора</h4>
      <ul class="op-list" id="ts-v1">${(cand.designs || []).map((x) => raw(row(x)))}</ul>
      <div class="acts"><button type="button" class="btn gold sm" id="ts-save">Сохранить список</button><span class="hint" id="ts-n">Выбрано: ${chosen.size}</span></div></div>`;
  const boxes = () => [...sec.querySelectorAll('[data-ship]')];
  sec.addEventListener('change', () => { $('#ts-n', sec).textContent = `Выбрано: ${boxes().filter((b) => b.checked).length}`; });
  $('#ts-q', sec).oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    boxes().forEach((b) => { b.closest('li').hidden = q && !b.closest('li').textContent.toLowerCase().includes(q); });
  };
  $('#ts-save', sec).onclick = async () => {
    const ships = boxes().filter((b) => b.checked).map((b) => ({ src: b.dataset.src, id: b.dataset.ship }));
    const r = await act('settings.save', 'trade', { ...trade, ships }).catch(() => null);
    if (r !== null) { dropSettings(); toast(`Торговых проектов: ${ships.length}.`); }
  };
}
