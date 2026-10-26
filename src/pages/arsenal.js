import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { num } from '../lib/format.js';

/**
 * #/arsenal — вики «Арсенал»: общедоступные орудия и системы.
 * Разделы — карточками, как «Вики фракций»; внутри — карточки позиций,
 * подробная справка и сравнение до трёх позиций.
 * Сервер: v1_arsenal() (открыт всем, без входа).
 */

const TYPE = { kinetic: 'кинетика', energy: 'энергия', missile: 'ракеты', repair: 'ремонт' };
const SECT = { weapons: 'Вооружение', systems: 'Системы' };
// подписи параметров: [название, формат, больше — лучше?]
const P = {
  dmg: ['Урон за ход', 'n', 1], heal: ['Ремонт за ход', 'n', 1], energy: ['Энергия, ЭЕ', 'n', 0], rng: ['Дальность', 'd', 1],
  acc: ['Точность', '%', 1], pen: ['Пробитие брони', 'p', 1], shield_k: ['Урон по щитам', 'x', 1], pd: ['Перехват ракет', 'p', 1],
  slow: ['Замедление цели', 'p', 1], radar: ['Радар', 'n', 1], km: ['Обзор, км', 'n', 1], comm: ['Связь', 'n', 1],
  jam: ['Подавление', '+', 1], protect: ['Защита от помех', '+', 1], acc_bonus: ['Точность эскадры', '+%', 1], command: ['Командование', '+', 1],
  crew_save: ['Экономия экипажа', 'p', 1], stealth: ['Маскировка', 'p', 1], anti_stealth: ['Обнаружение маскировки', 'p', 1],
  jump: ['Прыжок, систем', 'n', 1], thrust: ['Тяга', 'n', 1], shield: ['Щит', 'n', 1], crew: ['Экипаж', 'n', 1], cargo: ['Груз', 'n', 1],
  craft: ['Звеньев авиации', 'n', 1], capacity: ['Топливо, ед.', 'n', 1], risk: ['Риск детонации', 'x', 0], hp: ['Прочность модуля', 'n', 1],
  mass: ['Масса, т', 'd', 0], cost: ['Цена, ГС', 'n', 0],
};
const ORDER = Object.keys(P);
const fmtv = (k, v) => {
  const f = P[k]?.[1];
  if (v == null) return '—';
  if (f === '%') return `${v} %`;
  if (f === 'p') return `${Math.round(v * 100)} %`;
  if (f === 'x') return `×${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
  if (f === '+') return `+${v}`;
  if (f === '+%') return `+${v} %`;
  if (f === 'd') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  return num(v);
};

let cache = null;
const compare = new Set();

export async function renderArsenal(root) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const g = qs.get('g'), item = qs.get('i');
  if (!cache) {
    root.innerHTML = '<div class="skeleton">Открываю арсенал…</div>';
    try { cache = await rpc('v1_arsenal'); } catch (e) {
      root.innerHTML = html`<section class="panel gate"><div><h1>Арсенал недоступен</h1><p>${e.missingSchema ? 'Каталог ещё не подключён в базе (миграция 30).' : e.message}</p></div></section>`;
      return;
    }
    setTimeout(() => { cache = null; }, 5 * 60 * 1000);
  }
  const { groups = [], items = [], mine } = cache;
  if (g && groups.some((x) => x.id === g)) drawGroup(root, groups.find((x) => x.id === g), items.filter((i) => i.grp === g), mine, items);
  else drawIndex(root, groups, items, mine);
  if (item) { const it = items.find((i) => i.id === item); if (it) openItem(root, it, groups, mine); }
}

// ═ Оглавление: разделы карточками ═
function drawIndex(root, groups, items, mine) {
  root.innerHTML = html`
    <section class="panel guide-head"><span class="m-ic">${icon('i-sword')}</span>
      <div><h1>Арсенал</h1><p>Общедоступные орудия и системы для кораблей Даллерии: ${items.length} позиций в ${groups.length} разделах.</p></div>
      <input class="search" type="search" id="ar-q" placeholder="Найти орудие или систему" aria-label="Найти орудие или систему"></section>
    <div id="ar-found" hidden></div>
    <div id="ar-sections">${Object.entries(SECT).map(([sec, title]) => raw(html`
      <h2 class="ar-sec">${title}</h2>
      <div class="wiki-grid">${groups.filter((x) => x.section === sec).map((x) => {
        const first = items.find((i) => i.grp === x.id);
        return raw(html`<a class="panel wiki-card ar-card" href="#/arsenal?g=${x.id}">
          <span class="wk-ban ar-ban">${x.cover ? raw(html`<img src="${x.cover}" alt="" loading="lazy">`) : raw(groupArt(x.id, items.filter((i) => i.grp === x.id)))}</span>
          <span class="wk-body"><span class="wk-crest ar-crest">${raw(first ? itemArt(first, true) : '')}</span>
            <b>${x.title}</b><small>${x.descr}</small><em class="ar-count">${x.count} ${plural(x.count, 'позиция', 'позиции', 'позиций')}</em></span></a>`);
      })}</div>`))}</div>`;

  const found = $('#ar-found', root), secs = $('#ar-sections', root);
  $('#ar-q', root).oninput = (e) => {
    const v = e.target.value.trim().toLowerCase();
    if (!v) { found.hidden = true; secs.hidden = false; return; }
    const hit = items.filter((i) => `${i.code} ${i.nick} ${i.base_name} ${i.descr}`.toLowerCase().includes(v));
    found.hidden = false; secs.hidden = true;
    found.innerHTML = hit.length ? html`<div class="wiki-grid ar-items">${hit.map((i) => raw(itemCard(i, groups, mine)))}</div>` : '<p class="panel empty ar-none">Ничего не нашлось.</p>';
    bindItems(found, items, groups, mine, root);
  };
}

// ═ Раздел: карточки позиций ═
function drawGroup(root, grp, list, mine, all) {
  const sizes = [...new Set(list.map((i) => i.size))];
  root.innerHTML = html`
    <a class="btn sm lore-back" href="#/arsenal">${icon('i-back')}Весь арсенал</a>
    <section class="panel ar-head">
      <div class="ar-head-art">${raw(grp.cover ? html`<img src="${grp.cover}" alt="">` : groupArt(grp.id, list))}</div>
      <div class="ar-head-body"><span class="fac"><i></i>${SECT[grp.section]}</span><h1>${grp.title}</h1><p>${grp.descr}</p>
        ${sizes.length > 1 ? raw(html`<div class="chips ar-sizes" role="group" aria-label="Размер">${['все', ...sizes].map((s) => raw(html`<button type="button" data-s="${s}" aria-pressed="${s === 'все'}">${s}</button>`))}</div>`) : ''}
      </div>
    </section>
    <div class="wiki-grid ar-items" id="ar-list">${list.map((i) => raw(itemCard(i, [grp], mine)))}</div>
    <div class="ar-cmp-bar" id="ar-cmp" hidden></div>`;
  $$('.ar-sizes button', root).forEach((b) => {
    b.onclick = () => {
      $$('.ar-sizes button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $$('#ar-list .ar-item', root).forEach((c) => { c.hidden = b.dataset.s !== 'все' && c.dataset.size !== b.dataset.s; });
    };
  });
  bindItems($('#ar-list', root), all, [grp], mine, root);
  drawCmpBar(root, all);
}

function bindItems(box, items, groups, mine, root) {
  box.onclick = (e) => {
    const cmp = e.target.closest('[data-cmp]');
    if (cmp) {
      e.preventDefault();
      const id = cmp.dataset.cmp;
      if (compare.has(id)) compare.delete(id); else if (compare.size < 3) compare.add(id);
      $$('[data-cmp]', root).forEach((b) => b.setAttribute('aria-pressed', String(compare.has(b.dataset.cmp))));
      drawCmpBar(root, items);
      return;
    }
    const card = e.target.closest('.ar-item');
    if (card) { e.preventDefault(); openItem(root, items.find((i) => i.id === card.dataset.id), groups, mine); }
  };
}

function drawCmpBar(root, items) {
  const bar = $('#ar-cmp', root); if (!bar) return;
  if (!compare.size) { bar.hidden = true; return; }
  const list = [...compare].map((id) => items.find((i) => i.id === id)).filter(Boolean);
  bar.hidden = false;
  bar.innerHTML = html`<span>Сравнение: ${list.map((i) => raw(html`<b>«${i.nick}»</b>`))}</span>
    <button type="button" class="btn sm gold" id="ar-cmp-open" ${list.length < 2 ? 'disabled' : ''}>Сравнить</button>
    <button type="button" class="btn sm" id="ar-cmp-clear">Сбросить</button>`;
  $('#ar-cmp-clear', bar).onclick = () => { compare.clear(); $$('[data-cmp]', root).forEach((b) => b.setAttribute('aria-pressed', 'false')); drawCmpBar(root, items); };
  $('#ar-cmp-open', bar).onclick = () => openCompare(list);
}

function itemCard(i, groups, mine) {
  const p = i.params || {};
  const keys = keyStats(i).slice(0, 4);
  return html`<a class="panel wiki-card ar-item" href="#/arsenal?g=${i.grp}&i=${i.id}" data-id="${i.id}" data-size="${i.size}">
    <span class="wk-ban ar-ban">${raw(itemArt(i))}</span>
    <span class="wk-body"><span class="wk-crest ar-code">${i.size}</span>
      <b>«${i.nick}»</b><small class="ar-sub"><span>${i.code}</span> · ${i.base_name}</small>
      <dl class="ar-mini">${keys.map((k) => raw(html`<div><dt>${P[k][0]}</dt><dd>${fmtv(k, p[k])}</dd></div>`))}</dl>
      <span class="ar-foot">
        ${p.type ? raw(html`<i class="ar-tag t-${p.type}">${TYPE[p.type]}</i>`) : ''}
        <i class="ar-tag">${p.w || 1}×${p.h || 1} кл.</i>
        ${i.tech_name ? raw(html`<i class="ar-tag ${mine ? (i.open ? 'ok' : 'lock') : ''}">${i.tech_name}</i>`) : ''}
        <span role="button" tabindex="0" class="ar-cmp" data-cmp="${i.id}" aria-pressed="${compare.has(i.id)}" title="Добавить к сравнению">⇄</span>
      </span>
    </span></a>`;
}

function keyStats(i) {
  const p = i.params || {};
  const pri = i.kind === 'weapon' ? ['dmg', 'heal', 'energy', 'rng', 'acc', 'pen', 'pd', 'shield_k', 'slow'] : ['radar', 'km', 'jam', 'protect', 'pd', 'acc_bonus', 'command', 'thrust', 'shield', 'stealth', 'jump', 'crew', 'cargo', 'craft', 'capacity', 'comm', 'energy'];
  const out = pri.filter((k) => p[k] != null && !(k === 'dmg' && p.type === 'repair'));
  if (!out.includes('energy') && p.energy) out.push('energy');
  return [...new Set(out), 'mass'];
}

function rows(i) {
  const p = i.params || {};
  return ORDER.filter((k) => p[k] != null && !(k === 'dmg' && p.type === 'repair' && !p.dmg));
}

function openItem(root, i, groups, mine) {
  const p = i.params || {};
  const dlg = document.createElement('dialog');
  dlg.className = 'ar-dlg panel';
  dlg.innerHTML = html`
    <button type="button" class="ib ar-x" aria-label="Закрыть">${icon('i-x')}</button>
    <div class="ar-dlg-art">${raw(itemArt(i, false, 360))}</div>
    <div class="ar-dlg-body">
      <span class="fac"><i></i>${(groups.find((g) => g.id === i.grp) || {}).title || ''}</span>
      <h2>«${i.nick}» <small>${i.code}</small></h2>
      <p class="ar-base">${i.base_name}</p>
      <p>${i.descr}</p>
      <div class="ar-foot">
        <i class="ar-tag">размер ${i.size}</i><i class="ar-tag">${p.w || 1}×${p.h || 1} клеток палубы</i>
        ${p.type ? raw(html`<i class="ar-tag t-${p.type}">${TYPE[p.type]}</i>`) : ''}
        ${i.tech_name ? raw(html`<i class="ar-tag ${mine ? (i.open ? 'ok' : 'lock') : ''}">технология «${i.tech_name}»${mine ? (i.open ? ' — изучена' : ' — не изучена') : ''}</i>`) : raw('<i class="ar-tag ok">без технологии</i>')}
      </div>
      <table class="ar-tbl"><tbody>${rows(i).map((k) => raw(html`<tr><th>${P[k][0]}</th><td>${fmtv(k, p[k])}</td></tr>`))}</tbody></table>
      ${i.in_shipyard ? '' : raw('<p class="hint ar-soon">В конструктор кораблей эта позиция подключится в следующем обновлении.</p>')}
    </div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); const h = location.hash.replace(/&i=[^&]*/, ''); if (h !== location.hash) history.replaceState(null, '', h); };
  dlg.querySelector('.ar-x').onclick = close;
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.showModal();
  const want = `#/arsenal?g=${i.grp}&i=${i.id}`;
  if (location.hash !== want) history.replaceState(null, '', want);
}

function openCompare(list) {
  const keys = ORDER.filter((k) => list.some((i) => i.params?.[k] != null));
  const best = (k) => {
    const vals = list.map((i) => i.params?.[k]).filter((v) => v != null);
    if (vals.length < 2) return null;
    return P[k][2] ? Math.max(...vals) : Math.min(...vals);
  };
  const dlg = document.createElement('dialog');
  dlg.className = 'ar-dlg ar-cmp-dlg panel';
  dlg.innerHTML = html`<button type="button" class="ib ar-x" aria-label="Закрыть">${icon('i-x')}</button>
    <h2>Сравнение</h2>
    <div class="tbl"><table class="ar-tbl ar-cmp-tbl">
      <thead><tr><th></th>${list.map((i) => raw(html`<th><span class="ar-cmp-art">${raw(itemArt(i, true))}</span>«${i.nick}»<small>${i.code} · ${i.size}</small></th>`))}</tr></thead>
      <tbody>${keys.map((k) => { const b = best(k); return raw(html`<tr><th>${P[k][0]}</th>${list.map((i) => raw(html`<td class="${b != null && i.params?.[k] === b ? 'best' : ''}">${fmtv(k, i.params?.[k])}</td>`))}</tr>`); })}</tbody>
    </table></div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('.ar-x').onclick = close;
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.showModal();
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* ══ Схемы: золотые чертежи позиций и разделов ══ */
const BG = (w, h, id) => `<defs><radialGradient id="g${id}" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#e9b949" stop-opacity=".22"/><stop offset="1" stop-color="#e9b949" stop-opacity="0"/></radialGradient>
  <pattern id="p${id}" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#e9b94914" stroke-width=".6"/></pattern></defs>
  <rect width="${w}" height="${h}" fill="#050504"/><rect width="${w}" height="${h}" fill="url(#p${id})"/><rect width="${w}" height="${h}" fill="url(#g${id})"/>`;
let uid = 0;

function barrels(i) {
  const n = i.base_name.toLowerCase();
  if (/восьмистволь/.test(n)) return 8;
  if (/шестистволь/.test(n)) return 6;
  if (/счетверён|четырехстволь|четырёхстволь/.test(n)) return 4;
  if (/сдвоен|двойн|спарен/.test(n)) return 2;
  if (/главн/.test(n) && /баллист/.test(n)) return 3;
  return 1;
}

/** Схема одной позиции. small — для гербовой плашки (без фона). */
function itemArt(i, small = false, W = 280) {
  const H = small ? W : Math.round(W * 0.47);
  const id = `a${++uid}`;
  const cx = W / 2, cy = small ? H / 2 : H * 0.6;
  const k = small ? W / 280 * 1.6 : W / 280;
  const S = { S: 0.75, M: 0.9, L: 1.05, XL: 1.2 }[i.size] || 0.9;
  const p = i.params || {};
  const L = (d, cls = '') => `<path d="${d}" class="ln ${cls}"/>`;
  const C = (x, y, r, cls = '') => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="ln ${cls}"/>`;
  const R = 22 * k * S;
  let body = '';
  const kind = i.kind;
  if (kind === 'weapon' && p.type === 'missile') {
    const n = barrels(i), cols = n >= 6 ? 3 : n >= 4 ? 2 : 1, rws = n >= 6 ? 2 : n >= 4 ? 2 : 1;
    const cw = 16 * k * S;
    const x0 = cx - (cols * cw) / 2, y0 = cy - (rws * cw) / 2;
    body += `<rect x="${(x0 - 4 * k).toFixed(1)}" y="${(y0 - 4 * k).toFixed(1)}" width="${(cols * cw + 8 * k).toFixed(1)}" height="${(rws * cw + 8 * k).toFixed(1)}" rx="${4 * k}" class="ln"/>`;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rws; b++) body += C(x0 + a * cw + cw / 2, y0 + b * cw + cw / 2, cw * 0.32, 'th') + C(x0 + a * cw + cw / 2, y0 + b * cw + cw / 2, cw * 0.1, 'fl');
    if (/шахт|торпед/.test(i.base_name)) body += L(`M${cx} ${y0 - 6 * k}v${-26 * k * S}`, 'dash');
  } else if (kind === 'weapon' && p.type === 'repair') {
    body += C(cx, cy, R, 'th');
    for (let a = 0; a < 8; a++) { const t = (a / 8) * Math.PI * 2; body += `<path d="M${(cx + Math.cos(t) * R * 1.9).toFixed(1)} ${(cy + Math.sin(t) * R * 1.9 - 4 * k).toFixed(1)}l${4 * k} ${4 * k}l${-4 * k} ${4 * k}l${-4 * k} ${-4 * k}z" class="ln fl2"/>`; }
    body += C(cx, cy, R * 1.9, 'dot') + L(`M${cx - 7 * k} ${cy}h${14 * k}M${cx} ${cy - 7 * k}v${14 * k}`, 'th');
  } else if (kind === 'weapon') {
    const n = barrels(i);
    const len = (p.rng ? Math.min(small ? 70 : 42, 22 + p.rng * 2) : 34) * k * S;
    const gap = n === 1 ? 0 : Math.min(9, 26 / n) * k * S;
    const bw = (p.type === 'energy' ? 3 : 5) * k * S;
    for (let b = 0; b < n; b++) {
      const x = cx + (b - (n - 1) / 2) * gap;
      body += `<rect x="${(x - bw / 2).toFixed(1)}" y="${(cy - R - len).toFixed(1)}" width="${bw.toFixed(1)}" height="${(len + R * 0.5).toFixed(1)}" rx="1" class="ln fl2"/>`;
      if (p.type === 'energy') body += C(x, cy - R - len - 3 * k, 3 * k * S, 'th');
      else body += `<rect x="${(x - bw / 2 - 1.5 * k).toFixed(1)}" y="${(cy - R - len - 2 * k).toFixed(1)}" width="${(bw + 3 * k).toFixed(1)}" height="${(6 * k).toFixed(1)}" class="fl"/>`;
    }
    if (/рельс|ускорит/.test(i.base_name)) body += L(`M${cx - bw * 2} ${cy - R}v${-len}M${cx + bw * 2} ${cy - R}v${-len}`);
    if (/плазм/.test(i.base_name)) body += C(cx, cy - R - len * 0.4, 8 * k * S) + C(cx, cy - R - len * 0.75, 6 * k * S);
    if (/буксир/.test(i.base_name)) body += L(`M${cx} ${cy - R - len}l${-14 * k} ${-12 * k}M${cx} ${cy - R - len}l${14 * k} ${-12 * k}`, 'dash');
    body += C(cx, cy, R, 'th') + C(cx, cy, R * 0.55) + C(cx, cy, R + 6 * k, 'dash');
  } else if (kind === 'sensor' || kind === 'comm') {
    for (let a = 1; a <= 3; a++) body += L(`M${(cx - a * 12 * k * S).toFixed(1)} ${(cy - a * 8 * k * S).toFixed(1)}A${a * 15 * k * S} ${a * 15 * k * S} 0 0 1 ${(cx + a * 12 * k * S).toFixed(1)} ${(cy - a * 8 * k * S).toFixed(1)}`, a === 1 ? 'th' : '');
    body += L(`M${cx} ${cy}v${18 * k}M${cx - 14 * k} ${cy + 18 * k}h${28 * k}`, 'th') + C(cx, cy, 4 * k, 'fl');
  } else if (kind === 'ecm') {
    for (let a = 0; a < 4; a++) body += L(`M${cx - 40 * k * S} ${(cy - 18 * k + a * 12 * k).toFixed(1)}q${10 * k * S} ${-10 * k} ${20 * k * S} 0t${20 * k * S} 0t${20 * k * S} 0t${20 * k * S} 0`, a % 2 ? 'dash' : 'th');
  } else if (kind === 'active') {
    body += C(cx, cy, R * 1.3, 'th') + L(`M${cx - R * 1.8} ${cy}h${R * 3.6}M${cx} ${cy - R * 1.8}v${R * 3.6}`) + C(cx, cy, 4 * k, 'fl');
    for (let a = 0; a < 3; a++) { const t = -Math.PI / 2 + (a - 1) * 0.7; body += `<path d="M${(cx + Math.cos(t) * R * 2.4).toFixed(1)} ${(cy + Math.sin(t) * R * 2.4).toFixed(1)}l${3 * k} ${6 * k}h${-6 * k}z" class="fl"/>`; }
  } else if (kind === 'control') {
    const s = 26 * k * S;
    body += `<rect x="${cx - s}" y="${cy - s}" width="${2 * s}" height="${2 * s}" rx="${4 * k}" class="ln th"/><rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" class="ln fl2"/>`;
    for (let a = -2; a <= 2; a++) body += L(`M${cx + a * s * 0.4} ${cy - s}v${-8 * k}M${cx + a * s * 0.4} ${cy + s}v${8 * k}M${cx - s} ${cy + a * s * 0.4}h${-8 * k}M${cx + s} ${cy + a * s * 0.4}h${8 * k}`);
  } else if (kind === 'ftl') {
    for (let a = 0; a < 3; a++) body += `<ellipse cx="${cx}" cy="${cy}" rx="${(R * (1.2 + a * 0.5)).toFixed(1)}" ry="${(R * (0.5 + a * 0.2)).toFixed(1)}" class="ln ${a ? 'dash' : 'th'}"/>`;
    body += C(cx, cy, 6 * k, 'fl');
  } else if (kind === 'engine') {
    const n = { S: 1, M: 2, L: 3, XL: 3 }[i.size] || 1;
    for (let b = 0; b < n; b++) { const y = cy + (b - (n - 1) / 2) * 18 * k; body += L(`M${cx - 24 * k} ${y - 7 * k}h${30 * k}l${16 * k} ${-5 * k}v${24 * k}l${-16 * k} ${-5 * k}h${-30 * k}z`, 'fl2') + L(`M${cx + 26 * k} ${y}h${22 * k}`, 'dash'); }
  } else if (kind === 'shield' || kind === 'cloak') {
    body += L(`M${cx - R * 1.6} ${cy + R * 0.6}A${R * 1.8} ${R * 1.8} 0 0 1 ${cx + R * 1.6} ${cy + R * 0.6}`, kind === 'cloak' ? 'dash' : 'th');
    body += L(`M${cx - R * 1.1} ${cy + R * 0.6}A${R * 1.2} ${R * 1.2} 0 0 1 ${cx + R * 1.1} ${cy + R * 0.6}`, 'dash') + L(`M${cx - R * 2} ${cy + R * 0.6}h${R * 4}`);
  } else if (kind === 'fuel_tank') {
    const w = 46 * k * S, h = 22 * k * S;
    body += `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" class="ln th"/>` + L(`M${cx - w / 4} ${cy - h / 2}v${h}M${cx + w / 4} ${cy - h / 2}v${h}`) + L(`M${cx - w / 2 + 6 * k} ${cy}h${w - 12 * k}`, 'dash');
  } else {
    const glyph = { bridge: 'М', quarters: 'Ж', cargo: 'Г', hangar: 'А' }[kind] || '•';
    const s = 24 * k * S;
    body += `<rect x="${cx - s * 1.3}" y="${cy - s}" width="${s * 2.6}" height="${2 * s}" rx="${5 * k}" class="ln th"/><text x="${cx}" y="${cy + 6 * k}" text-anchor="middle" class="gl" style="font-size:${18 * k}px">${glyph}</text>`;
  }
  if (small) return `<svg viewBox="0 0 ${W} ${H}" class="ar-art" aria-hidden="true">${body}</svg>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="ar-art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${BG(W, H, id)}${body}</svg>`;
}

/** Обложка раздела: несколько позиций раздела в ряд. */
function groupArt(grp, list) {
  const W = 280, H = 130, id = `g${++uid}`;
  const pick = list.slice(0, 3);
  const parts = pick.map((it, n) => {
    const svg = itemArt(it, true, 90);
    const x = W / 2 - (pick.length * 80) / 2 + n * 80 - 5;
    return `<g transform="translate(${x} 22)">${svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="ar-art" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${BG(W, H, id)}${parts}</svg>`;
}
