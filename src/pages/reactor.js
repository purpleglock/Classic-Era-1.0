import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/reactor — конструктор реактора.
 * Сервер: v1_reactor_state / v1_reactor_preview / v1_reactor_save / v1_reactor_delete.
 * Реактор = принцип + размер + топливо + охлаждение + преобразователь + режим.
 * Предпросмотр считает база, поэтому цифры совпадают с регистрацией.
 */

const FAM = { nuclear: 'ядерное', fusion: 'термоядерное', exotic: 'экзотическое', chem: 'химическое', ion: 'ионное', mass: 'рабочее тело' };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const ERR = {
  reactor_fuel_class: (c) => `Это топливо (${FAM[c.class] || c.class}) реактор не примет. Нужно: ${(c.need || []).map((x) => FAM[x] || x).join(', ')}.`,
  reactor_fuel_unstable: (c) => `«${c.fuel}» в чистом виде слишком нестабилен. Сделайте из него марку в конструкторе топлива.`,
  reactor_fuel_missing: () => 'Выберите топливо.',
  reactor_mode: (c) => `Режим этого реактора — не выше ${c.max} %.`,
  reactor_incomplete: () => 'Соберите все узлы.',
};

export async function renderReactor(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-spark')}</span><div><h1>Конструктор реактора</h1><p>Войдите, чтобы проектировать реакторы своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Конструктор откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.rx-wrap')) root.innerHTML = '<div class="skeleton">Разворачиваю чертёжную…</div>';
  let s;
  try { s = await rpc('v1_reactor_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Конструктор недоступен</h1><p>${e.missingSchema ? 'Конструктор реактора ещё не подключён в базе (миграция 25).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const cfgS = s.settings || {};
  const LIMIT = cfgS.max_per_faction || 12, MMIN = cfgS.mode_min || 60, MMAX = cfgS.mode_max || 140;
  const parts = s.parts || [];
  const of = (k) => parts.filter((p) => p.kind === k);
  const part = (k, id) => parts.find((p) => p.kind === k && p.id === id);
  const types = of('type'), sizes = of('size'), cools = of('cool'), convs = of('conv');
  const fuels = s.fuels || [], rawF = s.raw || [], reactors = s.reactors || [], archive = s.archive || [];
  const can = !!s.can_edit;

  const firstOpen = (list) => (list.find((p) => p.open) || list[0])?.id;
  const st = {
    cfg: { type: firstOpen(types), size: 'M', cool: 'radiator', conv: 'thermal', mode: 100, fuel: null },
    edit: null, calc: null, seq: 0,
  };
  const pickFuel = () => {
    const fam = part('type', st.cfg.type)?.params?.fuels || [];
    const cur = st.cfg.fuel;
    const ok = (f) => f && fam.includes(f.class);
    if (cur?.kind === 'fuel' && ok(fuels.find((f) => f.id === cur.id))) return;
    if (cur?.kind === 'res' && ok(rawF.find((r) => r.res === cur.res && r.ok))) return;
    const m = fuels.filter(ok).sort((a, b) => b.grade - a.grade)[0];
    if (m) { st.cfg.fuel = { kind: 'fuel', id: m.id }; return; }
    const r = rawF.find((x) => x.ok && ok(x));
    st.cfg.fuel = r ? { kind: 'res', res: r.res } : null;
  };
  pickFuel();

  const cards = (kind, list) => html`<div class="rx-opts" role="radiogroup" data-kind="${kind}">${list.map((p) => raw(html`
    <button type="button" role="radio" class="rx-opt" data-id="${p.id}" ${p.open && can ? '' : 'disabled'} aria-checked="false">
      <b>${p.name}</b><small>${p.descr}</small>
      ${p.open ? raw(chips(kind, p.params)) : raw(html`<em class="rx-lock">${icon('i-shield')}Нужна технология «${p.tech_name || p.tech}»</em>`)}
    </button>`))}</div>`;

  root.innerHTML = html`<div class="rx-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Конструктор реактора</h1>
        <p>Соберите установку из четырёх узлов и выберите режим. <b>Форсаж даёт мощность, но съедает надёжность и запас по теплу.</b></p>
      </div>
      <div class="col-treasury"><small>Реакторов державы</small><b>${reactors.length} из ${LIMIT}</b></div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но регистрировать реакторы могут только правитель и члены державы с правом «Производство».</p>')}

    <div class="rx-grid">
      <section class="panel rx-build" aria-label="Сборка реактора">
        <div class="rx-step"><h2><i>1</i>Принцип</h2>${raw(cards('type', types))}</div>
        <div class="rx-step"><h2><i>2</i>Размер</h2>
          <div class="rx-seg" role="radiogroup" data-kind="size">${sizes.map((p) => raw(html`<button type="button" role="radio" data-id="${p.id}" ${p.open && can ? '' : 'disabled'} aria-checked="false" title="${p.open ? p.descr : `Нужна технология «${p.tech_name || p.tech}»`}"><b>${p.id}</b><small>${p.open ? p.descr : 'закрыт'}</small></button>`))}</div>
        </div>
        <div class="rx-step"><h2><i>3</i>Топливо</h2>
          <div class="rx-fuel">
            <select id="rx-fuel" aria-label="Топливо" ${can ? '' : 'disabled'}></select>
            <p class="hint" id="rx-fuel-hint"></p>
          </div>
        </div>
        <div class="rx-step"><h2><i>4</i>Охлаждение</h2>${raw(cards('cool', cools))}</div>
        <div class="rx-step"><h2><i>5</i>Преобразователь</h2>${raw(cards('conv', convs))}</div>
        <div class="rx-step"><h2><i>6</i>Режим</h2>
          <div class="rx-mode">
            <input type="range" id="rx-mode" min="${MMIN}" max="${MMAX}" step="5" value="100" aria-label="Режим, % номинала" ${can ? '' : 'disabled'}>
            <output id="rx-mode-v">100 %</output>
          </div>
          <div class="rx-mode-scale"><span>Экономный</span><span>Номинал</span><span>Форсаж</span></div>
        </div>
      </section>

      <aside class="panel rx-card" aria-live="polite">
        <figure class="rx-draw" id="rx-draw"></figure>
        <div id="rx-out"></div>
        <form id="rx-form" class="fu-form">
          <label for="rx-name">Название реактора</label>
          <input id="rx-name" maxlength="48" placeholder="Например: Заря-3" ${can ? '' : 'disabled'}>
          <div class="fu-acts">
            <button type="submit" class="btn gold" id="rx-save" disabled>Зарегистрировать</button>
            <button type="button" class="btn" id="rx-cancel" hidden>Отменить правку</button>
          </div>
        </form>
      </aside>
    </div>
    <a class="fu-mini" id="rx-mini" href="#rx-draw" hidden></a>

    <section class="panel fu-list rx-list" aria-labelledby="rx-list-h">
      <h2 id="rx-list-h">Реакторы державы</h2>
      ${reactors.length ? raw(html`<div class="fu-cards">${reactors.map((r) => raw(reactorCard(r, parts, fuels, can)))}</div>`)
        : raw('<p class="empty">Пока ни одного. Соберите установку выше и зарегистрируйте первую.</p>')}
    </section>

    ${archive.length ? raw(html`<section class="panel fu-list rx-arch" aria-labelledby="rx-arch-h">
      <h2 id="rx-arch-h">Архив: реакторы старого образца</h2>
      <p class="hint">Корабли на них продолжают работать до переработки конструктора кораблей. Создавать и менять такие реакторы больше нельзя.</p>
      <div class="tbl"><table><thead><tr><th>Название</th><th>Носитель</th><th>Мощность</th><th>Масса</th><th>Топливо</th></tr></thead><tbody>
        ${archive.map((a) => raw(html`<tr><td>${a.name}</td><td>${a.carrier || '—'}</td><td>${num(a.power)}</td><td>${num(a.mass)}</td><td>${a.fuel || '—'}</td></tr>`))}
      </tbody></table></div>
    </section>`) : ''}
  </div>`;

  const out = $('#rx-out', root), drawEl = $('#rx-draw', root), save = $('#rx-save', root), nameEl = $('#rx-name', root);
  const cancel = $('#rx-cancel', root), mini = $('#rx-mini', root), modeEl = $('#rx-mode', root), modeV = $('#rx-mode-v', root);
  const fuelSel = $('#rx-fuel', root), fuelHint = $('#rx-fuel-hint', root);

  const fillFuel = () => {
    const ty = part('type', st.cfg.type);
    const fam = ty?.params?.fuels || [];
    const ok = (c) => fam.includes(c);
    const cur = st.cfg.fuel ? (st.cfg.fuel.kind === 'fuel' ? `f:${st.cfg.fuel.id}` : `r:${st.cfg.fuel.res}`) : '';
    fuelSel.innerHTML = html`
      ${st.cfg.fuel ? '' : raw('<option value="">— нет подходящего топлива —</option>')}
      <optgroup label="Марки державы">${fuels.length ? raw(fuels.map((f) => html`<option value="f:${f.id}" ${ok(f.class) ? '' : 'disabled'}>${f.name} · ${FAM[f.class] || f.class} · оценка ${f.grade}</option>`).join('')) : raw('<option disabled>марок пока нет</option>')}</optgroup>
      <optgroup label="Сырьё">${raw(rawF.map((r) => html`<option value="r:${r.res}" ${ok(r.class) && r.ok ? '' : 'disabled'}>${r.res} · ${FAM[r.class] || r.class}${r.ok ? '' : ' · нестабилен'}</option>`).join(''))}</optgroup>`;
    fuelSel.value = cur;
    fuelHint.innerHTML = html`Принимает: <b>${fam.map((x) => FAM[x] || x).join(', ')}</b>. ${fuels.length ? '' : raw('<a href="#/fuel">Сделать свою марку →</a>')}`;
  };

  const sync = () => {
    for (const g of $$('[data-kind]', root)) {
      const k = g.dataset.kind;
      for (const b of $$('[role=radio]', g)) b.setAttribute('aria-checked', String(b.dataset.id === st.cfg[k]));
    }
    const ty = part('type', st.cfg.type);
    const tmax = Math.min(MMAX, ty?.params?.max_mode || 999);
    modeEl.max = tmax;
    if (st.cfg.mode > tmax) st.cfg.mode = tmax;
    modeEl.value = st.cfg.mode;
    modeV.textContent = `${st.cfg.mode} %`;
    modeV.className = st.cfg.mode > 100 ? 'hot' : st.cfg.mode < 100 ? 'cool' : '';
    fillFuel();
    drawEl.innerHTML = blueprint(st.cfg, st.calc);
    recalc();
  };

  let timer;
  const recalc = () => {
    clearTimeout(timer);
    if (!st.cfg.type || !st.cfg.fuel) { st.calc = null; paint(); return; }
    timer = setTimeout(async () => {
      const my = ++st.seq;
      const r = await rpc('v1_reactor_preview', { p_cfg: st.cfg }).catch((e) => ({ ok: false, error: e.message }));
      if (my !== st.seq) return;
      st.calc = r; paint();
    }, 200);
  };

  const paint = () => {
    const c = st.calc;
    save.disabled = !can || !c?.ok || !c.registrable || nameEl.value.trim().length < 3;
    drawEl.innerHTML = blueprint(st.cfg, c);
    mini.hidden = true;
    if (!c) { out.innerHTML = html`<p class="empty">${st.cfg.fuel ? 'Считаю…' : 'Для этого принципа нет подходящего топлива — выберите другое или сделайте марку.'}</p>`; return; }
    if (!c.ok) { out.innerHTML = html`<p class="empty warn">${(ERR[c.error] || (() => c.error))(c)}</p>`; return; }
    out.innerHTML = passport(c);
    mini.hidden = false;
    mini.innerHTML = html`<b>${c.grade}</b><span>${c.tier}</span><span>${num(c.power)} ЭЕ</span><span class="${relCls(c.reliability)}">надёжн. ${fmt(c.reliability)}</span><span class="${c.margin < 0 ? 'bad' : ''}">тепло ${c.margin >= 0 ? '+' : ''}${fmt(c.margin, 2)}</span>`;
    mini.onclick = (e) => { e.preventDefault(); drawEl.scrollIntoView({ behavior: 'smooth' }); };
  };

  root.querySelector('.rx-build').addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b || b.disabled) return;
    const k = b.closest('[data-kind]').dataset.kind;
    st.cfg[k] = b.dataset.id;
    if (k === 'type') pickFuel();
    sync();
  });
  fuelSel.onchange = () => {
    const v = fuelSel.value;
    st.cfg.fuel = v.startsWith('f:') ? { kind: 'fuel', id: v.slice(2) } : v.startsWith('r:') ? { kind: 'res', res: v.slice(2) } : null;
    sync();
  };
  modeEl.oninput = () => { st.cfg.mode = Number(modeEl.value); modeV.textContent = `${st.cfg.mode} %`; modeV.className = st.cfg.mode > 100 ? 'hot' : st.cfg.mode < 100 ? 'cool' : ''; recalc(); };
  nameEl.oninput = () => paint();

  const startEdit = (r, copy) => {
    st.edit = copy ? null : r.id;
    st.cfg = { ...r.cfg, fuel: { ...r.cfg.fuel } };
    nameEl.value = copy ? '' : r.name;
    save.textContent = copy ? 'Зарегистрировать' : 'Сохранить изменения';
    cancel.hidden = copy;
    sync(); $('.rx-grid', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  cancel.onclick = () => { st.edit = null; nameEl.value = ''; save.textContent = 'Зарегистрировать'; cancel.hidden = true; paint(); };

  $('#rx-form', root).onsubmit = async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await rpc('v1_reactor_save', { p_id: st.edit, p_name: nameEl.value, p_cfg: st.cfg });
      toast(st.edit ? 'Реактор обновлён' : `Реактор «${nameEl.value.trim()}» зарегистрирован`);
      renderReactor(root);
    } catch (err) { toast(err.message, 'err'); paint(); }
  };

  $('.rx-list', root).onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const r = reactors.find((x) => x.id === b.closest('[data-id]').dataset.id); if (!r) return;
    if (b.dataset.act === 'edit') startEdit(r, false);
    if (b.dataset.act === 'copy') startEdit(r, true);
    if (b.dataset.act === 'del') {
      if (!(await confirmBox(`Удалить реактор «${r.name}»?`, 'Удалить'))) return;
      try { await rpc('v1_reactor_delete', { p_id: r.id }); toast('Реактор удалён'); renderReactor(root); } catch (err) { toast(err.message, 'err'); }
    }
  };

  sync();
}

function chips(kind, p) {
  const pct = (x) => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)} %`;
  const list = [];
  if (kind === 'type') {
    list.push([`мощность ×${fmt(p.power, 2)}`, p.power >= 1 ? 'good' : '']);
    list.push([`надёжность ${p.rel}`, p.rel >= 75 ? 'good' : p.rel < 60 ? 'bad' : '']);
    list.push([`топливо: ${(p.fuels || []).map((x) => FAM[x] || x).join(', ')}`, '']);
  }
  if (kind === 'cool') {
    list.push([`отвод тепла ×${fmt(p.cap, 2)}`, p.cap >= 1.4 ? 'good' : '']);
    if (p.sig) list.push([`заметность ${p.sig > 0 ? '+' : '−'}${Math.abs(p.sig)}`, p.sig < 0 ? 'good' : 'bad']);
    if (p.self) list.push([`берёт ${Math.round(p.self * 100)} % мощности`, 'bad']);
    if (p.rel) list.push([`надёжность ${p.rel > 0 ? '+' : '−'}${Math.abs(p.rel)}`, p.rel > 0 ? 'good' : 'bad']);
  }
  if (kind === 'conv') {
    if (p.power !== 1) list.push([`мощность ${pct(p.power)}`, 'good']);
    if (p.heat !== 1) list.push([`нагрев ${pct(p.heat)}`, p.heat < 1 ? 'good' : 'bad']);
    list.push([`надёжность ${p.rel > 0 ? '+' : p.rel < 0 ? '−' : '±'}${Math.abs(p.rel)}`, p.rel > 0 ? 'good' : p.rel < 0 ? 'bad' : '']);
  }
  return html`<span class="rx-chips">${list.map(([t, c]) => raw(html`<i class="${c}">${t}</i>`))}</span>`;
}

function relCls(r) { return r >= 80 ? 'good' : r >= 60 ? '' : r >= 35 ? 'warn' : 'bad'; }

function bar(label, value, max, cls = '', text = fmt(value)) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return html`<div class="fu-bar ${cls}"><span>${label}</span><b>${text}</b><i><em style="width:${w}%"></em></i></div>`;
}

function passport(c) {
  const g = Number(c.grade) || 0, circ = 2 * Math.PI * 34;
  const billTxt = Object.entries(c.bill || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  return html`
    <div class="fu-top">
      <div class="fu-ring" title="Оценка: удельная мощность, надёжность и запас по теплу">
        <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="bg"/><circle cx="40" cy="40" r="34" class="fg" style="stroke-dasharray:${circ};stroke-dashoffset:${circ * (1 - g / 100)}"/></svg>
        <b>${g}</b><small>${c.tier}</small>
      </div>
      <div class="fu-id">
        <span class="fu-cls">${num(c.power)} ЭЕ</span>
        <span class="fu-stab ${relCls(c.reliability)}">${c.rel_tier}</span>
        <p class="hint">на топливе «${c.fuel_name}» · отдача ×${fmt(c.fuel_k, 2)}</p>
      </div>
    </div>
    ${raw(bar('Надёжность', c.reliability, 100, relCls(c.reliability)))}
    ${raw(bar('Нагрев / отвод', c.heat, Math.max(c.cooling, c.heat) * 1.15, c.margin < 0 ? 'bad' : c.margin < 0.2 ? 'warn' : '', `${fmt(c.heat, 2)} из ${fmt(c.cooling, 2)}`))}
    ${raw(bar('Заметность', c.signature, 100, c.signature >= 50 ? 'warn' : '', fmt(c.signature)))}
    <dl class="fu-derived">
      <div><dt>Удельная мощность</dt><dd>${fmt(c.density)}<small>ЭЕ на тонну</small></dd></div>
      <div><dt>Масса · места</dt><dd>${fmt(c.mass)} т · ${c.slots}<small>в корпусе</small></dd></div>
      <div><dt>Риск аварии</dt><dd class="${c.risk >= 20 ? 'bad' : c.risk >= 8 ? 'warn' : ''}">${fmt(c.risk)} %<small>при попадании</small></dd></div>
      <div><dt>Расход топлива</dt><dd>${fmt(c.fuel_use, 2)}<small>ед. в сутки</small></dd></div>
      <div><dt>Цена</dt><dd>${num(c.cost)} ГС</dd></div>
      <div><dt>Запас по теплу</dt><dd class="${c.margin < 0 ? 'bad' : c.margin < 0.2 ? 'warn' : 'good'}">${c.margin >= 0 ? '+' : ''}${fmt(c.margin, 2)}</dd></div>
    </dl>
    ${billTxt ? raw(html`<p class="rx-bill"><span>Сырьё на постройку</span>${billTxt}</p>`) : ''}
    ${c.warnings?.length ? raw(html`<ul class="fu-warns">${c.warnings.map((w) => raw(html`<li>${w}</li>`))}</ul>`) : ''}`;
}

function reactorCard(r, parts, fuels, can) {
  const c = r.stats || {};
  const nm = (k) => parts.find((p) => p.kind === k && p.id === r.cfg[k])?.name || r.cfg[k];
  return html`<article class="fu-fuel" data-id="${r.id}">
    <header><div><b>${r.name}</b><small>${nm('type')} · ${r.cfg.size} · ${c.fuel_name || ''}</small></div><span class="fu-grade">${c.grade ?? '—'}<small>${c.tier || ''}</small></span></header>
    ${c.broken ? raw('<ul class="fu-warns"><li>Марка топлива изменилась и больше не подходит — пересоберите реактор.</li></ul>') : ''}
    <dl><div><dt>Мощность</dt><dd>${num(c.power)} ЭЕ</dd></div><div><dt>Надёжность</dt><dd>${fmt(c.reliability)}</dd></div>
      <div><dt>Масса</dt><dd>${fmt(c.mass)} т</dd></div><div><dt>Тепло</dt><dd class="${c.margin < 0 ? 'bad' : ''}">${c.margin >= 0 ? '+' : ''}${fmt(c.margin, 2)}</dd></div></dl>
    <p class="hint">${nm('cool')} · ${nm('conv')} · режим ${r.cfg.mode} %</p>
    ${can ? raw(html`<div class="fu-acts"><button type="button" class="btn sm" data-act="edit">Изменить</button><button type="button" class="btn sm" data-act="copy">Взять за основу</button><button type="button" class="btn sm danger" data-act="del">Удалить</button></div>`) : ''}
  </article>`;
}

/* ── Чертёж: ядро (принцип), кольцо преобразователя, внешний контур охлаждения ── */
function blueprint(cfg, c) {
  const K = { S: 0.72, M: 0.82, L: 0.92, XL: 1 }[cfg.size] || 0.82;
  const R = (r) => (r * K).toFixed(1);
  const ring = (r, n, fn) => Array.from({ length: n }, (_, i) => fn((i / n) * Math.PI * 2, i)).join('');
  const P = (a, r) => [120 + Math.cos(a) * r * K, 120 + Math.sin(a) * r * K];
  const hot = c?.ok ? Math.max(0, Math.min(1.4, c.heat / (c.cooling || 1))) : 0.6;
  const over = c?.ok && c.margin < 0;
  const mode = (cfg.mode || 100) / 100;

  // охлаждение
  const cool = {
    radiator: `<circle cx="120" cy="120" r="${R(96)}" class="ln"/>` + ring(16, 16, (a) => { const [x1, y1] = P(a, 96), [x2, y2] = P(a, 112); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ln th"/>`; }),
    metal: `<circle cx="120" cy="120" r="${R(100)}" class="ln th"/><circle cx="120" cy="120" r="${R(92)}" class="ln"/>` + ring(8, 8, (a) => { const [x, y] = P(a, 96); return `<circle cx="${x}" cy="${y}" r="2.4" class="fl"/>`; }),
    cryo: `<circle cx="120" cy="120" r="${R(104)}" class="ln dash"/><circle cx="120" cy="120" r="${R(94)}" class="ln dash"/>` + ring(6, 6, (a) => { const [x1, y1] = P(a, 90), [x2, y2] = P(a, 108); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ln"/>`; }),
    field: [108, 100, 92].map((r, i) => `<circle cx="120" cy="120" r="${R(r)}" class="ln dot" style="opacity:${0.9 - i * 0.25}"/>`).join(''),
  }[cfg.cool] || '';

  // преобразователь
  const conv = {
    thermal: `<circle cx="120" cy="120" r="${R(70)}" class="ln"/>` + ring(8, 8, (a) => { const [x, y] = P(a, 70); const d = (a * 180) / Math.PI; return `<rect x="${x - 7}" y="${y - 4}" width="14" height="8" rx="2" class="ln bx" transform="rotate(${d} ${x} ${y})"/>`; }),
    direct: `<circle cx="120" cy="120" r="${R(70)}" class="ln"/>` + ring(12, 12, (a) => { const [x, y] = P(a, 70); return `<circle cx="${x}" cy="${y}" r="3" class="fl"/>`; }),
    plasma: [0, Math.PI].map((o) => { let d = ''; for (let i = 0; i <= 40; i++) { const a = o + (i / 40) * Math.PI * 1.6; const r = 52 + (i / 40) * 26; const [x, y] = P(a, r); d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; } return `<path d="${d}" class="ln th"/>`; }).join(''),
  }[cfg.conv] || '';

  // ядро
  const core = {
    rtg: ring(6, 6, (a) => { const [x, y] = P(a, 16); return `<circle cx="${x}" cy="${y}" r="4.5" class="fl"/>`; }) + `<circle cx="120" cy="120" r="${(4.5).toFixed(1)}" class="fl"/>`,
    fission: [-14, 0, 14].flatMap((dx) => [-14, 0, 14].map((dy) => `<rect x="${120 + dx * K - 3}" y="${120 + dy * K - 7}" width="6" height="14" rx="1.5" class="fl"/>`)).join(''),
    fusion: `<ellipse cx="120" cy="120" rx="${R(30)}" ry="${R(14)}" class="ln th"/><ellipse cx="120" cy="120" rx="${R(16)}" ry="${R(6)}" class="ln"/>`,
    catalytic: (() => { let d = ''; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const [x, y] = P(a, i % 2 ? 12 : 30); d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; } return `<path d="${d}Z" class="ln th"/>`; })(),
    grav: [0, 60, 120].map((d) => `<ellipse cx="120" cy="120" rx="${R(30)}" ry="${R(11)}" class="ln" transform="rotate(${d} 120 120)"/>`).join('') + '<circle cx="120" cy="120" r="5" class="fl"/>',
  }[cfg.type] || '';

  const glow = over ? '#e0573f' : '#e9b949';
  return `<svg viewBox="0 0 240 240" class="rx-svg ${over ? 'over' : ''}" role="img" aria-label="Чертёж реактора">
    <defs><radialGradient id="rxg"><stop offset="0" stop-color="${glow}" stop-opacity="${(0.25 + hot * 0.45).toFixed(2)}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
      <pattern id="rxgrid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" class="gr"/></pattern></defs>
    <rect width="240" height="240" fill="url(#rxgrid)"/>
    <circle cx="120" cy="120" r="${R(44 + 20 * mode)}" fill="url(#rxg)"/>
    <g class="rx-cool">${cool}</g>
    <g class="rx-conv">${conv}</g>
    <circle cx="120" cy="120" r="${R(40)}" class="ln faint"/>
    <g class="rx-core">${core}</g>
  </svg>
  <figcaption><span>ядро</span><span>преобразователь</span><span>охлаждение</span><span>${cfg.size || ''}</span></figcaption>`;
}
