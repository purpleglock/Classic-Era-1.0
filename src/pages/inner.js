import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, dayMonth, dateTime, leftText } from '../lib/format.js';

/**
 * #/inner — внутренняя политика: порядок колоний и волнения, курс державы, вера.
 * Сервер: v1_inner_state, v1_unrest_decide, v1_course_set, v1_faith_*.
 */

const TABS = [['order', 'Порядок'], ['budget', 'Бюджет'], ['course', 'Курс'], ['faith', 'Вера'], ['log', 'Журнал']];
const LVL = ['нет', 'скудно', 'норма', 'усиленно', 'максимум'];
const BUDGET = [
  ['industry', 'Промышленность', (l, c) => `работает ${c.slots?.[l] ?? '?'} из 6 слотов гражданских построек, рабочие — ${[10, 20, 30, 40, 50][l]} % населения`],
  ['military', 'Оборонзаказ', (l, c) => `работает ${c.slots?.[l] ?? '?'} из 6 слотов военных построек${l === 0 ? '; войска не строятся вовсе' : ''}; чем выше, тем быстрее производство`],
  ['science', 'Образование', (l, c) => `работает ${c.slots?.[l] ?? '?'} из 6 слотов институтов и спецслужб, наука ×${[0.5, 0.8, 1, 1.2, 1.4][l].toLocaleString('ru-RU')}`],
  ['social', 'Соцобеспечение', (l) => `доход ×${[0.85, 0.95, 1, 1.08, 1.15][l].toLocaleString('ru-RU')}, население ${['−2', '+0,5', '+1,5', '+2,5', '+3,5'][l]} % в сутки`],
  ['infra', 'Инфраструктура', (l) => `ёмкость складов ×${[0.8, 0.9, 1, 1.15, 1.3][l].toLocaleString('ru-RU')}`],
];
const STAGE = { calm: 'спокойно', unrest: 'волнения', rebellion: 'восстание' };
// подписи осей курса: [название, «хорошо» — когда плюс]
const AX = {
  gc: ['доход', true], mine: ['добыча', true], build: ['цена построек', false], research: ['цена науки', false],
  colonize: ['цена колоний', false], claim_cost: ['цена захвата', false], claim_cd: ['перерыв захвата', false],
  order: ['порядок', true], fleet: ['вместимость флота', true], sci_flat: ['ОН в сутки', true],
};
const CUSTOM = [['gc', 'Доход'], ['mine', 'Добыча'], ['build', 'Стройка'], ['research', 'Наука'], ['order', 'Порядок'], ['fleet', 'Флот']];

function axStep(k, axes = {}) {
  const v = Number(axes?.[k]);
  if (!v) return '';
  if (k === 'order') return ` ${v > 0 ? '+' : ''}${v} за очко`;
  const good = { build: 'дешевле', research: 'дешевле' }[k];
  return good ? ` −${Math.round(Math.abs(v) * 100)} % цены за очко` : ` +${Math.round(v * 100)} % за очко`;
}

function modChips(m = {}) {
  return Object.entries(m).filter(([k, v]) => AX[k] && Number(v)).map(([k, v]) => {
    const n = Number(v), [label, plusGood] = AX[k];
    const txt = k === 'order' || k === 'sci_flat' ? `${n > 0 ? '+' : ''}${n}` : `${n > 0 ? '+' : ''}${Math.round(n * 100)} %`;
    return `<span class="ip-mod ${(n > 0) === plusGood ? 'good' : 'bad'}">${label} ${txt}</span>`;
  }).join('');
}

export async function renderInner(root, ui = { tab: new URLSearchParams(location.hash.split('?')[1] || '').get('t') || 'order', onlyBad: false, q: '', open: new Set(), openSys: new Set(), custom: null }) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-crown')}</span><div><h1>Внутренняя политика</h1><p>Войдите, чтобы управлять державой.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Внутренняя политика откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.ip-wrap')) root.innerHTML = '<div class="skeleton">Слушаю, о чём говорят в колониях…</div>';
  let s;
  try { [s, ui.budget] = await Promise.all([rpc('v1_inner_state'), rpc('v1_budget_state').catch(() => null)]); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Внутренняя политика недоступна</h1><p>${e.missingSchema ? 'Внутренняя политика ещё не подключена в базе (миграция 20).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s, ui);
}

function draw(root, s, ui) {
  const o = s.order || {}, c = s.course || {}, f = s.faith || {}, cfg = s.cfg || {};
  const can = s.can_manage;
  const cols = o.colonies || [];
  const course = (c.list || []).find((x) => x.key === c.key) || {};
  const courseName = c.key === 'ideo' ? c.ideo?.name || course.name : course.name;
  const mine = f.mine || [];
  const mainFaith = mine.find((x) => x.id === f.main);

  const decisions = (col) => {
    const garrison = col.garrison > 0;
    const list = [
      ['concessions', `Пойти на уступки · ${num((cfg.concessions_cost || 25000) * (col.stage === 'rebellion' ? 2 : 1))} ГС`, `+${cfg.concessions_order || 30} к порядку на ${cfg.concessions_days || 5} дн.`, true],
      ['army', col.stage === 'rebellion' ? 'Подавить армией' : 'Ввести войска', `+${cfg.army_order || 25} на ${cfg.army_days || 5} дн., соседям по системе ${cfg.army_neighbors || -5}${col.stage === 'rebellion' ? '; восстание подавлено, но вся держава −10 на 3 дня' : ''}. Нужен флот в системе или армия на планете.`, garrison],
      ['preach', `Проповедь веры · ${num(cfg.preach_cost || 10000)} ГС`, `+${cfg.preach_order || 20} на ${cfg.preach_days || 7} дн., колония возвращается к государственной вере.`, !!f.main],
      ['martial', 'Военное положение', `+${cfg.martial_order || 40} на ${cfg.martial_days || 3} дн., но колония не приносит дохода.`, col.stage !== 'rebellion'],
    ];
    return html`<div class="ip-dec">${list.map(([k, l, d, ok]) => raw(html`<button type="button" class="ip-choice" data-dec="${k}" data-col="${col.id}" data-label="${l}" ${raw(ok && can ? '' : 'disabled')}><b>${l}</b><small>${d}</small></button>`))}</div>`;
  };

  const meter = (v) => {
    const p = Math.max(-100, Math.min(100, v));
    return `<span class="ip-meter ${p < (cfg.unrest_at ?? -50) ? 'crit' : p < 0 ? 'low' : p > 50 ? 'high' : ''}"><i style="--l:${p < 0 ? 50 + p / 2 : 50}%;--w:${Math.abs(p) / 2}%"></i></span>`;
  };

  const tabs = {
    order: () => {
      const q = ui.q.toLowerCase();
      const rows = cols.filter((x) => (!ui.onlyBad || x.stage !== 'calm' || x.value < 0) && (!q || `${x.name} ${x.system}`.toLowerCase().includes(q)));
      return html`
      ${s.live ? '' : raw(html`<p class="panel note-bar ip-preview">${icon('i-eye')}<span><b>Режим просмотра.</b> Порядок, волнения и решения работают, но восставшие колонии пока не отделяются, а доход не режется. Включит команда проекта, когда механика будет оценена.</span></p>`)}
      <section class="ip-sum">
        <div class="panel"><small>Средний порядок</small><b>${o.avg ?? '—'}</b></div>
        <div class="panel ${o.unrest ? 'warn' : ''}"><small>Волнения</small><b>${o.unrest}</b></div>
        <div class="panel ${o.rebellion ? 'warn' : ''}"><small>Восстания</small><b>${o.rebellion}</b></div>
        <div class="panel"><small>Ниже нуля</small><b>${o.low}</b><em>доход ${Math.round((cfg.income_low ?? -0.25) * 100)} %</em></div>
        <div class="panel"><small>Выше 50</small><b>${o.high}</b><em>доход +${Math.round((cfg.income_high ?? 0.1) * 100)} %</em></div>
        <div class="panel"><small>Слотов СБ</small><b>${o.police}</b><em>служба безопасности</em></div>
      </section>
      ${(o.state_mods || []).length ? raw(html`<p class="panel ip-state">${icon('i-flag')}<span>На всю державу: ${o.state_mods.map((m) => `${m.source} ${m.amount > 0 ? '+' : ''}${m.amount} (до ${dayMonth(m.until)})`).join(' · ')}</span></p>`) : ''}
      <section class="panel col-sec">
        <div class="sec-h"><h2>Колонии</h2>
          <label class="check col-free"><input type="checkbox" id="ip-bad" ${raw(ui.onlyBad ? 'checked' : '')}> <span>Только неспокойные</span></label>
          <input class="search" type="search" id="ip-q" value="${ui.q}" placeholder="Найти колонию" aria-label="Найти колонию"></div>
        <p class="hint">Порядок от −100 до 100. Ниже ${cfg.unrest_at ?? -50} начинаются волнения: сначала их пытается погасить служба безопасности (постройте её отделения в «Управлении колониями»), не справится — нужно ваше решение за ${cfg.unrest_days || 2} дн., иначе восстание. Восстание без подавления за ${cfg.secede_days || 5} дн. — колония отделяется.</p>
        ${(() => {
          if (!rows.length) return raw('<p class="empty-li">Ничего не найдено.</p>');
          const groups = new Map();
          rows.forEach((x) => { const k = x.system || '—'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
          const rank = { rebellion: 2, unrest: 1, calm: 0 };
          const sys = [...groups.entries()].map(([name, list]) => ({ name, list, worst: list.reduce((m, x) => (rank[x.stage] > rank[m] ? x.stage : m), 'calm'),
            avg: Math.round(list.reduce((a, x) => a + x.value, 0) / list.length), min: Math.min(...list.map((x) => x.value)), cap: list.some((x) => x.capital) }))
            .sort((a, b) => (rank[b.worst] - rank[a.worst]) || (b.cap - a.cap) || (a.min - b.min));
          return raw(html`<div class="ip-systems">${sys.map((g) => raw(html`<details class="ip-sys ${g.worst}" data-sys="${g.name}" ${raw(ui.openSys.has(g.name) || g.worst !== 'calm' || !!q ? 'open' : '')}>
            <summary><span class="b-n"><b>${g.name}</b>${g.cap ? raw('<em class="cbadge on">Столица</em>') : ''}<small>${g.list.length} ${plural(g.list.length, 'колония', 'колонии', 'колоний')} · худший порядок ${g.min > 0 ? '+' : ''}${g.min}</small></span>
              ${raw(meter(g.avg))}<b class="ip-val">${g.avg > 0 ? '+' : ''}${g.avg}</b>
              <span class="cbadge ${g.worst === 'calm' ? 'dim' : 'on'}">${STAGE[g.worst]}</span>${icon('i-down')}</summary>
            <ul class="ip-cols">${g.list.map((x) => raw(html`<li class="${x.stage}">
              <details data-id="${x.id}" ${raw(ui.open.has(x.id) || x.stage !== 'calm' ? 'open' : '')}>
                <summary><span class="b-n"><b>${x.name}</b>${x.capital ? raw('<em class="cbadge on">Столица</em>') : ''}<small>${x.martial ? 'военное положение' : 'колония'}</small></span>
                  ${raw(meter(x.value))}<b class="ip-val">${x.value > 0 ? '+' : ''}${x.value}</b>
                  <span class="cbadge ${x.stage === 'calm' ? 'dim' : 'on'}">${STAGE[x.stage]}${x.deadline && x.stage !== 'calm' ? ` · ${leftText(new Date(x.deadline) - Date.now())}` : ''}</span></summary>
                <ul class="ip-break">${(x.breakdown || []).map((b) => raw(html`<li><span>${b.k}</span><b class="${b.v < 0 ? 'bad' : 'good'}">${b.v > 0 ? '+' : ''}${b.v}</b></li>`))}</ul>
                ${x.stage !== 'calm' ? raw(decisions(x)) : ''}
              </details></li>`))}</ul></details>`))}</div>`);
        })()}
      </section>`;
    },

    budget: () => {
      const B = ui.budget;
      if (!B) return html`<p class="panel op-empty">Бюджет ещё не подключён в базе (миграция 21).</p>`;
      ui.levels = ui.levels || { ...B.levels };
      const L = ui.levels, cfgB = B.cfg || {};
      const upkeep = Math.round((B.pop || 0) * BUDGET.reduce((a, [k]) => a + (k === 'social' && B.robot ? 0 : (cfgB.weights?.[L[k]] ?? 0) * (cfgB.rates?.[k] ?? 0)), 0));
      const changed = BUDGET.some(([k]) => L[k] !== B.levels[k]);
      return html`<section class="panel col-sec ip-budget">
        <div class="sec-h"><h2>Бюджет державы</h2><small>население ${num(B.pop)}</small></div>
        <p class="hint">Пять отраслей, у каждой пять уровней. Цена растёт прогрессивно (веса 0 · 1 · 2 · 4 · 7) и зависит от населения. Слоты построек открываются сразу после сохранения. На каждый работающий слот нужно ${cfgB.pop_per_slot || 3} жителя: не хватает людей — урезаются все слоты.</p>
        <div class="ip-branches">${BUDGET.map(([k, name, fx]) => raw(html`<div class="ip-branch">
          <div class="ip-bh"><b>${name}</b>${B.buildings?.[k] ? raw(html`<small>построек: ${B.buildings[k]}</small>`) : ''}</div>
          <div class="seg ip-lvls" role="group" aria-label="${name}">${LVL.map((l, i) => raw(html`<button type="button" data-lvl="${k}" data-v="${i}" aria-pressed="${String(L[k] === i)}" ${raw(s.can_manage ? '' : 'disabled')}>${l}</button>`))}</div>
          <p>${fx(L[k], cfgB)}${k === 'social' && B.robot ? ' · машинам соцобеспечение бесплатно' : ''}</p></div>`))}</div>
        <div class="ip-upkeep"><span>Содержание в сутки</span><b>${num(upkeep)} ГС</b>${changed ? raw(html`<small>было ${num(B.upkeep)} ГС</small>`) : ''}</div>
        ${raw(B.slots_need > B.pop ? html`<p class="st-warn">Населения не хватает на все слоты: нужно ${num(B.slots_need)}, есть ${num(B.pop)}. Слоты урезаны пропорционально.</p>` : '')}
        ${s.can_manage ? raw(html`<div class="acts"><button type="button" class="btn gold" id="bd-save" ${raw(changed ? '' : 'disabled')}>Сохранить бюджет</button>${changed ? raw('<button type="button" class="btn" id="bd-reset">Отменить</button>') : ''}</div>`) : ''}
        <p class="hint">Два нуля губят державу: Оборонзаказ на нуле — войска не строятся, Соцобеспечение на нуле — население уходит на 2 % в сутки.</p>
      </section>`;
    },

    course: () => {
      const custom = ui.custom || Object.fromEntries(CUSTOM.map(([k]) => [k, Number((c.custom || {})[k === 'order' ? 'wb' : k] || 0)]));
      ui.custom = custom;
      const used = Object.values(custom).reduce((a, b) => a + b, 0);
      const cardFor = (x) => {
        const isCur = x.key === c.key;
        const name = x.key === 'ideo' ? `${x.name}: ${c.ideo?.name || '—'}` : x.name;
        const mods = x.key === 'ideo' ? c.ideo?.mods : x.mods;
        const locked = (c.next && !isCur) || (x.key === 'custom' && !c.points);
        return html`<article class="ip-course ${isCur ? 'cur' : ''}">
          <header><b>${name}</b>${isCur ? raw('<span class="cbadge on">действует</span>') : ''}</header>
          <p>${x.key === 'ideo' ? `Свой путь для идеологии «${c.ideology || '—'}».` : x.descr}</p>
          ${x.key !== 'custom' ? raw(html`<div class="ip-mods">${raw(modChips(mods) || '<span class="ip-mod">без бонусов и штрафов</span>')}</div>`) : ''}
          ${x.key === 'custom' ? raw(c.points ? html`<div class="ip-axes">${CUSTOM.map(([k, l]) => raw(html`<div class="ip-ax"><span>${l}<small>${axStep(k, c.axes)}</small></span><button type="button" class="btn sm" data-ax="${k}" data-d="-1" ${raw(custom[k] <= -2 ? 'disabled' : '')} aria-label="Меньше">−</button><b>${custom[k] > 0 ? '+' : ''}${custom[k]}</b><button type="button" class="btn sm" data-ax="${k}" data-d="1" ${raw(custom[k] >= 2 ? 'disabled' : '')} aria-label="Больше">+</button></div>`))}
              <p class="hint">Очков: ${used} из ${c.points}. Минусы возвращают очки.</p></div>` : html`<p class="hint">Откройте технологию «Экономический совет».</p>`) : ''}
          ${can && (!isCur || x.key === 'custom') ? raw(html`<button type="button" class="btn sm ${locked ? '' : 'gold'}" data-course="${x.key}" ${raw(locked || (x.key === 'custom' && used > c.points) ? 'disabled' : '')}>${isCur ? 'Сохранить доктрину' : 'Принять курс'}</button>`) : ''}
        </article>`;
      };
      return html`<section class="panel col-sec">
        <div class="sec-h"><h2>Курс державы</h2><small>сейчас: ${courseName || 'Равновесие'}</small></div>
        <p class="hint">Курс меняется раз в ${c.cd_days} дн.${c.next ? ` Следующая смена — ${dateTime(c.next)}.` : ' Сменить можно сейчас.'} Итоговые множители державы: ${raw(modChips({ gc: (s.mods?.gc ?? 1) - 1, mine: (s.mods?.mine ?? 1) - 1, build: (s.mods?.build ?? 1) - 1, research: (s.mods?.research ?? 1) - 1, order: s.mods?.order || 0 }))}</p>
        <div class="ip-courses">${(c.list || []).map((x) => raw(cardFor(x)))}</div></section>`;
    },

    faith: () => html`
      ${mine.length ? mine.map((x) => raw(html`<section class="panel col-sec ip-faith" style="--fc:${x.color || '#e9b949'}">
        <div class="sec-h"><h2><i class="ip-dot"></i>${x.name}</h2><span class="cbadge on">${x.role === 'founder' ? 'основатель' : 'последователь'}</span>${x.id === f.main ? raw('<span class="cbadge free">государственная</span>') : ''}</div>
        ${x.dogma ? raw(html`<p class="ip-dogma">${x.dogma}</p>`) : ''}
        <p class="hint">Последователи: ${(x.members || []).map((m) => `${m.name}${m.role === 'founder' ? ' (основатель)' : ''}`).join(', ')}</p>
        ${can ? raw(html`<div class="acts">
          ${x.role === 'founder' ? raw(html`<button type="button" class="btn sm" data-fopen="${x.id}" data-v="${x.open ? '' : '1'}">${x.open ? 'Закрыть вход' : 'Открыть вход'}</button>`) : ''}
          <button type="button" class="btn sm danger" data-fleave="${x.id}" data-name="${x.name}" data-founder="${x.role === 'founder' ? '1' : ''}">${x.role === 'founder' ? 'Распустить веру' : 'Отречься'}</button></div>`) : ''}
      </section>`)) : raw(html`<section class="panel col-sec">
        <div class="sec-h"><h2>${f.secular ? 'Светское государство' : 'У державы нет веры'}</h2></div>
        <p class="hint">${f.secular ? 'Держава отделила церковь от государства: +5 % к науке, но нет бонусов веры и храмов.' : 'Можно основать свою веру, принять чужую или объявить государство светским (+5 % к науке).'}</p>
        ${can ? raw(html`<button type="button" class="btn sm ${f.secular ? '' : 'gold'}" data-secular="${f.secular ? '' : '1'}">${f.secular ? 'Отменить светский статус' : 'Объявить светским (+5 % к науке)'}</button>`) : ''}
      </section>`)}
      ${!mine.length && can ? raw(html`<form class="panel op-form" data-form="found"><h3>${icon('i-spark')}Основать веру</h3>
        <div class="op-row"><input name="name" required minlength="3" maxlength="60" placeholder="Название веры" aria-label="Название"><label class="op-num">Цвет <input name="color" type="color" value="#e9b949" aria-label="Цвет"></label></div>
        <textarea name="dogma" rows="3" maxlength="2000" placeholder="Догматы: во что верят, чего требуют от верующих" aria-label="Догматы"></textarea>
        <p class="hint">Основатель — глава веры: решает, открыт ли вход, и может исключать последователей. Колонии с государственной верой получают +${cfg.faith_match || 10} к порядку.</p>
        <button type="submit" class="btn gold">Основать</button></form>`) : ''}
      <section class="panel col-sec"><div class="sec-h"><h2>Веры галактики</h2></div>
        <ul class="op-list">${(f.all || []).map((x) => raw(html`<li><span class="b-n"><b style="color:${x.color || 'inherit'}">${x.name}</b><small>основатель — ${x.founder} · последователей ${x.members}${x.open ? '' : ' · вход закрыт'}</small>${x.dogma ? raw(html`<small class="ip-dg">${x.dogma}</small>`) : ''}</span>
          ${can && !mine.length && x.open ? raw(html`<button type="button" class="btn sm" data-fjoin="${x.id}" data-name="${x.name}">Принять веру</button>`) : ''}</li>`))}</ul></section>`,

    log: () => html`<section class="panel col-sec"><div class="sec-h"><h2>Журнал порядка</h2></div>
      ${(s.log || []).length ? raw(html`<ol class="ev">${s.log.map((l) => raw(html`<li><span class="dot ${['unrest', 'rebellion', 'would_secede', 'seceded'].includes(l.kind) ? 'gold' : ''}"></span><p>${l.text}</p><time>${dateTime(l.at)}</time></li>`))}</ol>`) : raw('<p class="hint">Пока событий не было. Волнения проверяются раз в сутки, на тике в 00:20 по UTC.</p>')}</section>`,
  };

  root.innerHTML = html`<div class="ip-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Внутренняя политика</h1>
        <p>Курс: <b>${courseName || 'Равновесие'}</b> · вера: <b>${mainFaith ? mainFaith.name : f.secular ? 'светское государство' : 'нет'}</b> · средний порядок <b>${o.avg ?? '—'}</b>${o.unrest + o.rebellion ? ` · неспокойно: ${o.unrest + o.rebellion}` : ''}</p>
      </div>
      <div class="col-treasury"><small>В казне</small><b>${num(s.gc)} ГС</b></div>
    </section>
    <nav class="seg op-tabs" role="tablist" aria-label="Разделы">${TABS.map(([k, l]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${String(ui.tab === k)}" aria-pressed="${String(ui.tab === k)}">${l}</button>`))}</nav>
    <div class="op-body">${raw((tabs[ui.tab] || tabs.order)())}</div></div>`;

  const wrap = $('.ip-wrap', root);
  $('.op-tabs', root).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; ui.tab = b.dataset.tab; history.replaceState(null, '', `#/inner?t=${ui.tab}`); draw(root, s, ui); };
  $('#ip-bad', root)?.addEventListener('change', (e) => { ui.onlyBad = e.target.checked; draw(root, s, ui); });
  const qi = $('#ip-q', root);
  if (qi) qi.oninput = (e) => { ui.q = e.target.value.trim(); const pos = e.target.selectionStart; draw(root, s, ui); const n = $('#ip-q', root); n.focus(); n.setSelectionRange(pos, pos); };
  wrap.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches?.('details[data-id]')) (d.open ? ui.open.add(d.dataset.id) : ui.open.delete(d.dataset.id));
    if (d.matches?.('details[data-sys]')) (d.open ? ui.openSys.add(d.dataset.sys) : ui.openSys.delete(d.dataset.sys));
  }, true);

  const go = async (btn, fn, msg) => {
    if (btn) btn.disabled = true;
    try { await fn(); if (msg) toast(msg); ui.custom = null; renderInner(root, ui); } catch (err) { toast(err.message, 'err'); if (btn) btn.disabled = false; }
  };

  wrap.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.lvl) { ui.levels[d.lvl] = Number(d.v); draw(root, s, ui); return; }
    if (b.id === 'bd-reset') { ui.levels = null; draw(root, s, ui); return; }
    if (b.id === 'bd-save') { const L = ui.levels; return go(b, () => rpc('v1_budget_set', { p_industry: L.industry, p_military: L.military, p_science: L.science, p_social: L.social, p_infra: L.infra }).then(() => { ui.levels = null; }), 'Бюджет сохранён, слоты пересчитаны'); }
    if (d.ax) { ui.custom[d.ax] = Math.max(-2, Math.min(2, (ui.custom[d.ax] || 0) + Number(d.d))); draw(root, s, ui); return; }
    if (d.dec) {
      if (!(await confirmBox(`${d.label}?`, 'Да'))) return;
      return go(b, () => rpc('v1_unrest_decide', { p_colony: d.col, p_choice: d.dec }), 'Решение принято');
    }
    if (d.course) {
      const nm = (c.list || []).find((x) => x.key === d.course)?.name;
      if (!(await confirmBox(`Принять курс «${nm}»? Следующая смена — через ${c.cd_days} дн.`, 'Принять'))) return;
      return go(b, () => rpc('v1_course_set', { p_key: d.course, p_custom: d.course === 'custom' ? ui.custom : null }), 'Курс принят');
    }
    if ('secular' in d && b.matches('[data-secular]')) return go(b, () => rpc('v1_faith_secular', { p_on: !!d.secular }), d.secular ? 'Держава стала светской' : 'Светский статус отменён');
    if (d.fjoin) { if (!(await confirmBox(`Принять веру «${d.name}»?`, 'Принять'))) return; return go(b, () => rpc('v1_faith_join', { p_faith: d.fjoin }), 'Вера принята'); }
    if (d.fleave) { if (!(await confirmBox(d.founder ? `Распустить веру «${d.name}»? Храмы останутся без веры.` : `Отречься от веры «${d.name}»?`, 'Да'))) return; return go(b, () => rpc('v1_faith_leave', { p_faith: d.fleave }), 'Готово'); }
    if (d.fopen) return go(b, () => rpc('v1_faith_manage', { p_faith: d.fopen, p_open: !!d.v, p_expel: null }), d.v ? 'Вход открыт' : 'Вход закрыт');
  };
  wrap.onsubmit = (e) => {
    e.preventDefault();
    const fm = e.target;
    if (fm.dataset.form === 'found') go(fm.querySelector('[type=submit]'), () => rpc('v1_faith_found', { p_name: fm.elements.name.value, p_dogma: fm.elements.dogma.value, p_color: fm.elements.color.value }), 'Вера основана');
  };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
