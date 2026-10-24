import { html, raw, icon, $ } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, signed, short, dayMonth, dateShort, leftText } from '../lib/format.js';
import { crest } from './home.js';

/**
 * #/stats — статистика державы. Все цифры приходят одним вызовом v1_faction_stats:
 * казна и её история по тикам, статьи дохода, территория, армия, наука, дипломатия, достижения.
 * Команда проекта может открыть чужую державу: #/stats?f=<faction_id>.
 */

// статьи дохода из журнала начислений: [ключ, название, пояснение, знак]
const LINES = [
  ['build', 'Постройки', 'фабрики и производства колоний', 1],
  ['trade', 'Торговые пути', 'караваны и доля с поставок', 1],
  ['export', 'Экспорт добычи', 'излишки рудников на вывоз', 1],
  ['market', 'Рынок', 'продажи на рынке сектора', 1],
  ['faith', 'Вера', 'храмы, десятина и общины', 1],
  ['policy', 'Содержание державы', 'бюджет отраслей и курс', -1],
];
const UNION = { federation: 'Федерация', confederation: 'Конфедерация', alliance: 'Альянс', union: 'Уния' };
const PERIODS = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней']];

const q = () => new URLSearchParams(location.hash.split('?')[1] || '');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export async function renderStats(root, days = Number(q().get('d')) || 30) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-stat')}</span><div><h1>Статистика державы</h1><p>Войдите, чтобы увидеть сводку своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  const fid = q().get('f') || null;
  if (!fid && !session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Статистика появится, когда команда проекта одобрит заявку.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  root.innerHTML = '<div class="skeleton">Собираю сводку державы…</div>';
  let s;
  try {
    s = await rpc('v1_faction_stats', { p_fid: fid, p_days: days });
  } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Статистика недоступна</h1><p>${e.missingSchema ? 'Сводка ещё не подключена в базе (миграция 15).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s, days, fid);
}

function draw(root, s, days, fid) {
  const f = s.faction || {}, t = s.treasury || {}, h = s.history || [];
  const ter = s.territory || {}, army = s.army || {}, sci = s.science || {}, ach = s.achievements || {}, dip = s.diplomacy || {};
  const last = h[h.length - 1] || {};
  const nets = h.map((x) => Number(x.net) || 0);
  const sumNet = nets.reduce((a, b) => a + b, 0);
  const avgNet = h.length ? sumNet / h.length : 0;
  const best = h.reduce((m, x) => (Number(x.net) > Number(m?.net ?? -Infinity) ? x : m), null);
  const start = h.length ? (Number(h[0].gc) || 0) - (Number(h[0].net) || 0) : null;
  const grow = start ? ((Number(t.gc) - start) / Math.max(1, Math.abs(start))) * 100 : 0;
  const sciDay = h.length ? h.reduce((a, x) => a + (Number(x.sci) || 0), 0) / h.length : 0;
  const half = Math.floor(nets.length / 2);
  const trend = half ? (nets.slice(half).reduce((a, b) => a + b, 0) / (nets.length - half)) - (nets.slice(0, half).reduce((a, b) => a + b, 0) / half) : 0;
  const nextTick = t.last_tick ? new Date(t.last_tick).getTime() + 864e5 : null;

  root.innerHTML = html`
    <section class="panel st-hero">
      <div class="st-crest" aria-hidden="true">${crest(f.herald_url)}</div>
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Статистика державы</h1>
        <p><b>${f.name || 'Держава'}</b>${f.gov ? ` · ${f.gov}` : ''}${f.capital ? ` · столица ${f.capital}` : ''}${f.since ? ` · с ${dayMonth(f.since)}` : ''}</p>
      </div>
      <div class="seg st-period" role="group" aria-label="Период">${PERIODS.map(([d, l]) => raw(html`<button type="button" data-d="${d}" aria-pressed="${String(d === days)}">${l}</button>`))}</div>
    </section>

    <section class="st-kpis" aria-label="Главное">
      <article class="panel kpi">
        <span class="kpi-ic">${icon('i-coin')}</span><small>Казна</small>
        <b>${num(t.gc)} <em>ГС</em></b>
        <span class="kpi-d ${grow >= 0 ? 'up' : 'down'}">${grow >= 0 ? '▲' : '▼'} ${Math.abs(grow).toFixed(1)}% за ${days} ${plural(days, 'день', 'дня', 'дней')}</span>
      </article>
      <article class="panel kpi">
        <span class="kpi-ic">${icon('i-trend')}</span><small>Доход в сутки</small>
        <b>${signed(last.net ?? 0)} <em>ГС</em></b>
        <span class="kpi-d ${trend >= 0 ? 'up' : 'down'}">в среднем ${signed(avgNet)} · ${trend >= 0 ? 'растёт' : 'падает'}</span>
      </article>
      <article class="panel kpi">
        <span class="kpi-ic">${icon('i-flask')}</span><small>Наука</small>
        <b>${num(t.science)} <em>ОН</em></b>
        <span class="kpi-d">≈ +${num(sciDay)} ОН в сутки</span>
      </article>
      <article class="panel kpi">
        <span class="kpi-ic">${icon('i-planet')}</span><small>Владения</small>
        <b>${num(ter.systems)} <em>${plural(Number(ter.systems) || 0, 'система', 'системы', 'систем')}</em></b>
        <span class="kpi-d">${num(ter.colonies)} ${plural(Number(ter.colonies) || 0, 'колония', 'колонии', 'колоний')} · ${short(ter.pop)} жителей</span>
      </article>
    </section>

    <section class="panel st-chart-box">
      <div class="sec-h"><h2>Казна и доход</h2><small>${h.length} ${plural(h.length, 'начисление', 'начисления', 'начислений')}</small>
        <span class="st-legend"><i class="l-gc"></i>казна <i class="l-net"></i>доход за тик</span></div>
      <div class="st-chart" id="st-chart"></div>
      <div class="st-sums">
        <div><small>Заработано за период</small><b>${signed(sumNet)} ГС</b></div>
        <div><small>Лучший день</small><b>${best ? `${signed(best.net)} ГС` : '—'}</b>${best ? raw(html`<span>${dayMonth(best.at)}</span>`) : ''}</div>
        <div><small>Следующее начисление</small><b id="st-tick">${nextTick ? 'через ' + leftText(nextTick - Date.now()) : '—'}</b></div>
      </div>
    </section>

    <div class="st-grid">
      <section class="panel st-card st-wide">
        <div class="sec-h"><h2>Из чего складывается доход</h2><small>${last.at ? `начисление ${dateShort(last.at)}` : 'нет начислений'}</small></div>
        ${raw(breakdown(last, h))}
      </section>

      <section class="panel st-card">
        <div class="sec-h"><h2>Территория</h2>${icon('i-map')}</div>
        <dl class="st-dl">
          <div><dt>Звёздных систем</dt><dd>${num(ter.systems)}</dd></div>
          <div><dt>Колоний</dt><dd>${num(ter.colonies)}</dd></div>
          <div><dt>Население</dt><dd>${num(ter.pop)}</dd></div>
          <div><dt>Построек</dt><dd>${num(ter.buildings)}</dd></div>
        </dl>
        ${raw(meter('Застройка ячеек', ter.buildings, ter.cells))}
        ${ter.occupied_by_enemy || ter.occupying ? raw(html`<p class="st-warn">${ter.occupied_by_enemy ? `Под оккупацией врага: ${ter.occupied_by_enemy}. ` : ''}${ter.occupying ? `Вы оккупируете: ${ter.occupying}.` : ''}</p>`) : ''}
        ${(ter.types || []).length ? raw(html`<h3 class="st-h3">Типы миров</h3><ul class="st-bars">${(ter.types || []).map((x) => raw(html`<li><span>${x.t}</span><i style="--w:${pct(x.n, ter.types[0].n)}%"></i><b>${x.n}</b></li>`))}</ul>`) : ''}
      </section>

      <section class="panel st-card">
        <div class="sec-h"><h2>Вооружённые силы</h2>${icon('i-ship')}</div>
        <dl class="st-dl">
          <div><dt>Кораблей</dt><dd>${num(army.ships)}</dd></div>
          <div><dt>Из них во флотах</dt><dd>${num(army.in_fleets)}</dd></div>
          <div><dt>Флотов</dt><dd>${num(army.fleets)}${army.moving ? raw(html` <small>· ${army.moving} в пути</small>`) : ''}</dd></div>
          <div><dt>Станций</dt><dd>${num(army.stations)}</dd></div>
          <div><dt>Наземные войска</dt><dd>${num(army.ground)}</dd></div>
          <div><dt>Авиация</dt><dd>${num(army.aviation)} <small class="tag">заморожена</small></dd></div>
          <div><dt>В производстве</dt><dd>${num(army.queued)}</dd></div>
          <div><dt>Проектов в реестре</dt><dd>${num(army.designs)}</dd></div>
        </dl>
        ${army.damaged ? raw(html`<p class="st-warn">Повреждено и ждёт ремонта: ${num(army.damaged)}.</p>`) : ''}
      </section>

      <section class="panel st-card">
        <div class="sec-h"><h2>Наука</h2>${icon('i-flask')}</div>
        <div class="st-ring-row">
          ${raw(ring(sci.done, sci.total))}
          <div><b>${num(sci.done)} из ${num(sci.total)}</b><small>технологий изучено</small>
            <p>${sci.active ? `Сейчас изучается: ${sci.active}` : 'Ничего не изучается'}${sci.queue ? ` · в очереди ${sci.queue}` : ''}</p>
            ${sci.next_ready ? raw(html`<p class="st-mute">Ближайшее открытие через ${leftText(new Date(sci.next_ready) - Date.now())}</p>`) : ''}</div>
        </div>
        <dl class="st-dl one"><div><dt>Очки науки</dt><dd>${num(t.science)} ОН</dd></div><div><dt>Прирост</dt><dd>≈ +${num(sciDay)} ОН/сут</dd></div></dl>
      </section>

      <section class="panel st-card">
        <div class="sec-h"><h2>Дипломатия</h2>${icon('i-flag')}</div>
        <dl class="st-dl">
          <div><dt>Войн всего</dt><dd>${num(dip.wars_total)}</dd></div>
          <div><dt>Побед</dt><dd>${num(dip.wars_won)}</dd></div>
          <div><dt>Идёт сейчас</dt><dd class="${dip.wars_active ? 'hot' : ''}">${num(dip.wars_active)}</dd></div>
          <div><dt>Вассалов</dt><dd>${num(dip.vassals)}</dd></div>
          <div><dt>Друзей</dt><dd>${num(dip.friends)}</dd></div>
          <div><dt>Соперников</dt><dd>${num(dip.rivals)}</dd></div>
          <div><dt>Выдано кредитов</dt><dd>${num(dip.loans_given)} ГС</dd></div>
          <div><dt>Взято кредитов</dt><dd>${num(dip.loans_taken)} ГС</dd></div>
        </dl>
        ${dip.overlord ? raw(html`<p class="st-warn">Держава — вассал: ${dip.overlord}.</p>`) : ''}
        ${(dip.unions || []).length ? raw(html`<ul class="st-tags">${dip.unions.map((u) => raw(html`<li>${UNION[u.kind] || 'Союз'} «${u.name}»${u.leader ? ' · глава' : ''}</li>`))}</ul>`) : raw('<p class="st-mute">В союзах не состоит.</p>')}
      </section>

      <section class="panel st-card st-ach-card">
        <div class="sec-h"><h2>Достижения</h2>${icon('i-crown')}</div>
        ${raw(meter('Получено', ach.count, ach.catalog))}
        <p class="st-mute">Наградами получено ${num(ach.reward)} ГС.</p>
        ${(ach.last || []).length ? raw(html`<ol class="st-ach">${ach.last.map((a) => raw(html`<li><span class="dot gold"></span><b>«${a.name}»</b><small>${a.reward ? `+${num(a.reward)} ГС · ` : ''}${dateShort(a.at)}</small></li>`))}</ol>`) : raw('<p class="st-mute">Достижений пока нет.</p>')}
      </section>
    </div>`;

  $('.st-period', root).onclick = (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const d = Number(b.dataset.d);
    history.replaceState(null, '', `#/stats?${new URLSearchParams({ ...(fid ? { f: fid } : {}), d })}`);
    renderStats(root, d);
  };
  chart($('#st-chart', root), h);
  const ro = new ResizeObserver(() => chart($('#st-chart', root), h));
  ro.observe($('#st-chart', root));
  if (nextTick) {
    const tm = setInterval(() => {
      const el = document.getElementById('st-tick');
      if (!el) { clearInterval(tm); ro.disconnect(); return; }
      el.textContent = 'через ' + leftText(nextTick - Date.now());
    }, 30000);
  }
}

/** Разбивка последнего начисления + сумма статей за период. */
function breakdown(last, h) {
  if (!last.at) return '<p class="st-mute">Начислений ещё не было — первая сводка появится после ближайшего тика.</p>';
  const rows = LINES.map(([k, name, sub, sign]) => {
    const v = (Number(last[k]) || 0) * sign;
    const period = h.reduce((a, x) => a + (Number(x[k]) || 0) * sign, 0);
    return { k, name, sub, v, period };
  }).filter((r) => r.v || r.period);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  const inc = rows.filter((r) => r.v > 0).reduce((a, r) => a + r.v, 0);
  const exp = rows.filter((r) => r.v < 0).reduce((a, r) => a - r.v, 0);
  return html`
    <div class="st-split">
      <div class="st-split-bar" role="img" aria-label="Доходы ${num(inc)} ГС, расходы ${num(exp)} ГС"><i style="--w:${pct(inc, inc + exp)}%"></i></div>
      <div class="st-split-l"><span><b>${num(inc)}</b> доходы</span><span><b>${num(exp)}</b> расходы</span><span class="net"><b>${signed(last.net)}</b> чистыми</span></div>
    </div>
    <ul class="st-lines">${rows.map((r) => raw(html`<li class="${r.v < 0 ? 'neg' : ''}">
      <span class="st-ln"><b>${r.name}</b><small>${r.sub}</small></span>
      <span class="st-lbar"><i style="--w:${Math.max(3, pct(Math.abs(r.v), max))}%"></i></span>
      <span class="st-lv"><b>${signed(r.v)}</b><small>${signed(r.period)} за период</small></span></li>`))}</ul>
    ${Number(last.mined_lost) > 0 ? raw(html`<p class="st-mute">Склады переполнены: за последний тик потеряно ${num(last.mined_lost)} ед. добычи.</p>`) : ''}`;
}

function meter(label, v, total) {
  const p = pct(Number(v) || 0, Number(total) || 0);
  return html`<div class="st-meter"><span>${label}</span><b>${num(v)} / ${num(total)}</b><i style="--w:${Math.min(100, p)}%"></i></div>`;
}

function ring(v, total) {
  const p = Math.min(1, (Number(v) || 0) / Math.max(1, Number(total) || 0));
  const c = 2 * Math.PI * 34;
  return `<svg class="st-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34"/><circle class="on" cx="40" cy="40" r="34" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/><text x="40" y="45">${Math.round(p * 100)}%</text></svg>`;
}

/** Линия казны с заливкой и столбики дохода за тик; подсказка по наведению. */
function chart(el, h) {
  if (!el) return;
  const W = Math.max(280, el.clientWidth || 600), H = W < 520 ? 200 : 250;
  if (h.length < 2) { el.innerHTML = '<p class="st-mute">Для графика нужно хотя бы два начисления.</p>'; return; }
  const pad = { l: 8, r: 8, t: 14, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const gcs = h.map((x) => Number(x.gc) || 0), nets = h.map((x) => Number(x.net) || 0);
  const gMin = Math.min(...gcs), gMax = Math.max(...gcs), gSpan = gMax - gMin || Math.max(1, gMax * 0.01);
  const nMax = Math.max(1, ...nets.map(Math.abs));
  const X = (i) => pad.l + (iw * i) / (h.length - 1);
  const Y = (v) => pad.t + ih * 0.62 * (1 - (v - gMin) / gSpan);
  const baseB = pad.t + ih, barH = ih * 0.3;
  const line = gcs.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${line}L${X(h.length - 1).toFixed(1)},${(pad.t + ih * 0.62).toFixed(1)}L${X(0).toFixed(1)},${(pad.t + ih * 0.62).toFixed(1)}Z`;
  const bw = Math.max(2, Math.min(18, (iw / h.length) * 0.6));
  const bars = nets.map((v, i) => {
    const bh = Math.max(1.5, (Math.abs(v) / nMax) * barH);
    return `<rect class="${v < 0 ? 'neg' : ''}" x="${(X(i) - bw / 2).toFixed(1)}" y="${(baseB - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>`;
  }).join('');
  const ticks = [0, Math.floor((h.length - 1) / 2), h.length - 1].map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === h.length - 1 ? 'end' : 'middle'}">${dateShort(h[i].at)}</text>`).join('');
  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Казна за период: от ${num(gcs[0])} до ${num(gcs[gcs.length - 1])} ГС">
      <defs><linearGradient id="st-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e9b949" stop-opacity=".35"/><stop offset="1" stop-color="#e9b949" stop-opacity="0"/></linearGradient></defs>
      <line class="st-axis" x1="${pad.l}" x2="${W - pad.r}" y1="${baseB}" y2="${baseB}"/>
      <g class="st-barsg">${bars}</g>
      <path class="st-area" d="${area}"/><path class="st-line" d="${line}"/>
      <g class="st-ticks">${ticks}</g>
      <line class="st-cursor" id="st-cur" y1="${pad.t}" y2="${baseB}" x1="-10" x2="-10"/>
      <circle class="st-dot" id="st-dot" r="4.5" cx="-10" cy="-10"/>
    </svg>
    <div class="st-tip" id="st-tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('#st-tip'), cur = el.querySelector('#st-cur'), dot = el.querySelector('#st-dot');
  const show = (i) => {
    const x = X(i);
    cur.setAttribute('x1', x); cur.setAttribute('x2', x);
    dot.setAttribute('cx', x); dot.setAttribute('cy', Y(gcs[i]));
    tip.hidden = false;
    tip.innerHTML = html`<b>${dayMonth(h[i].at)}</b><span>Казна: ${num(gcs[i])} ГС</span><span class="${nets[i] < 0 ? 'neg' : ''}">Доход: ${signed(nets[i])} ГС</span>`;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(W - tw - 4, Math.max(4, x - tw / 2))}px`;
  };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (h.length - 1));
    show(Math.max(0, Math.min(h.length - 1, i)));
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cur.setAttribute('x1', -10); cur.setAttribute('x2', -10); dot.setAttribute('cx', -10); });
}

