import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/fuel — конструктор топлива.
 * Сервер: v1_fuel_state / v1_fuel_calc / v1_fuel_save / v1_fuel_delete.
 * Предпросмотр считает сама база (v1_fuel_calc), поэтому цифры на сайте
 * совпадают с тем, что будет записано при регистрации.
 */

const GRP = {
  chem: ['Химическое', 'Дёшево, сильная тяга, мало энергии'],
  mass: ['Рабочее тело', 'Охлаждает и стабилизирует смесь'],
  ion: ['Ионное', 'Экономично, но медленно'],
  nuclear: ['Ядерное', 'Мощно, нужен охладитель'],
  fusion: ['Термоядерное', 'Основа дальнего флота'],
  exotic: ['Экзотика', 'Предельная энергия или стабилизация'],
};
const RARITY = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', epic: 'эпический', legendary: 'легендарный' };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

export async function renderFuel(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-fuel')}</span><div><h1>Конструктор топлива</h1><p>Войдите, чтобы создавать марки топлива своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Конструктор откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.fu-wrap')) root.innerHTML = '<div class="skeleton">Открываю топливную лабораторию…</div>';
  let s;
  try { s = await rpc('v1_fuel_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Конструктор недоступен</h1><p>${e.missingSchema ? 'Конструктор топлива ещё не подключён в базе (миграция 24).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const cfg = s.settings || {};
  const MIN = cfg.min_units || 10, MAX = cfg.max_units || 100, LIMIT = cfg.max_per_faction || 10;
  const comps = s.components || [];
  const fuels = s.fuels || [];
  const tanks = s.tanks || [];
  const st = { recipe: {}, edit: null, name: '', calc: null, seq: 0 };
  const can = !!s.can_edit;

  const groups = Object.keys(GRP).map((g) => [g, comps.filter((c) => c.grp === g)]).filter(([, list]) => list.length);

  root.innerHTML = html`<div class="fu-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Конструктор топлива</h1>
        <p>Смешайте ресурсы и зарегистрируйте марку для своих кораблей. Чем больше энергии, тем выше риск взрыва — <b>лучшие марки находят золотую середину</b>.</p>
      </div>
      <div class="col-treasury"><small>Марок державы</small><b>${fuels.length} из ${LIMIT}</b></div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но регистрировать топливо могут только правитель и члены державы с правом «Производство».</p>')}

    <div class="fu-grid">
      <section class="panel fu-mix" aria-labelledby="fu-mix-h">
        <div class="fu-head"><h2 id="fu-mix-h">Состав смеси</h2>
          <span class="fu-total" id="fu-total"></span>
          <button type="button" class="btn sm" id="fu-reset" ${can ? '' : 'disabled'}>Сбросить</button></div>
        <p class="hint">От ${MIN} до ${MAX} единиц. Доля каждого ресурса считается от общей суммы. Регистрация ресурсы не списывает: они тратятся при заправке кораблей.</p>
        ${groups.map(([g, list]) => raw(html`<div class="fu-grp"><h3>${GRP[g][0]}<small>${GRP[g][1]}</small></h3>
          ${list.map((c) => raw(html`<div class="fu-row" data-res="${c.res}">
            <div class="fu-res"><b><i class="r-${c.rarity || 'common'}" title="${RARITY[c.rarity] || ''}"></i>${c.res}</b>
              <small>${c.role} · на складе ${num(c.stock)}</small>
              <p class="fu-note">${c.note}</p></div>
            <div class="fu-props" aria-hidden="true">
              <span title="Энергия на 100 % смеси">Э ${c.e}</span><span title="Вклад в стабильность" class="${c.s < 0 ? 'bad' : ''}">С ${signed(Number(c.s))}</span>
            </div>
            <div class="fu-step">
              <button type="button" class="ib sm" data-d="-5" aria-label="Меньше ${c.res}" ${can ? '' : 'disabled'}>−</button>
              <input type="number" min="0" max="${MAX}" step="1" inputmode="numeric" value="0" aria-label="${c.res}, единиц" ${can ? '' : 'disabled'}>
              <button type="button" class="ib sm" data-d="5" aria-label="Больше ${c.res}" ${can ? '' : 'disabled'}>+</button>
            </div>
            <div class="fu-share"><i></i></div>
          </div>`))}
        </div>`))}
      </section>

      <aside class="panel fu-card" aria-labelledby="fu-card-h" aria-live="polite">
        <h2 id="fu-card-h">Паспорт марки</h2>
        <div id="fu-out"><p class="empty">Добавьте компоненты — здесь появятся характеристики.</p></div>
        <form id="fu-form" class="fu-form">
          <label for="fu-name">Название марки</label>
          <input id="fu-name" maxlength="48" placeholder="Например: Горизонт-2" ${can ? '' : 'disabled'}>
          <div class="fu-acts">
            <button type="submit" class="btn gold" id="fu-save" disabled>Зарегистрировать</button>
            <button type="button" class="btn" id="fu-cancel" hidden>Отменить правку</button>
          </div>
        </form>
      </aside>
    </div>

    <a class="fu-mini" id="fu-mini" href="#fu-card-h" hidden></a>

    <section class="panel fu-list" aria-labelledby="fu-list-h">
      <h2 id="fu-list-h">Марки державы</h2>
      ${fuels.length ? raw(html`<div class="fu-cards">${fuels.map((f) => raw(fuelCard(f, can)))}</div>`)
        : raw('<p class="empty">Пока ни одной марки. Соберите смесь выше и зарегистрируйте первую.</p>')}
    </section>

    <section class="panel fu-tanks" aria-labelledby="fu-tanks-h">
      <h2 id="fu-tanks-h">Модуль «Топливный бак»</h2>
      <p class="hint">Баки войдут в переработанный конструктор кораблей. Дальность и риск ниже посчитаны для смеси, которая сейчас собрана.</p>
      <div class="fu-tank-grid" id="fu-tanks"></div>
    </section>
  </div>`;

  const rows = $$('.fu-row', root);
  const out = $('#fu-out', root), totalEl = $('#fu-total', root), save = $('#fu-save', root), nameEl = $('#fu-name', root), cancel = $('#fu-cancel', root), mini = $('#fu-mini', root);

  const total = () => Object.values(st.recipe).reduce((a, b) => a + b, 0);
  const sync = () => {
    const t = total();
    for (const r of rows) {
      const v = st.recipe[r.dataset.res] || 0;
      const inp = $('input', r);
      if (Number(inp.value) !== v && document.activeElement !== inp) inp.value = v;
      $('.fu-share i', r).style.width = `${t ? (v / t) * 100 : 0}%`;
      r.classList.toggle('on', v > 0);
    }
    totalEl.textContent = `${t} ед.`;
    totalEl.className = `fu-total ${t && (t < MIN || t > MAX) ? 'bad' : ''}`;
    recalc();
  };

  let timer;
  const recalc = () => {
    clearTimeout(timer);
    const recipe = Object.fromEntries(Object.entries(st.recipe).filter(([, v]) => v > 0));
    if (!Object.keys(recipe).length) { st.calc = null; paint(); return; }
    timer = setTimeout(async () => {
      const my = ++st.seq;
      const r = await rpc('v1_fuel_calc', { p_recipe: recipe }).catch((e) => ({ ok: false, error: e.message }));
      if (my !== st.seq) return;
      st.calc = r; paint();
    }, 220);
  };

  const paint = () => {
    const c = st.calc;
    save.disabled = !can || !c?.ok || !c.registrable || nameEl.value.trim().length < 3;
    mini.hidden = true;
    if (!c) { out.innerHTML = '<p class="empty">Добавьте компоненты — здесь появятся характеристики.</p>'; drawTanks(null); return; }
    if (!c.ok) {
      const msg = c.error === 'fuel_total' ? `В смеси должно быть от ${c.min} до ${c.max} единиц, сейчас ${c.total}.` : 'Смесь пока не собрана.';
      out.innerHTML = html`<p class="empty warn">${msg}</p>`; drawTanks(null); return;
    }
    out.innerHTML = passport(c);
    drawTanks(c);
    mini.hidden = false;
    mini.onclick = (e) => { e.preventDefault(); $('#fu-card-h', root).scrollIntoView({ behavior: 'smooth' }); };
    mini.innerHTML = html`<b>${c.grade}</b><span>${c.tier}</span><span>Э ${fmt(c.energy)}</span><span class="${stabCls(c.stability)}">С ${fmt(c.stability)}</span><span>риск ${fmt(c.risk)} %</span>`;
  };

  const drawTanks = (c) => {
    $('#fu-tanks', root).innerHTML = tanks.map((t) => {
      const p = t.params || {};
      const jumps = c ? Math.max(c.energy > 0 ? 1 : 0, Math.floor((p.capacity * c.energy * c.efficiency) / (cfg.jump_energy || 300))) : null;
      const risk = c ? Math.min(100, c.risk * (p.risk || 1)) : null;
      return html`<article class="fu-tank"><header><b>${t.name}</b><span class="cbadge">${t.size}</span></header>
        <p>${t.descr}</p>
        <dl><div><dt>Объём</dt><dd>${p.capacity} ед.</dd></div><div><dt>Масса</dt><dd>${p.mass} т</dd></div>
          <div><dt>Места в корпусе</dt><dd>${p.slots}</dd></div><div><dt>Прочность</dt><dd>${p.hp}</dd></div>
          <div><dt>Риск детонации</dt><dd>×${fmt(p.risk, 2)}</dd></div><div><dt>Цена</dt><dd>${num(p.cost)} ГС</dd></div></dl>
        ${c ? raw(html`<p class="fu-tank-now">С этой смесью: <b>${jumps} ${plural(jumps, 'прыжок', 'прыжка', 'прыжков')}</b> · риск при пробитии <b class="${risk >= 25 ? 'bad' : ''}">${fmt(risk)} %</b> · заправка ≈ ${num(c.cost * p.capacity)} ГС</p>`) : ''}
      </article>`;
    }).join('');
  };

  for (const r of rows) {
    const res = r.dataset.res, inp = $('input', r);
    const set = (v) => { v = Math.max(0, Math.min(MAX, Math.round(Number(v) || 0))); if (v) st.recipe[res] = v; else delete st.recipe[res]; sync(); };
    $$('button[data-d]', r).forEach((b) => { b.onclick = () => set((st.recipe[res] || 0) + Number(b.dataset.d)); });
    inp.oninput = () => set(inp.value);
    inp.onblur = () => { inp.value = st.recipe[res] || 0; };
  }
  $('#fu-reset', root).onclick = () => { st.recipe = {}; sync(); };
  nameEl.oninput = () => paint();

  const startEdit = (f) => {
    st.edit = f.id; st.recipe = { ...f.recipe };
    nameEl.value = f.name; save.textContent = 'Сохранить изменения'; cancel.hidden = false;
    sync(); $('.fu-grid', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const stopEdit = () => { st.edit = null; nameEl.value = ''; save.textContent = 'Зарегистрировать'; cancel.hidden = true; paint(); };
  cancel.onclick = () => { st.recipe = {}; stopEdit(); sync(); };

  $('#fu-form', root).onsubmit = async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await rpc('v1_fuel_save', { p_id: st.edit, p_name: nameEl.value, p_recipe: st.recipe });
      toast(st.edit ? 'Марка обновлена' : `Марка «${nameEl.value.trim()}» зарегистрирована`);
      renderFuel(root);
    } catch (err) { toast(err.message, 'err'); paint(); }
  };

  $('.fu-list', root).onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const f = fuels.find((x) => x.id === b.closest('[data-id]').dataset.id); if (!f) return;
    if (b.dataset.act === 'edit') startEdit(f);
    if (b.dataset.act === 'copy') { st.edit = null; st.recipe = { ...f.recipe }; nameEl.value = ''; save.textContent = 'Зарегистрировать'; cancel.hidden = true; sync(); $('.fu-grid', root).scrollIntoView({ behavior: 'smooth' }); }
    if (b.dataset.act === 'del') {
      if (!(await confirmBox(`Удалить марку «${f.name}»? Формула пропадёт.`, 'Удалить'))) return;
      try { await rpc('v1_fuel_delete', { p_id: f.id }); toast('Марка удалена'); renderFuel(root); } catch (err) { toast(err.message, 'err'); }
    }
  };

  sync();
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function bar(label, value, max, cls = '', text = fmt(value)) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return html`<div class="fu-bar ${cls}"><span>${label}</span><b>${text}</b><i><em style="width:${w}%"></em></i></div>`;
}

function stabCls(s) { return s >= 75 ? 'good' : s >= 50 ? '' : s >= 25 ? 'warn' : 'bad'; }

function passport(c) {
  const g = Number(c.grade) || 0;
  const circ = 2 * Math.PI * 34;
  return html`
    <div class="fu-top">
      <div class="fu-ring" title="Оценка марки: энергия, стабильность и экономичность вместе">
        <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="bg"/><circle cx="40" cy="40" r="34" class="fg" style="stroke-dasharray:${circ};stroke-dashoffset:${circ * (1 - g / 100)}"/></svg>
        <b>${g}</b><small>${c.tier}</small>
      </div>
      <div class="fu-id">
        <span class="fu-cls">${GRP[c.class]?.[0] || c.class} топливо</span>
        <span class="fu-stab ${stabCls(c.stability)}">${c.stab_tier}</span>
        <p class="hint">${c.total} ед. · ${c.kinds} ${plural(c.kinds, 'компонент', 'компонента', 'компонентов')}</p>
      </div>
    </div>
    ${raw(bar('Энергия', c.energy, 150))}
    ${raw(bar('Стабильность', c.stability, 100, stabCls(c.stability)))}
    ${raw(bar('Тяга', c.thrust, 1.6, '', fmt(c.thrust, 2)))}
    <dl class="fu-derived">
      <div><dt>Дальность</dt><dd>${c.jumps} ${plural(c.jumps, 'прыжок', 'прыжка', 'прыжков')}<small>на стандартный бак</small></dd></div>
      <div><dt>Скорость</dt><dd class="${c.speed < 0 ? 'bad' : c.speed > 0 ? 'good' : ''}">${signed(c.speed)} %</dd></div>
      <div><dt>Риск детонации</dt><dd class="${c.risk >= 25 ? 'bad' : c.risk >= 10 ? 'warn' : ''}">${fmt(c.risk)} %<small>при пробитии бака</small></dd></div>
      <div><dt>Сила взрыва</dt><dd>${c.blast} %<small>прочности корабля</small></dd></div>
      <div><dt>Экономичность</dt><dd>×${fmt(c.efficiency, 2)}</dd></div>
      <div><dt>Себестоимость</dt><dd>${fmt(c.cost, 2)} ГС<small>за единицу</small></dd></div>
    </dl>
    ${c.traits?.length ? raw(html`<ul class="fu-traits">${c.traits.map((t) => raw(html`<li>${icon('i-spark')}${t}</li>`))}</ul>`) : ''}
    ${c.warnings?.length ? raw(html`<ul class="fu-warns">${c.warnings.map((w) => raw(html`<li>${w}</li>`))}</ul>`) : ''}`;
}

function fuelCard(f, can) {
  const c = f.stats || {};
  return html`<article class="fu-fuel" data-id="${f.id}">
    <header><div><b>${f.name}</b><small>${GRP[c.class]?.[0] || ''} · ${c.stab_tier || ''}</small></div><span class="fu-grade">${c.grade}<small>${c.tier}</small></span></header>
    <dl><div><dt>Энергия</dt><dd>${fmt(c.energy)}</dd></div><div><dt>Стабильность</dt><dd class="${stabCls(c.stability)}">${fmt(c.stability)}</dd></div>
      <div><dt>Дальность</dt><dd>${c.jumps}</dd></div><div><dt>Риск</dt><dd>${fmt(c.risk)} %</dd></div></dl>
    <ul class="chips-res">${Object.entries(f.recipe || {}).map(([k, v]) => raw(html`<li><i></i>${k} <b>${v}</b></li>`))}</ul>
    ${can ? raw(html`<div class="fu-acts"><button type="button" class="btn sm" data-act="edit">Изменить</button><button type="button" class="btn sm" data-act="copy">Взять за основу</button><button type="button" class="btn sm danger" data-act="del">Удалить</button></div>`) : ''}
  </article>`;
}
