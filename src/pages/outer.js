import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
import { rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { num, dayMonth, leftText } from '../lib/format.js';
import { solid } from '../lib/galaxy.js';

/**
 * #/outer — внешняя политика: войны и ноты, союзы, вассалы и унии, кредиты, Межгалактическое сообщество.
 * Все данные — одним вызовом v1_outer_state, действия — отдельные v1_* функции.
 */

const TABS = [['wars', 'Войны'], ['unions', 'Союзы'], ['loans', 'Кредиты'], ['council', 'Сообщество'], ['states', 'Державы']];
const UNION = { alliance: 'Альянс', confederation: 'Конфедерация', federation: 'Федерация' };
const RES = {
  condemn_war: ['Осудить войну', 'Агрессор теряет отношения со всеми, кто «за», и получает −10 к порядку на 7 дней.'],
  support_side: ['Поддержать сторону войны', 'Сторона получает +10 к порядку на 5 дней.'],
  apology: ['Потребовать извинений', 'Держава за 3 дня извиняется (5 % казны вам) или отказывается (−20 к отношениям со всеми «за»).'],
  ceasefire: ['Призвать к перемирию', 'Сторонам приходит нота о мире; отказ портит отношения со всеми «за».'],
  sanctions: ['Ввести санкции', 'Торговый запрет на 7 дней от всех, кто голосовал «за».'],
  recognize: ['Признать державу', '+10 к отношениям со всеми, кто «за».'],
};
const NOTE = { status_quo: 'Предложение мира', capitulation: 'Требование капитуляции', surrender: 'Капитуляция', call_ally: 'Зов союзника', demand_surrender: 'Требование сдаться', conference: 'Конференция' };
const LOAN = { offered: 'предложен', active: 'выплачивается', repaid: 'погашен', defaulted: 'просрочен', forgiven: 'прощён', declined: 'отклонён', cancelled: 'отменён' };

export async function renderOuter(root, ui = { tab: new URLSearchParams(location.hash.split('?')[1] || '').get('t') || 'wars' }) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>Внешняя политика</h1><p>Войдите, чтобы вести дипломатию.</p></div><button type="button" class="btn gold" id="g-in">Войти</button></section>`;
    $('#g-in', root).onclick = () => openLogin();
    return;
  }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>У вас пока нет державы</h1><p>Дипломатия откроется вместе с кабинетом.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  if (!root.querySelector('.op-wrap')) root.innerHTML = '<div class="skeleton">Собираю донесения посольств…</div>';
  let s;
  try { s = await rpc('v1_outer_state'); } catch (e) {
    root.innerHTML = html`<section class="panel gate"><div><h1>Внешняя политика недоступна</h1><p>${e.missingSchema ? 'Внешняя политика ещё не подключена в базе (миграция 19).' : e.message}</p></div><a class="btn" href="#/cabinet">В кабинет</a></section>`;
    return;
  }
  draw(root, s, ui);
}

function draw(root, s, ui) {
  const F = Object.fromEntries((s.factions || []).map((f) => [f.id, f]));
  const nm = (id) => (id === s.me ? 'Вы' : F[id]?.name || 'держава');
  const chip = (id) => html`<span class="op-f" style="--fc:${solid(F[id]?.color, '#e9b949')}"><i></i>${nm(id)}</span>`;
  const active = (s.wars || []).filter((w) => w.status === 'active');
  const incoming = (s.calls || []).length + active.reduce((a, w) => a + w.offers.filter((o) => o.to === s.me && o.status === 'pending').length, 0)
    + (s.union_invites || []).length + (s.vassals || []).filter((v) => v.vassal === s.me && v.status === 'pending').length
    + (s.juniors || []).filter((j) => j.partner === s.me && j.status === 'pending').length
    + (s.merges || []).filter((m) => m.minor === s.me && m.status === 'proposed').length
    + (s.loans || []).filter((l) => l.borrower_fid === s.me && l.status === 'offered').length;
  const can = s.can_manage;
  const opts = (filter = () => true) => (s.factions || []).filter(filter).map((f) => raw(html`<option value="${f.id}">${f.name}</option>`));

  const tabs = {
    wars: () => html`
      ${(s.calls || []).map((c) => raw(html`<article class="panel op-alert">${icon('i-sword')}<div><b>${nm(c.from)} зовёт вас в войну</b>
        <p>${nm(c.attacker)} против ${nm(c.defender)}${c.message ? ` · «${c.message}»` : ''} · ответ до ${dayMonth(c.expires_at)}</p></div>
        ${can ? raw(html`<div class="acts"><button type="button" class="btn sm gold" data-act="join" data-id="${c.id}" data-yes="1">Вступить</button><button type="button" class="btn sm" data-act="join" data-id="${c.id}">Отказать</button></div>`) : ''}</article>`))}
      ${active.length ? active.map((w) => raw(war(w, s, nm, chip, can, opts))) : raw('<p class="panel op-empty">Ваша держава ни с кем не воюет.</p>')}
      ${can && !s.senior ? raw(html`<form class="panel op-form" data-form="declare">
        <h3>${icon('i-sword')}Объявить войну</h3>
        <div class="op-row"><select name="target" required aria-label="Держава"><option value="">Держава…</option>${opts((f) => !f.at_war)}</select>
          <input name="cause" maxlength="200" placeholder="Повод к войне (виден всем)" aria-label="Повод"></div>
        <p class="hint">Цель увидит войну сразу, союзники цели по альянсу и её сюзерен получат зов. Мир подписывают только зачинщики сторон.</p>
        <button type="submit" class="btn danger">Объявить войну</button></form>`) : s.senior ? raw(html`<p class="panel op-empty">Внешнюю политику вашей державы ведёт старший партнёр унии — ${nm(s.senior)}.</p>`) : ''}
      ${(s.wars || []).filter((w) => w.status !== 'active').length ? raw(html`<section class="panel op-sec"><h3>Недавно окончены</h3><ul class="op-list">${(s.wars || []).filter((w) => w.status !== 'active').map((w) => raw(html`<li>
        ${raw(chip(w.attacker))} <span>против</span> ${raw(chip(w.defender))}<small>${{ status_quo: 'мир статус-кво', attacker_won: `победа ${nm(w.attacker)}`, defender_won: `победа ${nm(w.defender)}` }[w.status] || w.status} · ${w.ended_at ? dayMonth(w.ended_at) : ''}</small></li>`))}</ul></section>`) : ''}`,

    unions: () => html`
      ${(s.union_invites || []).map((i) => raw(html`<article class="panel op-alert">${icon('i-flag')}<div><b>Приглашение в ${UNION[i.kind] || 'союз'} «${i.union}»</b><p>Глава — ${nm(i.leader)}</p></div>
        ${can ? raw(html`<div class="acts"><button type="button" class="btn sm gold" data-act="uresp" data-id="${i.id}" data-yes="1">Вступить</button><button type="button" class="btn sm" data-act="uresp" data-id="${i.id}">Отказать</button></div>`) : ''}</article>`))}
      <section class="panel op-sec">
        <h3>Союз</h3>
        ${s.union ? raw(html`<div class="op-union"><b>${UNION[s.union.kind]} «${s.union.name}»</b><small>глава — ${nm(s.union.leader)}</small>
          <ul class="op-members">${(s.union.members || []).map((m) => raw(html`<li>${raw(chip(m))}${can && s.union.leader === s.me && m !== s.me ? raw(html`<button type="button" class="btn sm ghost" data-act="ukick" data-id="${m}" data-name="${nm(m)}">Исключить</button>`) : ''}</li>`))}
            ${(s.union.invited || []).map((m) => raw(html`<li class="dim">${raw(chip(m))}<small>приглашена</small></li>`))}</ul>
          ${can && s.union.leader === s.me ? raw(html`<form class="op-row" data-form="uinvite"><select name="target" required aria-label="Пригласить"><option value="">Пригласить державу…</option>${opts((f) => !(s.union.members || []).includes(f.id))}</select><button type="submit" class="btn sm gold">Пригласить</button></form>`) : ''}
          ${can ? raw(html`<button type="button" class="btn sm" data-act="uleave">Выйти из союза</button>`) : ''}
          ${s.union.kind === 'alliance' ? raw('<p class="hint">Альянс оборонительный: если на участника нападают, остальные получают зов в войну.</p>') : ''}</div>`)
          : can ? raw(html`<form class="op-form-in" data-form="ucreate"><div class="op-row"><select name="kind" aria-label="Вид союза"><option value="alliance">Альянс — оборонительный союз</option><option value="confederation">Конфедерация</option><option value="federation">Федерация</option></select>
            <input name="name" required minlength="3" maxlength="60" placeholder="Название союза" aria-label="Название"></div><button type="submit" class="btn sm gold">Основать союз</button></form>`) : raw('<p class="hint">Держава не состоит в союзе.</p>')}
      </section>
      <section class="panel op-sec">
        <h3>Вассалитет</h3>
        ${(s.vassals || []).length ? raw(html`<ul class="op-list">${s.vassals.map((v) => raw(html`<li>${v.overlord === s.me ? raw(html`Вассал: ${raw(chip(v.vassal))}`) : raw(html`Сюзерен: ${raw(chip(v.overlord))}`)}
          <small>дань ${Math.round(v.tribute * 100)} % · ${v.status === 'pending' ? 'ждёт ответа' : 'действует'}</small>
          ${can && v.status === 'pending' && v.vassal === s.me ? raw(html`<span class="acts"><button type="button" class="btn sm gold" data-act="vresp" data-id="${v.id}" data-yes="1">Принять присягу</button><button type="button" class="btn sm" data-act="vresp" data-id="${v.id}">Отказать</button></span>`) : ''}
          ${can && (v.status === 'active' || v.overlord === s.me) ? raw(html`<button type="button" class="btn sm ${v.vassal === s.me && v.status === 'active' ? 'danger' : ''}" data-act="vend" data-id="${v.id}" data-name="${v.vassal === s.me ? 'Объявить независимость? Сюзерен будет недоволен (−30 к отношениям).' : v.status === 'pending' ? 'Отозвать предложение?' : 'Отпустить вассала?'}">${v.vassal === s.me && v.status === 'active' ? 'Независимость' : v.status === 'pending' ? 'Отозвать' : 'Отпустить'}</button>`) : ''}</li>`))}</ul>`) : raw('<p class="hint">Вассальных договоров нет.</p>')}
        ${can ? raw(html`<form class="op-row" data-form="vassal"><select name="target" required aria-label="Держава"><option value="">Предложить вассалитет державе…</option>${opts((f) => !f.at_war)}</select>
          <label class="op-num">Дань <input name="pct" type="number" min="0" max="30" step="1" value="10" aria-label="Дань, процентов">%</label><button type="submit" class="btn sm gold">Предложить</button></form>
          <p class="hint">Вассал платит дань с дохода, сюзерен получает зов, если на вассала нападают.</p>`) : ''}
      </section>
      <section class="panel op-sec">
        <h3>Унии</h3>
        ${(s.juniors || []).map((j) => raw(html`<p class="op-line">${j.lead === s.me ? raw(html`Младший партнёр: ${raw(chip(j.partner))}`) : raw(html`Старший партнёр: ${raw(chip(j.lead))}`)} <small>${j.status === 'pending' ? 'ждёт ответа' : 'действует'}</small>
          ${can && j.status === 'pending' && j.partner === s.me ? raw(html`<button type="button" class="btn sm gold" data-act="jresp" data-id="${j.id}" data-yes="1">Принять</button><button type="button" class="btn sm" data-act="jresp" data-id="${j.id}">Отказать</button>`) : ''}
          ${can ? raw(html`<button type="button" class="btn sm" data-act="jend" data-id="${j.id}">${j.status === 'pending' ? 'Отозвать' : 'Распустить'}</button>`) : ''}</p>`))}
        ${(s.merges || []).map((m) => raw(html`<p class="op-line">Объединение: ${raw(chip(m.minor))} входит в ${raw(chip(m.lead))} <small>${m.status === 'proposed' ? 'ждёт согласия' : 'ждёт утверждения командой проекта'}</small>
          ${can && m.status === 'proposed' && m.minor === s.me ? raw(html`<button type="button" class="btn sm gold" data-act="mresp" data-id="${m.id}" data-yes="1">Согласиться</button>`) : ''}
          <button type="button" class="btn sm" data-act="mresp" data-id="${m.id}">Отменить</button></p>`))}
        ${can && !s.senior ? raw(html`<form class="op-row" data-form="junior"><select name="target" required aria-label="Держава"><option value="">Младшая уния с державой…</option>${opts((f) => !f.at_war)}</select><button type="submit" class="btn sm">Предложить унию</button></form>
          <p class="hint"><b>Младшая уния:</b> партнёр сохраняет кабинет, но внешнюю политику ведёте вы, и он воюет на вашей стороне.</p>
          <form class="op-row" data-form="merge"><select name="target" required aria-label="Держава"><option value="">Старшая уния: присоединить державу…</option>${opts((f) => !f.at_war)}</select><button type="submit" class="btn sm">Предложить объединение</button></form>
          <p class="hint"><b>Старшая уния:</b> полное слияние — всё имущество переходит вам, правитель партнёра становится соправителем. Нужны согласие партнёра и утверждение командой проекта.</p>`) : ''}
      </section>`,

    loans: () => {
      const L = s.loans || [];
      const row = (l) => {
        const given = l.lender_fid === s.me;
        const pct = l.total_due ? Math.round((l.paid / l.total_due) * 100) : 0;
        let acts = '';
        if (can) {
          if (l.status === 'offered' && !given) acts = html`<button type="button" class="btn sm gold" data-act="lresp" data-id="${l.id}" data-yes="1">Принять</button><button type="button" class="btn sm" data-act="lresp" data-id="${l.id}">Отказать</button>`;
          if (l.status === 'offered' && given) acts = html`<button type="button" class="btn sm" data-act="lcancel" data-id="${l.id}">Отозвать</button>`;
          if (['active', 'defaulted'].includes(l.status) && given) acts = html`<button type="button" class="btn sm" data-act="lforgive" data-id="${l.id}">Простить долг</button>`;
          if (['active', 'defaulted'].includes(l.status) && !given) acts = html`<button type="button" class="btn sm gold" data-act="lrepay" data-id="${l.id}" data-sum="${l.total_due - l.paid}">Погасить ${num(l.total_due - l.paid)}</button>`;
        }
        return html`<li class="op-loan ${l.status}"><div><b>${given ? 'Выдан' : 'Взят'}: ${num(l.amount)} ГС</b> ${given ? 'державе' : 'у'} ${raw(chip(given ? l.borrower_fid : l.lender_fid))}
          <small>${Math.round(l.interest_pct * 100)} % · ${l.days} дн. · ${LOAN[l.status]}${l.total_due ? ` · выплачено ${num(l.paid)} из ${num(l.total_due)}` : ''}${l.note ? ` · «${l.note}»` : ''}</small>
          ${l.total_due ? raw(html`<span class="op-bar"><i style="--w:${pct}%"></i></span>`) : ''}</div><span class="acts">${raw(acts)}</span></li>`;
      };
      return html`
        ${can ? raw(html`<form class="panel op-form" data-form="loan"><h3>${icon('i-coin')}Выдать кредит</h3>
          <div class="op-row"><select name="target" required aria-label="Держава"><option value="">Державе…</option>${opts()}</select>
            <label class="op-num">Сумма <input name="amount" type="number" min="1000" step="1000" required value="100000" aria-label="Сумма"> ГС</label>
            <label class="op-num">Процент <input name="pct" type="number" min="0" max="30" value="10" aria-label="Процент"> %</label>
            <label class="op-num">Срок <input name="days" type="number" min="7" max="60" value="14" aria-label="Срок, дней"> дн.</label></div>
          <input name="note" maxlength="300" placeholder="Условия или комментарий (необязательно)" aria-label="Комментарий">
          <p class="hint" id="ln-prev"></p>
          <button type="submit" class="btn gold">Предложить кредит</button></form>`) : ''}
        <section class="panel op-sec"><h3>Кредиты державы</h3>${L.length ? raw(html`<ul class="op-list">${L.map((l) => raw(row(l)))}</ul>`) : raw('<p class="hint">Кредитов нет.</p>')}
          <p class="hint">Погашение — каждые сутки равными долями. Просрочка больше 3 дней — дефолт: −20 к отношениям и повод к войне для кредитора.</p></section>
        ${(s.old_loans || []).length ? raw(html`<section class="panel op-sec"><h3>Архив старых кредитов</h3><ul class="op-list">${s.old_loans.map((l) => raw(html`<li>${l.lender} → ${l.borrower}: ${num(l.amount)} ГС <small>${l.status} · ${dayMonth(l.created_at)}</small></li>`))}</ul></section>`) : ''}`;
    },

    council: () => {
      const C = s.council || [];
      const open = C.filter((c) => c.status === 'open'), done = C.filter((c) => c.status !== 'open');
      const apologies = C.filter((c) => c.kind === 'apology' && c.status === 'passed' && c.target === s.me && !c.answer);
      const resCard = (c) => {
        const v = c.votes || {}, tot = (v.yes || 0) + (v.no || 0) + (v.abstain || 0);
        return html`<article class="op-res ${c.status}">
          <header><b>${RES[c.kind]?.[0] || c.kind}</b>${c.target ? raw(html` · ${raw(chip(c.target))}`) : ''}<span class="cbadge ${c.status === 'passed' || c.status === 'answered' ? 'on' : c.status === 'open' ? 'free' : 'dim'}">${{ open: `идёт · ${leftText(new Date(c.closes_at) - Date.now())}`, passed: 'принята', failed: 'отклонена', answered: 'принята' }[c.status]}</span></header>
          <p>Вносит ${nm(c.author)}${c.text ? ` · «${c.text}»` : ''}</p>
          <div class="op-votes"><span style="--w:${tot ? (v.yes / tot) * 100 : 0}%"></span><small>за ${v.yes || 0} · против ${v.no || 0} · воздерж. ${v.abstain || 0}</small></div>
          ${c.answer ? raw(html`<p class="hint">Ответ: ${{ apologized: 'извинения принесены', refused: 'отказ', silence: 'молчание (отказ)' }[c.answer]}</p>`) : ''}
          ${c.status === 'open' && can && s.rep ? raw(html`<div class="acts">${['yes', 'no', 'abstain'].map((k) => raw(html`<button type="button" class="btn sm ${c.my_vote === k ? 'gold' : ''}" data-act="vote" data-id="${c.id}" data-v="${k}">${{ yes: 'За', no: 'Против', abstain: 'Воздержаться' }[k]}</button>`))}</div>`) : ''}
        </article>`;
      };
      return html`
        ${apologies.map((c) => raw(html`<article class="panel op-alert">${icon('i-flag')}<div><b>Сообщество требует от вас извинений перед ${nm(c.author)}</b><p>Срок — ${c.answer_deadline ? dayMonth(c.answer_deadline) : '3 дня'}. Извинения стоят 5 % казны; отказ испортит отношения со всеми, кто голосовал «за».</p></div>
          ${can ? raw(html`<div class="acts"><button type="button" class="btn sm gold" data-act="answer" data-id="${c.id}" data-yes="1">Извиниться</button><button type="button" class="btn sm danger" data-act="answer" data-id="${c.id}">Отказать</button></div>`) : ''}</article>`))}
        <section class="panel op-sec op-rep">
          <h3>Ваш представитель</h3>
          ${s.rep ? raw(html`<p class="op-line"><b>${s.rep.name}</b><small>в Сообществе с ${dayMonth(s.rep.appointed_at)}</small></p>`) : raw('<p class="hint">Представитель не назначен: без него держава не может вносить резолюции и голосовать.</p>')}
          ${can ? raw(html`<form class="op-row" data-form="rep"><input name="name" required minlength="2" maxlength="60" value="${s.rep?.name || ''}" placeholder="Имя представителя" aria-label="Имя представителя"><button type="submit" class="btn sm ${s.rep ? '' : 'gold'}">${s.rep ? 'Сменить' : 'Назначить'}</button></form>`) : ''}
          <p class="hint">Представителей в Сообществе: ${s.reps}. Один голос на державу. Резолюция принята, если «за» больше половины голосов и проголосовали хотя бы 3 державы. Решения не принуждают силой — они бьют по отношениям, порядку и торговле.</p>
        </section>
        ${can && s.rep ? raw(html`<form class="panel op-form" data-form="propose"><h3>Внести резолюцию</h3>
          <div class="op-row"><select name="kind" id="rs-kind" aria-label="Резолюция">${Object.entries(RES).map(([k, [l]]) => raw(html`<option value="${k}">${l}</option>`))}</select>
            <select name="war" id="rs-war" aria-label="Война">${(s.council_wars || []).map((w) => raw(html`<option value="${w.id}">${nm(w.attacker)} против ${nm(w.defender)}</option>`))}</select>
            <select name="side" id="rs-side" aria-label="Сторона"><option value="attacker">Нападающих</option><option value="defender">Защищающихся</option></select>
            <select name="target" id="rs-target" aria-label="Держава"><option value="">Держава…</option>${opts()}</select></div>
          <p class="hint" id="rs-hint"></p>
          <textarea name="text" maxlength="1000" rows="2" placeholder="Обоснование для Сообщества" aria-label="Обоснование"></textarea>
          <button type="submit" class="btn gold">Внести на голосование</button><small class="hint">Одна резолюция от державы раз в 3 дня, голосование — 48 часов.</small></form>`) : ''}
        <section class="panel op-sec"><h3>Голосования</h3>${open.length ? open.map((c) => raw(resCard(c))) : raw('<p class="hint">Сейчас ничего не обсуждается.</p>')}</section>
        ${done.length ? raw(html`<section class="panel op-sec"><h3>Решения за три недели</h3>${done.map((c) => raw(resCard(c)))}</section>`) : ''}
        ${(s.sanctions || []).length ? raw(html`<section class="panel op-sec"><h3>Действующие санкции</h3><ul class="op-list">${s.sanctions.map((x) => raw(html`<li>${raw(chip(x.target))}<small>до ${dayMonth(x.until)}</small></li>`))}</ul></section>`) : ''}`;
    },

    states: () => html`<section class="panel op-sec"><h3>Державы галактики</h3><table class="op-table"><thead><tr><th>Держава</th><th>Систем</th><th>Ваше отношение</th><th>Их отношение</th><th></th></tr></thead>
      <tbody>${(s.factions || []).map((f) => raw(html`<tr><td>${raw(chip(f.id))}</td><td>${f.systems}</td><td>${raw(rel(f.rel))}</td><td>${raw(rel(f.their_rel))}</td><td>${f.at_war ? raw('<span class="cbadge on">война</span>') : ''}</td></tr>`))}</tbody></table>
      <p class="hint">Отношения от −100 до 100. Их меняют войны, договоры, кредиты и решения Сообщества.</p></section>`,
  };

  root.innerHTML = html`<div class="op-wrap">
    <section class="panel st-hero">
      <div class="st-title">
        <a class="st-back" href="#/cabinet">${icon('i-back')}Кабинет</a>
        <h1>Внешняя политика</h1>
        <p>Войн: <b>${active.length}</b> · ждут вашего ответа: <b>${incoming}</b>${s.union ? ` · ${UNION[s.union.kind]} «${s.union.name}»` : ''}${s.rep ? ` · представитель ${s.rep.name}` : ''}</p>
      </div>
      <div class="col-treasury"><small>В казне</small><b>${num(s.gc)} ГС</b></div>
    </section>
    <nav class="seg op-tabs" role="tablist" aria-label="Разделы">${TABS.map(([k, l]) => raw(html`<button type="button" role="tab" data-tab="${k}" aria-selected="${String(ui.tab === k)}" aria-pressed="${String(ui.tab === k)}">${l}</button>`))}</nav>
    <div class="op-body">${raw((tabs[ui.tab] || tabs.wars)())}</div></div>`;

  const wrap = $('.op-wrap', root);
  $('.op-tabs', root).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; ui.tab = b.dataset.tab; history.replaceState(null, '', `#/outer?t=${ui.tab}`); draw(root, s, ui); };

  // форма резолюции: показываем только нужные поля
  const kindSel = $('#rs-kind', root);
  if (kindSel) {
    const sync = () => {
      const k = kindSel.value, warK = ['condemn_war', 'support_side', 'ceasefire'].includes(k);
      $('#rs-war', root).hidden = !warK; $('#rs-side', root).hidden = k !== 'support_side'; $('#rs-target', root).hidden = warK;
      $('#rs-hint', root).textContent = RES[k][1] + (warK && !(s.council_wars || []).length ? ' Сейчас в галактике нет войн.' : '');
    };
    kindSel.onchange = sync; sync();
  }
  const lf = $('[data-form="loan"]', root);
  if (lf) {
    const prev = () => { const a = +lf.amount.value || 0, p = +lf.pct.value || 0, d = +lf.days.value || 1; $('#ln-prev', root).textContent = `Вернут ${num(a * (1 + p / 100))} ГС: по ${num(Math.ceil((a * (1 + p / 100)) / d))} ГС в сутки ${d} дн.`; };
    lf.oninput = prev; prev();
  }

  const go = async (btn, fn, msg) => {
    if (btn) btn.disabled = true;
    try { await fn(); if (msg) toast(msg); renderOuter(root, ui); } catch (err) { toast(err.message, 'err'); if (btn) btn.disabled = false; }
  };

  wrap.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, k = f.dataset.form, b = f.querySelector('[type=submit]');
    const v = (n) => f.elements[n]?.value;
    if (k === 'declare') {
      if (!(await confirmBox(`Объявить войну державе «${nm(v('target'))}»? Это увидит вся галактика.`, 'Объявить войну'))) return;
      return go(b, () => rpc('v1_war_declare', { p_target: v('target'), p_cause: v('cause') }), 'Война объявлена');
    }
    if (k === 'peace') return go(b, () => rpc('v1_war_note', { p_war: f.dataset.war, p_kind: 'status_quo', p_message: v('msg') }), 'Нота о мире отправлена');
    if (k === 'call') return go(b, () => rpc('v1_war_call', { p_war: f.dataset.war, p_ally: v('ally'), p_message: null }), 'Зов отправлен');
    if (k === 'ucreate') return go(b, () => rpc('v1_union_create', { p_kind: v('kind'), p_name: v('name') }), 'Союз основан');
    if (k === 'uinvite') return go(b, () => rpc('v1_union_invite', { p_target: v('target') }), 'Приглашение отправлено');
    if (k === 'vassal') return go(b, () => rpc('v1_vassal_propose', { p_target: v('target'), p_tribute: (+v('pct') || 0) / 100 }), 'Предложение отправлено');
    if (k === 'junior') return go(b, () => rpc('v1_junior_propose', { p_target: v('target') }), 'Предложение унии отправлено');
    if (k === 'merge') {
      if (!(await confirmBox(`Предложить державе «${nm(v('target'))}» войти в состав вашей? После согласия её и утверждения командой проекта слияние необратимо.`, 'Предложить'))) return;
      return go(b, () => rpc('v1_merge_propose', { p_target: v('target') }), 'Предложение отправлено');
    }
    if (k === 'loan') return go(b, () => rpc('v1_loan_offer', { p_to: v('target'), p_amount: +v('amount'), p_pct: (+v('pct') || 0) / 100, p_days: +v('days'), p_note: v('note') }), 'Кредит предложен');
    if (k === 'rep') return go(b, () => rpc('v1_council_appoint', { p_name: v('name'), p_portrait: null }), 'Представитель назначен');
    if (k === 'propose') {
      const kind = v('kind'), warK = ['condemn_war', 'support_side', 'ceasefire'].includes(kind);
      return go(b, () => rpc('v1_council_propose', { p_kind: kind, p_target: warK ? null : v('target') || null, p_war: warK ? v('war') || null : null, p_side: kind === 'support_side' ? v('side') : null, p_text: v('text') }), 'Резолюция внесена');
    }
  };

  wrap.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = b.dataset, yes = !!d.yes;
    const map = {
      join: () => rpc('v1_war_join', { p_offer: d.id, p_accept: yes }),
      wresp: () => rpc('v1_war_respond', { p_offer: d.id, p_accept: yes }),
      uresp: () => rpc('v1_union_respond', { p_invite: d.id, p_accept: yes }),
      ukick: () => rpc('v1_union_kick', { p_target: d.id }),
      uleave: () => rpc('v1_union_leave'),
      vresp: () => rpc('v1_vassal_respond', { p_id: d.id, p_accept: yes }),
      vend: () => rpc('v1_vassal_end', { p_id: d.id }),
      jresp: () => rpc('v1_junior_respond', { p_id: d.id, p_accept: yes }),
      jend: () => rpc('v1_junior_end', { p_id: d.id }),
      mresp: () => rpc('v1_merge_respond', { p_id: d.id, p_accept: yes }),
      lresp: () => rpc('v1_loan_respond', { p_id: d.id, p_accept: yes }),
      lcancel: () => rpc('v1_loan_cancel', { p_id: d.id }),
      lforgive: () => rpc('v1_loan_forgive', { p_id: d.id }),
      lrepay: () => rpc('v1_loan_repay', { p_id: d.id }),
      vote: () => rpc('v1_council_vote', { p_res: d.id, p_vote: d.v }),
      answer: () => rpc('v1_council_answer', { p_res: d.id, p_apologize: yes }),
      cap: () => rpc('v1_war_note', { p_war: d.id, p_kind: 'capitulation', p_message: null }),
      surrender: () => rpc('v1_war_note', { p_war: d.id, p_kind: 'surrender', p_message: null }),
    };
    const ask = {
      surrender: 'Капитулировать? Вся держава перейдёт победителю. Это необратимо.',
      ukick: `Исключить ${d.name} из союза?`, uleave: 'Выйти из союза?', vend: d.name, lforgive: 'Простить остаток долга?',
      lrepay: `Погасить остаток ${num(d.sum)} ГС сейчас?`, cap: 'Потребовать капитуляции? У врага будет 3 дня; молчание — согласие.',
      answer: yes ? 'Принести извинения и выплатить 5 % казны?' : 'Отказаться от извинений?',
    }[d.act];
    if (ask && !(await confirmBox(ask, 'Да'))) return;
    if (map[d.act]) go(b, map[d.act], null);
  };
}

function war(w, s, nm, chip, can, opts) {
  const foe = w.my_side === 'attacker' ? w.defender : w.attacker;
  const held = Math.round((w.held || 0) * 100), lost = Math.round((w.lost || 0) * 100), need = Math.round((s.cap_share || 0.8) * 100);
  const heldN = Math.round((w.held || 0) * (w.foe_systems || 0));
  const mine = w.offers.filter((o) => o.status === 'pending');
  const allies = (w.sides || []).filter((x) => x.side === w.my_side && x.fid !== s.me);
  const foes = (w.sides || []).filter((x) => x.side !== w.my_side);
  return html`<article class="panel op-war">
    <header><span class="op-vs">${raw(chip(w.attacker))}<em>против</em>${raw(chip(w.defender))}</span><small>с ${dayMonth(w.started_at)}${w.cause ? ` · повод: «${w.cause}»` : ''}</small></header>
    <div class="op-sides"><span>Ваша сторона: ${allies.length ? allies.map((x) => raw(chip(x.fid))) : 'без союзников'}</span><span>Враги: ${foes.map((x) => raw(chip(x.fid)))}</span></div>
    <div class="op-front">
      <div><small>Вы держите систем врага</small><span class="op-bar cap"><i style="--w:${held}%"></i><b style="--at:${need}%" title="Порог капитуляции"></b></span><em>${heldN} из ${w.foe_systems} · ${held} %</em></div>
      <div><small>Враг держит ваших</small><span class="op-bar bad"><i style="--w:${lost}%"></i></span><em>${lost} %</em></div>
    </div>
    ${mine.length ? raw(html`<ul class="op-notes">${mine.map((o) => raw(html`<li class="${o.to === s.me ? 'in' : 'out'}"><b>${NOTE[o.kind] || o.kind}</b> ${o.to === s.me ? `от ${nm(o.from)}` : `для ${nm(o.to)}`}${o.message ? ` · «${o.message}»` : ''}
      <small>${o.to === s.me ? (o.kind === 'capitulation' ? 'молчание будет считаться согласием' : 'нет ответа — отказ') : 'ждём ответа'} · до ${dayMonth(o.expires_at)}</small>
      ${can && o.to === s.me ? raw(html`<span class="acts"><button type="button" class="btn sm ${o.kind === 'capitulation' ? 'danger' : 'gold'}" data-act="wresp" data-id="${o.id}" data-yes="1">${o.kind === 'capitulation' ? 'Капитулировать' : 'Принять'}</button><button type="button" class="btn sm" data-act="wresp" data-id="${o.id}">Отказать</button></span>`) : ''}</li>`))}</ul>`) : ''}
    ${can && w.leader ? raw(html`<div class="op-war-acts">
      <form class="op-row" data-form="peace" data-war="${w.id}"><input name="msg" maxlength="200" placeholder="Условия мира (необязательно)" aria-label="Условия мира"><button type="submit" class="btn sm gold">Предложить мир</button></form>
      <div class="op-row">
        <button type="button" class="btn sm" data-act="cap" data-id="${w.id}" ${raw(held >= need ? '' : `disabled title="Нужно занять не меньше ${need} % систем врага"`)}>${held >= need ? 'Потребовать капитуляции' : `Потребовать капитуляции · нужно ${need} %`}</button>
        <button type="button" class="btn sm danger" data-act="surrender" data-id="${w.id}">Капитулировать</button>
      </div></div>`) : can ? raw('<p class="hint">Мир и капитуляцию подписывают только зачинщики сторон.</p>') : ''}
    ${can ? raw(html`<form class="op-row" data-form="call" data-war="${w.id}"><select name="ally" required aria-label="Позвать в войну"><option value="">Позвать в войну…</option>${opts((f) => f.id !== foe && !(w.sides || []).some((x) => x.fid === f.id))}</select><button type="submit" class="btn sm">Позвать</button></form>`) : ''}
  </article>`;
}

function rel(v) {
  if (v == null) return '<span class="op-rel">0</span>';
  const n = Number(v);
  return `<span class="op-rel ${n >= 30 ? 'good' : n <= -30 ? 'bad' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
}
