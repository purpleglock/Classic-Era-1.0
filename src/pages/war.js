import { html, raw, icon, $ } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';

/**
 * #/war — «Война»: сводка фронта державы.
 * Идущие войны, занятые и потерянные системы, колонии в оккупации (со сроком передачи),
 * зачистки, сражения и флоты, летящие к врагу. Ноты, мир и союзники — во «Внешней политике»,
 * приказы флотам и армиям — во «Флоте и войсках». Сервер: v1_war_front.
 */
const hhmm = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const left = (t) => {
  const ms = new Date(t) - Date.now();
  if (ms <= 0) return 'вот-вот';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : h ? `${h} ч ${m} мин` : `${Math.max(1, m)} мин`;
};
const days = (t) => Math.max(0, Math.floor((Date.now() - new Date(t)) / 864e5));

export async function renderWar(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-sword')}</span><div><h1>Война</h1><p>Войдите, чтобы видеть фронт своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) { root.innerHTML = html`<section class="panel gate"><div><h1>У вас пока нет державы</h1></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`; return; }
  root.innerHTML = '<div class="skeleton">Собираю донесения с фронта…</div>';
  let s;
  try { s = await rpc('v1_war_front'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Сводка недоступна</h1><p>${e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  const sec = (title, ic, body, empty) => html`<section class="panel wr-sec"><h2>${icon(ic)}${title}</h2>${body ? raw(body) : raw(html`<p class="empty">${empty}</p>`)}</section>`;
  const list = (items, row) => items.length ? html`<ul class="wr-list">${items.map((x) => raw(row(x)))}</ul>` : '';

  root.innerHTML = html`<div class="rx-wrap wr-wrap">
    <section class="panel st-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Война</h1>
        <p>Сводка фронта: идущие войны, занятые и потерянные системы, колонии в оккупации и сражения. Объявить войну, отправить ноту или предложить мир — во <a href="#/outer?t=wars">внешней политике</a>; приказы флотам и армиям — во <a href="#/fleet">флоте и войсках</a>.</p></div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Войн</small><b>${s.wars.length}</b></div>
        <div class="col-treasury"><small>Занято систем</small><b>${s.held.length}</b></div>
        <div class="col-treasury"><small>Потеряно систем</small><b class="${s.lost.length ? 'bad' : ''}">${s.lost.length}</b></div>
      </div>
    </section>

    ${raw(sec('Идущие войны', 'i-sword', list(s.wars, (w) => html`<li class="wr-war">
      <div><b>${(w.mine || []).join(', ')}</b><span class="wr-vs">против</span><b class="bad">${(w.foes || []).join(', ')}</b></div>
      <small>${w.role === 'attacker' ? 'мы наступаем' : 'мы обороняемся'} · идёт ${days(w.started_at)} дн.${w.cause ? ` · повод: ${w.cause}` : ''}</small></li>`),
      'Ваша держава ни с кем не воюет.'))}

    ${s.battles.length ? raw(sec('Сражения', 'i-sword', list(s.battles, (b) => html`<li><a class="wr-row" href="#/battle?id=${b.id}">
      <b>${b.kind === 'ground' ? `Высадка · ${b.colony || b.system}` : b.system}</b><small>против ${(b.foes || []).join(', ')} · ход ${b.turn}</small>
      <span class="bm-chip ${b.my_turn ? 'hot' : ''}">${b.my_turn ? 'ваш ход' : 'ход противника'}</span></a></li>`))) : ''}

    <div class="wr-cols">
      ${raw(sec('Занятые системы', 'i-flag', list(s.held, (x) => html`<li class="wr-row"><b>${x.system}</b><small>у державы «${x.owner}» · ${days(x.since)} дн.${x.fleet ? ` · держит флот «${x.fleet}»` : ''}</small></li>`),
        'Пока ни одной. Флот, прибывший в беззащитную систему врага, занимает её.'))}
      ${raw(sec('Потерянные системы', 'i-shield', list(s.lost, (x) => html`<li class="wr-row bad"><b>${x.system}</b><small>заняла держава «${x.occupier}» · ${days(x.since)} дн.</small></li>`),
        'Все системы под вашим флагом. Чтобы освободить занятую, достаточно привести туда флот.'))}
    </div>

    <div class="wr-cols">
      ${raw(sec('Колонии под нашей оккупацией', 'i-planet', list(s.colonies_held, (x) => html`<li class="wr-row"><b>${x.colony}${x.capital ? ' ★' : ''}</b>
        <small>${x.system} · у державы «${x.owner}» · перейдёт к нам ${hhmm(x.transfer_at)} (через ${left(x.transfer_at)})</small>
        ${x.held ? raw('<span class="bm-chip">армия на месте</span>') : raw('<span class="bm-chip hot">армии нет — оккупация сорвётся</span>')}</li>`),
        'Нет. Армия, зачистившая планету врага, занимает её — колония переходит через несколько дней.'))}
      ${raw(sec('Наши колонии в оккупации', 'i-planet', list(s.colonies_lost, (x) => html`<li class="wr-row bad"><b>${x.colony}${x.capital ? ' ★ столица' : ''}</b>
        <small>${x.system} · держит «${x.occupier}» · уйдёт ${hhmm(x.transfer_at)} (через ${left(x.transfer_at)}) — выбейте армию врага с планеты</small></li>`),
        'Ни одна колония не занята врагом.'))}
    </div>

    ${s.clearing.length || s.moving.length ? raw(html`<div class="wr-cols">
      ${raw(sec('Зачистки', 'i-sword', list(s.clearing, (x) => html`<li class="wr-row"><b>${x.colony}</b><small>армия «${x.army}» · готово ${hhmm(x.ready)} (через ${left(x.ready)})</small></li>`), 'Зачисток нет.'))}
      ${raw(sec('Флоты летят к врагу', 'i-ship', list(s.moving, (x) => html`<li class="wr-row"><b>«${x.fleet}» → ${x.to}</b><small>прибытие ${hhmm(x.arrive_at)} (через ${left(x.arrive_at)})</small></li>`), 'Никто не летит.'))}
    </div>`) : ''}

    ${s.recent.length ? raw(sec('Недавние сражения', 'i-list', list(s.recent, (b) => html`<li><a class="wr-row" href="#/battle?id=${b.id}"><b>${b.system}</b>
      <small>${b.kind === 'ground' ? 'наземный бой' : 'космический бой'}${b.ended_at ? ` · ${hhmm(b.ended_at)}` : ''}</small>
      <span class="bm-chip ${b.won ? '' : 'hot'}">${b.won ? 'победа' : 'поражение'}</span></a></li>`))) : ''}
  </div>`;
}
