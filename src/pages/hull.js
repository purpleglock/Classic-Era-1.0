import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/hull — конструктор корпусов (сплавы брони).
 * Сервер: v1_alloy_state / v1_alloy_preview / v1_alloy_save / v1_alloy_delete.
 */

const GRP = {
  metal: ['Металлы', 'Основа брони'],
  composite: ['Композиты', 'Волокно и реактивные слои'],
  ceramic: ['Керамика', 'Держит жар, боится взрывов'],
  heavy: ['Тяжёлые металлы', 'Отражают лучи, весят много'],
  organic: ['Органика', 'Лёгкая и живучая'],
  exotic: ['Экзотика', 'Звёздные и легендарные материалы'],
};
const RARITY = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', epic: 'эпический', legendary: 'легендарный' };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const pct = (x) => `${Math.round(Number(x || 0) * 100)} %`;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

export async function renderHull(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-shield')}</span><div><h1>Конструктор корпусов</h1><p>Войдите, чтобы создавать сплавы брони своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Конструктор откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.hl-wrap')) root.innerHTML = '<div class="skeleton">Разогреваю плавильню…</div>';
  let s;
  try { s = await rpc('v1_alloy_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Конструктор недоступен</h1><p>${e.missingSchema ? 'Конструктор корпусов ещё не подключён в базе (миграция 27).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const cfg = s.settings || {};
  const MIN = cfg.min_units || 10, MAX = cfg.max_units || 100, LIMIT = cfg.max_per_faction || 12;
  const comps = s.components || [], procs = s.processes || [], alloys = s.alloys || [], archive = s.archive || [];
  const can = !!s.can_edit;
  const st = { recipe: {}, process: 'cast', edit: null, calc: null, seq: 0 };
  const groups = Object.keys(GRP).map((g) => [g, comps.filter((c) => c.grp === g)]).filter(([, l]) => l.length);

  root.innerHTML = html`<div class="hl-wrap fu-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Конструктор корпусов</h1>
        <p>Сплавьте броню из ресурсов державы и выберите способ обработки. <b>Тяжёлая броня держит удар, но тормозит корабль</b> — лучшие сплавы находят баланс.</p>
      </div>
      <div class="col-treasury"><small>Сплавов державы</small><b>${alloys.length} из ${LIMIT}</b></div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но регистрировать сплавы могут только правитель и члены державы с правом «Производство».</p>')}

    <div class="fu-grid hl-grid">
      <section class="panel fu-mix" aria-labelledby="hl-mix-h">
        <div class="fu-head"><h2 id="hl-mix-h">Состав сплава</h2>
          <span class="fu-total" id="hl-total"></span>
          <button type="button" class="btn sm" id="hl-reset" ${can ? '' : 'disabled'}>Сбросить</button></div>
        <p class="hint">От ${MIN} до ${MAX} единиц. Регистрация ресурсы не списывает: они тратятся при постройке кораблей.</p>
        ${groups.map(([g, list]) => raw(html`<div class="fu-grp"><h3>${GRP[g][0]}<small>${GRP[g][1]}</small></h3>
          ${list.map((c) => raw(html`<div class="fu-row" data-res="${c.res}">
            <div class="fu-res"><b><i class="r-${c.rarity || 'common'}" title="${RARITY[c.rarity] || ''}"></i>${c.res}</b>
              <small>${c.role} · на складе ${num(c.stock)}</small>
              <p class="fu-note">${c.note}</p></div>
            <div class="fu-props hl-props" aria-hidden="true">
              <span title="Кинетика">К ${pct(c.k)}</span><span title="Энергия">Э ${pct(c.en)}</span><span title="Ракеты">Р ${pct(c.mi)}</span><span title="Плотность" class="${c.dens > 7 ? 'bad' : ''}">${fmt(c.dens)} г/см³</span>
            </div>
            <div class="fu-step">
              <button type="button" class="ib sm" data-d="-5" aria-label="Меньше ${c.res}" ${can ? '' : 'disabled'}>−</button>
              <input type="number" min="0" max="${MAX}" step="1" inputmode="numeric" value="0" aria-label="${c.res}, единиц" ${can ? '' : 'disabled'}>
              <button type="button" class="ib sm" data-d="5" aria-label="Больше ${c.res}" ${can ? '' : 'disabled'}>+</button>
            </div>
            <div class="fu-share"><i></i></div>
          </div>`))}
        </div>`))}

        <div class="fu-grp"><h3>Способ обработки<small>Меняет профиль стойкости и цену</small></h3>
          <div class="rx-opts" role="radiogroup" id="hl-proc">${procs.map((p) => raw(html`
            <button type="button" role="radio" class="rx-opt" data-id="${p.id}" ${p.open && can ? '' : 'disabled'} aria-checked="false">
              <b>${p.name}</b><small>${p.descr}</small>
              ${p.open ? raw(procChips(p.params)) : raw(html`<em class="rx-lock">${icon('i-shield')}Нужна технология «${p.tech_name || p.tech}»</em>`)}
            </button>`))}</div>
        </div>
      </section>

      <aside class="panel fu-card" aria-live="polite">
        <h2>Паспорт сплава</h2>
        <figure class="hl-plate" id="hl-plate"></figure>
        <div id="hl-out"><p class="empty">Добавьте компоненты — здесь появятся характеристики.</p></div>
        <form id="hl-form" class="fu-form">
          <label for="hl-name">Название сплава</label>
          <input id="hl-name" maxlength="48" placeholder="Например: Бастион-4" ${can ? '' : 'disabled'}>
          <div class="fu-acts">
            <button type="submit" class="btn gold" id="hl-save" disabled>Зарегистрировать</button>
            <button type="button" class="btn" id="hl-cancel" hidden>Отменить правку</button>
          </div>
        </form>
      </aside>
    </div>
    <a class="fu-mini" id="hl-mini" href="#hl-plate" hidden></a>

    <section class="panel fu-list hl-list" aria-labelledby="hl-list-h">
      <h2 id="hl-list-h">Сплавы державы</h2>
      ${alloys.length ? raw(html`<div class="fu-cards">${alloys.map((a) => raw(alloyCard(a, procs, can)))}</div>`)
        : raw('<p class="empty">Пока ни одного. Соберите сплав выше и зарегистрируйте первый.</p>')}
    </section>

    ${archive.length ? raw(html`<section class="panel fu-list rx-arch" aria-labelledby="hl-arch-h">
      <h2 id="hl-arch-h">Архив: сплавы старого образца</h2>
      <p class="hint">Корабли с этой бронёй продолжают служить до переработки конструктора кораблей. Создавать и менять такие сплавы больше нельзя.</p>
      <div class="tbl"><table><thead><tr><th>Название</th><th>Оценка</th><th>Кинетика</th><th>Энергия</th><th>Ракеты</th><th>Прочность</th></tr></thead><tbody>
        ${archive.map((a) => raw(html`<tr><td>${a.name}</td><td>${a.grade ?? '—'}</td><td>${pct(a.resist?.kinetic)}</td><td>${pct(a.resist?.energy)}</td><td>${pct(a.resist?.missile)}</td><td>+${pct(a.hp)}</td></tr>`))}
      </tbody></table></div>
    </section>`) : ''}
  </div>`;

  const rows = $$('.fu-row', root);
  const out = $('#hl-out', root), plate = $('#hl-plate', root), totalEl = $('#hl-total', root), save = $('#hl-save', root);
  const nameEl = $('#hl-name', root), cancel = $('#hl-cancel', root), mini = $('#hl-mini', root);
  const total = () => Object.values(st.recipe).reduce((a, b) => a + b, 0);

  const sync = () => {
    const t = total();
    for (const r of rows) {
      const v = st.recipe[r.dataset.res] || 0, inp = $('input', r);
      if (Number(inp.value) !== v && document.activeElement !== inp) inp.value = v;
      $('.fu-share i', r).style.width = `${t ? (v / t) * 100 : 0}%`;
      r.classList.toggle('on', v > 0);
    }
    for (const b of $$('#hl-proc [role=radio]', root)) b.setAttribute('aria-checked', String(b.dataset.id === st.process));
    totalEl.textContent = `${t} ед.`;
    totalEl.className = `fu-total ${t && (t < MIN || t > MAX) ? 'bad' : ''}`;
    plate.innerHTML = plateSvg(st.recipe, comps);
    recalc();
  };

  let timer;
  const recalc = () => {
    clearTimeout(timer);
    const recipe = Object.fromEntries(Object.entries(st.recipe).filter(([, v]) => v > 0));
    if (!Object.keys(recipe).length) { st.calc = null; paint(); return; }
    timer = setTimeout(async () => {
      const my = ++st.seq;
      const r = await rpc('v1_alloy_preview', { p_recipe: recipe, p_process: st.process }).catch((e) => ({ ok: false, error: e.message }));
      if (my !== st.seq) return;
      st.calc = r; paint();
    }, 220);
  };

  const paint = () => {
    const c = st.calc;
    save.disabled = !can || !c?.ok || !c.registrable || nameEl.value.trim().length < 3;
    mini.hidden = true;
    if (!c) { out.innerHTML = '<p class="empty">Добавьте компоненты — здесь появятся характеристики.</p>'; return; }
    if (!c.ok) {
      out.innerHTML = html`<p class="empty warn">${c.error === 'alloy_total' ? `В сплаве должно быть от ${c.min} до ${c.max} единиц, сейчас ${c.total}.` : 'Сплав пока не собран.'}</p>`;
      return;
    }
    out.innerHTML = passport(c);
    mini.hidden = false;
    mini.innerHTML = html`<b>${c.grade}</b><span>${c.tier}</span><span>К ${pct(c.resist.kinetic)}</span><span>Э ${pct(c.resist.energy)}</span><span>Р ${pct(c.resist.missile)}</span><span class="${c.speed < 0 ? 'bad' : ''}">скор. ${signed(c.speed)} %</span>`;
    mini.onclick = (e) => { e.preventDefault(); plate.scrollIntoView({ behavior: 'smooth' }); };
  };

  for (const r of rows) {
    const res = r.dataset.res, inp = $('input', r);
    const set = (v) => { v = Math.max(0, Math.min(MAX, Math.round(Number(v) || 0))); if (v) st.recipe[res] = v; else delete st.recipe[res]; sync(); };
    $$('button[data-d]', r).forEach((b) => { b.onclick = () => set((st.recipe[res] || 0) + Number(b.dataset.d)); });
    inp.oninput = () => set(inp.value);
    inp.onblur = () => { inp.value = st.recipe[res] || 0; };
  }
  $('#hl-proc', root).onclick = (e) => { const b = e.target.closest('[role=radio]'); if (!b || b.disabled) return; st.process = b.dataset.id; sync(); };
  $('#hl-reset', root).onclick = () => { st.recipe = {}; sync(); };
  nameEl.oninput = () => paint();

  const load = (a, copy) => {
    st.edit = copy ? null : a.id; st.recipe = { ...a.recipe }; st.process = a.process || 'cast';
    nameEl.value = copy ? '' : a.name; save.textContent = copy ? 'Зарегистрировать' : 'Сохранить изменения'; cancel.hidden = copy;
    sync(); $('.hl-grid', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  cancel.onclick = () => { st.edit = null; nameEl.value = ''; save.textContent = 'Зарегистрировать'; cancel.hidden = true; paint(); };

  $('#hl-form', root).onsubmit = async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await rpc('v1_alloy_save', { p_id: st.edit, p_name: nameEl.value, p_recipe: st.recipe, p_process: st.process });
      toast(st.edit ? 'Сплав обновлён' : `Сплав «${nameEl.value.trim()}» зарегистрирован`);
      renderHull(root);
    } catch (err) { toast(err.message, 'err'); paint(); }
  };

  $('.hl-list', root).onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const a = alloys.find((x) => x.id === b.closest('[data-id]').dataset.id); if (!a) return;
    if (b.dataset.act === 'edit') load(a, false);
    if (b.dataset.act === 'copy') load(a, true);
    if (b.dataset.act === 'del') {
      if (!(await confirmBox(`Удалить сплав «${a.name}»?`, 'Удалить'))) return;
      try { await rpc('v1_alloy_delete', { p_id: a.id }); toast('Сплав удалён'); renderHull(root); } catch (err) { toast(err.message, 'err'); }
    }
  };

  sync();
}

function procChips(p) {
  const d = (x) => Math.round((x - 1) * 100);
  const list = [['К', p.k], ['Э', p.en], ['Р', p.mi], ['прочн.', p.hp]].filter(([, v]) => v !== 1)
    .map(([t, v]) => [`${t} ${d(v) > 0 ? '+' : '−'}${Math.abs(d(v))} %`, v > 1 ? 'good' : 'bad']);
  list.push([`цена ×${fmt(p.cost, 2)}`, p.cost > 1.5 ? 'bad' : '']);
  return html`<span class="rx-chips">${list.map(([t, c]) => raw(html`<i class="${c}">${t}</i>`))}</span>`;
}

/** Треугольник стойкости: кинетика, энергия, ракеты. */
function triangle(r) {
  const cx = 70, cy = 74, R = 56;
  const ang = [-90, 30, 150].map((a) => (a * Math.PI) / 180);
  const pt = (a, v) => [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  const vals = [r.kinetic, r.energy, r.missile].map((v) => Math.max(0.02, Math.min(1, (Number(v) || 0) / 0.9)));
  const poly = ang.map((a, i) => pt(a, vals[i]).map((x) => x.toFixed(1)).join(',')).join(' ');
  const grid = [0.33, 0.66, 1].map((v) => `<polygon points="${ang.map((a) => pt(a, v).map((x) => x.toFixed(1)).join(',')).join(' ')}" class="gr"/>`).join('');
  const lbl = [['Кинетика', r.kinetic], ['Энергия', r.energy], ['Ракеты', r.missile]];
  const lp = ang.map((a) => pt(a, 1.22));
  return `<svg viewBox="0 0 140 150" class="hl-tri" role="img" aria-label="Стойкость: кинетика ${pct(r.kinetic)}, энергия ${pct(r.energy)}, ракеты ${pct(r.missile)}">
    ${grid}${ang.map((a) => { const [x, y] = pt(a, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="gr"/>`; }).join('')}
    <polygon points="${poly}" class="sh"/>
    ${lbl.map(([t, v], i) => `<text x="${lp[i][0].toFixed(1)}" y="${(lp[i][1] + (i ? 4 : 2)).toFixed(1)}" text-anchor="middle"><tspan class="t">${t}</tspan><tspan x="${lp[i][0].toFixed(1)}" dy="11" class="v">${pct(v)}</tspan></text>`).join('')}
  </svg>`;
}

/** Разрез бронеплиты: слои по долям компонентов, толщина — от плотности. */
function plateSvg(recipe, comps) {
  const items = comps.filter((c) => recipe[c.res] > 0).map((c) => ({ c, v: recipe[c.res] }));
  const total = items.reduce((a, b) => a + b.v, 0);
  if (!total) return '<div class="hl-plate-empty">разрез бронеплиты появится здесь</div>';
  const shade = { metal: '#c9a14a', composite: '#8f7a4a', ceramic: '#e6d3a1', heavy: '#ffe08a', organic: '#7a6233', exotic: '#ffd97a' };
  let x = 0;
  const W = 300, H = 46;
  const segs = items.map(({ c, v }) => {
    const w = (v / total) * W, seg = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${shade[c.grp] || '#c9a14a'}" opacity="${0.35 + Math.min(0.6, c.dens / 22)}"><title>${c.res}: ${v} ед.</title></rect>`
      + (w > 34 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H / 2 + 4}" text-anchor="middle">${c.res.length > 10 ? c.res.slice(0, 9) + '…' : c.res}</text>` : '');
    x += w; return seg;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="hl-svg" preserveAspectRatio="none" role="img" aria-label="Разрез бронеплиты">${segs}</svg>
    <figcaption>разрез бронеплиты · слои по долям сплава</figcaption>`;
}

function passport(c) {
  const g = Number(c.grade) || 0, circ = 2 * Math.PI * 34;
  return html`
    <div class="fu-top">
      <div class="fu-ring" title="Оценка: защита против веса">
        <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="bg"/><circle cx="40" cy="40" r="34" class="fg" style="stroke-dasharray:${circ};stroke-dashoffset:${circ * (1 - g / 100)}"/></svg>
        <b>${g}</b><small>${c.tier}</small>
      </div>
      <div class="fu-id">
        <span class="fu-cls">${GRP[c.class]?.[0] || c.class}</span>
        <span class="fu-stab">${c.process_name}</span>
        <p class="hint">${c.total} ед. · ${c.kinds} комп.</p>
      </div>
    </div>
    <div class="hl-tri-wrap">${raw(triangle(c.resist))}</div>
    <dl class="fu-derived">
      <div><dt>Прочность корпуса</dt><dd class="good">+${pct(c.hpPercentBoost)}</dd></div>
      <div><dt>Плотность</dt><dd class="${c.density > 7 ? 'warn' : ''}">${fmt(c.density, 2)}<small>г/см³ · ×${fmt(c.mass_factor, 2)} к стали</small></dd></div>
      <div><dt>Скорость корабля</dt><dd class="${c.speed < 0 ? 'bad' : c.speed > 0 ? 'good' : ''}">${signed(c.speed)} %</dd></div>
      <div><dt>Места в корпусе</dt><dd class="${c.capacityBoost < 0 ? 'bad' : 'good'}">${signed(c.capacityBoost)}</dd></div>
      <div><dt>Жаростойкость</dt><dd>${num(c.heat)} °C</dd></div>
      <div><dt>${c.regen ? 'Регенерация' : 'Себестоимость'}</dt><dd>${c.regen ? raw(html`${fmt(c.regen)} %<small>брони за ход</small>`) : raw(html`${fmt(c.cost, 2)} ГС<small>за единицу</small>`)}</dd></div>
    </dl>
    ${c.traits?.length ? raw(html`<ul class="fu-traits">${c.traits.map((t) => raw(html`<li>${icon('i-spark')}${t}</li>`))}</ul>`) : ''}
    ${c.warnings?.length ? raw(html`<ul class="fu-warns">${c.warnings.map((w) => raw(html`<li>${w}</li>`))}</ul>`) : ''}`;
}

function alloyCard(a, procs, can) {
  const c = a.stats || {}, r = c.resist || {};
  return html`<article class="fu-fuel" data-id="${a.id}">
    <header><div><b>${a.name}</b><small>${GRP[c.class]?.[0] || ''} · ${procs.find((p) => p.id === a.process)?.name || ''}</small></div><span class="fu-grade">${c.grade}<small>${c.tier}</small></span></header>
    <dl><div><dt>Кинетика</dt><dd>${pct(r.kinetic)}</dd></div><div><dt>Энергия</dt><dd>${pct(r.energy)}</dd></div>
      <div><dt>Ракеты</dt><dd>${pct(r.missile)}</dd></div><div><dt>Прочность</dt><dd>+${pct(c.hpPercentBoost)}</dd></div></dl>
    <ul class="chips-res">${Object.entries(a.recipe || {}).map(([k, v]) => raw(html`<li><i></i>${k} <b>${v}</b></li>`))}</ul>
    ${can ? raw(html`<div class="fu-acts"><button type="button" class="btn sm" data-act="edit">Изменить</button><button type="button" class="btn sm" data-act="copy">Взять за основу</button><button type="button" class="btn sm danger" data-act="del">Удалить</button></div>`) : ''}
  </article>`;
}
