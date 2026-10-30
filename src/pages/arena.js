import { html, raw, icon, $, $$, toast } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/arena — Арена: бои на гекс-картах нового движка, космос и земля.
 * Ростер в пределах бюджета арены; отряды условные — настоящие флоты и армии не страдают.
 * Бот «Жнец»: ходит первым, видит всё поле; победа над ним — приз (раз в 12 часов).
 * Вызов державе со ставкой; зрители ставят на исход первые два хода.
 * Сервер: v1_arena_state, v1_arena_fight_bot, v1_arena_challenge, v1_arena_answer, v1_arena_bet (миграция 47).
 */
const UT = { ship: 'корабль', inf: 'пехота', tank: 'техника', art: 'артиллерия', aa: 'ПВО', air: 'авиация' };
let tab = 'fight', kind = 'space';
const roster = { space: {}, ground: {} };

export async function renderArena(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-arena')}</span><div><h1>Арена</h1><p>Войдите, чтобы выйти на арену.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) { root.innerHTML = html`<section class="panel gate"><div><h1>У вас пока нет державы</h1></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`; return; }
  if (!root.querySelector('.ar-wrap')) root.innerHTML = '<div class="skeleton">Открываю ворота арены…</div>';
  let s;
  try { s = await rpc('v1_arena_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Арена недоступна</h1><p>${e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  const y = scrollY; draw(root, s); scrollTo(0, y);
}

function draw(root, s) {
  const cfg = s.settings || {}, can = !!s.can, budget = Number(cfg.budget || 4000000), maxU = Number(cfg.max_units || 8);
  const list = kind === 'space' ? s.space || [] : s.ground || [];
  const ros = roster[kind];
  const cost = () => list.reduce((a, d) => a + Number(d.cost) * (ros[d.id] || 0), 0);
  const picked = () => list.filter((d) => ros[d.id] > 0).map((d) => ({ id: d.id, qty: ros[d.id] }));
  const matches = s.matches || [];
  const live = matches.filter((m) => m.status === 'live'), pend = matches.filter((m) => m.status === 'pending'), done = matches.filter((m) => m.status === 'done');
  const myLive = live.find((m) => m.mine);
  const reload = () => renderArena(root);
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); return r; } catch (e) { toast(e.message, 'err'); } };

  root.innerHTML = html`<div class="rx-wrap ar-wrap">
    <section class="panel st-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Арена</h1>
        <p>Космические и наземные поединки на настоящих картах сражений с туманом войны. Соберите отряды в пределах бюджета арены — это условные отряды, ваши флоты и армии не пострадают. «Жнец» — бот арены: ходит первым, видит всё поле, бьёт по самому уязвимому и держит дистанцию.</p></div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Бюджет отряда</small><b>${num(budget)} ГС</b></div>
        <div class="col-treasury"><small>Приз за «Жнеца»</small><b class="${s.prize_ready ? '' : 'mute'}">${s.prize_ready ? `${num(cfg.prize)} ГС` : 'уже взят'}</b></div>
        <div class="col-treasury"><small>Идут бои</small><b>${live.length}</b></div>
      </div>
    </section>
    ${myLive ? raw(html`<a class="panel ar-live" href="#/battle?id=${myLive.battle}">${icon('i-sword')}<span><b>Ваш бой идёт: ${myLive.a} против ${myLive.b}</b><small>ход ${myLive.turn} · нажмите, чтобы продолжить</small></span></a>`) : ''}
    <section class="panel fl-body">
      <div class="tabs" role="tablist">${[['fight', 'На арену'], ['calls', `Вызовы${pend.length ? ` · ${pend.length}` : ''}`], ['live', `Идут бои · ${live.length}`], ['hist', 'История']]
        .map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}</div>

      <div class="fl-pane" data-pane="fight" ${tab === 'fight' ? '' : raw('hidden')}>
        <div class="seg ar-kind" role="group" aria-label="Вид боя"><button type="button" data-kind="space" aria-pressed="${kind === 'space'}">Космос</button><button type="button" data-kind="ground" aria-pressed="${kind === 'ground'}">Земля</button></div>
        ${list.length ? raw(html`<ul class="ar-roster">${list.map((d) => raw(html`<li>
          <span class="fl-n"><b>${d.name}</b><small>${d.class || UT[d.utype] || ''} · ${UT[d.utype] || ''}${d.public ? ' · общедоступный' : ''} · ${num(d.stats?.hp)} ПЗ · ${num(d.stats?.dmg)} урона · дальность ${d.stats?.rng} · ход ${d.stats?.speed}</small></span>
          <span class="ar-cost">${num(d.cost)} ГС</span>
          <input type="number" min="0" max="500" value="${ros[d.id] || 0}" data-q="${d.id}" aria-label="Сколько ${d.name}"></li>`))}</ul>`)
          : raw(html`<p class="empty">${kind === 'space' ? 'Нет готовых проектов кораблей нового образца. Соберите корабль в <a href="#/shipyard">конструкторе</a> — на арену идут проекты без ошибок.' : 'Нет проектов наземных войск.'}</p>`)}
        <div class="ar-budget"><div class="fl-prog"><i id="ar-bar"></i></div><small id="ar-sum"></small></div>
        ${can ? raw(html`<div class="ar-go">
          <button type="button" class="btn gold" id="ar-bot" ${raw(myLive ? 'disabled title="Сначала доиграйте текущий бой"' : '')}>${icon('i-sword')}Бой с «Жнецом»</button>
          <form class="ar-call" id="ar-call"><select name="target" required aria-label="Кого вызвать"><option value="">Вызвать державу…</option>${(s.factions || []).map((f) => raw(html`<option value="${f.id}">${f.name}</option>`))}</select>
            <input type="number" name="stake" min="0" max="${cfg.stake_max || 500000}" step="1000" placeholder="Ставка, ГС (необязательно)" aria-label="Ставка">
            <button class="btn sm">Бросить вызов</button></form></div>
          <p class="fl-note">Отрядов — до ${maxU}. Вызов: обе стороны ставят одинаковую сумму (до ${num(cfg.stake_max || 500000)} ГС), победитель забирает обе. Противник принимает вызов своим отрядом того же вида.</p>`)
          : raw('<p class="note">Выводить отряды на арену могут правитель и члены державы с правом «Флот», «Армия» или «Производство».</p>')}
      </div>

      <div class="fl-pane" data-pane="calls" ${tab === 'calls' ? '' : raw('hidden')}>
        ${pend.length ? raw(html`<ul class="tr-lots">${pend.map((m) => raw(html`<li>
          <span class="tag ${m.incoming ? 'new' : ''}">${m.incoming ? 'вас вызывают' : 'ваш вызов'}</span>
          <span class="fl-n"><b>${m.a} → ${m.b}</b><small>${m.kind === 'space' ? 'космос' : 'земля'}${m.stake ? ` · ставка ${num(m.stake)} ГС` : ''}</small></span>
          ${can ? raw(m.incoming ? html`<button type="button" class="btn sm gold" data-acc="${m.id}" data-kind="${m.kind}">Принять текущим отрядом</button><button type="button" class="btn sm" data-dec="${m.id}">Отказаться</button>`
            : html`<button type="button" class="btn sm" data-dec="${m.id}">Отозвать</button>`) : ''}</li>`))}</ul>
          <p class="fl-note">Чтобы принять вызов, соберите отряд того же вида на вкладке «На арену» — его и выведут.</p>`)
          : raw('<p class="empty">Вызовов нет.</p>')}
      </div>

      <div class="fl-pane" data-pane="live" ${tab === 'live' ? '' : raw('hidden')}>
        ${live.length ? raw(html`<ul class="tr-lots">${live.map((m) => raw(html`<li>
          <span class="tag">${m.kind === 'space' ? 'космос' : 'земля'}</span>
          <span class="fl-n"><b>${m.a} против ${m.b}</b><small>ход ${m.turn}${m.stake ? ` · ставка ${num(m.stake)} ГС` : ''} · на кону у зрителей: ${num(m.bets?.a)} / ${num(m.bets?.b)} ГС${m.my_bet ? ` · ваша ставка ${num(m.my_bet.amount)} на ${m.my_bet.side === 'a' ? m.a : m.b}` : ''}</small></span>
          <a class="btn sm" href="#/battle?id=${m.battle}">${m.mine ? 'К бою' : 'Смотреть'}</a>
          ${!m.mine && !m.my_bet && m.turn <= (cfg.bet_turns || 2) && s.can ? raw(html`<form class="tr-q" data-bet="${m.id}"><select name="side" aria-label="На кого"><option value="a">${m.a}</option><option value="b">${m.b}</option></select>
            <input type="number" name="amount" min="${cfg.bet_min || 25000}" max="${cfg.bet_max || 500000}" step="1000" value="${cfg.bet_min || 25000}" aria-label="Ставка"><button class="btn sm gold">Поставить</button></form>`) : ''}</li>`))}</ul>
          <p class="fl-note">Ставки принимаются первые ${cfg.bet_turns || 2} хода, от ${num(cfg.bet_min || 25000)} до ${num(cfg.bet_max || 500000)} ГС. Тотализатор: победившие делят ставки проигравших, ${Math.round((cfg.house || 0.05) * 100)} % — арене. Ничья — ставки назад.</p>`)
          : raw('<p class="empty">Сейчас на арене тихо.</p>')}
      </div>

      <div class="fl-pane" data-pane="hist" ${tab === 'hist' ? '' : raw('hidden')}>
        ${done.length ? raw(html`<ul class="tr-lots">${done.map((m) => raw(html`<li class="${m.mine && !m.won ? 'off' : ''}">
          <span class="tag ${m.won ? 'new' : ''}">${m.kind === 'space' ? 'космос' : 'земля'}</span>
          <span class="fl-n"><b>${m.a} против ${m.b}</b><small>${m.winner ? `победа: ${m.winner}` : 'ничья'}${m.prize ? ` · приз ${num(m.prize)} ГС` : ''}${m.my_bet ? ` · ваша ставка ${num(m.my_bet.amount)} → ${num(m.my_bet.won)}` : ''}</small></span>
          ${m.battle ? raw(html`<a class="btn sm" href="#/battle?id=${m.battle}">Разбор</a>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Боёв ещё не было.</p>')}
      </div>
    </section>
  </div>`;

  const upd = () => {
    const c = cost(), n = picked().length;
    $('#ar-bar', root).style.width = `${Math.min(100, c / budget * 100).toFixed(1)}%`;
    $('#ar-bar', root).classList.toggle('over', c > budget || n > maxU);
    $('#ar-sum', root).textContent = `Отряд: ${num(c)} из ${num(budget)} ГС · отрядов ${n} из ${maxU}${c > budget ? ' — дороже бюджета' : ''}`;
  };
  upd();
  $$('[data-q]', root).forEach((i) => (i.oninput = () => { ros[i.dataset.q] = Math.max(0, Math.min(500, Number(i.value) || 0)); upd(); }));
  $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }));
  $$('.ar-kind [data-kind]', root).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; draw(root, s); }));
  $('#ar-bot', root)?.addEventListener('click', async () => {
    if (!picked().length) { toast('Наберите отряд.', 'err'); return; }
    const id = await run(() => rpc('v1_arena_fight_bot', { p_kind: kind, p_roster: picked() }));
    if (id) location.hash = `/battle?id=${id}`;
  });
  const call = $('#ar-call', root);
  if (call) call.onsubmit = async (e) => {
    e.preventDefault();
    if (!picked().length) { toast('Наберите отряд.', 'err'); return; }
    const r = await run(() => rpc('v1_arena_challenge', { p_target: call.target.value, p_kind: kind, p_roster: picked(), p_stake: Number(call.stake.value) || 0 }), 'Вызов отправлен.');
    if (r) { tab = 'calls'; reload(); }
  };
  $$('[data-acc]', root).forEach((b) => (b.onclick = async () => {
    const k = b.dataset.kind, list2 = k === 'space' ? s.space : s.ground, pk = (list2 || []).filter((d) => roster[k][d.id] > 0).map((d) => ({ id: d.id, qty: roster[k][d.id] }));
    if (!pk.length) { toast(`Соберите ${k === 'space' ? 'космический' : 'наземный'} отряд на вкладке «На арену».`, 'err'); kind = k; tab = 'fight'; draw(root, s); return; }
    const id = await run(() => rpc('v1_arena_answer', { p_match: b.dataset.acc, p_accept: true, p_roster: pk }));
    if (id) location.hash = `/battle?id=${id}`;
  }));
  $$('[data-dec]', root).forEach((b) => (b.onclick = async () => { await run(() => rpc('v1_arena_answer', { p_match: b.dataset.dec, p_accept: false, p_roster: null }), 'Готово.'); reload(); }));
  $$('[data-bet]', root).forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const r = await run(() => rpc('v1_arena_bet', { p_match: f.dataset.bet, p_side: f.side.value, p_amount: Number(f.amount.value) }), 'Ставка принята.');
    if (r) reload();
  }));
}
