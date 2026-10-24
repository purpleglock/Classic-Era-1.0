import { html, raw, icon, $, toast } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, dateTime, leftText } from '../lib/format.js';

/**
 * #/research — дерево технологий, слоты и очередь.
 * Сервер: v1_research_state / v1_research_start / v1_research_queue / v1_research_dequeue.
 * Изучение заканчивается на ближайшем суточном тике.
 */

export async function renderResearch(root, ui = { q: '', show: 'open', branch: '' }) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flask')}</span><div><h1>Исследования</h1><p>Войдите, чтобы вести науку державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Исследования откроются вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.rs-wrap')) root.innerHTML = '<div class="skeleton">Открываю архивы академий…</div>';
  let s;
  try { s = await rpc('v1_research_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Исследования недоступны</h1><p>${e.missingSchema ? 'Исследования ещё не подключены в базе (миграция 17).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s, ui);
}

function draw(root, s, ui) {
  const tree = s.tree || [];
  const byId = Object.fromEntries(tree.map((t) => [t.id, t]));
  const done = new Set(s.done || []);
  const active = s.active || [];
  const running = new Map(active.map((a) => [a.n, a.r]));
  const queue = s.queue || [];
  const free = Math.max(0, (s.slots || 1) - active.length);
  const sci = Number(s.science) || 0;
  const nameOf = (id) => byId[id]?.name || id;
  const state = (t) => {
    if (done.has(t.id)) return 'done';
    if (running.has(t.id)) return 'run';
    if (queue.includes(t.id)) return 'queued';
    if (t.frozen) return 'frozen';
    return t.prereq.every((p) => done.has(p)) ? 'open' : 'locked';
  };
  const branches = [...new Set(tree.map((t) => t.branch))];
  const total = tree.filter((t) => !t.frozen).length, doneN = tree.filter((t) => !t.frozen && done.has(t.id)).length;

  root.innerHTML = html`<div class="rs-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Исследования</h1>
        <p>Изучено <b>${doneN} из ${total}</b> доступных технологий · исследование завершается на суточном тике${s.mult && Number(s.mult) !== 1 ? ` · цены ×${Number(s.mult).toFixed(2)} от доктрины` : ''}</p>
      </div>
      <div class="col-treasury"><small>Очки науки</small><b>${num(sci)} ОН</b>${s.income ? raw(html`<em class="rs-inc">+${num(s.income)} ОН за сутки</em>`) : ''}</div>
    </section>

    <section class="rs-top">
      <div class="panel rs-slots">
        <div class="sec-h"><h2>Слоты</h2><small>${active.length} из ${s.slots} заняты</small></div>
        <ol class="rs-active">${active.map((a) => raw(html`<li><span class="rs-pulse"></span><b>${nameOf(a.n)}</b><small>готово через ${leftText(new Date(a.r) - Date.now())} · ${dateTime(a.r)}</small></li>`))}
          ${Array.from({ length: free }, () => raw('<li class="free"><span></span><b>Свободный слот</b><small>выберите технологию ниже</small></li>'))}</ol>
      </div>
      <div class="panel rs-queue">
        <div class="sec-h"><h2>Очередь</h2><small>${queue.length} из 12</small></div>
        ${queue.length ? raw(html`<ol class="rs-q">${queue.map((id, i) => raw(html`<li><em>${i + 1}</em><span><b>${nameOf(id)}</b><small>${num(byId[id]?.cost)} ОН</small></span>${s.can_manage ? raw(html`<button type="button" class="btn sm" data-deq="${id}" aria-label="Убрать из очереди">${icon('i-x')}</button>`) : ''}</li>`))}</ol>`)
          : raw('<p class="st-mute">Очередь пуста. Технологии из очереди сами встают в свободный слот, когда хватает очков науки.</p>')}
      </div>
    </section>

    <section class="panel rs-tree">
      <div class="sec-h"><h2>Дерево технологий</h2>
        <div class="seg" role="group" aria-label="Показать">${[['open', 'Доступные'], ['all', 'Все'], ['done', 'Изученные']].map(([k, l]) => raw(html`<button type="button" data-show="${k}" aria-pressed="${String(ui.show === k)}">${l}</button>`))}</div>
        <input class="search" type="search" id="rs-q" value="${ui.q}" placeholder="Найти технологию" aria-label="Найти технологию"></div>
      <nav class="rs-branches" aria-label="Ветки"><button type="button" data-br="" aria-pressed="${String(!ui.branch)}">Все ветки</button>${branches.map((b) => raw(html`<button type="button" data-br="${b}" aria-pressed="${String(ui.branch === b)}">${b}</button>`))}</nav>
      <div id="rs-list"></div>
    </section></div>`;

  const list = $('#rs-list', root);
  const drawList = () => {
    const q = ui.q.toLowerCase();
    const groups = branches.filter((b) => !ui.branch || ui.branch === b).map((b) => {
      const items = tree.filter((t) => t.branch === b).filter((t) => {
        const st = state(t);
        if (q && !(`${t.name} ${t.descr}`.toLowerCase().includes(q))) return false;
        // «Доступные»: можно изучать или уже идёт; закрытые — только при поиске
        if (ui.show === 'open') return st === 'open' || st === 'run' || st === 'queued' || (st === 'locked' && !!q);
        if (ui.show === 'done') return st === 'done';
        return true;
      });
      return [b, items];
    }).filter(([, items]) => items.length);
    list.innerHTML = groups.length ? groups.map(([b, items]) => {
      const fr = items.every((t) => t.frozen);
      return html`<div class="rs-group ${fr ? 'frozen' : ''}"><h3>${b}${fr ? raw(html` <small>${items[0].frozen}</small>`) : ''}</h3><div class="rs-cards">${items.map((t) => raw(card(t, state(t), s, sci, free, nameOf, done, queue)))}</div></div>`;
    }).join('') : `<p class="st-mute">${ui.show === 'open' ? 'Сейчас нечего изучать: всё доступное уже изучено или ждёт предшественников. Откройте «Все».' : 'Ничего не найдено.'}</p>`;
  };
  drawList();

  $('#rs-q', root).oninput = (e) => { ui.q = e.target.value.trim(); drawList(); };
  $('.rs-tree .seg', root).onclick = (e) => { const b = e.target.closest('[data-show]'); if (!b) return; ui.show = b.dataset.show; $$p(root, '[data-show]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawList(); };
  $('.rs-branches', root).onclick = (e) => { const b = e.target.closest('[data-br]'); if (!b) return; ui.branch = b.dataset.br; $$p(root, '[data-br]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawList(); };

  $('.rs-wrap', root).onclick = async (e) => {
    const go = e.target.closest('[data-go]'), qu = e.target.closest('[data-q]'), dq = e.target.closest('[data-deq]');
    const b = go || qu || dq;
    if (!b) return;
    b.disabled = true;
    try {
      if (go) { const r = await rpc('v1_research_start', { p_node: go.dataset.go }); toast(`Начато: «${nameOf(go.dataset.go)}» за ${num(r.cost)} ОН`); }
      if (qu) { await rpc('v1_research_queue', { p_node: qu.dataset.q }); toast(`«${nameOf(qu.dataset.q)}» в очереди`); }
      if (dq) { await rpc('v1_research_dequeue', { p_node: dq.dataset.deq }); }
      renderResearch(root, ui);
    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
  };
}

const $$p = (root, sel) => [...root.querySelectorAll(sel)];

function card(t, st, s, sci, free, nameOf, done, queue) {
  const label = { done: 'Изучено', run: 'Изучается', queued: `В очереди · ${queue.indexOf(t.id) + 1}`, frozen: 'Заморожено', locked: 'Закрыто', open: 'Доступно' }[st];
  const need = t.prereq.filter((p) => !done.has(p)).map(nameOf);
  let acts = '';
  if (s.can_manage && (st === 'open' || st === 'locked')) {
    const canGo = st === 'open' && free > 0 && sci >= t.cost;
    acts = html`<div class="rs-acts">${st === 'open' ? raw(html`<button type="button" class="btn sm ${canGo ? 'gold' : ''}" data-go="${t.id}" ${raw(canGo ? '' : `disabled title="${free ? 'Не хватает очков науки' : 'Все слоты заняты'}"`)}>Изучить</button>`) : ''}
      <button type="button" class="btn sm" data-q="${t.id}">В очередь</button></div>`;
  }
  return html`<article class="rs-card ${st}">
    <header><b>${t.name}</b><span class="cbadge ${st === 'done' ? 'on' : st === 'open' ? 'free' : st === 'run' || st === 'queued' ? 'on' : 'dim'}">${label}</span></header>
    <p>${t.descr}</p>
    ${st === 'frozen' ? raw(html`<p class="rs-why">${t.frozen}</p>`) : ''}
    ${need.length && st !== 'done' && st !== 'frozen' ? raw(html`<p class="rs-why">Нужно: ${need.join(', ')}</p>`) : ''}
    <footer><span>${num(t.cost)} ОН</span>${raw(acts)}</footer>
  </article>`;
}
