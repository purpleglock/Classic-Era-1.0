import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num } from '../lib/format.js';

/**
 * #/intel — «Разведка» на новом движке.
 * Агенты: наём с рынка рекрутов, охрана своих систем, увольнение. Специализаций, уровней,
 * тренировок и артефактов нет. Операции: 11 видов, до 3 агентов на задание.
 * Донесения: итоги своих операций, наблюдатели и всё, что сделали против нас.
 * Плен: держать, отпустить или предложить выкуп; свои пленные — заплатить или отказаться.
 * Сервер: v1_intel_* (миграция 42).
 */
const hhmm = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const left = (t) => {
  const ms = new Date(t) - Date.now();
  if (ms <= 0) return 'вот-вот';
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : h ? `${h} ч ${m} мин` : `${Math.max(1, m)} мин`;
};
const ini = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const KIND = { report: ['Наша операция', ''], incident: ['Против нас', 'bad'], watch: ['Наблюдатель', 'blue'], captive: ['Плен', ''], ransom: ['Выкуп', ''] };
const FILTERS = [['all', 'Все'], ['report', 'Наши операции'], ['incident', 'Против нас'], ['watch', 'Наблюдатели'], ['captive', 'Плен и выкуп']];
let tab = 'agents', filter = 'all', poll = 0;

export async function renderIntel(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-eye')}</span><div><h1>Разведка</h1><p>Войдите, чтобы командовать агентами державы.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) { root.innerHTML = html`<section class="panel gate"><div><h1>У вас пока нет державы</h1></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`; return; }
  if (!root.querySelector('.iv-wrap')) root.innerHTML = '<div class="skeleton">Связываюсь с резидентурой…</div>';
  let s;
  try { s = await rpc('v1_intel_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Разведка недоступна</h1><p>${e.missingSchema ? 'Новая разведка ещё не подключена в базе.' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  const y = scrollY; draw(root, s); scrollTo(0, y);
  clearInterval(poll);
  poll = setInterval(() => {
    if (!root.querySelector('.iv-wrap') || !location.hash.startsWith('#/intel')) { clearInterval(poll); return; }
    if (document.querySelector('.veil') || root.querySelector('form:focus-within, select:focus')) return;
    renderIntel(root);
  }, 60000);
}

/** Подробности донесения по виду операции. */
function details(d) {
  const r = d?.result || {}, op = d?.op;
  if (!d?.result || !Object.keys(r).length) return '';
  if (op === 'recon_basic') return html`<dl class="iv-dl">
    <dt>Казна</dt><dd>${num(r.gc)} ГС</dd><dt>Колоний</dt><dd>${num(r.colonies)}</dd><dt>Систем</dt><dd>${num(r.systems)}</dd>
    <dt>Флотов</dt><dd>${num(r.fleets)}</dd><dt>Армий</dt><dd>${num(r.armies)}</dd><dt>Агентов</dt><dd>${num(r.agents)} (на охране ${num(r.guards)})</dd>
    <dt>Воюет с</dt><dd>${(r.wars || []).length ? r.wars.join(', ') : 'ни с кем'}</dd></dl>`;
  if (op === 'recon_deep') return html`<div class="iv-cols">
    <div><b>Склад</b><ul>${Object.entries(r.stock || {}).map(([k, v]) => raw(html`<li>${k}<span>${num(v)}</span></li>`))}</ul></div>
    <div><b>Постройки</b><ul>${Object.entries(r.buildings || {}).map(([k, v]) => raw(html`<li>${k}<span>${num(v)}</span></li>`))}</ul></div>
    <div><b>Очередь верфей</b><ul>${(r.queue || []).length ? r.queue.map((q) => raw(html`<li>${q.name} ×${q.qty}<span>${q.system || ''} · ${hhmm(q.ready_at)}</span></li>`)) : raw('<li>пусто</li>')}</ul></div></div>`;
  if (op === 'fleet_dossier') return html`<ul class="iv-fleets">${(r.fleets || []).map((f) => raw(html`<li>
    <b>${f.name}</b><small>${f.dest ? `летит в ${f.dest}${f.arrive_at ? `, прибытие ${hhmm(f.arrive_at)}` : ''}` : `стоит: ${f.system || '—'}`}${f.stance === 'defend' ? ' · в обороне' : ''}${f.fuel_cap ? ` · запас хода ${num(f.fuel)}/${num(f.fuel_cap)}` : ''}</small>
    <span>${(f.ships || []).map((x) => `${x.name} ×${x.qty}`).join(', ') || 'пустой'}</span></li>`))}</ul>`;
  if (op === 'steal_gc') return html`<p class="iv-got">Добыто: <b>${num(r.gc)} ГС</b></p>`;
  if (op === 'steal_res') return html`<p class="iv-got">Добыто: <b>${Object.entries(r.resources || {}).map(([k, v]) => `${k} ${num(v)}`).join(', ') || 'ничего'}</b></p>`;
  if (op === 'sabotage') return html`<p class="iv-got">${r.building ? `На колонии «${r.colony}» разрушена постройка: ${r.building}.` : `На колонии «${r.colony}» нечего было разрушать.`}</p>`;
  if (op === 'yard_sabotage') return html`<p class="iv-got">Задержано заказов верфей: <b>${num(r.orders)}</b> на ${num(r.hours)} ч.</p>`;
  if (op === 'drain_fuel') return html`<p class="iv-got">${Object.keys(r.fleets || {}).length ? `Запас хода снижен у флотов: ${Object.keys(r.fleets).map((n) => `«${n}»`).join(', ')}.` : 'На стоянке не нашлось ни одного флота.'}</p>`;
  if (op === 'incite') return html`<p class="iv-got">Порядок на колонии «${r.colony}»: ${r.order} на ${r.days} дн.</p>`;
  if (op === 'kill_agent') return html`<p class="iv-got">${r.agent ? `Устранён агент ${r.agent}.` : 'Свободных агентов у цели не нашлось.'}</p>`;
  if (op === 'watch') return html`<p class="iv-got">Наблюдатель на месте: система ${r.system}, ${r.days} дн.</p>`;
  return '';
}

function draw(root, s) {
  const cfg = s.settings || {}, OPS = cfg.ops || {}, can = !!s.can;
  const agents = s.agents || [], free = agents.filter((a) => a.free), ops = s.ops || [], log = s.log || [];
  const captives = s.captives || [], jailed = s.jailed || [];
  const MAXP = cfg.max_per_op || 3, cap = cfg.max_agents || 20;
  const reload = () => renderIntel(root);
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); reload(); return r; } catch (e) { toast(e.message, 'err'); } };
  const opName = (k) => OPS[k]?.label || k;
  const status = (a) => a.op ? html`<span class="iv-st busy">${a.op.status === 'watching' ? 'наблюдает' : 'на задании'}: ${opName(a.op.op)} · ${a.op.target} · ${left(a.op.status === 'watching' ? a.op.until : a.op.ready_at)}</span>`
    : a.guard ? html`<span class="iv-st guard">${icon('i-shield')}охраняет ${a.guard.name}</span>`
      : a.old_busy ? html`<span class="iv-st busy">занят по старому заданию</span>`
        : !a.free ? html`<span class="iv-st busy">отдыхает · ${left(a.ready_at)}</span>` : html`<span class="iv-st ok">свободен</span>`;
  const opsList = Object.entries(OPS);
  const nJail = captives.length + jailed.length;
  const nIn = log.filter((l) => l.kind === 'incident').length;

  root.innerHTML = html`<div class="rx-wrap iv-wrap">
    <section class="panel st-hero">
      <div class="st-title"><a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a><h1>Разведка</h1>
        <p>Агенты ведут разведку, воруют, саботируют и следят за флотами врага. Чем больше агентов на задании, тем выше шанс успеха, но и риск раскрытия. Охрана систем мешает чужим агентам. Раскрытая операция выдаёт заказчика, а провал с раскрытием отправляет агента в плен.</p></div>
      <div class="fl-kpi">
        <div class="col-treasury"><small>Казна</small><b>${num(s.gc)} ГС</b></div>
        <div class="col-treasury"><small>Агентов</small><b>${agents.length} / ${cap}</b></div>
        <div class="col-treasury"><small>На заданиях</small><b>${ops.length}</b></div>
      </div>
    </section>
    ${can ? '' : raw('<p class="panel note-bar">Смотреть можно, но командуют разведкой правитель и члены державы с правом «Разведка» или «Армия».</p>')}
    <section class="panel fl-body">
      <div class="tabs" role="tablist">${[['agents', `Агенты · ${agents.length}`], ['ops', `Операции${ops.length ? ` · ${ops.length}` : ''}`], ['log', `Донесения${nIn ? ` · ${nIn} против нас` : ''}`], ['jail', `Плен${nJail ? ` · ${nJail}` : ''}`]]
        .map(([k, t]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`))}</div>

      <div class="fl-pane" data-pane="agents" ${tab === 'agents' ? '' : raw('hidden')}>
        ${can ? raw(html`<div class="iv-recruits"><p class="fl-sub">Рынок рекрутов · обновляется раз в сутки</p>
          <div class="iv-rgrid">${(s.recruits || []).map((r) => raw(html`<article class="iv-rec"><span class="fl-crest mono">${ini(r.name)}</span>
            <div><b>${r.name}</b><small>уйдёт через ${left(r.expires)}</small></div>
            <button type="button" class="btn sm gold" data-hire="${r.id}" ${raw(agents.length >= cap ? 'disabled title="Достигнут предел агентов"' : '')}>Нанять · ${num(r.cost)} ГС</button></article>`))}</div></div>`) : ''}
        ${agents.length ? raw(html`<ul class="iv-agents">${agents.map((a) => raw(html`<li>
          <span class="fl-crest mono">${ini(a.name)}</span>
          <div class="iv-an"><b>${a.name}</b>${raw(status(a))}</div>
          ${can ? raw(html`<div class="iv-aact">
            ${a.guard ? raw(html`<button type="button" class="btn sm" data-unguard="${a.id}">Снять с охраны</button>`)
              : a.free ? raw(html`<select data-guard="${a.id}" aria-label="Поставить на охрану"><option value="">На охрану системы…</option>${(s.systems || []).map((x) => raw(html`<option value="${x.id}">${x.name}</option>`))}</select>`) : ''}
            ${a.free || a.guard ? raw(html`<button type="button" class="btn sm" data-fire="${a.id}">Уволить</button>`) : ''}</div>`) : ''}
        </li>`))}</ul>`) : raw('<p class="empty">Агентов нет. Наймите первых на рынке рекрутов.</p>')}
        <p class="fl-note">Агент на охране стережёт систему: операции против державы реже удаются и чаще раскрываются (каждый охранник −${cfg.guard_succ || 3} % к успеху и +${cfg.guard_det || 4} % к раскрытию, до −${cfg.guard_succ_cap || 20} % / +${cfg.guard_det_cap || 25} %), а охранник в той самой системе — ещё −${cfg.sys_guard_succ || 10} % / +${cfg.sys_guard_det || 15} %. Охранник не ходит на задания.</p>
      </div>

      <div class="fl-pane" data-pane="ops" ${tab === 'ops' ? '' : raw('hidden')}>
        ${can ? raw(html`<form class="iv-form" id="iv-form">
          <div class="iv-opgrid" role="radiogroup" aria-label="Операция">${opsList.map(([k, o], i) => raw(html`<label class="iv-op">
            <input type="radio" name="op" value="${k}" ${raw(i === 0 ? 'checked' : '')}><span><b>${o.label}</b><small>${o.desc}</small>
            <em>${o.hours} ч · ${num(o.gc)} ГС за агента · успех ${o.succ} % · раскрытие ${o.det} %</em></span></label>`))}</div>
          <div class="iv-row">
            <label><span>Цель</span><select name="target" required><option value="">Держава…</option>${(s.factions || []).map((f) => raw(html`<option value="${f.id}">${f.name}${f.war ? ' · война' : ''}</option>`))}</select></label>
            <label data-need="colony" hidden><span>Колония</span><select name="colony"></select></label>
            <label data-need="system" hidden><span>Система</span><select name="system"></select></label>
          </div>
          <p class="fl-sub">Агенты · до ${MAXP}</p>
          ${free.length ? raw(html`<div class="iv-pick">${free.map((a) => raw(html`<label><input type="checkbox" name="agent" value="${a.id}"><span>${a.name}</span></label>`))}</div>`)
            : raw('<p class="empty">Свободных агентов нет: все на заданиях, на охране или отдыхают.</p>')}
          <div class="fl-est" id="iv-est"></div>
          <button class="btn gold" ${raw(free.length ? '' : 'disabled')}>Начать операцию</button>
        </form>`) : ''}
        <h3 class="fl-h3">Идут сейчас</h3>
        ${ops.length ? raw(html`<ul class="fl-queue">${ops.map((o) => raw(html`<li>
          <span class="fl-n"><b>${opName(o.op)} · ${o.target}</b><small>${o.colony ? `колония «${o.colony}» · ` : ''}${o.system ? `система ${o.system} · ` : ''}агентов ${o.agents} · успех ${o.success} % · раскрытие ${o.detect} %</small></span>
          <span class="fl-t">${icon('i-clock')}${o.status === 'watching' ? `наблюдает ещё ${left(o.until)}` : `итог через ${left(o.ready_at)}`}</span>
          ${can && o.status === 'watching' ? raw(html`<button type="button" class="btn sm" data-recall="${o.id}">Отозвать</button>`) : ''}</li>`))}</ul>`) : raw('<p class="empty">Агенты сейчас никуда не отправлены.</p>')}
      </div>

      <div class="fl-pane" data-pane="log" ${tab === 'log' ? '' : raw('hidden')}>
        <div class="iv-filters">${FILTERS.map(([k, t]) => raw(html`<button type="button" class="bm-chip ${filter === k ? 'on' : ''}" data-filter="${k}">${t}</button>`))}</div>
        <ul class="iv-log">${log.filter((l) => filter === 'all' || l.kind === filter || (filter === 'captive' && l.kind === 'ransom')).map((l) => raw(html`<li class="${KIND[l.kind]?.[1] || ''}">
          <div class="iv-lh"><span class="tag">${KIND[l.kind]?.[0] || l.kind}</span><b>${l.title}</b><time>${hhmm(l.at)}</time></div>
          ${l.body ? raw(html`<p>${l.body}</p>`) : ''}${raw(l.kind === 'report' ? details(l.data) : '')}</li>`))}</ul>
        ${log.length ? '' : raw('<p class="empty">Донесений пока нет.</p>')}
      </div>

      <div class="fl-pane" data-pane="jail" ${tab === 'jail' ? '' : raw('hidden')}>
        <h3 class="fl-h3">Чужие агенты в нашей тюрьме</h3>
        ${captives.length ? raw(html`<ul class="iv-agents">${captives.map((c) => raw(html`<li><span class="fl-crest mono">${ini(c.name)}</span>
          <div class="iv-an"><b>${c.name}</b><span class="iv-st">агент державы «${c.owner}»${c.since ? ` · в плену с ${hhmm(c.since)}` : ''}${c.ransom ? ` · выкуп ${num(c.ransom.price)} ГС: ${{ open: 'ждём ответа', declined: 'отказались', paid: 'оплачен', void: 'снят' }[c.ransom.status] || c.ransom.status}` : ''}</span></div>
          ${can ? raw(html`<form class="iv-aact" data-ransom="${c.id}"><input type="number" name="price" min="0" step="100" placeholder="Цена, ГС" aria-label="Цена выкупа" required>
            <button class="btn sm gold">Предложить выкуп</button><button type="button" class="btn sm" data-release="${c.id}">Отпустить</button></form>`) : ''}</li>`))}</ul>`)
          : raw('<p class="empty">Пленных нет. Агент, пойманный на провале, попадает сюда.</p>')}
        <h3 class="fl-h3">Наши агенты в плену</h3>
        ${jailed.length ? raw(html`<ul class="iv-agents">${jailed.map((c) => raw(html`<li><span class="fl-crest mono">${ini(c.name)}</span>
          <div class="iv-an"><b>${c.name}</b><span class="iv-st bad">в тюрьме державы «${c.captor}»${c.ransom ? ` · просят ${num(c.ransom.price)} ГС` : ' · выкуп не предлагали'}</span></div>
          ${can && c.ransom ? raw(html`<div class="iv-aact"><button type="button" class="btn sm gold" data-pay="${c.ransom.id}">Заплатить ${num(c.ransom.price)} ГС</button><button type="button" class="btn sm" data-decline="${c.ransom.id}">Отказаться</button></div>`) : ''}</li>`))}</ul>`)
          : raw('<p class="empty">Все наши агенты на свободе.</p>')}
        <p class="fl-note">Пленного можно держать сколько угодно, отпустить без условий или предложить выкуп. Казней и перевербовки нет. Отпущенный агент сутки отдыхает.</p>
      </div>
    </section>
  </div>`;

  $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }));
  $$('[data-filter]', root).forEach((b) => (b.onclick = () => { filter = b.dataset.filter; draw(root, s); }));
  $$('[data-hire]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_intel_hire', { p_recruit: b.dataset.hire }), 'Агент нанят.')));
  $$('[data-guard]', root).forEach((sel) => (sel.onchange = () => sel.value && run(() => rpc('v1_intel_guard', { p_agent: sel.dataset.guard, p_system: sel.value }), 'Агент заступил на охрану.')));
  $$('[data-unguard]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_intel_guard', { p_agent: b.dataset.unguard, p_system: null }), 'Агент снят с охраны.')));
  $$('[data-fire]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Уволить агента? Деньги за наём не вернутся.', 'Уволить'))) return;
    run(() => rpc('v1_intel_fire', { p_agent: b.dataset.fire }), 'Агент уволен.');
  }));
  $$('[data-recall]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_intel_recall', { p_op: b.dataset.recall }), 'Наблюдатель отозван.')));
  $$('[data-release]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Отпустить пленного без выкупа?', 'Отпустить'))) return;
    run(() => rpc('v1_intel_release', { p_agent: b.dataset.release }), 'Пленный отпущен.');
  }));
  $$('[data-ransom]', root).forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); run(() => rpc('v1_intel_ransom', { p_agent: f.dataset.ransom, p_price: Number(f.price.value) }), 'Выкуп предложен.'); }));
  $$('[data-pay]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Заплатить выкуп? Агент вернётся и сутки будет отдыхать.', 'Заплатить'))) return;
    run(() => rpc('v1_intel_ransom_answer', { p_ransom: b.dataset.pay, p_accept: true }), 'Выкуп заплачен, агент возвращается.');
  }));
  $$('[data-decline]', root).forEach((b) => (b.onclick = () => run(() => rpc('v1_intel_ransom_answer', { p_ransom: b.dataset.decline, p_accept: false }), 'Выкуп отклонён.')));

  // ── форма операции ──
  const fm = $('#iv-form', root);
  if (!fm) return;
  let targets = null;
  const op = () => OPS[fm.querySelector('[name=op]:checked')?.value] || {};
  const est = () => {
    const o = op(), n = $$('[name=agent]:checked', fm).length;
    $$('[data-need]', fm).forEach((l) => (l.hidden = l.dataset.need !== o.target));
    $$('[name=agent]', fm).forEach((c) => (c.disabled = !c.checked && n >= MAXP));
    const k = Math.max(1, n);
    const succ = Math.min(95, o.succ + (cfg.extra_agent_succ || 8) * (k - 1)), det = Math.min(95, o.det + (cfg.extra_agent_det || 4) * (k - 1));
    $('#iv-est', root).innerHTML = html`
      <span><small>Успех</small><b class="good">до ${succ} %</b></span><span><small>Раскрытие</small><b class="warn">от ${det} %</b></span>
      <span><small>Стоимость</small><b class="${o.gc * k > s.gc ? 'bad' : ''}">${num(o.gc * k)} ГС</b></span><span><small>Срок</small><b>${o.hours} ч</b></span>
      <em>Охрана цели (её число вам неизвестно) снизит успех и поднимет риск раскрытия.</em>`;
  };
  const fillTargets = async () => {
    fm.colony.innerHTML = ''; fm.system.innerHTML = ''; targets = null;
    if (!fm.target.value) return;
    try { targets = await rpc('v1_intel_targets', { p_fid: fm.target.value }); } catch (e) { toast(e.message, 'err'); return; }
    fm.colony.innerHTML = targets.colonies.map((c) => html`<option value="${c.id}">${c.name} · ${c.system || ''}${c.capital ? ' ★' : ''}</option>`).join('');
    fm.system.innerHTML = targets.systems.map((x) => html`<option value="${x.id}">${x.name}</option>`).join('');
  };
  fm.target.onchange = fillTargets;
  fm.addEventListener('change', (e) => { if (e.target.name === 'op' || e.target.name === 'agent') est(); });
  est();
  fm.onsubmit = (e) => {
    e.preventDefault();
    const o = op(), k = fm.querySelector('[name=op]:checked').value, ids = $$('[name=agent]:checked', fm).map((c) => c.value);
    if (!ids.length) { toast('Выберите хотя бы одного агента.', 'err'); return; }
    if (o.target === 'colony' && !fm.colony.value) { toast('Выберите колонию цели.', 'err'); return; }
    if (o.target === 'system' && !fm.system.value) { toast('Выберите систему цели.', 'err'); return; }
    run(() => rpc('v1_intel_launch', { p_op: k, p_target: fm.target.value, p_agents: ids, p_colony: o.target === 'colony' ? fm.colony.value : null, p_system: o.target === 'system' ? fm.system.value : null }),
      (r) => `Агенты отправлены: итог ${hhmm(r.ready_at)}.`);
  };
}
