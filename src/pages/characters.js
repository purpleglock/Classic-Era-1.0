import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, dateTime } from '../lib/format.js';

/**
 * #/characters — персонажи и личные финансы.
 * У каждого персонажа свой счёт в ГС, отдельно от казны. Деньги приходят жалованьем и выплатами
 * из казны (право «Казна»), переводами от других персонажей, выигрышами в баре и на арене,
 * наградами команды проекта за события. Держава пала — персонаж уходит «без державы» с деньгами.
 * Сервер (миграция 48): v1_char_state, v1_char_create/edit/use/join/heir/die,
 * v1_char_send/donate/pay/salary_set/grant, v1_char_ledger_read, v1_char_directory.
 */
const KIND = {
  salary: 'Жалованье', salary_miss: 'Жалованье не выплачено', pay: 'Выплата из казны', send: 'Перевод', recv: 'Получен перевод',
  donate: 'Пожертвование', inherit: 'Наследство', death: 'Гибель', grant: 'Команда проекта', exile: 'Без державы', join: 'Служба',
  arena_bet: 'Ставка на арене', arena_win: 'Арена', arena_prize: 'Приз арены',
};
const STATUS = { active: 'на службе', exile: 'без державы', dead: 'погиб' };
let tab = 'mine', dir = null, q = '', openLedger = null, ledger = [], editing = null;

const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export async function renderCharacters(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-users')}</span><div><h1>Персонажи</h1><p>Войдите, чтобы создать персонажа.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!root.querySelector('.ch-wrap')) root.innerHTML = '<div class="skeleton">Поднимаю личные дела…</div>';
  let s;
  try {
    [s, dir] = await Promise.all([rpc('v1_char_state'), rpc('v1_char_directory', { p_q: q || null, p_dead: tab === 'dir' })]);
    if (openLedger) ledger = await rpc('v1_char_ledger_read', { p_char: openLedger, p_limit: 40 }).catch(() => []);
  } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Персонажи недоступны</h1><p>${e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const cfg = s.settings || {}, tax = Math.round((cfg.tax ?? 0.05) * 100), maxAlive = Number(cfg.max_alive || 3);
  const mine = s.mine || [], alive = mine.filter((c) => c.status !== 'dead'), act = mine.find((c) => c.id === s.active);
  const fac = s.faction, others = (dir || []).filter((c) => c.status !== 'dead');
  const reload = () => renderCharacters(root);
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); reload(); return r; } catch (e) { toast(e.message, 'err'); } };
  const total = alive.reduce((a, c) => a + Number(c.gc || 0), 0);
  const tabs = [['mine', `Мои персонажи · ${alive.length}`], ...(fac ? [['fac', `Держава${fac.martial ? ' · военное положение' : ''}`]] : []), ['dir', 'Справочник']];
  if (!tabs.find(([k]) => k === tab)) tab = 'mine';

  const charCard = (c) => {
    const dead = c.status === 'dead';
    const heirOpts = [...alive, ...others].filter((x, i, a) => x.id !== c.id && a.findIndex((y) => y.id === x.id) === i);
    return html`<article class="ch-card ${dead ? 'dead' : ''} ${c.id === s.active ? 'on' : ''}">
      <header>
        <span class="ch-ava" aria-hidden="true">${initials(c.name)}</span>
        <div class="ch-id"><b>${c.name}</b><small>${c.title || (dead ? 'погиб' : 'без титула')}</small></div>
        <span class="tag ${c.status === 'active' ? 'new' : ''}">${c.status === 'active' ? `служит «${c.faction}»` : STATUS[c.status]}</span>
      </header>
      ${dead ? raw(html`<p class="fl-note">Погиб ${dateTime(c.died_at)}${c.death_note ? ` · ${c.death_note}` : ''}.</p>`) : raw(html`
      <div class="ch-money">
        <div><small>Личный счёт</small><b>${num(c.gc)} ГС</b></div>
        <div><small>Жалованье</small><b>${c.salary ? `${num(c.salary)} ГС/сут.` : '—'}</b></div>
        <div><small>Наследник</small><b>${c.heir_name || '—'}</b></div>
      </div>
      ${c.bio && editing !== c.id ? raw(html`<p class="ch-bio">${c.bio}</p>`) : ''}
      ${editing === c.id ? raw(html`<form class="ch-form" data-edit="${c.id}">
        <label><span>Имя</span><input name="name" value="${c.name}" maxlength="24" required></label>
        <label><span>Титул</span><input name="title" value="${c.title || ''}" maxlength="${cfg.title_max || 60}"></label>
        <label class="wide"><span>Биография</span><textarea name="bio" maxlength="${cfg.bio_max || 1500}" rows="4">${c.bio || ''}</textarea></label>
        <div class="ch-btns"><button class="btn sm gold">Сохранить</button><button type="button" class="btn sm" data-noedit>Отмена</button></div></form>`) : ''}
      <div class="ch-btns">
        ${c.id === s.active ? raw('<span class="tag">активный: бар и ставки</span>') : raw(html`<button type="button" class="btn sm" data-use="${c.id}">Сделать активным</button>`)}
        ${c.status === 'exile' && fac ? raw(html`<button type="button" class="btn sm gold" data-join="${c.id}">Поступить на службу «${fac.name}»</button>`) : ''}
        <button type="button" class="btn sm" data-editbtn="${c.id}">Изменить</button>
        <button type="button" class="btn sm" data-ledger="${c.id}" aria-expanded="${openLedger === c.id}">Журнал</button>
      </div>
      <details class="ch-ops"><summary>Деньги и наследство</summary>
        <form class="ch-row" data-send="${c.id}"><span>Перевести персонажу</span>
          <select name="to" required><option value="">Кому…</option>${heirOpts.map((x) => raw(html`<option value="${x.id}">${x.name}${x.faction ? ` · ${x.faction}` : ''}</option>`))}</select>
          <input type="number" name="amount" min="${cfg.min_send || 1000}" step="1000" placeholder="ГС" required aria-label="Сумма">
          <input name="note" maxlength="140" placeholder="за что (необязательно)" aria-label="Комментарий">
          <button class="btn sm gold">Перевести</button></form>
        <p class="fl-note">Налог ${tax} % сгорает. За сутки — не больше ${num(cfg.send_cap || 2000000)} ГС (сегодня отправлено ${num(c.sent_today)}).</p>
        <form class="ch-row" data-donate="${c.id}"><span>Пожертвовать в казну</span>
          <select name="fid" required>${(s.factions || []).map((f) => raw(html`<option value="${f.id}" ${f.id === c.fid ? 'selected' : ''}>${f.name}</option>`))}</select>
          <input type="number" name="amount" min="${cfg.min_send || 1000}" step="1000" placeholder="ГС" required aria-label="Сумма">
          <button class="btn sm">Внести</button></form>
        <form class="ch-row" data-heir="${c.id}"><span>Наследник</span>
          <select name="heir"><option value="">Нет — ${c.fid ? 'деньги уйдут в казну державы' : 'деньги сгорят'}</option>${heirOpts.map((x) => raw(html`<option value="${x.id}" ${x.id === c.heir ? 'selected' : ''}>${x.name}${x.faction ? ` · ${x.faction}` : ''}</option>`))}</select>
          <button class="btn sm">Назначить</button></form>
        <p class="fl-note">При гибели персонажа наследник получает его счёт за вычетом налога ${tax} %.</p>
        <form class="ch-row" data-die="${c.id}"><span>Гибель персонажа</span>
          <input name="note" maxlength="200" placeholder="как это случилось (для истории)" aria-label="Обстоятельства">
          <button class="btn sm danger">Персонаж погибает…</button></form>
        <p class="fl-note">Необратимо. Персонаж остаётся в справочнике с пометкой †.</p>
      </details>`)}
      ${openLedger === c.id ? raw(html`<div class="ch-ledger">${ledger.length ? raw(html`<ul class="br-list">${ledger.map((l) => raw(html`<li><span>${KIND[l.kind] || l.kind}<small>${dateTime(l.at)}${l.other ? ` · ${l.other}` : ''}${l.faction && !l.other ? ` · ${l.faction}` : ''}${l.note && !['Жалованье.'].includes(l.note) ? ` · ${l.note}` : ''}</small></span>
        <em class="${l.delta > 0 ? 'good' : l.delta < 0 ? 'bad' : ''}">${l.delta > 0 ? '+' : ''}${num(l.delta)}</em></li>`))}</ul>`) : raw('<p class="empty">Движений по счёту ещё не было.</p>')}</div>`) : ''}
    </article>`;
  };

  root.innerHTML = html`<div class="rx-wrap ch-wrap">
    <section class="panel st-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Персонажи</h1>
        <p>Герои вашей истории — правители, послы, капитаны и авантюристы. У каждого свой счёт, отдельный от казны: жалованье, награды, выигрыши в баре и на арене. Падение державы бьёт только по казне — персонаж уходит в изгнание со своими деньгами и может начать заново.</p></div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Живых персонажей</small><b>${alive.length} / ${maxAlive}</b></div>
        <div class="col-treasury"><small>Активный</small><b>${act ? act.name : '—'}</b></div>
        <div class="col-treasury"><small>На счетах</small><b>${num(total)} ГС</b></div>
      </div>
    </section>
    <section class="panel fl-body">
      <div class="tabs" role="tablist">${tabs.map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}</div>

      <div class="fl-pane" data-pane="mine" ${tab === 'mine' ? '' : raw('hidden')}>
        ${alive.length < maxAlive ? raw(html`<details class="ch-new" ${alive.length ? '' : raw('open')}><summary>Новый персонаж</summary>
          <form class="ch-form" id="ch-create">
            <label><span>Имя</span><input name="name" maxlength="24" required placeholder="3–24 знака"></label>
            <label><span>Титул</span><input name="title" maxlength="${cfg.title_max || 60}" placeholder="например, посол или капитан"></label>
            <label class="wide"><span>Биография</span><textarea name="bio" maxlength="${cfg.bio_max || 1500}" rows="3" placeholder="необязательно"></textarea></label>
            <div class="ch-btns"><button class="btn gold">Создать</button></div>
          </form>
          <p class="fl-note">${fac ? `Персонаж сразу поступит на службу державе «${fac.name}».` : 'У вас нет державы — персонаж начнёт вольным.'} Имя проверяется так же, как имя игрока. Счёт новичка — 0 ГС.</p></details>`) : raw(html`<p class="fl-note">Живых персонажей уже ${maxAlive} — больше создать нельзя.</p>`)}
        <div class="ch-grid">${mine.length ? mine.map((c) => raw(charCard(c))) : raw('<p class="empty">Персонажей пока нет.</p>')}</div>
      </div>

      ${fac ? raw(html`<div class="fl-pane" data-pane="fac" ${tab === 'fac' ? '' : raw('hidden')}>
        ${fac.martial ? raw('<p class="note-bar ch-martial">Военное положение: держава воюет или в столичной системе стоит чужая армия. Выплаты из казны персонажам и повышение жалованья закрыты, назначенное жалованье выплачивается.</p>') : ''}
        ${fac.can_treasury ? raw(html`<div class="ch-money">
          <div><small>Казна</small><b>${num(fac.gc)} ГС</b></div>
          <div><small>Выплачено сегодня</small><b>${num(fac.paid_today)} / ${num(cfg.treasury_cap || 1000000)} ГС</b></div>
          <div><small>Жалованье в сутки</small><b>${num(fac.salaries)} ГС</b></div></div>
          <p class="fl-note">Жалованье выплачивается из казны раз в сутки (00:17 UTC), до ${num(cfg.salary_max || 200000)} ГС на персонажа. Разовые выплаты — не больше ${num(cfg.treasury_cap || 1000000)} ГС в сутки на всю державу, налог ${tax} %.</p>`)
          : raw('<p class="fl-note">Жалованье и выплаты назначают правитель, соправитель и члены державы с правом «Казна».</p>')}
        ${(fac.chars || []).length ? raw(html`<ul class="tr-lots">${fac.chars.map((c) => raw(html`<li>
          <span class="ch-ava sm" aria-hidden="true">${initials(c.name)}</span>
          <span class="fl-n"><b>${c.name}</b><small>${c.title || 'без титула'} · игрок ${c.owner}${c.salary ? ` · жалованье ${num(c.salary)} ГС` : ''}</small></span>
          ${fac.can_treasury ? raw(html`<form class="tr-q" data-salary="${c.id}"><input type="number" name="v" min="0" max="${cfg.salary_max || 200000}" step="1000" value="${c.salary || 0}" aria-label="Жалованье"><button class="btn sm">Жалованье</button></form>
            <form class="tr-q" data-pay="${c.id}"><input type="number" name="v" min="${cfg.min_send || 1000}" step="1000" placeholder="ГС" aria-label="Выплата" required><button class="btn sm gold" ${fac.martial ? raw('disabled') : ''}>Выплатить</button></form>`) : ''}</li>`))}</ul>`)
          : raw('<p class="empty">На службе державы пока нет персонажей.</p>')}
      </div>`) : ''}

      <div class="fl-pane" data-pane="dir" ${tab === 'dir' ? '' : raw('hidden')}>
        <form class="tr-q ch-search" id="ch-q"><input name="q" value="${q}" placeholder="Имя, титул или держава" aria-label="Поиск"><button class="btn sm">Найти</button></form>
        ${(dir || []).length ? raw(html`<ul class="tr-lots">${dir.map((c) => raw(html`<li class="${c.status === 'dead' ? 'mute' : ''}">
          <span class="ch-ava sm" aria-hidden="true">${initials(c.name)}</span>
          <span class="fl-n"><b>${c.name}${c.status === 'dead' ? ' †' : ''}</b><small>${c.title ? `${c.title} · ` : ''}${c.status === 'active' ? c.faction : STATUS[c.status]} · игрок ${c.owner}${s.staff && c.gc != null ? ` · счёт ${num(c.gc)} ГС` : ''}</small></span>
          ${s.staff && c.status !== 'dead' ? raw(html`<form class="tr-q" data-grant="${c.id}"><input type="number" name="v" step="1000" placeholder="±ГС" aria-label="Сумма" required><input name="note" placeholder="за что" aria-label="Причина" required maxlength="140"><button class="btn sm gold">Начислить</button></form>`) : ''}</li>`))}</ul>`)
          : raw('<p class="empty">Никого не нашли.</p>')}
        ${s.staff ? raw('<p class="fl-note">Команда проекта видит счета и может начислять награды за события. Каждое начисление пишется в журнал персонажа.</p>') : ''}
      </div>
    </section>
  </div>`;

  $$('[data-tab]', root).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; if (tab === 'dir') reload(); else draw(root, s); }));
  $('#ch-create', root)?.addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.target;
    run(() => rpc('v1_char_create', { p_name: f.name.value, p_title: f.title.value || null, p_bio: f.bio.value || null }), 'Персонаж создан.');
  });
  $$('[data-use]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_char_use', { p_char: b.dataset.use }), 'Активный персонаж выбран.')));
  $$('[data-join]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_char_join', { p_char: b.dataset.join }), 'Персонаж поступил на службу.')));
  $$('[data-editbtn]', root).forEach((b) => (b.onclick = () => { editing = b.dataset.editbtn; draw(root, s); }));
  $$('[data-noedit]', root).forEach((b) => (b.onclick = () => { editing = null; draw(root, s); }));
  $$('[data-edit]', root).forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const r = await run(() => rpc('v1_char_edit', { p_char: f.dataset.edit, p_name: f.name.value, p_title: f.title.value, p_bio: f.bio.value }), 'Сохранено.');
    if (r) editing = null;
  }));
  $$('[data-ledger]', root).forEach((b) => (b.onclick = () => { openLedger = openLedger === b.dataset.ledger ? null : b.dataset.ledger; reload(); }));
  $$('[data-die]', root).forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const c = mine.find((x) => x.id === f.dataset.die);
    const where = c.heir_name ? `наследнику ${c.heir_name} (минус ${tax} %)` : c.fid ? `в казну державы «${c.faction}»` : 'никому — они сгорят';
    if (!(await confirmBox(`${c.name} погибнет навсегда. Счёт ${num(c.gc)} ГС перейдёт ${where}. Отменить это нельзя.`, 'Да, персонаж погибает'))) return;
    const note = f.note.value.trim() || null;
    run(() => rpc('v1_char_die', { p_char: c.id, p_note: note }), 'Персонаж погиб. Его история сохранена в справочнике.');
  }));
  $$('[data-send]', root).forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault();
    run(() => rpc('v1_char_send', { p_from: f.dataset.send, p_to: f.to.value, p_amount: Number(f.amount.value), p_note: f.note.value || null }),
      (r) => `Отправлено ${num(r.sent)} ГС, получатель получил ${num(r.got)} (налог ${num(r.tax)}).`);
  }));
  $$('[data-donate]', root).forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault();
    run(() => rpc('v1_char_donate', { p_char: f.dataset.donate, p_fid: f.fid.value, p_amount: Number(f.amount.value) }), (r) => `В казну внесено ${num(r)} ГС.`);
  }));
  $$('[data-heir]', root).forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); run(() => rpc('v1_char_heir', { p_char: f.dataset.heir, p_heir: f.heir.value || null }), 'Наследник назначен.'); }));
  $$('[data-salary]', root).forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault(); const v = Number(f.v.value) || 0;
    run(() => rpc('v1_char_salary_set', { p_char: f.dataset.salary, p_amount: v }), v ? `Жалованье: ${num(v)} ГС в сутки.` : 'Жалованье снято.');
  }));
  $$('[data-pay]', root).forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault();
    run(() => rpc('v1_char_pay', { p_char: f.dataset.pay, p_amount: Number(f.v.value) }), (r) => `Из казны ${num(r.paid)} ГС, персонаж получил ${num(r.got)} (налог ${num(r.tax)}).`);
  }));
  $$('[data-grant]', root).forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault();
    run(() => rpc('v1_char_grant', { p_char: f.dataset.grant, p_amount: Number(f.v.value), p_note: f.note.value }), (r) => `Готово, на счёте ${num(r)} ГС.`);
  }));
  $('#ch-q', root)?.addEventListener('submit', (e) => { e.preventDefault(); q = e.target.q.value.trim(); reload(); });
}
