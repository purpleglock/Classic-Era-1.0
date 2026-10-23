import { html, raw, icon, $, $$, toast } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { go } from '../lib/router.js';
import { loadGalaxy, STAR_NAME } from '../lib/galaxy.js';
import { GalaxyView } from '../ui/galaxy-view.js';
import { myDiscord, discordBadge, STATUS } from './account.js';
import {
  MOD_LABEL, GOV, REGIME, GOV_REGIME, IDEOLOGY, GOV_IDEO_BAN, RACE, MACHINE_GOV, MACHINE_RACE,
  CIV, CAPITAL, BUILDINGS, POINTS, MONEY_PRICE,
} from '../content/doctrine.js';

const STEPS = ['Политика', 'Облик', 'Система', 'Столица', 'Постройки', 'Культура', 'История', 'Обзор'];
const EMPTY = {
  name: '', leader: '', gov: 'Республика', regime: 'Демократический', civ_type: 'colony',
  color: 'rgba(233, 185, 73, 0.34)', herald_url: '', system_id: '', system_name: '',
  race: 'Гуманоиды', capital_env: 'terrestrial', planet_name: '', buildings: [], bonus_money: false,
  ideology: 'Технократия (Культ науки)', culture: '', history: '',
};
const draftKey = () => `ce.apply.${session.user?.id}`;

let A = null; // { data, step, id, status, reason, view }

export async function renderApply(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>Заявка на державу</h1><p>Сначала зарегистрируйтесь или войдите.</p></div><button type="button" class="btn gold" id="ap-up">Зарегистрироваться</button></section>`;
    $('#ap-up', root).onclick = () => openLogin('up');
    return;
  }
  if (session.factionId) { go('/cabinet'); return; }
  root.innerHTML = '<div class="skeleton">Открываю заявку…</div>';

  const { data: row } = await sb.from('faction_applications').select('*').eq('owner_id', session.user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  let local = null;
  try { local = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { /* приватный режим */ }
  const fromRow = row ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, row[k] ?? EMPTY[k]])) : null;
  A = {
    data: { ...EMPTY, ...(fromRow || {}), ...(local?.data && (!row || local.ts > Date.parse(row.updated_at || 0)) ? local.data : {}) },
    step: local?.step || 0, id: row?.id || null, status: row?.status || null, reason: row?.reject_reason || null,
  };
  if (!Array.isArray(A.data.buildings)) A.data.buildings = [];

  if (A.status === 'pending' && !A.editing) { renderPending(root); return; }
  draw(root);
}

function renderPending(root) {
  root.innerHTML = html`
    <section class="panel gate">
      <span class="m-ic">${icon('i-clock')}</span>
      <div><h1>Заявка на рассмотрении</h1><p>«${A.data.name}» ждёт проверки командой проекта. Мы сообщим о решении, а кабинет откроется сам.</p></div>
      <button type="button" class="btn" id="ap-edit">Изменить заявку</button>
    </section>`;
  $('#ap-edit', root).onclick = () => { A.editing = true; draw(root); };
}

function save() {
  try { localStorage.setItem(draftKey(), JSON.stringify({ data: A.data, step: A.step, ts: Date.now() })); } catch { /* ничего */ }
}

function chips(mods) {
  return raw(Object.entries(mods || {}).map(([k, v]) => {
    const [label, upGood, pct] = MOD_LABEL[k] || [k, true, true];
    const good = upGood ? v > 0 : v < 0;
    const val = pct ? `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%` : `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
    return html`<span class="mchip ${good ? 'good' : 'bad'}">${label} ${val}</span>`;
  }).join(''));
}
function sumMods(d) {
  const out = {};
  for (const m of [GOV[d.gov]?.mods, REGIME[d.regime]?.mods, IDEOLOGY[d.ideology]?.mods, RACE[d.race]?.mods, CIV[d.civ_type]?.mods, CAPITAL[d.capital_env]?.mods]) {
    for (const [k, v] of Object.entries(m || {})) out[k] = Math.round(((out[k] || 0) + v) * 100) / 100;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
const opt = (list, val, disabled = []) => raw(list.map((o) => html`<option ${raw(o === val ? 'selected' : '')} ${raw(disabled.includes(o) ? 'disabled' : '')}>${o}</option>`).join(''));
const regimesFor = (gov) => GOV_REGIME[gov] || Object.keys(REGIME);
const ideologiesFor = (gov) => Object.keys(IDEOLOGY).filter((i) => !(GOV_IDEO_BAN[gov] || []).includes(i));
const homesFor = (race) => RACE[race]?.home || ['terrestrial'];
const spent = (d) => d.buildings.reduce((a, id) => a + (id === CIV[d.civ_type].free ? 0 : BUILDINGS.find((b) => b.id === id)?.price || 0), 0) + (d.bonus_money ? MONEY_PRICE : 0);

function fixConsistency(d) {
  if (d.gov === MACHINE_GOV) d.race = MACHINE_RACE;
  if (!regimesFor(d.gov).includes(d.regime)) d.regime = regimesFor(d.gov)[0];
  if (!ideologiesFor(d.gov).includes(d.ideology)) d.ideology = ideologiesFor(d.gov)[0];
  if (!homesFor(d.race).includes(d.capital_env)) d.capital_env = homesFor(d.race)[0];
  d.buildings = d.buildings.filter((b) => b !== CIV[d.civ_type].free);
}

function draw(root) {
  A.view?.destroy(); A.view = null;
  const d = A.data;
  fixConsistency(d);
  const last = A.step === STEPS.length - 1;
  root.innerHTML = html`
    <section class="panel guide-head">
      <span class="m-ic">${icon('i-flag')}</span>
      <div><h1>Заявка на державу</h1><p>Шаг ${A.step + 1} из ${STEPS.length} — ${STEPS[A.step]}. Черновик сохраняется сам.</p></div>
      ${A.status ? raw(html`<span class="tag">${STATUS[A.status] || A.status}</span>`) : ''}
    </section>
    ${A.status === 'rejected' || (A.status === 'draft' && A.reason) ? raw(html`<p class="panel note-bar">${A.status === 'rejected' ? 'Заявка отклонена' : 'Заявку вернули на доработку'}. ${A.reason ? `Причина: ${A.reason}` : ''} Исправьте и отправьте снова.</p>`) : ''}
    <nav class="panel steps" aria-label="Шаги заявки">${STEPS.map((s, i) => raw(html`<button type="button" data-step="${i}" class="${i < A.step ? 'done' : ''}" ${raw(i === A.step ? 'aria-current="step"' : '')}><span>${i + 1}</span>${s}</button>`))}</nav>
    <section class="panel apply-body" id="ap-body"></section>
    <div class="apply-nav">
      <button type="button" class="btn" id="ap-prev" ${raw(A.step === 0 ? 'disabled' : '')}>${icon('i-back')}Назад</button>
      <button type="button" class="btn" id="ap-draft">Сохранить черновик</button>
      ${last ? raw('<button type="button" class="btn gold" id="ap-send">Отправить на рассмотрение</button>') : raw('<button type="button" class="btn gold" id="ap-next">Далее</button>')}
    </div>`;
  const body = $('#ap-body', root);
  STEP_RENDER[A.step](body, d, () => draw(root));
  body.addEventListener('input', () => save());
  body.addEventListener('change', () => save());

  $('.steps', root).onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) { A.step = Number(b.dataset.step); save(); draw(root); } };
  $('#ap-prev', root).onclick = () => { A.step = Math.max(0, A.step - 1); save(); draw(root); };
  $('#ap-next', root)?.addEventListener('click', () => {
    const err = validate(A.step);
    if (err) { toast(err.msg, 'err'); return; }
    A.step += 1; save(); draw(root); scrollTo(0, 0);
  });
  $('#ap-draft', root).onclick = () => submit(root, 'draft');
  $('#ap-send', root)?.addEventListener('click', () => submit(root, 'pending'));
}

function validate(step, all = false) {
  const d = A.data;
  const checks = [
    [0, !d.name.trim(), 'Укажите название державы.'],
    [0, d.name.trim().length > 80, 'Название — не длиннее 80 символов.'],
    [2, !d.system_id, 'Выберите свободную систему для столицы.'],
    [3, !d.planet_name.trim(), 'Назовите столичную планету.'],
    [4, spent(d) > POINTS, `Постройки превышают ${POINTS} очков.`],
  ];
  for (const [s, bad, msg] of checks) if ((all || s === step) && bad) return { msg, step: s };
  return null;
}

async function submit(root, status) {
  const d = A.data;
  if (status === 'pending') {
    const err = validate(null, true);
    if (err) { toast(err.msg, 'err'); A.step = err.step; draw(root); return; }
  }
  const body = {
    owner_id: session.user.id, status,
    name: d.name.trim(), leader: d.leader.trim(), gov: d.gov, regime: d.regime, civ_type: d.civ_type,
    color: d.color, herald_url: d.herald_url || null, system_id: d.system_id || null, system_name: d.system_name || null,
    race: d.race, capital_env: d.capital_env, planet_name: d.planet_name.trim(),
    buildings: d.buildings, bonus_money: d.bonus_money, ideology: d.ideology, culture: d.culture, history: d.history,
    updated_at: new Date().toISOString(),
  };
  const btn = $(status === 'pending' ? '#ap-send' : '#ap-draft', root);
  if (btn) btn.disabled = true;
  try {
    const q = A.id ? sb.from('faction_applications').update(body).eq('id', A.id).select('id').single()
      : sb.from('faction_applications').insert(body).select('id').single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    A.id = data.id; A.status = status;
    try { localStorage.removeItem(draftKey()); } catch { /* ничего */ }
    if (status === 'pending') { A.editing = false; toast('Заявка отправлена на рассмотрение'); renderPending(root); scrollTo(0, 0); }
    else toast('Черновик сохранён');
  } catch (e) {
    toast(`Не удалось сохранить: ${e.message}`, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ── Шаги ─────────────────────────────────────────────────────────── */
const STEP_RENDER = [
  // 0. Политика
  (el, d, redraw) => {
    el.innerHTML = html`
      <h2>Политика</h2>
      <label for="f-name">Полное название державы *</label><input id="f-name" type="text" maxlength="80" value="${d.name}" placeholder="Например: Республика Серениса">
      <label for="f-leader">Глава державы</label><input id="f-leader" type="text" maxlength="80" value="${d.leader}" placeholder="Имя и титул">
      <div class="opts">
        <div><label for="f-gov">Форма правления</label><select id="f-gov">${opt(Object.keys(GOV), d.gov)}</select>
          <p class="opt-d">${GOV[d.gov].d}${GOV[d.gov].star ? raw(html` <b>${GOV[d.gov].star}.</b>`) : ''}</p><div class="mchips">${chips(GOV[d.gov].mods)}</div></div>
        <div><label for="f-regime">Политический режим</label><select id="f-regime">${opt(regimesFor(d.gov), d.regime)}</select>
          <p class="opt-d">Доступны режимы, совместимые с формой правления.</p><div class="mchips">${chips(REGIME[d.regime]?.mods)}</div></div>
        <div><label for="f-civ">Тип цивилизации</label><select id="f-civ">${raw(Object.entries(CIV).map(([k, c]) => html`<option value="${k}" ${raw(k === d.civ_type ? 'selected' : '')}>${c.name}</option>`).join(''))}</select>
          <p class="opt-d">${CIV[d.civ_type].d}</p><div class="mchips">${chips(CIV[d.civ_type].mods)}</div></div>
      </div>`;
    $('#f-name', el).oninput = (e) => { d.name = e.target.value; };
    $('#f-leader', el).oninput = (e) => { d.leader = e.target.value; };
    $('#f-gov', el).onchange = (e) => { d.gov = e.target.value; fixConsistency(d); save(); redraw(); };
    $('#f-regime', el).onchange = (e) => { d.regime = e.target.value; save(); redraw(); };
    $('#f-civ', el).onchange = (e) => { d.civ_type = e.target.value; fixConsistency(d); save(); redraw(); };
  },

  // 1. Облик: цвет и герб
  (el, d, redraw) => {
    el.innerHTML = html`
      <h2>Облик</h2>
      <div class="look">
        <div>
          <label for="f-color">Цвет державы на карте</label>
          <div class="give"><input id="f-color" type="color" value="${hexOf(d.color)}"><span class="hint">Им окрасятся ваши системы и границы.</span></div>
          <label for="f-herald">Герб</label>
          <input id="f-herald" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">
          <p class="hint">PNG, JPG, WEBP или SVG, до 3 МБ. Герб виден в кабинете, в вестнике и в карточке державы.</p>
          <p class="msg" id="h-msg" aria-live="polite"></p>
        </div>
        <figure class="herald-prev" style="--c:${hexOf(d.color)}">${d.herald_url ? raw(html`<img src="${d.herald_url}" alt="Герб державы">`) : raw('<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#e1"/></svg>')}<figcaption>${d.name || 'Ваша держава'}</figcaption></figure>
      </div>`;
    $('#f-color', el).oninput = (e) => { d.color = rgbaOf(e.target.value, 0.34); $('.herald-prev', el).style.setProperty('--c', e.target.value); };
    $('#f-herald', el).onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { $('#h-msg', el).textContent = 'Файл больше 3 МБ.'; return; }
      $('#h-msg', el).textContent = 'Загружаю…';
      const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `heralds/${session.user.id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('wiki-images').upload(path, f, { upsert: false, contentType: f.type });
      if (error) { $('#h-msg', el).textContent = `Не удалось загрузить: ${error.message}`; return; }
      d.herald_url = sb.storage.from('wiki-images').getPublicUrl(path).data.publicUrl;
      save(); redraw();
    };
  },

  // 2. Система
  async (el, d, redraw) => {
    el.innerHTML = html`<h2>Столичная система</h2><p class="opt-d">Выберите <b>свободную</b> звезду: золотые свободны, тусклые заняты. Столица будет основана в этой системе.</p>
      <div class="pick-wrap"><div class="pick-map"><canvas id="pick-cv" aria-label="Выбор системы"></canvas></div>
      <div class="pick-side" id="pick-side"><p class="empty">Загружаю карту…</p></div></div>`;
    let g;
    try { g = await loadGalaxy(); } catch (e) { $('#pick-side', el).innerHTML = html`<p class="empty warn">Карта не загрузилась: ${e.message}</p>`; return; }
    const free = (s) => !s.faction;
    const side = $('#pick-side', el);
    const showSide = () => {
      const s = g.byId[d.system_id];
      side.innerHTML = s
        ? html`<span class="fac"><i></i>${STAR_NAME[s.star_type] || 'Звезда'}</span><h3>${s.name}</h3><p class="hint">Планет: ${s.planets.length}. Соседей по гиперпутям: ${g.lanes.filter((l) => l.a_id === s.id || l.b_id === s.id).length}.</p><p class="ok">Выбрано для столицы.</p>`
        : html`<p class="empty">Свободных систем: ${g.systems.filter(free).length}. Кликните по золотой звезде.</p>`;
    };
    A.view = new GalaxyView($('#pick-cv', el), g, {
      labels: 'auto',
      style: (s) => (s.id === d.system_id ? { fill: '#ffe08a', ring: '#ffe08a', size: 4 } : free(s) ? { fill: '#e9b949' } : { dim: true }),
      onPick: (s) => {
        if (!s) return;
        if (!free(s)) { toast(`«${s.name}» уже занята`, 'err'); return; }
        d.system_id = s.id; d.system_name = s.name; save();
        A.view.selected = s; A.view.draw(); showSide();
      },
    });
    if (d.system_id && g.byId[d.system_id]) A.view.selected = g.byId[d.system_id];
    A.view.draw(); showSide();
  },

  // 3. Столица
  (el, d, redraw) => {
    const locked = d.gov === MACHINE_GOV;
    const homes = homesFor(d.race);
    el.innerHTML = html`
      <h2>Столица</h2>
      <label for="f-race">Раса — определяет родные миры</label>
      ${locked ? raw(html`<p class="locked">Раса закреплена формой правления «${d.gov}»: <b>${d.race}</b>.</p>`) : raw(html`<select id="f-race">${opt(Object.keys(RACE), d.race)}</select>`)}
      <div class="mchips">${chips(RACE[d.race].mods)}${RACE[d.race].star ? raw(html`<span class="mchip good">${RACE[d.race].star}</span>`) : ''}</div>
      <p class="opt-d">Тип родного мира${homes.length > 1 ? '' : ' — единственный для этой расы'}:</p>
      <div class="env-grid">${homes.map((k) => raw(html`<button type="button" class="env" data-env="${k}" aria-pressed="${String(k === d.capital_env)}">
        <span class="env-orb env-${k}"></span><b>${CAPITAL[k].title}</b><small>${CAPITAL[k].name} · ${CAPITAL[k].cells} ячеек</small>
        <small>Ресурсы: ${CAPITAL[k].res.join(', ')}</small><span class="mchips">${chips(CAPITAL[k].mods)}</span></button>`))}</div>
      <label for="f-planet">Название столичной планеты *</label><input id="f-planet" type="text" maxlength="60" value="${d.planet_name}" placeholder="Например: Авалон">`;
    $('#f-race', el)?.addEventListener('change', (e) => { d.race = e.target.value; fixConsistency(d); save(); redraw(); });
    $('.env-grid', el).onclick = (e) => { const b = e.target.closest('[data-env]'); if (b) { d.capital_env = b.dataset.env; save(); redraw(); } };
    $('#f-planet', el).oninput = (e) => { d.planet_name = e.target.value; };
  },

  // 4. Постройки
  (el, d, redraw) => {
    const free = CIV[d.civ_type].free;
    const left = POINTS - spent(d);
    el.innerHTML = html`
      <h2>Стартовые постройки</h2>
      <p class="points">Осталось очков: <b class="${left < 0 ? 'bad' : ''}">${left}</b> из ${POINTS}</p>
      <div class="blds">${BUILDINGS.map((b) => {
        const isFree = b.id === free, on = isFree || d.buildings.includes(b.id);
        return raw(html`<label class="bld ${on ? 'on' : ''} ${isFree ? 'free' : ''}" for="b-${b.id}">
          <input type="checkbox" id="b-${b.id}" data-b="${b.id}" ${raw(on ? 'checked' : '')} ${raw(isFree ? 'disabled' : '')}>
          <span><b>${b.name}</b><small>${b.d}</small></span><em>${isFree ? 'бесплатно' : `${b.price} очк.`}</em></label>`);
      })}
        <label class="bld ${d.bonus_money ? 'on' : ''}" for="b-money"><input type="checkbox" id="b-money" ${raw(d.bonus_money ? 'checked' : '')}>
          <span><b>+500 ГС</b><small>Стартовый капитал в казну.</small></span><em>${MONEY_PRICE} очк.</em></label></div>
      <p class="callout">Надёжный старт: Гражданская фабрика, Торговый хаб, Центр подготовки и +500 ГС.</p>`;
    el.querySelector('.blds').onchange = (e) => {
      if (e.target.id === 'b-money') d.bonus_money = e.target.checked;
      else if (e.target.dataset.b) {
        const id = e.target.dataset.b;
        d.buildings = e.target.checked ? [...new Set([...d.buildings, id])] : d.buildings.filter((x) => x !== id);
      }
      if (spent(d) > POINTS) { toast('Не хватает очков', 'err'); if (e.target.id === 'b-money') d.bonus_money = false; else d.buildings = d.buildings.filter((x) => x !== e.target.dataset.b); }
      save(); redraw();
    };
  },

  // 5. Культура
  (el, d, redraw) => {
    const allowed = ideologiesFor(d.gov);
    const banned = GOV_IDEO_BAN[d.gov] || [];
    el.innerHTML = html`
      <h2>Культура</h2>
      <p class="opt-d">Раса: <b>${d.race}</b>.</p>
      <label for="f-ideo">Идеология</label><select id="f-ideo">${opt(allowed, d.ideology)}</select>
      ${banned.length ? raw(html`<p class="hint">Форма правления «${d.gov}» исключает: ${banned.join(', ')}.</p>`) : ''}
      <div class="mchips">${chips(IDEOLOGY[d.ideology]?.mods)}${IDEOLOGY[d.ideology]?.star ? raw(html`<span class="mchip good">${IDEOLOGY[d.ideology].star}</span>`) : ''}</div>
      <label for="f-culture">Культура и особенности народа</label>
      <textarea id="f-culture" rows="6" maxlength="4000" placeholder="Обычаи, ценности, внешний облик, чем этот народ отличается от соседей">${d.culture}</textarea>`;
    $('#f-ideo', el).onchange = (e) => { d.ideology = e.target.value; save(); redraw(); };
    $('#f-culture', el).oninput = (e) => { d.culture = e.target.value; };
  },

  // 6. История
  (el, d) => {
    el.innerHTML = html`
      <h2>История</h2>
      <p class="opt-d">Откуда пришла держава, как возникла, чем живёт сейчас. Команда проекта читает историю при рассмотрении заявки.</p>
      <textarea id="f-history" rows="14" maxlength="20000" placeholder="История державы">${d.history}</textarea>
      <p class="hint" id="h-count">${d.history.length} / 20 000</p>`;
    $('#f-history', el).oninput = (e) => { d.history = e.target.value; $('#h-count', el).textContent = `${d.history.length} / 20 000`; };
  },

  // 7. Обзор
  async (el, d) => {
    const err = validate(null, true);
    el.innerHTML = html`
      <h2>Обзор</h2>
      <div class="review">
        <figure class="herald-prev" style="--c:${hexOf(d.color)}">${d.herald_url ? raw(html`<img src="${d.herald_url}" alt="Герб державы">`) : raw('<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#e1"/></svg>')}<figcaption>${d.name || 'Без названия'}</figcaption></figure>
        <dl class="kv">
          <dt>Глава</dt><dd>${d.leader || '—'}</dd>
          <dt>Правление</dt><dd>${d.gov} · ${d.regime}</dd>
          <dt>Тип</dt><dd>${CIV[d.civ_type].name}</dd>
          <dt>Раса</dt><dd>${d.race}</dd>
          <dt>Идеология</dt><dd>${d.ideology}</dd>
          <dt>Столица</dt><dd>${d.planet_name || '—'} · ${d.system_name || 'система не выбрана'} · ${CAPITAL[d.capital_env].title}</dd>
          <dt>Постройки</dt><dd>${[BUILDINGS.find((b) => b.id === CIV[d.civ_type].free)?.name + ' (бесплатно)', ...d.buildings.map((id) => BUILDINGS.find((b) => b.id === id)?.name)].filter(Boolean).join(', ')}${d.bonus_money ? ', +500 ГС' : ''}</dd>
        </dl>
      </div>
      <h3 class="sub-h">Доктрина: итог бонусов</h3><div class="mchips">${chips(sumMods(d))}</div>
      <h3 class="sub-h">Discord</h3><div id="rv-ds"><p class="hint">Проверяю…</p></div>
      ${err ? raw(html`<p class="callout warn">Не заполнено: ${err.msg}</p>`) : raw('<p class="callout">Всё готово. После отправки заявку рассмотрит команда проекта.</p>')}`;
    const ds = await myDiscord();
    const box = $('#rv-ds', el); if (!box) return;
    box.innerHTML = ds.linked
      ? html`<p>${discordBadge(ds.name)} Команда увидит, кто подаёт заявку.</p>`
      : html`<p class="hint">Discord не привязан. Привяжите его в <a href="#/account">аккаунте</a>: так команде проще подтвердить заявку.</p>`;
  },
];

function hexOf(c) { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c : '#e9b949'; return '#' + m[1].split(',').slice(0, 3).map((x) => Math.round(parseFloat(x)).toString(16).padStart(2, '0')).join(''); }
function rgbaOf(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`; }
export { $$ };
