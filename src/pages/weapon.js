import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/weapon — конструктор орудий.
 * Сервер: v1_weapon_state / v1_weapon_preview / v1_weapon_save / v1_weapon_delete.
 * Орудие = принцип + размер + компоновка + профиль огня + материал ствола + режим.
 */

const KIND = { kinetic: 'кинетический', energy: 'энергетический', missile: 'ракетный', repair: 'ремонт' };
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const pct = (x) => `${Math.round(Number(x || 0) * 100)} %`;

export async function renderWeapon(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-sword')}</span><div><h1>Конструктор орудий</h1><p>Войдите, чтобы проектировать орудия своей державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Конструктор откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.wp-wrap')) root.innerHTML = '<div class="skeleton">Открываю оружейный цех…</div>';
  let s;
  try { s = await rpc('v1_weapon_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Конструктор недоступен</h1><p>${e.missingSchema ? 'Конструктор орудий ещё не подключён в базе (миграция 28).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s);
}

function draw(root, s) {
  const cfgS = s.settings || {};
  const LIMIT = cfgS.max_per_faction || 16, MMIN = cfgS.mode_min || 60, MMAX = cfgS.mode_max || 140;
  const parts = s.parts || [];
  const of = (k) => parts.filter((p) => p.kind === k);
  const part = (k, id) => parts.find((p) => p.kind === k && p.id === id);
  const alloys = s.alloys || [], weapons = s.weapons || [], archive = s.archive || [];
  const can = !!s.can_edit;
  const firstOpen = (list) => (list.find((p) => p.open) || list[0])?.id;
  const st = { cfg: { type: firstOpen(of('type')), size: 'M', mount: 'single', profile: 'balanced', mode: 100, alloy: null }, edit: null, calc: null, seq: 0 };

  const cards = (kind, list, chipsFn) => html`<div class="rx-opts" role="radiogroup" data-kind="${kind}">${list.map((p) => raw(html`
    <button type="button" role="radio" class="rx-opt" data-id="${p.id}" ${p.open && can ? '' : 'disabled'} aria-checked="false">
      <b>${p.name}</b><small>${p.descr}</small>
      ${p.open ? raw(chipsFn(p.params)) : raw(html`<em class="rx-lock">${icon('i-shield')}Нужна технология «${p.tech_name || p.tech}»</em>`)}
    </button>`))}</div>`;
  const seg = (kind, list, sub) => html`<div class="rx-seg ${list.length === 3 ? 'three' : ''}" role="radiogroup" data-kind="${kind}">${list.map((p) => raw(html`<button type="button" role="radio" data-id="${p.id}" ${p.open && can ? '' : 'disabled'} aria-checked="false" title="${p.open ? p.descr : `Нужна технология «${p.tech_name || p.tech}»`}"><b>${sub(p)}</b><small>${p.open ? p.descr : 'закрыт'}</small></button>`))}</div>`;

  root.innerHTML = html`<div class="wp-wrap rx-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Конструктор орудий</h1>
        <p>Соберите орудие и выберите режим. <b>Больше стволов и форсаж — больше урона, но тяжелее, прожорливее и ненадёжнее.</b> Общедоступные орудия старого каталога остаются в конструкторе кораблей.</p>
      </div>
      <div class="col-treasury"><small>Орудий державы</small><b>${weapons.length} из ${LIMIT}</b></div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но регистрировать орудия могут только правитель и члены державы с правом «Производство».</p>')}

    <div class="rx-grid">
      <section class="panel rx-build" aria-label="Сборка орудия">
        <div class="rx-step"><h2><i>1</i>Принцип</h2>${raw(cards('type', of('type'), typeChips))}</div>
        <div class="rx-step"><h2><i>2</i>Размер</h2>${raw(seg('size', of('size'), (p) => p.id))}</div>
        <div class="rx-step"><h2><i>3</i>Компоновка</h2>${raw(seg('mount', of('mount'), (p) => `${p.params.barrels}×`))}</div>
        <div class="rx-step"><h2><i>4</i>Профиль огня</h2>${raw(cards('profile', of('profile'), profChips))}</div>
        <div class="rx-step"><h2><i>5</i>Материал ствола</h2>
          <div class="rx-fuel">
            <select id="wp-alloy" aria-label="Материал ствола" ${can ? '' : 'disabled'}>
              <option value="">Стандартная сталь</option>
              ${alloys.length ? raw(html`<optgroup label="Сплавы державы">${raw(alloys.map((a) => html`<option value="${a.id}">${a.name} · оценка ${a.grade} · жаростойкость ${num(a.heat)} °C</option>`).join(''))}</optgroup>`) : ''}
            </select>
            <p class="hint">Жаростойкий сплав поднимает надёжность горячих орудий, лёгкий — снижает массу, прочный — добавляет пробитие снарядам. ${alloys.length ? '' : raw('<a href="#/hull">Сделать свой сплав →</a>')}</p>
          </div>
        </div>
        <div class="rx-step"><h2><i>6</i>Режим</h2>
          <div class="rx-mode">
            <input type="range" id="wp-mode" min="${MMIN}" max="${MMAX}" step="5" value="100" aria-label="Режим, % номинала" ${can ? '' : 'disabled'}>
            <output id="wp-mode-v">100 %</output>
          </div>
          <div class="rx-mode-scale"><span>Щадящий</span><span>Номинал</span><span>Форсаж</span></div>
        </div>
      </section>

      <aside class="panel rx-card" aria-live="polite">
        <figure class="rx-draw" id="wp-draw"></figure>
        <div id="wp-out"></div>
        <form id="wp-form" class="fu-form">
          <label for="wp-name">Название орудия</label>
          <input id="wp-name" maxlength="48" placeholder="Например: Копьё-2" ${can ? '' : 'disabled'}>
          <div class="fu-acts">
            <button type="submit" class="btn gold" id="wp-save" disabled>Зарегистрировать</button>
            <button type="button" class="btn" id="wp-cancel" hidden>Отменить правку</button>
          </div>
        </form>
      </aside>
    </div>
    <a class="fu-mini" id="wp-mini" href="#wp-draw" hidden></a>

    <section class="panel fu-list wp-list" aria-labelledby="wp-list-h">
      <h2 id="wp-list-h">Орудия державы</h2>
      ${weapons.length ? raw(html`<div class="fu-cards">${weapons.map((w) => raw(weaponCard(w, parts, can)))}</div>`)
        : raw('<p class="empty">Пока ни одного. Соберите орудие выше и зарегистрируйте первое.</p>')}
    </section>

    ${archive.length ? raw(html`<section class="panel fu-list rx-arch" aria-labelledby="wp-arch-h">
      <h2 id="wp-arch-h">Архив: орудия державы старого образца</h2>
      <p class="hint">Корабли с ними продолжают служить до переработки конструктора кораблей. Создавать и менять такие орудия больше нельзя.</p>
      <div class="tbl"><table><thead><tr><th>Название</th><th>Класс</th><th>Тип</th><th>Урон</th><th>Энергия</th><th>Дальность</th></tr></thead><tbody>
        ${archive.map((a) => raw(html`<tr><td>${a.name}</td><td>${a.klass || '—'}</td><td>${KIND[a.kind] || a.kind || '—'}</td><td>${num(a.damage)}</td><td>${num(a.energy)}</td><td>${fmt(a.dalnost)}</td></tr>`))}
      </tbody></table></div>
    </section>`) : ''}
  </div>`;

  const out = $('#wp-out', root), drawEl = $('#wp-draw', root), save = $('#wp-save', root), nameEl = $('#wp-name', root);
  const cancel = $('#wp-cancel', root), mini = $('#wp-mini', root), modeEl = $('#wp-mode', root), modeV = $('#wp-mode-v', root), alloyEl = $('#wp-alloy', root);

  const sync = () => {
    for (const g of $$('[data-kind]', root)) {
      for (const b of $$('[role=radio]', g)) b.setAttribute('aria-checked', String(b.dataset.id === st.cfg[g.dataset.kind]));
    }
    modeEl.value = st.cfg.mode;
    modeV.textContent = `${st.cfg.mode} %`;
    modeV.className = st.cfg.mode > 100 ? 'hot' : st.cfg.mode < 100 ? 'cool' : '';
    alloyEl.value = st.cfg.alloy || '';
    drawEl.innerHTML = turret(st.cfg, part, st.calc);
    recalc();
  };

  let timer;
  const recalc = () => {
    clearTimeout(timer);
    if (!st.cfg.type) { st.calc = null; paint(); return; }
    timer = setTimeout(async () => {
      const my = ++st.seq;
      const r = await rpc('v1_weapon_preview', { p_cfg: st.cfg }).catch((e) => ({ ok: false, error: e.message }));
      if (my !== st.seq) return;
      st.calc = r; paint();
    }, 200);
  };

  const paint = () => {
    const c = st.calc;
    save.disabled = !can || !c?.ok || !c.registrable || nameEl.value.trim().length < 3;
    drawEl.innerHTML = turret(st.cfg, part, c);
    mini.hidden = true;
    if (!c) { out.innerHTML = '<p class="empty">Считаю…</p>'; return; }
    if (!c.ok) { out.innerHTML = html`<p class="empty warn">${c.error === 'weapon_alloy_missing' ? 'Сплав не найден — выберите другой материал.' : 'Соберите все узлы.'}</p>`; return; }
    out.innerHTML = passport(c);
    mini.hidden = false;
    const main = c.kind === 'repair' ? `ремонт ${num(c.heal)}` : `${num(c.damage)} урона`;
    mini.innerHTML = html`<b>${c.grade}</b><span>${c.tier}</span><span>${main}</span><span>${num(c.energy)} ЭЕ</span><span class="${c.reliability < 60 ? 'bad' : ''}">надёжн. ${fmt(c.reliability)}</span>`;
    mini.onclick = (e) => { e.preventDefault(); drawEl.scrollIntoView({ behavior: 'smooth' }); };
  };

  root.querySelector('.rx-build').addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b || b.disabled) return;
    st.cfg[b.closest('[data-kind]').dataset.kind] = b.dataset.id;
    sync();
  });
  alloyEl.onchange = () => { st.cfg.alloy = alloyEl.value || null; sync(); };
  modeEl.oninput = () => { st.cfg.mode = Number(modeEl.value); modeV.textContent = `${st.cfg.mode} %`; modeV.className = st.cfg.mode > 100 ? 'hot' : st.cfg.mode < 100 ? 'cool' : ''; recalc(); };
  nameEl.oninput = () => paint();

  const load = (w, copy) => {
    st.edit = copy ? null : w.id; st.cfg = { ...w.cfg };
    nameEl.value = copy ? '' : w.name; save.textContent = copy ? 'Зарегистрировать' : 'Сохранить изменения'; cancel.hidden = copy;
    sync(); $('.rx-grid', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  cancel.onclick = () => { st.edit = null; nameEl.value = ''; save.textContent = 'Зарегистрировать'; cancel.hidden = true; paint(); };

  $('#wp-form', root).onsubmit = async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await rpc('v1_weapon_save', { p_id: st.edit, p_name: nameEl.value, p_cfg: st.cfg });
      toast(st.edit ? 'Орудие обновлено' : `Орудие «${nameEl.value.trim()}» зарегистрировано`);
      renderWeapon(root);
    } catch (err) { toast(err.message, 'err'); paint(); }
  };

  $('.wp-list', root).onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const w = weapons.find((x) => x.id === b.closest('[data-id]').dataset.id); if (!w) return;
    if (b.dataset.act === 'edit') load(w, false);
    if (b.dataset.act === 'copy') load(w, true);
    if (b.dataset.act === 'del') {
      if (!(await confirmBox(`Удалить орудие «${w.name}»?`, 'Удалить'))) return;
      try { await rpc('v1_weapon_delete', { p_id: w.id }); toast('Орудие удалено'); renderWeapon(root); } catch (err) { toast(err.message, 'err'); }
    }
  };

  sync();
}

const chipList = (list) => html`<span class="rx-chips">${list.map(([t, c]) => raw(html`<i class="${c}">${t}</i>`))}</span>`;

function typeChips(p) {
  return chipList([
    [`урон ×${fmt(p.dmg, 2)}`, p.dmg > 1 ? 'good' : ''],
    [`дальность ${p.rng}`, p.rng >= 8 ? 'good' : ''],
    [`точность ${p.acc}`, p.acc >= 85 ? 'good' : p.acc < 70 ? 'bad' : ''],
    [`энергия ×${fmt(p.en, 1)}`, p.en >= 1 ? 'bad' : 'good'],
    ...(p.pen >= 0.3 ? [[`пробитие ${pct(p.pen)}`, 'good']] : []),
  ]);
}

function profChips(p) {
  const d = (x) => Math.round((x - 1) * 100);
  const list = [];
  if (p.dmg !== 1) list.push([`урон ${d(p.dmg) > 0 ? '+' : '−'}${Math.abs(d(p.dmg))} %`, p.dmg > 1 ? 'good' : 'bad']);
  if (p.rate !== 1) list.push([`темп ${d(p.rate) > 0 ? '+' : '−'}${Math.abs(d(p.rate))} %`, p.rate > 1 ? 'good' : 'bad']);
  if (p.rng !== 1) list.push([`дальность +${d(p.rng)} %`, 'good']);
  if (p.acc) list.push([`точность ${p.acc > 0 ? '+' : '−'}${Math.abs(p.acc)}`, p.acc > 0 ? 'good' : 'bad']);
  if (p.pen) list.push([`пробитие +${pct(p.pen)}`, 'good']);
  if (!list.length) list.push(['без перекосов', '']);
  return chipList(list);
}

function bar(label, value, max, cls = '', text = fmt(value)) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return html`<div class="fu-bar ${cls}"><span>${label}</span><b>${text}</b><i><em style="width:${w}%"></em></i></div>`;
}
const relCls = (r) => (r >= 80 ? 'good' : r >= 60 ? '' : r >= 35 ? 'warn' : 'bad');

function passport(c) {
  const g = Number(c.grade) || 0, circ = 2 * Math.PI * 34;
  const billTxt = Object.entries(c.bill || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  const rep = c.kind === 'repair';
  return html`
    <div class="fu-top">
      <div class="fu-ring" title="Оценка: польза в бою против массы и энергии">
        <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="bg"/><circle cx="40" cy="40" r="34" class="fg" style="stroke-dasharray:${circ};stroke-dashoffset:${circ * (1 - g / 100)}"/></svg>
        <b>${g}</b><small>${c.tier}</small>
      </div>
      <div class="fu-id">
        <span class="fu-cls">${rep ? `${num(c.heal)} ремонта` : `${num(c.damage)} урона`}<small class="wp-turn"> за ход</small></span>
        <span class="fu-stab">${KIND[c.kind] || c.kind}</span>
        <p class="hint">${c.barrels} ств. · ${fmt(c.rate, 2)} выстр./ход · ${num(c.shot)} за выстрел</p>
      </div>
    </div>
    ${raw(bar('Точность', c.accuracy, 100, c.accuracy >= 85 ? 'good' : c.accuracy < 65 ? 'warn' : '', `${c.accuracy} %`))}
    ${raw(bar('Пробитие брони', c.penetration, 0.8, '', pct(c.penetration)))}
    ${raw(bar('Надёжность', c.reliability, 100, relCls(c.reliability)))}
    <dl class="fu-derived">
      <div><dt>Энергия</dt><dd>${num(c.energy)}<small>ЭЕ от реактора</small></dd></div>
      <div><dt>Дальность</dt><dd>${fmt(c.dalnost)}</dd></div>
      <div><dt>Масса · места</dt><dd>${fmt(c.mass)} т · ${c.slots}<small>в корпусе</small></dd></div>
      <div><dt>Цена</dt><dd>${num(c.cost)} ГС</dd></div>
    </dl>
    <p class="rx-bill"><span>Ствол</span>${c.alloy_name}</p>
    ${billTxt ? raw(html`<p class="rx-bill"><span>Сырьё на постройку</span>${billTxt}</p>`) : ''}
    ${c.warnings?.length ? raw(html`<ul class="fu-warns">${c.warnings.map((w) => raw(html`<li>${w}</li>`))}</ul>`) : ''}`;
}

function weaponCard(w, parts, can) {
  const c = w.stats || {};
  const nm = (k) => parts.find((p) => p.kind === k && p.id === w.cfg[k])?.name || w.cfg[k];
  const rep = c.kind === 'repair';
  return html`<article class="fu-fuel" data-id="${w.id}">
    <header><div><b>${w.name}</b><small>${nm('type')} · ${w.cfg.size} · ${nm('mount')}</small></div><span class="fu-grade">${c.grade}<small>${c.tier}</small></span></header>
    <dl><div><dt>${rep ? 'Ремонт' : 'Урон'}</dt><dd>${num(rep ? c.heal : c.damage)}</dd></div><div><dt>Энергия</dt><dd>${num(c.energy)}</dd></div>
      <div><dt>Дальность</dt><dd>${fmt(c.dalnost)}</dd></div><div><dt>Надёжность</dt><dd>${fmt(c.reliability)}</dd></div></dl>
    <p class="hint">${nm('profile')} · ${c.alloy_name || 'Стандартная сталь'} · режим ${w.cfg.mode} %</p>
    ${can ? raw(html`<div class="fu-acts"><button type="button" class="btn sm" data-act="edit">Изменить</button><button type="button" class="btn sm" data-act="copy">Взять за основу</button><button type="button" class="btn sm danger" data-act="del">Удалить</button></div>`) : ''}
  </article>`;
}

/* ── Схема орудия сверху: башня, стволы по компоновке, дульная часть по принципу ── */
function turret(cfg, part, c) {
  const K = { S: 0.62, M: 0.76, L: 0.9, XL: 1 }[cfg.size] || 0.76;
  const n = part('mount', cfg.mount)?.params?.barrels || 1;
  const len = (cfg.profile === 'precise' ? 108 : cfg.profile === 'burst' ? 72 : 90) * K;
  const R = 40 * K;
  const cx = 120, cy = 150;
  const over = c?.ok && c.reliability < 35;
  const gap = n === 1 ? 0 : n === 2 ? 16 : 11;
  const xs = Array.from({ length: n }, (_, i) => cx + (i - (n - 1) / 2) * gap * K);
  const w = cfg.type === 'plasma' ? 9 : cfg.type === 'laser' ? 4 : 6;
  let body = '';
  if (cfg.type === 'missile') {
    const cols = n === 1 ? 2 : n === 2 ? 3 : 4, rows = n === 4 ? 3 : 2;
    const cw = 14 * K, ch = 14 * K, x0 = cx - (cols * cw) / 2, y0 = cy - R - rows * ch - 4;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) body += `<rect x="${(x0 + i * cw + 1).toFixed(1)}" y="${(y0 + j * ch + 1).toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(ch - 2).toFixed(1)}" rx="2" class="ln bx"/><circle cx="${(x0 + i * cw + cw / 2).toFixed(1)}" cy="${(y0 + j * ch + ch / 2).toFixed(1)}" r="${(3 * K).toFixed(1)}" class="fl"/>`;
  } else if (cfg.type === 'repair') {
    for (let i = 0; i < 6 + n * 2; i++) { const a = (i / (6 + n * 2)) * Math.PI * 2; body += `<path d="M${(cx + Math.cos(a) * (R + 28) - 5).toFixed(1)} ${(cy + Math.sin(a) * (R + 28)).toFixed(1)}l5 -5l5 5l-5 5z" class="ln bx"/>`; }
    body += `<circle cx="${cx}" cy="${cy}" r="${(R + 28).toFixed(1)}" class="ln dot"/>`;
  } else {
    body = xs.map((x) => {
      const top = cy - R - len;
      let b = `<rect x="${(x - w / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${w}" height="${(len + R * 0.4).toFixed(1)}" rx="1.5" class="ln bx"/>`;
      if (cfg.type === 'rail') b += `<line x1="${(x - w / 2 - 2).toFixed(1)}" y1="${top.toFixed(1)}" x2="${(x - w / 2 - 2).toFixed(1)}" y2="${(cy - R).toFixed(1)}" class="ln"/><line x1="${(x + w / 2 + 2).toFixed(1)}" y1="${top.toFixed(1)}" x2="${(x + w / 2 + 2).toFixed(1)}" y2="${(cy - R).toFixed(1)}" class="ln"/>`;
      if (cfg.type === 'laser') b += `<circle cx="${x.toFixed(1)}" cy="${(top - 3).toFixed(1)}" r="4" class="ln th"/>`;
      if (cfg.type === 'plasma') b += `<circle cx="${x.toFixed(1)}" cy="${(top + 6).toFixed(1)}" r="8" class="ln"/><circle cx="${x.toFixed(1)}" cy="${(top + 18).toFixed(1)}" r="7" class="ln"/>`;
      if (cfg.type === 'kinetic') b += `<rect x="${(x - w / 2 - 2).toFixed(1)}" y="${(top - 2).toFixed(1)}" width="${w + 4}" height="7" rx="1" class="fl"/>`;
      if (cfg.profile === 'ap') b += `<path d="M${x.toFixed(1)} ${(top - 14).toFixed(1)}l-4 8h8z" class="fl"/>`;
      return b;
    }).join('');
  }
  const glow = over ? '#e0573f' : '#e9b949';
  const m = (cfg.mode || 100) / 100;
  return `<svg viewBox="0 0 240 240" class="rx-svg ${over ? 'over' : ''}" role="img" aria-label="Схема орудия">
    <defs><radialGradient id="wpg"><stop offset="0" stop-color="${glow}" stop-opacity="${(0.15 + 0.35 * m).toFixed(2)}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
      <pattern id="wpgrid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" class="gr"/></pattern></defs>
    <rect width="240" height="240" fill="url(#wpgrid)"/>
    <circle cx="${cx}" cy="${cy}" r="${(R * 1.8).toFixed(1)}" fill="url(#wpg)"/>
    ${body}
    <circle cx="${cx}" cy="${cy}" r="${R.toFixed(1)}" class="ln th"/>
    <circle cx="${cx}" cy="${cy}" r="${(R * 0.55).toFixed(1)}" class="ln"/>
    <circle cx="${cx}" cy="${cy}" r="${(R + 8).toFixed(1)}" class="ln dash"/>
  </svg>
  <figcaption><span>${part('type', cfg.type)?.name || ''}</span><span>${cfg.size || ''}</span><span>${n} ств.</span><span>${part('profile', cfg.profile)?.name || ''}</span></figcaption>`;
}
