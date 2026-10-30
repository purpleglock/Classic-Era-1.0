import { html, raw, icon, $, $$, toast } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/mining — «Добыча ресурсов».
 * Сводка по ресурсам (склад, добыча за сутки, куда идёт, порог склада), шахты по колониям
 * (какие залежи копать) и разбор суток нового тика экономики. Пока новый тик в режиме
 * просмотра, цифры — прогноз: начисляет по-прежнему старый тик. Сервер: v1_mining_state,
 * v1_res_policy_set, v1_mine_targets (миграция 44).
 */
export const RAR = { common: ['обычный', '#9a948a'], uncommon: ['необычный', '#7fc79a'], rare: ['редкий', '#7aa7d9'], epic: ['эпический', '#b48ad9'], legendary: ['легендарный', '#e9b949'] };
const MINE = { mining: 'Шахта', mining_deep: 'Глубокая шахта', mining_exotic: 'Экзотическая шахта' };
const RICH = ['следы', 'мало', 'умеренно', 'много', 'очень много', 'колоссально'];
const hhmm = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
let tab = 'sum';

export const rarChip = (r) => html`<i class="mn-rar" style="--r:${(RAR[r] || RAR.common)[1]}" title="${(RAR[r] || RAR.common)[0]}"></i>`;

export async function renderMining(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-pick')}</span><div><h1>Добыча ресурсов</h1><p>Войдите, чтобы управлять шахтами державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) { root.innerHTML = html`<section class="panel gate"><div><h1>У вас пока нет державы</h1></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`; return; }
  if (!root.querySelector('.mn-wrap')) root.innerHTML = '<div class="skeleton">Считаю добычу за сутки…</div>';
  let s;
  try { s = await rpc('v1_mining_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Добыча недоступна</h1><p>${e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  const y = scrollY; draw(root, s); scrollTo(0, y);
}

function draw(root, s) {
  const can = !!s.can, fc = s.forecast || {}, inc = fc.income || {}, pol = s.policy || {}, prices = s.prices || {}, stock = s.stock || {};
  const used = Object.values(stock).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0), cap = Number(s.cap || 0);
  const names = [...new Set([...Object.keys(fc.mined || {}), ...Object.keys(stock).filter((k) => Number(stock[k]) > 0), ...Object.keys(pol)])]
    .filter((k) => prices[k]).sort((a, b) => (Number(fc.mined?.[b] || 0) - Number(fc.mined?.[a] || 0)) || a.localeCompare(b));
  const reload = () => renderMining(root);
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); reload(); } catch (e) { toast(e.message, 'err'); } };

  // шахты: постройка → её залежи
  const bld = new Map();
  for (const m of s.mines || []) {
    if (!bld.has(m.building)) bld.set(m.building, { ...m, deps: [] });
    bld.get(m.building).deps.push(m);
  }
  const byCol = new Map();
  for (const b of bld.values()) { if (!byCol.has(b.colony_id)) byCol.set(b.colony_id, { name: b.colony, list: [] }); byCol.get(b.colony_id).list.push(b); }
  const idle = (s.deposits || []).filter((d) => !d.mined);

  const row = (k) => {
    const p = pol[k] || {}, mined = Number(fc.mined?.[k] || 0), dump = Number(fc.dumped?.[k] || 0), pr = prices[k] || {};
    return html`<tr>
      <td><span class="mn-res">${raw(rarChip(pr.rarity))}<b>${k}</b></span></td>
      <td class="num">${num(Math.round(Number(stock[k] || 0)))}</td>
      <td class="num">${mined ? `+${num(mined)}` : '—'}${dump ? raw(html`<small class="warn" title="Не влезет на склад и уйдёт по дешёвке">−${num(dump)} сброс</small>`) : ''}</td>
      <td>${can ? raw(html`<select data-mode="${k}" aria-label="Куда идёт ${k}"><option value="store" ${raw(p.mode !== 'sell' ? 'selected' : '')}>на склад</option><option value="sell" ${raw(p.mode === 'sell' ? 'selected' : '')}>на рынок</option></select>`) : (p.mode === 'sell' ? 'на рынок' : 'на склад')}</td>
      <td>${can ? raw(html`<input type="number" min="0" step="100" value="${p.keep ?? ''}" placeholder="нет" data-keep="${k}" aria-label="Порог склада ${k}">`) : (p.keep ?? '—')}</td>
      <td class="num">${num(Math.round(Number(pr.price || 0) * 100) / 100)}<small>база ${num(pr.base)}</small></td>
      <td class="num">${s.needs?.[k] ? num(s.needs[k]) : ''}</td></tr>`;
  };

  const li = (label, v, cls = '') => html`<li class="${cls}"><span>${label}</span><b>${v > 0 ? '+' : ''}${num(Math.round(v || 0))}</b></li>`;

  root.innerHTML = html`<div class="rx-wrap mn-wrap">
    <section class="panel st-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Добыча ресурсов</h1>
        <p>Шахты копают залежи колоний: выход зависит от редкости и богатства залежи, вида шахты, класса мира и порядка на колонии. Каждый ресурс идёт на склад или сразу на рынок; у склада есть предел, а всё, что выше порога, продаётся. Не влезшее на склад уходит по дешёвке.</p>
        ${s.live ? '' : raw(html`<p class="note mn-shadow">${icon('i-clock')}Новый тик экономики пока в режиме просмотра: цифры здесь — прогноз по новым правилам, а начисляет по-прежнему старый тик. Настройки «куда идёт» и «порог» уже сохраняются и заработают в день переезда.</p>`)}</div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Склад</small><b>${num(Math.round(used))} / ${num(cap)}</b></div>
        <div class="col-treasury"><small>Доход за сутки</small><b class="${inc.net < 0 ? 'bad' : ''}">${inc.net > 0 ? '+' : ''}${num(inc.net)} ГС</b></div>
        <div class="col-treasury"><small>Шахт</small><b>${bld.size}</b></div>
      </div>
      <div class="mn-cap"><div class="fl-prog"><i style="width:${Math.min(100, cap ? used / cap * 100 : 0).toFixed(1)}%"></i></div>
        <small>${used >= cap ? 'Склад полон — новая добыча уходит по дешёвке. Постройте склады, поднимите инфраструктуру в бюджете или продавайте лишнее.' : `Свободно ${num(Math.round(cap - used))}`}</small></div>
    </section>

    <section class="panel fl-body">
      <div class="tabs" role="tablist">${[['sum', 'Ресурсы'], ['mines', `Шахты · ${bld.size}`], ['day', 'Сутки']].map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}</div>

      <div class="fl-pane" data-pane="sum" ${tab === 'sum' ? '' : raw('hidden')}>
        <div class="mn-table"><table>
          <thead><tr><th>Ресурс</th><th class="num">Склад</th><th class="num">Добыча / сут</th><th>Куда</th><th title="Всё, что выше, продаётся на тике">Порог склада</th><th class="num">Цена, ГС</th><th class="num" title="Сырьё на один корабль каждого вашего проекта, всего">Проектам</th></tr></thead>
          <tbody>${names.map((k) => raw(row(k)))}</tbody></table></div>
        ${names.length ? '' : raw('<p class="empty">Ни шахт, ни запасов пока нет.</p>')}
        <p class="fl-note">«На рынок» — вся добыча ресурса продаётся на тике по рыночной цене минус комиссия ${Math.round((s.settings?.fee || 0.04) * 100)} %. «Порог склада» — сколько держать; всё сверх продаётся. Колонка «Проектам» подсказывает, какое сырьё нужно вашим кораблям.</p>
      </div>

      <div class="fl-pane" data-pane="mines" ${tab === 'mines' ? '' : raw('hidden')}>
        <p class="fl-note">Обычная шахта берёт обычные и необычные залежи, глубокая — ещё и редкие, экзотическая — редкие, эпические и легендарные. Отметьте, какие залежи копать; без отметок шахта копает все доступные ей поровну. Богатство залежи: ${RICH.join(' → ')}.</p>
        ${[...byCol.values()].map((c) => raw(html`<article class="mn-col"><h3>${icon('i-planet')}${c.name}</h3>
          ${c.list.map((b) => raw(html`<form class="mn-mine" data-mine="${b.building}">
            <header><b>${MINE[b.btype] || b.btype}</b><small>слотов ${b.slots} · ${num(b.deps.reduce((a, d) => a + Number(d.rate || 0), 0))} ед./сут</small>
              ${can ? raw('<button class="btn sm" hidden>Сохранить</button>') : ''}</header>
            <ul>${b.deps.map((d) => raw(html`<li class="${d.allowed ? '' : 'off'}"><label>
              <input type="checkbox" name="t" value="${d.res}" ${raw(d.picked ? 'checked' : '')} ${raw(!can || !d.allowed ? 'disabled' : '')}>
              ${raw(rarChip(d.rarity))}<span>${d.res}</span><small>${d.rich}${d.allowed ? '' : ' · этой шахте не по силам'}</small><em>${d.rate ? `+${num(d.rate)}` : ''}</em></label></li>`))}</ul>
          </form>`))}</article>`))}
        ${bld.size ? '' : raw('<p class="empty">Шахт пока нет. Постройте их в <a href="#/colonies">управлении колониями</a>.</p>')}
        ${idle.length ? raw(html`<h3 class="fl-h3">Залежи без шахт</h3><ul class="mn-idle">${idle.map((d) => raw(html`<li>${raw(rarChip(d.rarity))}<b>${d.res}</b><small>${d.colony}${d.system ? ` · ${d.system}` : ''} · ${d.rich}</small></li>`))}</ul>`) : ''}
      </div>

      <div class="fl-pane" data-pane="day" ${tab === 'day' ? '' : raw('hidden')}>
        <div class="mn-day">
          <section><h3>Новый тик · прогноз на сутки</h3><ul class="mn-led">
            ${raw(li('Фабрики', inc.factory))}${raw(li('Торговые хабы', inc.trade))}${raw(li('Храмы', inc.temple))}
            ${raw(li('Продажа ресурсов', inc.sales))}${raw(li('Сброс излишков', inc.dump))}${raw(li('Бюджет (апкип)', -inc.upkeep, 'bad'))}
            ${raw(li('Итого', inc.net, 'sum'))}</ul>
            <ul class="mn-led small">
              <li><span>Наука</span><b>+${num(fc.science)}</b></li>
              <li><span>Очки агентов (1 очко = агент)</span><b>+${fc.agent_pts ?? 0}</b></li>
              <li><span>Товары: сделано / спрос</span><b>${num(fc.goods?.made)} / ${num(fc.goods?.demand)}</b></li>
              <li><span>Благополучие (× доход построек)</span><b>×${fc.welfare}</b></li>
              <li><span>Население</span><b>${num(fc.pop?.before)} → ${num(fc.pop?.after)}</b></li>
            </ul></section>
          <section><h3>Старый тик · последние сутки</h3>
            ${s.old ? raw(html`<ul class="mn-led">
              ${raw(li('Постройки', s.old.build))}${raw(li('Рынок', s.old.market))}${raw(li('Вывоз', s.old.export))}${raw(li('Итого', s.old.net, 'sum'))}</ul>
              <ul class="mn-led small"><li><span>Легло на склад</span><b>${num(s.old.mined)}</b></li><li><span>Сгорело (нет места)</span><b>${num(s.old.lost)}</b></li><li><span>Когда</span><b>${hhmm(s.old.at)}</b></li></ul>`)
              : raw('<p class="empty">Нет данных.</p>')}
            ${s.shadow ? raw(html`<p class="fl-note">Новый тик в режиме просмотра последний раз считал ${hhmm(s.shadow.at)}: итог ${s.shadow.income?.net > 0 ? '+' : ''}${num(s.shadow.income?.net)} ГС.</p>`) : ''}
          </section>
        </div>
      </div>
    </section>
  </div>`;

  $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }));
  const save = (k) => {
    const mode = $(`[data-mode="${CSS.escape(k)}"]`, root)?.value || 'store', kv = $(`[data-keep="${CSS.escape(k)}"]`, root)?.value;
    run(() => rpc('v1_res_policy_set', { p_res: k, p_mode: mode, p_keep: kv === '' || kv == null ? null : Number(kv) }), 'Сохранено.');
  };
  $$('[data-mode]', root).forEach((el) => (el.onchange = () => save(el.dataset.mode)));
  $$('[data-keep]', root).forEach((el) => (el.onchange = () => save(el.dataset.keep)));
  $$('[data-mine]', root).forEach((f) => {
    const btn = $('button', f);
    f.onchange = () => { if (btn) btn.hidden = false; };
    f.onsubmit = (e) => {
      e.preventDefault();
      const t = $$('[name=t]:checked:not(:disabled)', f).map((c) => c.value);
      const all = $$('[name=t]:not(:disabled)', f).length;
      if (!t.length) { toast('Отметьте хотя бы одну залежь.', 'err'); return; }
      run(() => rpc('v1_mine_targets', { p_building: f.dataset.mine, p_targets: t.length === all ? [] : t }), 'Шахта перенастроена.');
    };
  });
}
