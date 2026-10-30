import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';
import { rarChip } from './mining.js';

/**
 * #/trade — «Торговля»: рынок, биржа заявок, сделки и караваны.
 * Рынок: купить или продать сразу по цене рынка (покупка дороже, продажа — минус комиссия).
 * Биржа: свои заявки «продам/куплю» с залогом, исполнение чужих.
 * Сделки: продавец предлагает, покупатель вносит залог, продавец отправляет караван — флот
 * только из торговых кораблей; на пролёте через врага его могут перехватить.
 * Сервер: v1_trade_state, v1_market_trade, v1_exchange_*, v1_deal_*, v1_caravan_send.
 */
const hhmm = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const left = (t) => {
  const ms = new Date(t) - Date.now();
  if (ms <= 0) return 'вот-вот';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : h ? `${h} ч ${m} мин` : `${Math.max(1, m)} мин`;
};
const DEAL = { proposed: 'ждёт ответа', accepted: 'залог внесён — ждёт каравана', loaded: 'караван в пути', done: 'выполнена', declined: 'отклонена', cancelled: 'отменена', lost: 'караван перехвачен' };
const fmt2 = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
let tab = 'market';

/** Мини-график цены за две недели. */
function spark(h = [], base = 1) {
  if (h.length < 2) return '';
  const w = 90, ht = 24, mx = Math.max(...h, base * 1.05), mn = Math.min(...h, base * 0.95);
  const pt = (v, i) => `${(i / (h.length - 1) * w).toFixed(1)},${(ht - (v - mn) / (mx - mn || 1) * ht).toFixed(1)}`;
  const up = h[h.length - 1] >= h[0];
  return html`<svg class="tr-spark" viewBox="0 0 ${w} ${ht}" width="${w}" height="${ht}" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${(ht - (base - mn) / (mx - mn || 1) * ht).toFixed(1)}" y2="${(ht - (base - mn) / (mx - mn || 1) * ht).toFixed(1)}" class="b"/>
    <polyline points="${h.map(pt).join(' ')}" class="${up ? 'up' : 'dn'}"/></svg>`;
}

export async function renderTrade(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-cart')}</span><div><h1>Торговля</h1><p>Войдите, чтобы торговать.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) { root.innerHTML = html`<section class="panel gate"><div><h1>У вас пока нет державы</h1></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`; return; }
  if (!root.querySelector('.tr-wrap')) root.innerHTML = '<div class="skeleton">Открываю торговые книги…</div>';
  let s;
  try { s = await rpc('v1_trade_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Торговля недоступна</h1><p>${e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  const y = scrollY; draw(root, s); scrollTo(0, y);
}

function draw(root, s) {
  const can = !!s.can, cfg = s.settings || {}, fee = Math.round((cfg.fee || 0.04) * 100), buyK = cfg.buy_k || 1.08;
  const stock = s.stock || {}, used = Object.values(stock).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0);
  const market = s.market || [], lots = s.lots || [], deals = s.deals || [], caravans = s.caravans || [];
  const others = lots.filter((l) => !l.mine), mine = lots.filter((l) => l.mine);
  const incoming = deals.filter((d) => d.role === 'buyer' && d.status === 'proposed').length;
  const toSend = deals.filter((d) => d.role === 'seller' && d.status === 'accepted').length;
  const reload = () => renderTrade(root);
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); reload(); return r; } catch (e) { toast(e.message, 'err'); } };
  const resOpts = (sel) => market.map((m) => raw(html`<option value="${m.name}" ${raw(m.name === sel ? 'selected' : '')}>${m.name}</option>`));

  root.innerHTML = html`<div class="rx-wrap tr-wrap">
    <section class="panel st-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Торговля</h1>
        <p>Рынок покупает и продаёт сразу; цены тянутся к базовым и держатся в пределах 50–200 % базы. На бирже державы выставляют заявки друг другу. Крупные сделки возят караваны — флоты из торговых кораблей; на пути через врага их могут перехватить, поэтому их стоит сопровождать.</p></div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Казна</small><b>${num(s.gc)} ГС</b></div>
        <div class="col-treasury"><small>Склад</small><b>${num(Math.round(used))} / ${num(s.cap)}</b></div>
        <div class="col-treasury"><small>Караванов</small><b>${caravans.length}</b></div>
      </div>
    </section>
    <section class="panel fl-body">
      <div class="tabs" role="tablist">${[['market', 'Рынок'], ['ex', `Биржа · ${others.length}`], ['deals', `Сделки и караваны${incoming + toSend ? ` · ${incoming + toSend}` : ''}`], ['log', 'Журнал']]
        .map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}</div>

      <div class="fl-pane" data-pane="market" ${tab === 'market' ? '' : raw('hidden')}>
        <div class="mn-table"><table class="tr-market">
          <thead><tr><th>Ресурс</th><th class="num">Цена</th><th>2 недели</th><th class="num">На складе</th>${can ? raw('<th>Сделка</th>') : ''}</tr></thead>
          <tbody>${market.map((m) => raw(html`<tr>
            <td><span class="mn-res">${raw(rarChip(m.rarity))}<b>${m.name}</b></span></td>
            <td class="num">${fmt2(m.price)}<small>база ${fmt2(m.base)} · ${Math.round(m.price / m.base * 100)} %</small></td>
            <td>${raw(spark(m.hist, m.base))}</td>
            <td class="num">${num(Math.round(Number(stock[m.name] || 0)))}</td>
            ${can ? raw(html`<td><form class="tr-q" data-res="${m.name}"><input type="number" name="q" min="1" step="10" placeholder="кол-во" aria-label="Количество ${m.name}">
              <button type="button" class="btn sm" data-side="buy" title="Купить по ${fmt2(m.price * buyK)}">Купить</button><button type="button" class="btn sm" data-side="sell" title="Продать по ${fmt2(m.price * (1 - fee / 100))}">Продать</button></form></td>`) : ''}</tr>`))}</tbody></table></div>
        <p class="fl-note">Покупка — по цене ×${String(buyK).replace('.', ',')} и только если хватает места на складе. Продажа — минус комиссия ${fee} %. Продажи давят цену вниз, покупки — вверх; раз в сутки цена делает шаг к базовой.${s.live ? '' : ' До дня переезда сделки идут по нынешним ценам рынка, а новый рынок считает свои цены в режиме просмотра.'}</p>
      </div>

      <div class="fl-pane" data-pane="ex" ${tab === 'ex' ? '' : raw('hidden')}>
        ${can ? raw(html`<form class="tr-post" id="tr-post">
          <select name="side" aria-label="Тип"><option value="sell">Продам</option><option value="buy">Куплю</option></select>
          <select name="res" aria-label="Ресурс">${resOpts()}</select>
          <input type="number" name="qty" min="1" placeholder="Количество" required aria-label="Количество">
          <input type="number" name="price" min="0.01" step="0.01" placeholder="Цена за ед., ГС" required aria-label="Цена">
          <button class="btn sm gold">Выставить</button></form>
          <p class="fl-note">Товар (для «продам») или деньги (для «куплю») уходят в залог до исполнения или отмены. Заявка живёт ${cfg.exchange_days || 7} дней. С продавца — комиссия ${fee} %.</p>`) : ''}
        <h3 class="fl-h3">Заявки других держав</h3>
        ${others.length ? raw(html`<ul class="tr-lots">${others.map((l) => raw(html`<li>
          <span class="tag ${l.side === 'sell' ? '' : 'new'}">${l.side === 'sell' ? 'продаёт' : 'покупает'}</span>
          <span class="fl-n"><b>${l.res} · ${num(l.left)} по ${fmt2(l.price)} ГС</b><small>${l.owner} · до ${hhmm(l.expires)}</small></span>
          ${can ? raw(html`<form class="tr-q" data-fill="${l.id}"><input type="number" name="q" min="1" max="${l.left}" value="${l.left}" aria-label="Сколько">
            <button class="btn sm gold">${l.side === 'sell' ? 'Купить' : 'Продать'}</button></form>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Чужих заявок нет.</p>')}
        <h3 class="fl-h3">Наши заявки</h3>
        ${mine.length ? raw(html`<ul class="tr-lots">${mine.map((l) => raw(html`<li><span class="tag">${l.side === 'sell' ? 'продаём' : 'покупаем'}</span>
          <span class="fl-n"><b>${l.res} · осталось ${num(l.left)} из ${num(l.qty)} по ${fmt2(l.price)} ГС</b><small>до ${hhmm(l.expires)}</small></span>
          ${can ? raw(html`<button type="button" class="btn sm" data-cancel="${l.id}">Снять</button>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Своих заявок нет.</p>')}
      </div>

      <div class="fl-pane" data-pane="deals" ${tab === 'deals' ? '' : raw('hidden')}>
        ${can ? raw(html`<form class="tr-deal" id="tr-deal"><h3>Предложить сделку с доставкой</h3>
          <div class="iv-row">
            <label><span>Покупатель</span><select name="buyer" required><option value="">Держава…</option>${(s.factions || []).filter((f) => !f.war).map((f) => raw(html`<option value="${f.id}">${f.name}</option>`))}</select></label>
            <label><span>Куда доставить</span><select name="sys" required></select></label>
            <label><span>Ресурс</span><select name="res">${resOpts()}</select></label>
            <label><span>Количество</span><input type="number" name="qty" min="1" required></label>
            <label><span>Цена за всё, ГС</span><input type="number" name="price" min="0" required></label>
            <label><span>Комментарий</span><input name="note" maxlength="200" placeholder="необязательно"></label>
          </div><button class="btn gold">Предложить</button></form>`) : ''}
        <h3 class="fl-h3">Сделки</h3>
        ${deals.length ? raw(html`<ul class="tr-lots">${deals.map((d) => raw(html`<li class="${['lost', 'declined', 'cancelled'].includes(d.status) ? 'off' : ''}">
          <span class="tag ${d.role === 'seller' ? '' : 'new'}">${d.role === 'seller' ? 'продаём' : 'покупаем'}</span>
          <span class="fl-n"><b>${d.res} × ${num(d.qty)} за ${num(d.price)} ГС · ${d.partner}</b>
            <small>доставка в ${d.to || '—'} · ${DEAL[d.status] || d.status}${d.fleet ? ` · караван «${d.fleet}»` : ''}${d.arrive_at ? ` · прибытие через ${left(d.arrive_at)}` : ''}${d.note ? ` · «${d.note}»` : ''}</small></span>
          ${can ? raw(html`<span class="fl-orders">
            ${d.role === 'buyer' && d.status === 'proposed' ? raw(html`<button type="button" class="btn sm gold" data-acc="${d.id}">Согласиться (залог ${num(d.price)} ГС)</button><button type="button" class="btn sm" data-dec="${d.id}">Отказать</button>`) : ''}
            ${d.role === 'seller' && d.status === 'accepted' ? raw(html`<button type="button" class="btn sm gold" data-ship="${d.id}">Отправить караван</button>`) : ''}
            ${['proposed', 'accepted'].includes(d.status) ? raw(html`<button type="button" class="btn sm" data-dcancel="${d.id}">Отменить</button>`) : ''}</span>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Сделок пока нет.</p>')}

        <h3 class="fl-h3">Караваны</h3>
        ${caravans.length ? raw(html`<ul class="tr-lots">${caravans.map((c) => raw(html`<li><span class="tag">${icon('i-ship')}</span>
          <span class="fl-n"><b>${c.name}</b><small>${c.status === 'v1_transit' ? `в пути в ${c.dest} · прибытие через ${left(c.arrive_at)}` : `стоит: ${c.system || '—'}`} · вместимость ${num(c.cap)}${c.cargo ? ` · везёт ${c.cargo.res} × ${num(c.cargo.qty)}` : ' · пустой'} · запас хода ${num(c.fuel)}/${num(c.fuel_cap)}</small></span></li>`))}</ul>`)
          : raw(html`<p class="empty">Караванов нет. Караван — это флот только из торговых кораблей. ${(s.designs || []).length ? raw(html`Их строят на верфи во <a href="#/fleet?tab=prod">флоте и войсках</a>: ${(s.designs || []).map((d) => d.name).join(', ')}.`) : 'Торговые корабли команда проекта добавит в ближайшее время.'}</p>`)}
        <p class="fl-note">Караван тратит запас хода, как любой флот. Флот противника в стойке «Оборона» на пути остановит его: если рядом есть ваш боевой флот, начнётся бой, если нет — груз достанется перехватчику, а залог вернётся покупателю. Флот сопровождения летит с караваном одним графиком.</p>
      </div>

      <div class="fl-pane" data-pane="log" ${tab === 'log' ? '' : raw('hidden')}>
        ${(s.log || []).length ? raw(html`<ul class="iv-log">${s.log.map((l) => raw(html`<li><div class="iv-lh"><b>${l.title}</b><time>${hhmm(l.at)}</time></div>${l.body ? raw(html`<p>${l.body}</p>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Журнал пуст.</p>')}
      </div>
    </section>
  </div>`;

  $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }));
  $$('[data-side]', root).forEach((b) => (b.onclick = () => {
    const f = b.closest('form'), q = Number(f.q.value);
    if (!q) { toast('Укажите количество.', 'err'); return; }
    run(() => rpc('v1_market_trade', { p_res: f.dataset.res, p_qty: q, p_side: b.dataset.side }),
      (r) => `${b.dataset.side === 'buy' ? 'Куплено' : 'Продано'}: ${num(q)} × ${f.dataset.res} за ${num(r.gc)} ГС.`);
  }));
  const post = $('#tr-post', root);
  if (post) post.onsubmit = (e) => { e.preventDefault(); run(() => rpc('v1_exchange_post', { p_side: post.side.value, p_res: post.res.value, p_qty: Number(post.qty.value), p_price: Number(post.price.value) }), 'Заявка выставлена.'); };
  $$('[data-fill]', root).forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); run(() => rpc('v1_exchange_fill', { p_lot: f.dataset.fill, p_qty: Number(f.q.value) }), (r) => `Исполнено: ${num(r.qty)} на ${num(r.gc)} ГС.`); }));
  $$('[data-cancel]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_exchange_cancel', { p_lot: b.dataset.cancel }), 'Заявка снята, залог возвращён.')));

  const df = $('#tr-deal', root);
  if (df) {
    df.buyer.onchange = () => {
      const f = (s.factions || []).find((x) => x.id === df.buyer.value);
      df.sys.innerHTML = (f?.systems || []).map((x) => html`<option value="${x.id}">${x.name}</option>`).join('');
    };
    df.onsubmit = (e) => {
      e.preventDefault();
      run(() => rpc('v1_deal_propose', { p_buyer: df.buyer.value, p_res: df.res.value, p_qty: Number(df.qty.value), p_price: Number(df.price.value), p_to_sys: df.sys.value, p_note: df.note.value || null }), 'Предложение отправлено.');
    };
  }
  $$('[data-acc]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Согласиться? Цена сделки уйдёт в залог и достанется продавцу, когда караван доставит груз. Если караван перехватят, залог вернётся.', 'Согласиться'))) return;
    run(() => rpc('v1_deal_answer', { p_deal: b.dataset.acc, p_accept: true }), 'Сделка принята, залог внесён.');
  }));
  $$('[data-dec]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_deal_answer', { p_deal: b.dataset.dec, p_accept: false }), 'Сделка отклонена.')));
  $$('[data-dcancel]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Отменить сделку? Если залог уже внесён, он вернётся покупателю.', 'Отменить'))) return;
    run(() => rpc('v1_deal_cancel', { p_deal: b.dataset.dcancel }), 'Сделка отменена.');
  }));
  $$('[data-ship]', root).forEach((b) => (b.onclick = () => {
    const d = deals.find((x) => x.id === b.dataset.ship);
    const ready = caravans.filter((c) => c.status === 'idle' && !c.cargo && !c.busy);
    const veil = document.createElement('div');
    veil.className = 'veil';
    veil.innerHTML = html`<article class="panel modal wide fl-modal" role="dialog" aria-label="Отправить караван">
      <button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button><h2>Караван: ${d.res} × ${num(d.qty)} → ${d.to}</h2>
      ${ready.length ? raw(html`<form class="fl-mform" id="cv">
        <label><span>Караван</span><select name="fleet">${ready.map((c) => raw(html`<option value="${c.id}" ${raw(c.cap < d.qty ? 'disabled' : '')}>${c.name} · ${c.system} · вместимость ${num(c.cap)}${c.cap < d.qty ? ' — мал' : ''}</option>`))}</select></label>
        <label><span>Сопровождение (флот в той же системе)</span><select name="escort"><option value="">Без сопровождения</option></select></label>
        <p class="hint">Товар спишется со склада при отправке. Путь — кратчайший по времени, через закрытые границы караван не пройдёт.</p>
        <div class="acts"><button class="btn gold">Отправить</button></div></form>`) : raw('<p class="empty">Нет свободных караванов на стоянке. Постройте торговые корабли и соберите из них отдельный флот.</p>')}
    </article>`;
    document.body.appendChild(veil);
    const close = () => veil.remove();
    veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-close]')) close(); });
    const cv = $('#cv', veil);
    if (!cv) return;
    const fillEsc = () => {
      const c = ready.find((x) => x.id === cv.fleet.value);
      cv.escort.innerHTML = html`<option value="">Без сопровождения</option>${(s.escorts || []).filter((e) => e.system_id === c?.system_id).map((e) => raw(html`<option value="${e.id}">${e.name}</option>`))}`;
    };
    cv.fleet.onchange = fillEsc; fillEsc();
    cv.onsubmit = (e) => { e.preventDefault(); close(); run(() => rpc('v1_caravan_send', { p_deal: d.id, p_fleet: cv.fleet.value, p_escort: cv.escort.value || null }), (r) => `Караван в пути: прибытие ${hhmm(r.arrive_at)}.`); };
  }));
}
