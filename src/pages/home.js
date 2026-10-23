import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { sb, rpc } from '../lib/supabase.js';
import { session, isTeam } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { go } from '../lib/router.js';
import { num, starDate, plain, dayMonth, dateShort } from '../lib/format.js';
import { loadTyan, pickDialogue, fillName, spriteFor, FALLBACK } from '../lib/tyan.js';
import { applyArt, art } from '../lib/settings.js';
import { firstImage } from '../lib/rich.js';

const POST_KIND = { event: 'ивент', lore: 'лор', announce: 'объявление' };

/** Герб державы: картинка из заявки или заглушка-щит. */
export function crest(url, cls = '') {
  return url
    ? raw(html`<img class="${cls}" src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer">`)
    : raw(`<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#e1"/></svg>`);
}

let heralds = null;
/** Гербы и цвета держав по faction_id (из одобренных заявок — они публичны). */
export async function loadHeralds() {
  if (heralds) return heralds;
  const { data } = await sb.from('faction_applications').select('faction_id,name,herald_url,color').eq('status', 'approved');
  heralds = Object.fromEntries((data || []).filter((r) => r.faction_id).map((r) => [r.faction_id, r]));
  return heralds;
}

export async function renderHome(root) {
  root.innerHTML = html`
    <section class="panel upd" id="upd" aria-label="Изменения правил и механик"><div class="skeleton">Загружаю изменения правил…</div></section>

    <section class="panel hero" aria-label="Главное">
      <div class="slide on">
        <div>
          <button type="button" class="speech" id="speech" aria-live="polite"><b id="spk">Классикал-Тян</b><span id="line">${fillName(FALLBACK.dialogues[0].lines[0].text)}</span><small aria-hidden="true">▸</small></button>
          <h1 class="t">Звёздные державы, флоты и войны за системы</h1>
          <p class="sub">Браузерная стратегия: колонии и экономика, сражения на тактической арене, дипломатия, разведка и союзы.</p>
          <div class="acts" id="hero-acts"></div>
          <p class="stats-line" id="stats"></p>
        </div>
        <figure class="holo" style="margin:0" aria-label="Голограмма Классикал-Тян">
          <div class="cone"></div>
          <svg viewBox="0 0 200 260" aria-hidden="true" id="tyan-sil"><use href="#tyan"/></svg>
          <img id="tyan-art" alt="" hidden>
          <div class="base"></div>
        </figure>
      </div>
    </section>

    ${isTeam() ? raw(html`
    <section class="panel home-admin" aria-label="Админ-панель">
      <span class="m-ic">${icon('i-shield')}</span>
      <div><b>Админ-панель</b><p id="adm-sum">Тикеты, заявки, новости на одобрение${session.level === 'superadmin' ? ', заявки админов' : ''}</p></div>
      <a class="btn gold sm" href="#/admin">Открыть</a>
    </section>`) : ''}

    <div class="cols">
      <section id="vestnik" aria-label="Вестник фракций">
        <div class="sec-h"><h2>Вестник фракций</h2><small id="news-count"></small><button type="button" class="btn sm" id="open-arch">Архив выпусков</button></div>
        <div class="news" id="news"><div class="skeleton">Загружаю вестник…</div></div>
        <button type="button" class="btn sm more-news" id="more-news" hidden>Показать ещё</button>
      </section>
      <aside class="panel admin" aria-label="От команды проекта">
        <div class="sec-h"><h2>От команды проекта</h2>${isTeam() ? raw('<a class="btn sm" href="#/news?new=post">+ Пост</a>') : ''}</div>
        <ol id="posts"><li class="empty">Загружаю…</li></ol>
      </aside>
    </div>`;

  // кнопки баннера по роли
  const acts = $('#hero-acts', root);
  if (!session.user) {
    acts.innerHTML = html`<button type="button" class="btn gold" id="h-reg">Основать державу</button><button type="button" class="btn" id="h-in">Войти</button>`;
    $('#h-reg', root).onclick = () => openLogin('up');
    $('#h-in', root).onclick = () => openLogin('in');
  } else {
    acts.innerHTML = html`<a class="btn gold" href="${session.factionId ? '#/cabinet' : '#/apply'}">${session.factionId ? 'В кабинет державы' : 'Подать заявку на державу'}</a>`;
  }

  startTyan(root);
  applyArt($('.hero', root), 'home');

  loadRules(root);
  loadNews(root);
  loadPosts(root);
  rpc('v1_galaxy_stats').then((s) => {
    $('#stats', root).textContent = `Сейчас в галактике: ${num(s.factions)} держав · ${num(s.colonies)} колоний · ${num(s.battles)} сражений`;
  }).catch(() => {});
  if (isTeam()) loadAdminSummary(root);
}

async function loadRules(root) {
  const box = $('#upd', root);
  const { data, error } = await sb.from('rules_updates').select('id,at,title,body,tag').order('at', { ascending: false }).limit(6);
  if (error || !data?.length) { box.hidden = true; return; }
  const [last, ...rest] = data;
  const fresh = Date.now() - new Date(last.at) < 7 * 864e5;
  box.innerHTML = html`
    <div class="upd-head">
      <div class="upd-ic">${icon('i-scroll')}</div>
      <div>
        <div class="meta"><b>Изменения правил и механик</b>${fresh ? raw('<span class="tag new">новое</span>') : ''}${last.tag ? raw(html`<span class="tag">${last.tag}</span>`) : ''}<time>${dayMonth(last.at)}</time></div>
        <h3>${last.title}</h3>
        <p class="clamp2">${plain(last.body).slice(0, 260)}</p>
      </div>
      ${rest.length ? raw(html`<button type="button" class="more" id="more" aria-expanded="false" aria-controls="upd-list">Все изменения ${icon('i-down')}</button>`) : ''}
    </div>
    <ol id="upd-list" hidden>
      ${rest.map((r) => raw(html`<li><time>${dateShort(r.at)}</time><span>${r.title}</span>${r.tag ? raw(html`<span class="tag">${r.tag}</span>`) : raw('<span></span>')}</li>`))}
    </ol>`;
  const more = $('#more', box);
  if (more) more.onclick = () => { const l = $('#upd-list', box); const o = l.hidden; l.hidden = !o; more.setAttribute('aria-expanded', String(o)); };
}

const PAGE = 6;
async function loadNews(root) {
  const box = $('#news', root);
  const [H, fallbackArt] = await Promise.all([loadHeralds().catch(() => ({})), art('news')]);
  let offset = 0;
  const { count } = await sb.from('faction_news').select('id', { count: 'exact', head: true }).eq('status', 'approved').eq('kind', 'news');
  if (count != null) $('#news-count', root).textContent = `передач: ${num(count)}`;

  async function page() {
    const { data, error } = await sb.from('faction_news')
      .select('id,faction_id,faction_name,title,excerpt,body,image_url,published_at,created_at')
      .eq('status', 'approved').eq('kind', 'news')
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (error) { box.innerHTML = '<p class="empty">Не удалось загрузить вестник.</p>'; return; }
    if (offset === 0) box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', (data || []).map((n) => newsCard(n, H, fallbackArt)).join(''));
    if (offset === 0 && !data.length) box.innerHTML = '<p class="empty">Пока ни одной передачи. Первая новость державы появится здесь.</p>';
    offset += data.length;
    $('#more-news', root).hidden = data.length < PAGE;
  }
  await page();
  $('#more-news', root).onclick = page;
  $('#open-arch', root).onclick = () => openArchive(H);
}

export function newsCard(n, H = {}, fallbackArt = null) {
  const h = H[n.faction_id] || {};
  const text = plain(n.excerpt || n.body).slice(0, 260);
  const img = n.image_url || firstImage(n.body) || fallbackArt;
  const banner = img
    ? html`<img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : crest(h.herald_url).html;
  return html`
    <article class="card">
      <a class="card-link" href="#/news?id=${n.id}" aria-label="Читать: ${n.title}"></a>
      <div class="ban">${raw(banner)}</div>
      <div class="c-body"><span class="fac"><i></i>${n.faction_name || h.name || 'Держава'}</span>
        <h3>${n.title}</h3>
        <p>${text}</p>
        <span class="sd">${starDate(n.published_at || n.created_at)}</span></div>
    </article>`;
}

async function openArchive(H) {
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.innerHTML = html`
    <div class="panel modal wide" role="dialog" aria-labelledby="at">
      <button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button>
      <h2 id="at">Архив выпусков</h2>
      <p>Все передачи держав, от новых к старым.</p>
      <div class="chips" id="chips" role="group" aria-label="Фильтр по державе"></div>
      <ol class="arch" id="arch"><li>Загружаю…</li></ol>
    </div>`;
  document.body.appendChild(veil);
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-close]')) veil.remove(); });
  const { data } = await sb.from('faction_news').select('id,faction_id,faction_name,title,published_at,created_at')
    .eq('status', 'approved').eq('kind', 'news').order('published_at', { ascending: false, nullsFirst: false }).limit(500);
  const rows = data || [];
  const facs = [...new Map(rows.map((r) => [r.faction_id, r.faction_name || H[r.faction_id]?.name || 'Держава'])).entries()];
  const chips = $('#chips', veil), list = $('#arch', veil);
  chips.innerHTML = html`<button type="button" data-f="" aria-pressed="true">Все</button>${facs.map(([id, name]) => raw(html`<button type="button" data-f="${id}" aria-pressed="false">${name}</button>`))}`;
  const draw = (f) => {
    list.innerHTML = rows.filter((r) => !f || r.faction_id === f).map((r) => html`<li><time>${starDate(r.published_at || r.created_at)}</time><div><b>${r.faction_name || H[r.faction_id]?.name || 'Держава'}</b><a href="#/news?id=${r.id}" data-close>${r.title}</a></div></li>`).join('') || '<li>Нет передач.</li>';
  };
  draw('');
  chips.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', chips).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw(b.dataset.f);
  };
}

async function loadPosts(root) {
  const box = $('#posts', root);
  const { data, error } = await sb.from('v1_posts').select('id,kind,title,body,image_url,created_at').eq('published', true).order('created_at', { ascending: false }).limit(6);
  if (error || !data?.length) {
    box.innerHTML = html`<li class="empty">${isTeam() ? 'Постов пока нет. Нажмите «+ Пост» выше или перенесите лорную новость из вестника в админ-панели.' : 'Здесь появятся ивенты и лорные вступления от команды проекта.'}</li>`;
    return;
  }
  box.innerHTML = data.map((p, i) => html`<li>${p.image_url ? raw(html`<img class="post-img" src="${p.image_url}" alt="" loading="lazy" referrerpolicy="no-referrer">`) : ''}<div class="meta"><span class="tag ${i === 0 ? 'new' : ''}">${POST_KIND[p.kind] || 'пост'}</span><time>${dayMonth(p.created_at)}</time></div>
    <h3><a href="#/news?post=${p.id}">${p.title}</a></h3><p>${plain(p.body).slice(0, 180)}</p></li>`).join('');
}

async function loadAdminSummary(root) {
  try {
    const [tickets, apps, news] = await Promise.all([
      rpc('v1_admin_list', { p_kind: 'tickets', p_q: 'open', p_limit: 200 }),
      rpc('v1_admin_list', { p_kind: 'apps' }),
      rpc('v1_admin_list', { p_kind: 'news' }),
    ]);
    const parts = [`Тикеты <em>${tickets.length}</em>`, `заявки <em>${apps.length}</em>`, `новости на одобрение <em>${news.length}</em>`];
    if (session.level === 'superadmin') parts.push(`заявки админов <em>${session.pendingRequests}</em>`);
    $('#adm-sum', root).innerHTML = parts.join(' · ');
  } catch { /* миграция не применена — оставляем текст по умолчанию */ }
}

/** Реплики Классикал-Тян: диалог по времени суток, арт у каждой реплики, печать по буквам. */
async function startTyan(root) {
  const cfg = await loadTyan();
  const name = session.displayName || (session.user ? 'командир' : 'странник');
  const line = $('#line', root), img = $('#tyan-art', root), sil = $('#tyan-sil', root), btn = $('#speech', root);
  if (!line) return;
  $('#spk', root).textContent = cfg.speaker || 'Классикал-Тян';
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dlg = pickDialogue(cfg), i = 0, timer = 0;
  const show = () => {
    const l = dlg.lines[i] || {};
    const text = fillName(l.text, name);
    clearInterval(timer);
    if (calm) line.textContent = text;
    else { let k = 0; line.textContent = ''; timer = setInterval(() => { line.textContent = text.slice(0, ++k); if (k >= text.length) clearInterval(timer); }, 22); }
    const url = spriteFor(cfg, dlg, l);
    if (url) { if (img.getAttribute('src') !== url) img.src = url; img.hidden = false; sil.hidden = true; } else { img.hidden = true; sil.hidden = false; }
  };
  btn.onclick = () => {
    if (++i >= dlg.lines.length) { dlg = pickDialogue(cfg, dlg.id); i = 0; }
    show();
  };
  show();
}

export { go };
