import { html, raw, icon, $, $$, toast } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/bar — ресторан-бар «Классикал»: игры на личный счёт активного персонажа.
 * Рулетка, колесо удачи с джекпотом бара, карты таро, «21» (блекджек), кости.
 * Ставка 25 000…500 000 ГС; 2 % проигранных ставок копятся в джекпот. Всё считает сервер:
 * v1_bar_state, v1_bar_roulette, v1_bar_wheel, v1_bar_tarot, v1_bar_dice, v1_bar_bj_start/act.
 */
const GAMES = { roulette: 'Рулетка', wheel: 'Колесо удачи', tarot: 'Таро', blackjack: '«21»', dice: 'Кости' };
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const MAJOR = ['Шут', 'Маг', 'Верховная Жрица', 'Императрица', 'Император', 'Иерофант', 'Влюблённые', 'Колесница', 'Сила', 'Отшельник', 'Колесо Фортуны',
  'Справедливость', 'Повешенный', 'Смерть', 'Умеренность', 'Дьявол', 'Башня', 'Звезда', 'Луна', 'Солнце', 'Суд', 'Мир'];
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
// колесо: 30 секторов, как на сервере
const WHEEL = [...Array(16).fill(['—', '#1a1712']), ...Array(6).fill(['×1,5', '#3b3220']), ...Array(4).fill(['×2', '#5a4720']), ['×3', '#8a6a24'], ['×3', '#8a6a24'], ['×5', '#c0563f'], ['★', '#e9b949']];
const WORDER = [0, 22, 1, 16, 2, 23, 3, 26, 4, 17, 5, 28, 6, 24, 7, 18, 8, 27, 9, 25, 10, 19, 11, 29, 12, 20, 13, 21, 14, 15];   // как секторы стоят по кругу
let tab = 'roulette', bet = 25000, last = null, wheelTurn = 0;

const card = (c, hidden = false) => hidden ? html`<span class="br-card back"></span>`
  : html`<span class="br-card ${c % 52 >= 13 && c % 52 < 39 ? 'red' : ''}"><b>${RANKS[c % 13]}</b><i>${SUITS[Math.floor(c / 13) % 4]}</i></span>`;
const fmtWin = (r) => r.net > 0 ? `+${num(r.net)} ГС` : r.net === 0 ? 'ставка возвращена' : `−${num(-r.net)} ГС`;

export async function renderBar(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-glass')}</span><div><h1>Ресторан-бар «Классикал»</h1><p>Войдите, чтобы занять столик.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!root.querySelector('.br-wrap')) root.innerHTML = '<div class="skeleton">Провожаю к столику…</div>';
  let s;
  try { s = await rpc('v1_bar_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Бар закрыт</h1><p>${e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const cfg = s.settings || {}, min = Number(cfg.min || 25000), max = Number(cfg.max || 500000), can = !!s.can;
  bet = Math.max(min, Math.min(max, bet));
  const bj = s.bj || (last?.game === 'blackjack' ? last.r : null);
  const today = s.today || {}, net = Number(today.payout || 0) - Number(today.bets || 0);

  const result = (g) => {
    if (!last || last.game !== g) return '';
    const r = last.r;
    const head = g === 'roulette' ? html`<span class="br-num ${r.color}">${r.number}</span>`
      : g === 'wheel' ? html`<span class="br-seg">${r.jackpot_won ? '★' : r.label}</span>`
        : g === 'tarot' ? html`<span class="br-tarot ${r.kind === 'major' ? 'major' : ''}"><small>${r.kind === 'major' ? ROMAN[r.card] : ''}</small><b>${r.name}</b></span>`
          : g === 'dice' ? html`<span class="br-dice"><i>${'⚀⚁⚂⚃⚄⚅'[r.d1 - 1]}</i><i>${'⚀⚁⚂⚃⚄⚅'[r.d2 - 1]}</i><small>${r.sum}</small></span>` : '';
    return html`<div class="br-res ${r.net > 0 ? 'win' : r.net < 0 ? 'lose' : ''}">${raw(head)}<b>${r.jackpot_won ? `ДЖЕКПОТ! ${fmtWin(r)}` : fmtWin(r)}</b></div>`;
  };

  root.innerHTML = html`<div class="rx-wrap br-wrap">
    <section class="panel st-hero br-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Ресторан-бар «Классикал»</h1>
        <p>Тихий свет, джаз из старого приёмника и столы, за которыми проигрывают с улыбкой. Играет ваш персонаж на свои деньги: ставка — от ${num(min)} до ${num(max)} ГС с личного счёта, казна державы не участвует. С каждой проигранной ставки 2 % уходят в джекпот бара — его можно сорвать на колесе удачи.</p></div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Джекпот бара</small><b class="br-jp">${num(s.jackpot)} ГС</b></div>
        <div class="col-treasury"><small>${s.char ? s.char.name : 'Персонаж'}</small><b>${s.char ? `${num(s.gc)} ГС` : '—'}</b></div>
        <div class="col-treasury"><small>Сегодня</small><b class="${net < 0 ? 'bad' : ''}">${net > 0 ? '+' : ''}${num(net)} ГС</b></div>
      </div>
    </section>
    ${can ? ((s.chars || []).length > 1 ? raw(html`<p class="panel note-bar br-who">За столом: <select id="br-char" aria-label="Персонаж">${s.chars.map((c) => raw(html`<option value="${c.id}" ${c.id === s.char.id ? 'selected' : ''}>${c.name}</option>`))}</select> <a href="#/characters">Личный счёт</a></p>`) : '')
      : raw('<p class="panel note-bar">В баре играют персонажи на свои деньги. <a href="#/characters">Создайте персонажа</a> — и столик ваш.</p>')}
    <div class="br-grid">
      <section class="panel fl-body">
        <div class="tabs" role="tablist">${Object.entries(GAMES).map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}</div>
        <div class="br-bet"><label><span>Ставка</span><input type="number" id="br-bet" min="${min}" max="${max}" step="5000" value="${bet}"></label>
          <div class="br-chips">${[25000, 50000, 100000, 250000, 500000].filter((v) => v >= min && v <= max).map((v) => raw(html`<button type="button" class="bm-chip ${v === bet ? 'on' : ''}" data-chip="${v}">${num(v / 1000)}к</button>`))}</div></div>

        <div class="fl-pane" data-pane="roulette" ${tab === 'roulette' ? '' : raw('hidden')}>
          <p class="fl-note">Европейская рулетка, 37 номеров. Число — выплата ×36, дюжина — ×3, цвет, чёт/нечет и половина — ×2. Зеро проигрывает все внешние ставки.</p>
          <div class="br-table">
            <button type="button" class="br-n green" data-rl="num" data-v="0">0</button>
            ${Array.from({ length: 36 }, (_, i) => i + 1).map((n) => raw(html`<button type="button" class="br-n ${RED.includes(n) ? 'red' : 'black'}" data-rl="num" data-v="${n}">${n}</button>`))}
          </div>
          <div class="br-outs">
            ${[['red', 'Красное'], ['black', 'Чёрное'], ['even', 'Чёт'], ['odd', 'Нечет'], ['low', '1–18'], ['high', '19–36']].map(([k, t]) => raw(html`<button type="button" class="btn sm" data-rl="${k}">${t}</button>`))}
            ${[1, 2, 3].map((d) => raw(html`<button type="button" class="btn sm" data-rl="dozen" data-v="${d}">${d}-я дюжина</button>`))}
          </div>
          ${raw(result('roulette'))}
        </div>

        <div class="fl-pane" data-pane="wheel" ${tab === 'wheel' ? '' : raw('hidden')}>
          <div class="br-wheelbox">
            <div class="br-wheel" id="br-wheel" style="--turn:${wheelTurn}deg;background:conic-gradient(${WORDER.map((seg, i) => `${WHEEL[seg][1]} ${(i * 12).toFixed(2)}deg ${((i + 1) * 12).toFixed(2)}deg`).join(',')})">
              ${WORDER.map((seg, i) => raw(html`<span style="--a:${i * 12 + 6}deg">${WHEEL[seg][0]}</span>`))}</div>
            <i class="br-pin" aria-hidden="true"></i>
          </div>
          <p class="fl-note">30 секторов: 16 пустых, шесть ×1,5, четыре ×2, два ×3, один ×5 и один ★ — джекпот бара (${num(s.jackpot)} ГС).</p>
          <button type="button" class="btn gold" id="br-spin">Крутить колесо</button>
          ${raw(result('wheel'))}
        </div>

        <div class="fl-pane" data-pane="tarot" ${tab === 'tarot' ? '' : raw('hidden')}>
          <p class="fl-note">Колода из 78 карт. Угадайте, что вытянет гадалка: старший аркан (×3,4), масть младшего аркана (×5,3) или точный старший аркан (×70).</p>
          <div class="br-outs">
            <button type="button" class="btn sm gold" data-tr="major">Старший аркан · ×3,4</button>
            ${[['wands', 'Жезлы'], ['cups', 'Кубки'], ['swords', 'Мечи'], ['pentacles', 'Пентакли']].map(([k, t]) => raw(html`<button type="button" class="btn sm" data-tr="${k}">${t} · ×5,3</button>`))}
          </div>
          <div class="br-exact"><select id="br-arc" aria-label="Старший аркан">${MAJOR.map((m, i) => raw(html`<option value="m${i}">${ROMAN[i]} · ${m}</option>`))}</select><button type="button" class="btn sm" id="br-exact">Назвать аркан · ×70</button></div>
          ${raw(result('tarot'))}
        </div>

        <div class="fl-pane" data-pane="blackjack" ${tab === 'blackjack' ? '' : raw('hidden')}>
          <p class="fl-note">«21»: наберите больше дилера, но не больше 21. Дилер добирает до 17. «21» с двух карт платит 3:2, удвоение — только на двух картах.</p>
          ${bj ? raw(html`<div class="br-bj">
            <div><small>Дилер · ${bj.dealer_val}${bj.status === 'play' ? '+' : ''}</small><div class="br-hand">${bj.dealer.map((c) => raw(card(c)))}${bj.status === 'play' ? raw(card(0, true)) : ''}</div></div>
            <div><small>Вы · ${bj.player_val}${bj.doubled ? ' · удвоено' : ''}</small><div class="br-hand">${bj.player.map((c) => raw(card(c)))}</div></div>
            ${bj.status === 'play' ? raw(html`<div class="br-outs"><button type="button" class="btn sm gold" data-bj="hit">Ещё</button><button type="button" class="btn sm" data-bj="stand">Хватит</button>
              ${bj.player.length === 2 ? raw(html`<button type="button" class="btn sm" data-bj="double">Удвоить (+${num(bj.bet)} ГС)</button>`) : ''}</div>`)
              : raw(html`<div class="br-res ${bj.payout > bj.bet ? 'win' : bj.payout === bj.bet ? '' : 'lose'}"><b>${{ blackjack: '«21»!', win: 'Победа', push: 'Ничья', lose: 'Проигрыш', bust: 'Перебор' }[bj.result] || ''} · ${bj.payout > 0 ? `выплата ${num(bj.payout)} ГС` : `−${num(bj.bet)} ГС`}</b></div>`)}
          </div>`) : ''}
          ${!bj || bj.status !== 'play' ? raw('<button type="button" class="btn gold" id="br-deal">Раздать</button>') : ''}
        </div>

        <div class="fl-pane" data-pane="dice" ${tab === 'dice' ? '' : raw('hidden')}>
          <p class="fl-note">«Кости капитана»: два кубика. Меньше 7 или больше 7 — ×2,3; ровно 7 — ×5,7; дубль — ×5,7.</p>
          <div class="br-outs">${[['under', 'Меньше 7 · ×2,3'], ['over', 'Больше 7 · ×2,3'], ['seven', 'Ровно 7 · ×5,7'], ['double', 'Дубль · ×5,7']].map(([k, t]) => raw(html`<button type="button" class="btn sm" data-dc="${k}">${t}</button>`))}</div>
          ${raw(result('dice'))}
        </div>
      </section>

      <aside class="panel br-side">
        <h3>${icon('i-crown')}Крупные выигрыши за сутки</h3>
        ${(s.wins || []).length ? raw(html`<ul class="br-list">${s.wins.map((w) => raw(html`<li><b>${w.who}</b><span>${GAMES[w.game] || w.game}</span><em>+${num(w.payout)}</em></li>`))}</ul>`) : raw('<p class="empty">Пока никто не сорвал куш.</p>')}
        <h3>${icon('i-clock')}Ваши последние игры</h3>
        ${(s.mine || []).length ? raw(html`<ul class="br-list">${s.mine.map((m) => raw(html`<li><span>${GAMES[m.game] || m.game}</span><small>${num(m.bet)}</small><em class="${m.payout > m.bet ? 'good' : m.payout < m.bet ? 'bad' : ''}">${m.payout - m.bet > 0 ? '+' : ''}${num(m.payout - m.bet)}</em></li>`))}</ul>`) : raw('<p class="empty">Вы ещё не играли.</p>')}
        <p class="fl-note">Сегодня: игр ${today.games || 0}, поставлено ${num(today.bets)} ГС, выплачено ${num(today.payout)} ГС.</p>
      </aside>
    </div>
  </div>`;

  const play = async (game, fn) => {
    if (!can) { toast('Сначала создайте персонажа.', 'err'); return; }
    try { const r = await fn(); last = { game, r }; const st = await rpc('v1_bar_state'); if (game === 'blackjack' && r.status === 'done') st.bj = null; draw(root, st); return r; }
    catch (e) { toast(e.message, 'err'); }
  };
  $('#br-char', root)?.addEventListener('change', async (e) => { try { await rpc('v1_char_use', { p_char: e.target.value }); last = null; draw(root, await rpc('v1_bar_state')); } catch (er) { toast(er.message, 'err'); } });
  $$('[data-tab]', root).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(root, s); }));
  $('#br-bet', root).onchange = (e) => { bet = Math.max(min, Math.min(max, Number(e.target.value) || min)); draw(root, s); };
  $$('[data-chip]', root).forEach((b) => (b.onclick = () => { bet = Number(b.dataset.chip); draw(root, s); }));
  $$('[data-rl]', root).forEach((b) => (b.onclick = () => play('roulette', () => rpc('v1_bar_roulette', { p_bet: bet, p_kind: b.dataset.rl, p_value: b.dataset.v != null ? Number(b.dataset.v) : null }))));
  $('#br-spin', root)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (!can) throw new Error('Сначала создайте персонажа.');
      const r = await rpc('v1_bar_wheel', { p_bet: bet });
      // докрутить колесо так, чтобы выпавший сектор встал под стрелку
      const pos = WORDER.indexOf(r.segment);
      wheelTurn += 360 * 4 + ((360 - (pos * 12 + 6) - (wheelTurn % 360)) % 360 + 360) % 360;
      $('#br-wheel', root).style.setProperty('--turn', `${wheelTurn}deg`);
      await new Promise((ok) => setTimeout(ok, 2600));
      last = { game: 'wheel', r };
      draw(root, await rpc('v1_bar_state'));
    } catch (er) { toast(er.message, 'err'); const b = $('#br-spin', root); if (b) b.disabled = false; }
  });
  $$('[data-tr]', root).forEach((b) => (b.onclick = () => play('tarot', () => rpc('v1_bar_tarot', { p_bet: bet, p_guess: b.dataset.tr }))));
  $('#br-exact', root)?.addEventListener('click', () => play('tarot', () => rpc('v1_bar_tarot', { p_bet: bet, p_guess: $('#br-arc', root).value })));
  $$('[data-dc]', root).forEach((b) => (b.onclick = () => play('dice', () => rpc('v1_bar_dice', { p_bet: bet, p_kind: b.dataset.dc }))));
  $('#br-deal', root)?.addEventListener('click', () => play('blackjack', () => rpc('v1_bar_bj_start', { p_bet: bet })));
  $$('[data-bj]', root).forEach((b) => (b.onclick = () => play('blackjack', () => rpc('v1_bar_bj_act', { p_game: bj.id, p_act: b.dataset.bj }))));
}
