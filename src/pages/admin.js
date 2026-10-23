import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { sb, rpc } from '../lib/supabase.js';
import { session, isTeam, isSuperadmin, refreshRole, LEVEL_LABEL, ROLE_LABEL } from '../lib/session.js';
import { num, dateTime, starDate, plain } from '../lib/format.js';
import { crest, loadHeralds } from './home.js';
import { rich, wireRich } from '../lib/rich.js';
import { act } from '../lib/act.js';
import { discordBadge } from './account.js';
import { media, tyan, models, bodies } from './admin-media.js';
import { achievements, battles } from './admin-game.js';

/** Discord-ники пользователей: { user_id: name }. Пусто, если сертификация ещё не подключена. */
async function discordNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  try { const rows = await rpc('v1_discord_of', { p_users: list }); return Object.fromEntries((rows || []).map((x) => [x.user_id, x.name])); } catch { return {}; }
}

const SECTIONS = [
  ['requests', 'i-check', 'Заявки на одобрение'],
  ['tickets', 'i-chat', 'Тикеты'],
  ['apps', 'i-flag', 'Регистрация фракций'],
  ['factions', 'i-crown', 'Управление фракциями'],
  ['achievements', 'i-crown', 'Достижения'],
  ['battles', 'i-sword', 'Сражения'],
  ['multi', 'i-eye', 'Аудит мультиаккаунтов'],
  ['users', 'i-users', 'Пользователи'],
  ['news', 'i-news', 'Новости'],
  ['pages', 'i-lore', 'Редакция страниц'],
  ['media', 'i-image', 'Медиатека и арты'],
  ['tyan', 'i-spark', 'Классикал-Тян'],
  ['bodies', 'i-planet', 'Небесные тела'],
  ['models', 'i-cube', '3D-модели'],
  ['policy', 'i-shield', 'Правила одобрения', true],
  ['audit', 'i-list', 'Журнал действий'],
  ['tests', 'i-wrench', 'Тестовые функции'],
];
const MODE_LABEL = { free: 'Сразу', approval: 'Через одобрение', superadmin: 'Только суперадмин' };
const STATUS_LABEL = { pending: 'ждёт', approved: 'одобрено', rejected: 'отклонено', cancelled: 'отозвано', failed: 'ошибка' };

let current = 'requests';

const list = (kind, q = null, limit = 50) => rpc('v1_admin_list', { p_kind: kind, p_q: q, p_limit: limit });

export async function renderAdmin(root) {
  if (!isTeam()) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-shield')}</span><div><h1>Нет доступа</h1><p>Админ-панель видна только команде проекта.</p></div><a class="btn" href="#/">На главную</a></section>`;
    return;
  }
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  if (want && SECTIONS.some(([k]) => k === want)) current = want;
  const visible = SECTIONS.filter(([, , , saOnly]) => !saOnly || isSuperadmin());
  root.innerHTML = html`
    <div class="adm-head panel">
      <span class="m-ic">${icon('i-shield')}</span>
      <div><h1>Админ-панель</h1><p>${ROLE_LABEL.team} · ${LEVEL_LABEL[session.level]}. ${isSuperadmin() ? 'Вы можете всё и одобряете заявки админов.' : 'Часть действий уходит на одобрение суперадмину.'} Все действия записываются в журнал.</p></div>
      <a class="btn sm" href="#/">${icon('i-back')}На главную</a>
    </div>
    <div class="adm">
      <nav class="adm-nav panel" aria-label="Разделы админ-панели">
        ${visible.map(([k, ic, t]) => raw(html`<button type="button" data-s="${k}" aria-current="${String(k === current)}">${icon(ic)}${t}${k === 'requests' && session.pendingRequests && isSuperadmin() ? raw(`<em>${session.pendingRequests}</em>`) : ''}</button>`))}
      </nav>
      <div class="adm-body"><section class="panel adm-sec" id="sec"></section></div>
    </div>`;
  $('.adm-nav', root).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    current = b.dataset.s;
    $$('.adm-nav button', root).forEach((x) => x.setAttribute('aria-current', String(x === b)));
    show();
  };
  const show = () => {
    const sec = $('#sec', root);
    sec.onclick = sec.onchange = sec.oninput = null; // обработчики прошлого раздела
    sec.innerHTML = '<div class="skeleton">Загружаю…</div>';
    (RENDER[current] || RENDER.requests)(sec).catch((e) => {
      sec.innerHTML = html`<p class="empty warn">${e.missingSchema ? 'Роли и админ-функции ещё не подключены в базе: примените миграцию 20261023_01_roles.sql.' : e.message}</p>`;
    });
  };
  show();
}

/** Список слева + карточка справа. */
function split(sec, title, items, renderItem, renderDetail, extraHead = '') {
  sec.innerHTML = html`<div class="sec-h"><h2>${title}</h2>${raw(extraHead)}</div>
    <div class="split"><ol class="list" id="lst"></ol><div class="detail" id="det"></div></div>`;
  const lst = $('#lst', sec), det = $('#det', sec);
  if (!items.length) { lst.innerHTML = '<li class="empty-li">Пусто.</li>'; det.innerHTML = '<p class="empty">Здесь появится выбранная запись.</p>'; return; }
  lst.innerHTML = items.map((it, i) => `<li data-i="${i}" class="${i === 0 ? 'sel' : ''}">${renderItem(it)}</li>`).join('');
  const pick = (i) => { $$('li', lst).forEach((li) => li.classList.toggle('sel', li.dataset.i === String(i))); renderDetail(det, items[i]); };
  lst.onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(li.dataset.i); };
  pick(0);
}

const RENDER = {
  media, tyan, models, bodies, achievements, battles,
  // Заявки админов
  async requests(sec) {
    const items = await list('requests', 'pending');
    const done = await list('requests', null, 30);
    const history = done.filter((r) => r.status !== 'pending');
    sec.innerHTML = html`<div class="sec-h"><h2>Заявки на одобрение</h2><small>${isSuperadmin() ? 'Действия админов, которые ждут вашего решения' : 'Ваши действия, которые ждут суперадмина'}</small></div>
      <div class="req-list">${items.length ? raw(items.map((r) => html`
        <div class="req" data-id="${r.id}">
          <div><b>${r.label || r.action}</b><span>${r.requested_by_name} · ${dateTime(r.created_at)} · цель: ${r.target || '—'}</span>
            ${Object.keys(r.payload || {}).length ? raw(html`<code>${JSON.stringify(r.payload)}</code>`) : ''}
            ${r.note ? raw(html`<p class="who">${r.note}</p>`) : ''}</div>
          <div class="acts">${isSuperadmin()
            ? raw(html`<button type="button" class="btn gold sm" data-ok>Одобрить</button><button type="button" class="btn sm danger" data-no>Отклонить</button>`)
            : raw(html`<button type="button" class="btn sm" data-cancel>Отозвать</button>`)}</div>
        </div>`).join('')) : raw('<p class="empty">Заявок нет.</p>')}</div>
      <h3 class="sub-h">Последние решения</h3>
      <div class="tbl"><table><thead><tr><th>Действие</th><th>Кто просил</th><th>Статус</th><th>Когда</th></tr></thead><tbody>
      ${history.length ? '' : raw('<tr><td colspan="4" class="empty">Решений пока нет.</td></tr>')}
      ${history.map((r) => raw(html`<tr><td>${r.label || r.action}<small>${r.target || ''}</small></td><td>${r.requested_by_name}</td><td><span class="tag">${STATUS_LABEL[r.status] || r.status}</span></td><td>${dateTime(r.decided_at || r.created_at)}</td></tr>`))}
      </tbody></table></div>`;
    sec.onclick = async (e) => {
      const card = e.target.closest('.req'); if (!card) return;
      const id = card.dataset.id;
      try {
        if (e.target.closest('[data-ok]')) {
          const r = await rpc('v1_admin_decide', { p_request: id, p_approve: true, p_note: null });
          toast(r.status === 'approved' ? 'Одобрено и выполнено' : `Не выполнено: ${r.error}`, r.status === 'approved' ? 'ok' : 'err');
        } else if (e.target.closest('[data-no]')) {
          await rpc('v1_admin_decide', { p_request: id, p_approve: false, p_note: null }); toast('Отклонено');
        } else if (e.target.closest('[data-cancel]')) {
          await rpc('v1_admin_cancel', { p_request: id }); toast('Заявка отозвана');
        } else return;
        await refreshRole();
        RENDER.requests(sec);
      } catch (err) { toast(err.message, 'err'); }
    };
  },

  // Тикеты
  async tickets(sec, status = 'open') {
    const items = await list('tickets', status, 100);
    split(sec, 'Тикеты', items,
      (t) => html`<b>${t.category || 'Без темы'}</b><span>${t.user_name || 'Игрок'} · ${dateTime(t.created_at)}</span>${t.status === 'open' ? raw('<span class="tag new">открыт</span>') : raw('<span class="tag">закрыт</span>')}`,
      (det, t) => {
        det.innerHTML = html`<h3>${t.category || 'Без темы'}</h3><p class="who">${t.user_name || 'Игрок'} · ${dateTime(t.created_at)}</p>
          <div class="msg-b">${t.description || ''}</div>
          ${(t.messages || []).map((m) => raw(html`<div class="msg-b ${m.staff ? 'staff' : ''}"><small>${m.author}${m.staff ? ' · команда' : ''} · ${dateTime(m.at)}</small><br>${m.body}</div>`))}
          <label for="tk-reply">Ответ игроку</label><textarea id="tk-reply" rows="3" placeholder="Напишите ответ"></textarea>
          <div class="acts"><button type="button" class="btn gold sm" id="tk-send">Ответить</button>
          ${t.status === 'open' ? raw('<button type="button" class="btn sm" id="tk-close">Закрыть тикет</button>') : raw('<button type="button" class="btn sm" id="tk-open">Открыть заново</button>')}</div>`;
        $('#tk-send', det).onclick = async () => { await act('ticket.reply', t.id, { body: $('#tk-reply', det).value }); RENDER.tickets(sec, status); };
        $('#tk-close', det)?.addEventListener('click', async () => { await act('ticket.close', t.id); RENDER.tickets(sec, status); });
        $('#tk-open', det)?.addEventListener('click', async () => { await act('ticket.reopen', t.id); RENDER.tickets(sec, status); });
      },
      html`<div class="seg" role="group" aria-label="Статус"><button type="button" data-st="open" aria-pressed="${String(status === 'open')}">Открытые</button><button type="button" data-st="closed" aria-pressed="${String(status === 'closed')}">Закрытые</button></div>`);
    $('.seg', sec).onclick = (e) => { const b = e.target.closest('button'); if (b) RENDER.tickets(sec, b.dataset.st); };
  },

  // Регистрация фракций
  async apps(sec) {
    const items = await list('apps');
    const ds = await discordNames(items.map((a) => a.owner_id));
    split(sec, 'Регистрация фракций', items,
      (a) => html`<b>${a.name || 'Без названия'}</b><span>${a.owner_name} · ${dateTime(a.updated_at || a.created_at)}</span><span class="tag new">ждёт</span>${ds[a.owner_id] ? discordBadge(ds[a.owner_id]) : ''}`,
      (det, a) => {
        det.innerHTML = html`<div class="det-head"><span class="crest sm">${crest(a.herald_url)}</span><h3>${a.name || 'Без названия'}</h3></div>
          <p class="who">${a.owner_name} · ${ds[a.owner_id] ? discordBadge(ds[a.owner_id]) : raw('<span class="tag">Discord не привязан</span>')}</p>
          <dl class="kv"><dt>Правление</dt><dd>${[a.gov, a.regime].filter(Boolean).join(' · ') || '—'}</dd><dt>Раса</dt><dd>${a.race || '—'}</dd>
          <dt>Столица</dt><dd>${[a.planet_name, a.system_name].filter(Boolean).join(' / ') || '—'}</dd><dt>Идеология</dt><dd>${a.ideology || '—'}</dd>
          <dt>Тип</dt><dd>${a.civ_type === 'frontier' ? 'Фронтир' : a.civ_type === 'colony' ? 'Колония' : '—'}</dd>
          <dt>Цвет</dt><dd>${a.color ? raw(html`<i class="sw" style="background:${a.color}"></i>${a.color}`) : '—'}</dd></dl>
          ${a.culture ? raw(html`<div class="msg-b"><small>Культура</small><br>${plain(a.culture).slice(0, 800)}</div>`) : ''}
          ${a.history ? raw(html`<div class="msg-b">${plain(a.history).slice(0, 1200)}</div>`) : ''}
          <label for="app-reason">Причина (для отказа или доработки)</label><input id="app-reason" type="text" placeholder="Например: не заполнена история державы">
          <div class="acts"><button type="button" class="btn sm" id="a-ret">Вернуть на доработку</button><button type="button" class="btn sm danger" id="a-rej">Отклонить</button></div>
          <p class="hint">Одобрение с созданием державы подключим следующим шагом: оно запускает стартовую экономику и колонию.</p>`;
        const reason = () => $('#app-reason', det).value.trim();
        $('#a-ret', det).onclick = async () => { await act('app.return', a.id, { reason: reason() }); RENDER.apps(sec); };
        $('#a-rej', det).onclick = async () => { if (await confirmBox(`Отклонить заявку «${a.name}»?`)) { await act('app.reject', a.id, { reason: reason() }); RENDER.apps(sec); } };
      });
  },

  // Управление фракциями
  async factions(sec, q = '') {
    const items = await list('factions', q || null, 200);
    split(sec, 'Управление фракциями', items,
      (f) => html`<b>${f.name}</b><span>${f.owner_name} · колоний: ${num(f.colonies)}</span>`,
      (det, f) => {
        det.innerHTML = html`<div class="det-head"><span class="crest sm">${crest(f.herald_url)}</span><h3>${f.name}</h3></div>
          <div class="grp"><h4>Казна</h4>
            <div class="row"><span>ГС <b>${num(f.gc)}</b></span><span>ОН <b>${num(f.science)}</b></span></div>
            <div class="give"><input id="d-gc" type="number" step="1000" placeholder="± ГС" aria-label="Изменение ГС"><input id="d-sc" type="number" step="10" placeholder="± ОН" aria-label="Изменение ОН">
              <input id="d-note" type="text" placeholder="Причина (видна в журнале)" aria-label="Причина"><button type="button" class="btn gold sm" id="d-apply">Применить</button></div>
            <p class="hint">${isSuperadmin() ? 'Выполнится сразу.' : 'Изменение казны уйдёт суперадмину на одобрение.'}</p></div>
          <div class="grp"><h4>Скоро</h4><p class="hint">Выдача ресурсов, юнитов и агентов, снять игрока и удалить державу переносим следующими шагами.</p></div>`;
        $('#d-apply', det).onclick = async () => {
          const gc = Number($('#d-gc', det).value || 0), sc = Number($('#d-sc', det).value || 0);
          if (!gc && !sc) { toast('Укажите изменение ГС или ОН', 'err'); return; }
          await act('faction.treasury', f.faction_id, { gc, science: sc }, $('#d-note', det).value.trim() || null);
          RENDER.factions(sec, q);
        };
      },
      html`<input class="search" type="search" id="fac-q" placeholder="Поиск державы" aria-label="Поиск державы" value="${q}">`);
    const inp = $('#fac-q', sec);
    inp.onkeydown = (e) => { if (e.key === 'Enter') RENDER.factions(sec, inp.value.trim()); };
  },

  // Мультиаккаунты
  async multi(sec) {
    const rows = await list('multi', null, 200);
    const flagged = rows.filter((r) => r.ip_shared > 0 || r.fp_shared > 0).length;
    sec.innerHTML = html`<div class="sec-h"><h2>Аудит мультиаккаунтов</h2><small>подозрительных: ${flagged}</small></div>
      <div class="tbl"><table><thead><tr><th>Игрок</th><th>Последний вход</th><th>Входов</th><th>Общий IP</th><th>Общее устройство</th>${isSuperadmin() ? raw('<th>IP</th>') : ''}</tr></thead><tbody>
      ${rows.map((r) => raw(html`<tr class="${r.ip_shared || r.fp_shared ? 'flag' : ''}"><td><b>${r.name}</b></td><td>${dateTime(r.last_at)}</td><td>${num(r.logins)}</td>
        <td>${r.ip_shared ? raw(html`<span class="tag new">с ${r.ip_shared}</span>`) : '—'}</td><td>${r.fp_shared ? raw(html`<span class="tag new">с ${r.fp_shared}</span>`) : '—'}</td>
        ${isSuperadmin() ? raw(html`<td><small>${(r.ips || []).join(', ')}</small></td>`) : ''}</tr>`))}
      </tbody></table></div>
      <p class="hint">«Общий IP / устройство» — сколько других аккаунтов входили с того же адреса или устройства. ${isSuperadmin() ? '' : 'Сами адреса видит только суперадмин.'}</p>`;
  },

  // Пользователи
  async users(sec, q = '') {
    const rows = await list('users', q || null, 100);
    const ds = await discordNames(rows.map((u) => u.id));
    sec.innerHTML = html`<div class="sec-h"><h2>Пользователи</h2><input class="search" type="search" id="u-q" placeholder="${isSuperadmin() ? 'Ник или почта' : 'Ник'}" aria-label="Поиск" value="${q}"></div>
      <div class="tbl"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Уровень</th><th>Статус</th><th></th></tr></thead><tbody>
      ${rows.map((u) => raw(html`<tr data-id="${u.id}">
        <td><b>${u.name}</b> <button type="button" class="link-btn" data-rename>изменить</button>${ds[u.id] ? discordBadge(ds[u.id]) : ''}${u.email ? raw(html`<small>${u.email}</small>`) : ''}</td>
        <td>${isSuperadmin()
          ? raw(html`<select data-staff aria-label="Роль">
              <option value="" ${raw(!u.staff_level ? 'selected' : '')}>${ROLE_LABEL[u.role === 'team' ? 'player' : u.role]}</option>
              <option value="admin" ${raw(u.staff_level === 'admin' ? 'selected' : '')}>Команда · Админ</option>
              <option value="superadmin" ${raw(u.staff_level === 'superadmin' ? 'selected' : '')}>Команда · Суперадмин</option></select>`)
          : raw(html`<span class="role-badge" data-role="${u.role}">${u.role === 'team' ? `Команда · ${LEVEL_LABEL[u.staff_level] || ''}` : ROLE_LABEL[u.role]}</span>`)}</td>
        <td><input type="number" class="lvl" data-lvl value="${u.level ?? ''}" aria-label="Уровень" min="0" max="99"></td>
        <td><span class="tag ${u.banned ? 'new' : ''}">${u.banned ? 'забанен' : 'активен'}</span></td>
        <td>${u.staff_level === 'superadmin' ? '' : raw(html`<button type="button" class="btn sm ${u.banned ? '' : 'danger'}" data-ban="${u.banned ? 'unban' : 'ban'}">${u.banned ? 'Разбанить' : 'Бан'}</button>`)}</td></tr>`))}
      </tbody></table></div>
      <p class="hint">${isSuperadmin() ? 'Роль в команде меняет только суперадмин.' : 'Бан и смена уровня уходят суперадмину на одобрение.'}</p>
      <div class="grp" id="blk"><h4>Запрещённые слова в именах</h4><p class="hint">Проверяются с учётом обхода: латиница вместо кириллицы, цифры вместо букв, точки и пробелы внутри слова, повторы букв. Пишите корень слова (не короче 3 букв).</p>
        <div class="give"><input type="text" id="blk-w" placeholder="Слово или корень" aria-label="Слово"><select id="blk-k" aria-label="Тип"><option value="mat">мат, оскорбление</option><option value="politics">политик</option><option value="nazi">нацизм</option><option value="reserved">служебное</option><option value="other">другое</option></select><button type="button" class="btn sm" id="blk-add">Запретить</button></div>
        <div class="blk-list" id="blk-list">Загружаю…</div></div>`;
    const inp = $('#u-q', sec);
    inp.onkeydown = (e) => { if (e.key === 'Enter') RENDER.users(sec, inp.value.trim()); };
    const KINDS = { mat: 'мат', politics: 'политики', nazi: 'нацизм', reserved: 'служебные', other: 'другое' };
    const drawBlk = async () => {
      const list = await rpc('v1_name_blocklist_list').catch(() => null);
      $('#blk-list', sec).innerHTML = !list ? '<p class="empty warn">Имена ещё не подключены в базе (миграция 12).</p>'
        : Object.entries(KINDS).map(([k, t]) => { const ws = list.filter((x) => x.kind === k); return ws.length ? html`<p><b>${t}:</b> ${raw(ws.map((x) => html`<span class="tag blk-w">${x.word}<button type="button" data-unblock="${x.word}" aria-label="Убрать">×</button></span>`).join(' '))}</p>` : ''; }).join('');
    };
    drawBlk();
    sec.onclick = async (e) => {
      if (e.target.closest('#blk-add')) {
        const w = $('#blk-w', sec).value.trim(); if (!w) return;
        await act('names.block_add', w, { kind: $('#blk-k', sec).value }).catch(() => {});
        $('#blk-w', sec).value = ''; drawBlk(); return;
      }
      const ub = e.target.closest('[data-unblock]');
      if (ub) { await act('names.block_del', ub.dataset.unblock).catch(() => {}); drawBlk(); return; }
      const rn = e.target.closest('[data-rename]');
      if (rn) {
        const tr = rn.closest('tr'); const cell = rn.parentElement;
        cell.innerHTML = html`<div class="give"><input type="text" maxlength="24" value="${tr.querySelector('b')?.textContent || ''}" aria-label="Новое имя"><button type="button" class="btn sm gold" data-rn-save>OK</button></div>`;
        cell.querySelector('[data-rn-save]').onclick = async () => {
          const r = await act('names.rename', tr.dataset.id, { name: cell.querySelector('input').value }).catch(() => null);
          if (r) RENDER.users(sec, q);
        };
        return;
      }
      const b = e.target.closest('[data-ban]'); if (!b) return;
      const id = b.closest('tr').dataset.id;
      if (b.dataset.ban === 'ban' && !(await confirmBox('Забанить пользователя? Он потеряет доступ к кабинету, держава останется.', 'Забанить'))) return;
      await act(b.dataset.ban === 'ban' ? 'user.ban' : 'user.unban', id).catch(() => {});
      RENDER.users(sec, q);
    };
    sec.onchange = async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.matches('[data-lvl]')) await act('user.set_level', id, { level: Number(e.target.value || 0) }).catch(() => {});
      if (e.target.matches('[data-staff]')) {
        const v = e.target.value;
        if (!(await confirmBox(v ? `Назначить в команду проекта (${LEVEL_LABEL[v]})?` : 'Убрать из команды проекта?', 'Да'))) { RENDER.users(sec, q); return; }
        await act(v ? 'staff.grant' : 'staff.revoke', id, v ? { level: v } : {}).catch(() => {});
        RENDER.users(sec, q);
      }
    };
  },

  // Новости
  async news(sec, tab = 'pending') {
    const H = await loadHeralds().catch(() => ({}));
    const tabs = html`<div class="seg" role="group" aria-label="Новости"><button type="button" data-nt="pending" aria-pressed="${String(tab === 'pending')}">На одобрение</button><button type="button" data-nt="live" aria-pressed="${String(tab === 'live')}">Опубликованные</button></div><a class="btn sm" href="#/news?new=post">+ Пост от команды проекта</a>`;
    const wireTabs = () => { $('.sec-h .seg', sec).onclick = (e) => { const b = e.target.closest('[data-nt]'); if (b) RENDER.news(sec, b.dataset.nt); }; };
    if (tab === 'live') {
      const { data } = await sb.from('faction_news').select('id,faction_id,faction_name,title,excerpt,body,image_url,published_at,created_at,kind')
        .eq('status', 'approved').order('published_at', { ascending: false, nullsFirst: false }).limit(80);
      split(sec, 'Опубликованные новости', data || [],
        (n) => html`<b>${n.title}</b><span>${n.faction_name || 'Держава'} · ${dateTime(n.published_at || n.created_at)}</span>${n.kind !== 'news' ? raw(html`<span class="tag">${n.kind}</span>`) : ''}`,
        (det, n) => {
          det.innerHTML = html`<h3>${n.title}</h3><p class="who">${n.faction_name || 'Держава'} · ${starDate(n.published_at || n.created_at)}</p>
            <div class="msg-b">${plain(n.body).slice(0, 600)}</div>
            <div class="acts"><a class="btn sm" href="#/news?id=${n.id}">Открыть</a></div>
            <div class="grp"><h4>Лорная новость?</h4><p class="hint">Тексты вроде «Война есть и будет» — это вступления от команды проекта, а не передачи держав. Перенос создаст пост в правой колонке главной и уберёт новость из вестника в архив.</p>
              <div class="give"><select id="tp-kind" aria-label="Тип поста"><option value="lore">Лор</option><option value="event">Ивент</option><option value="announce">Объявление</option></select><button type="button" class="btn gold sm" id="tp-go">Перенести в «От команды проекта»</button></div></div>`;
          $('#tp-go', det).onclick = async () => {
            if (!(await confirmBox(`Перенести «${n.title}» в «От команды проекта»?`, 'Перенести'))) return;
            const r = await act('news.to_post', n.id, { kind: $('#tp-kind', det).value }).catch(() => null);
            if (r) RENDER.news(sec, 'live');
          };
        }, tabs);
      wireTabs();
      return;
    }
    const items = await list('news');
    split(sec, 'Новости на одобрение', items,
      (n) => html`<b>${n.title}</b><span>${n.faction_name || 'Держава'} · ${dateTime(n.created_at)}</span>`,
      (det, n) => {
        const h = H[n.faction_id] || {};
        det.innerHTML = html`<p class="who">Предпросмотр, как увидят игроки</p>
          <article class="card preview"><div class="ban">${n.image_url ? raw(html`<img src="${n.image_url}" alt="" referrerpolicy="no-referrer">`) : crest(h.herald_url)}</div>
            <div class="c-body"><span class="fac"><i></i>${n.faction_name || h.name || 'Держава'}</span><h3>${n.title}</h3><p>${plain(n.excerpt || n.body).slice(0, 260)}</p><span class="sd">${starDate(n.created_at)}</span></div></article>
          <details class="full"><summary>Полный текст с оформлением</summary><div class="msg-b rich" id="n-full">${raw(rich(n.body || '', { heralds: H }))}</div></details>
          <label for="n-reason">Причина отклонения</label><input id="n-reason" type="text" placeholder="Например: нарушение правил РП">
          <div class="acts"><button type="button" class="btn gold sm" id="n-ok">Одобрить</button><button type="button" class="btn sm danger" id="n-no">Отклонить</button></div>`;
        wireRich($('#n-full', det));
        $('#n-ok', det).onclick = async () => { await act('news.approve', n.id); RENDER.news(sec); };
        $('#n-no', det).onclick = async () => { await act('news.reject', n.id, { reason: $('#n-reason', det).value.trim() }); RENDER.news(sec); };
      }, tabs);
    wireTabs();
  },

  // Редакция страниц и посты команды проекта
  async pages(sec, q = '') {
    const [pages, posts, docs] = await Promise.all([
      list('pages', q || null, 200),
      sb.from('v1_posts').select('id,kind,title,published,created_at').order('created_at', { ascending: false }).limit(50).then((r) => r.data || []),
      sb.from('v1_docs').select('id,kind,grp,title,body,sort').order('kind').order('sort').then((r) => r.data || []),
    ]);
    const KIND = { guide: ['Гайдбук', '20261023_03_guide.sql', 'гайдбуке'], rules: ['Правила', '20261023_04_rules.sql', 'правилах'] };
    const ofKind = (k) => docs.filter((d) => d.kind === k);
    sec.innerHTML = html`<div class="sec-h"><h2>Редакция страниц</h2><input class="search" type="search" id="p-q" placeholder="Поиск страницы" aria-label="Поиск страницы" value="${q}"></div>
      <div class="split">
        <div class="tree" id="tree">
          ${Object.entries(KIND).map(([k, [name, file]]) => raw(html`<b>${name}</b>${ofKind(k).length ? '' : raw(html`<span class="hint tree-hint">Примените миграцию ${file}</span>`)}
            ${ofKind(k).map((d) => raw(html`<button type="button" data-doc="${d.id}" data-kind="${k}">${d.title}</button>`))}
            ${ofKind(k).length ? raw(html`<button type="button" data-doc="new" data-kind="${k}">+ Новый раздел</button>`) : ''}`))}
          <b>Посты команды проекта</b><a class="tree-a" href="#/news?new=post">+ Новый пост</a>
          ${posts.map((p) => raw(html`<a class="tree-a" href="#/news?edit=${p.id}">${p.published ? '' : '◌ '}${p.title}</a>`))}
          ${Object.entries(groupBy(pages, (p) => p.section || 'Без раздела')).map(([s, ps]) => raw(html`<b>${s}</b>${ps.map((p) => raw(html`<button type="button" data-page="${p.id}">${p.title || p.slug}</button>`))}`))}
        </div>
        <div class="detail" id="ed"><p class="empty">Выберите страницу или пост слева.</p></div>
      </div>`;
    const inp = $('#p-q', sec);
    inp.onkeydown = (e) => { if (e.key === 'Enter') RENDER.pages(sec, inp.value.trim()); };
    const ed = $('#ed', sec);
    $('#tree', sec).onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#tree button', sec).forEach((x) => x.classList.toggle('sel', x === b));
      if (b.dataset.page) {
        const p = await list('page', b.dataset.page);
        ed.innerHTML = html`<label for="pg-title">Заголовок</label><input id="pg-title" type="text" value="${p.title || ''}">
          <label for="pg-body">Текст</label><textarea id="pg-body" rows="14">${p.content || ''}</textarea>
          <div class="acts"><button type="button" class="btn gold sm" id="pg-save">Сохранить</button><button type="button" class="btn sm danger" id="pg-del">Удалить страницу</button></div>
          <p class="hint">${isSuperadmin() ? '' : 'Удаление уйдёт суперадмину на одобрение.'}</p>`;
        $('#pg-save', ed).onclick = () => act('page.update', p.id, { title: $('#pg-title', ed).value, content: $('#pg-body', ed).value });
        $('#pg-del', ed).onclick = async () => { if (await confirmBox(`Удалить страницу «${p.title}»?`, 'Удалить')) { await act('page.delete', p.id); RENDER.pages(sec, q); } };
      } else if (b.dataset.doc) {
        const kind = b.dataset.kind, list = ofKind(kind);
        const groups = [...new Set(list.map((d) => d.grp))];
        const d = list.find((x) => x.id === b.dataset.doc) || { id: '', grp: groups[groups.length - 1] || 'Начало', title: '', body: '', sort: (list.at(-1)?.sort || 0) + 10 };
        ed.innerHTML = html`<label for="dc-title">Заголовок раздела</label><input id="dc-title" type="text" value="${d.title}">
          <label for="dc-grp">Группа в оглавлении</label><input id="dc-grp" type="text" list="dc-grps" value="${d.grp}"><datalist id="dc-grps">${groups.map((g) => raw(html`<option value="${g}">`))}</datalist>
          <label for="dc-body">Текст</label><textarea id="dc-body" rows="18">${d.body}</textarea>
          <p class="hint">Разметка: пустая строка — абзац, «## » — подзаголовок, «- » — пункт, «| a | b |» — таблица, «> » — совет, «>! » — важно, **жирный**, ![подпись](ссылка) — картинка из медиатеки (кнопка «Для текста»).</p>
          <div class="acts"><button type="button" class="btn gold sm" id="dc-save">Сохранить</button>${d.id ? raw(html`<a class="btn sm" href="#/${kind}?s=${d.id.replace(`${kind}/`, '')}">Открыть в ${KIND[kind][2]}</a><button type="button" class="btn sm danger" id="dc-del">Удалить раздел</button>`) : ''}</div>`;
        $('#dc-save', ed).onclick = async () => {
          const title = $('#dc-title', ed).value.trim();
          const id = d.id || `${kind}/${title.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || Date.now()}`;
          await act('doc.save', id, { kind, grp: $('#dc-grp', ed).value.trim(), title, body: $('#dc-body', ed).value, sort: d.sort });
          RENDER.pages(sec, q);
        };
        $('#dc-del', ed)?.addEventListener('click', async () => { if (await confirmBox(`Удалить раздел «${d.title}»?`, 'Удалить')) { await act('doc.delete', d.id); RENDER.pages(sec, q); } });
      }
    };
  },

  // Правила одобрения (суперадмин)
  async policy(sec) {
    const rows = await list('policy');
    sec.innerHTML = html`<div class="sec-h"><h2>Правила одобрения</h2><small>Что админ делает сам, а что только через вас</small></div>
      <div class="tbl"><table><thead><tr><th>Действие</th><th>Для админа</th></tr></thead><tbody>
      ${rows.map((r) => raw(html`<tr data-a="${r.action}"><td>${r.label}<small>${r.action}</small></td><td>${['staff.grant', 'staff.revoke', 'policy.set'].includes(r.action)
        ? raw(html`<span class="tag">${MODE_LABEL[r.mode]}</span>`)
        : raw(html`<select aria-label="Режим">${Object.entries(MODE_LABEL).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === r.mode ? 'selected' : '')}>${v}</option>`))}</select>`)}</td></tr>`))}
      </tbody></table></div>`;
    sec.onchange = (e) => { const tr = e.target.closest('tr[data-a]'); if (tr) act('policy.set', tr.dataset.a, { mode: e.target.value }).catch(() => {}); };
  },

  // Журнал
  async audit(sec) {
    const rows = await list('audit', null, 200);
    const OUT = { done: 'выполнено', requested: 'запрошено', approved: 'одобрено', rejected: 'отклонено', cancelled: 'отозвано', failed: 'ошибка' };
    sec.innerHTML = html`<div class="sec-h"><h2>Журнал действий</h2><small>последние ${rows.length}</small></div>
      <div class="tbl"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Цель</th><th>Итог</th></tr></thead><tbody>
      ${rows.map((r) => raw(html`<tr><td>${dateTime(r.created_at)}</td><td>${r.actor_name}</td><td>${r.action}</td><td><small>${r.target || ''}</small></td><td><span class="tag">${OUT[r.outcome] || r.outcome}</span></td></tr>`))}
      </tbody></table></div>`;
  },

  // Тестовые функции
  async tests(sec) {
    sec.innerHTML = html`<div class="sec-h"><h2>Тестовые функции</h2></div>
      <div class="test-grid">
        <div class="grp"><h4>Создать сражение</h4><p class="hint">Космическое и наземное, против бота или державы, ход бота.</p></div>
        <div class="grp"><h4>Время и экономика</h4><p class="hint">+1 тик, начислить доход, сбросить таймер дохода.</p></div>
        <div class="grp"><h4>Флоты и разведка</h4><p class="hint">Пропустить полёт, завершить шпионаж.</p></div>
        <div class="grp danger-zone"><h4>Сброс</h4><p class="hint">Обнулить казну, обнулить ресурсы.</p></div>
      </div>
      <p class="hint">Эти кнопки подключим вместе с переносом боёв и экономики: их серверная часть сейчас живёт в старом коде, который мы заменяем.</p>`;
  },
};

function groupBy(arr, fn) { return arr.reduce((m, x) => { (m[fn(x)] ||= []).push(x); return m; }, {}); }
