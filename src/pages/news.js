import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { session, isTeam } from '../lib/session.js';
import { starDate, dateTime, plain } from '../lib/format.js';
import { rich, wireRich, mentionsOf, firstImage } from '../lib/rich.js';
import { richEditor } from '../ui/rich-editor.js';
import { uploadMedia } from '../lib/upload.js';
import { act } from '../lib/act.js';
import { loadHeralds, crest } from './home.js';

export const POST_KIND = { event: 'Ивент', lore: 'Лор', announce: 'Объявление' };
const NEWS_STATUS = { draft: 'черновик', pending: 'на проверке', approved: 'опубликована', rejected: 'отклонена', archived: 'в архиве' };

/**
 * #/news?id=…        новость державы целиком
 * #/news?post=…      пост команды проекта целиком
 * #/news?new         написать новость державы (игрок)
 * #/news?new=post    написать пост команды проекта; ?edit=<id> — изменить
 * #/news             мои новости
 */
export async function renderNews(root) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const H = await loadHeralds().catch(() => ({}));
  if (q.get('id')) return showNews(root, q.get('id'), H);
  if (q.get('post')) return showPost(root, q.get('post'), H);
  if (q.has('new') && q.get('new') === 'post' || q.get('edit')) return isTeam() ? postForm(root, q.get('edit'), H) : denied(root);
  if (q.has('new') || q.get('draft')) return newsForm(root, q.get('draft'), H);
  return myNews(root, H);
}

const denied = (root) => {
  root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-shield')}</span><div><h1>Нет доступа</h1><p>Писать посты от команды проекта могут только её члены.</p></div><a class="btn" href="#/">На главную</a></section>`;
};

function article(root, { banner, chip, title, date, body, H, tools = '', kind = '' }) {
  root.innerHTML = html`
    <article class="panel read">
      <a class="btn sm read-back" href="#/">${icon('i-back')}На главную</a>
      ${banner ? raw(html`<div class="read-ban"><img src="${banner}" alt="" referrerpolicy="no-referrer"></div>`) : ''}
      <div class="read-meta">${raw(chip)}${kind ? raw(html`<span class="tag">${kind}</span>`) : ''}<time>${date}</time>${raw(tools)}</div>
      <h1>${title}</h1>
      <div class="rich" id="rx">${raw(rich(body, { heralds: H }))}</div>
    </article>`;
  wireRich($('#rx', root));
}

async function showNews(root, id, H) {
  const { data: n } = await sb.from('faction_news').select('id,faction_id,faction_name,title,excerpt,body,image_url,status,published_at,created_at,owner_id').eq('id', id).maybeSingle();
  if (!n) { root.innerHTML = '<section class="panel gate"><div><h1>Новость не найдена</h1><p>Её могли снять с публикации.</p></div><a class="btn" href="#/">На главную</a></section>'; return; }
  const h = H[n.faction_id] || {};
  const own = session.user && n.owner_id === session.user.id && ['draft', 'rejected', 'pending'].includes(n.status);
  article(root, {
    banner: n.image_url, H,
    chip: html`<span class="fac" style="--fc:${h.color || ''}"><span class="crest xs">${crest(h.herald_url)}</span>${n.faction_name || h.name || 'Держава'}</span>`,
    title: n.title, date: starDate(n.published_at || n.created_at), body: n.body || n.excerpt || '',
    kind: n.status !== 'approved' ? NEWS_STATUS[n.status] : '',
    tools: own ? html`<a class="btn sm" href="#/news?draft=${n.id}">Изменить</a>` : '',
  });
}

async function showPost(root, id, H) {
  const { data: p } = await sb.from('v1_posts').select('id,kind,title,body,image_url,published,created_at').eq('id', id).maybeSingle();
  if (!p) { root.innerHTML = '<section class="panel gate"><div><h1>Пост не найден</h1></div><a class="btn" href="#/">На главную</a></section>'; return; }
  article(root, {
    banner: p.image_url, H,
    chip: html`<span class="fac team">${icon('i-shield')}Команда проекта</span>`,
    title: p.title, date: starDate(p.created_at), body: p.body, kind: `${POST_KIND[p.kind] || 'Пост'}${p.published ? '' : ' · не опубликован'}`,
    tools: isTeam() ? html`<a class="btn sm" href="#/news?edit=${p.id}">Изменить</a>` : '',
  });
}

/** Баннер новости: загрузить файл или оставить пустым. */
function bannerField(box, url, folder) {
  let value = url || null;
  const draw = () => {
    box.innerHTML = html`<div class="ban-pick">${value ? raw(html`<img src="${value}" alt="">`) : raw('<span>Без баннера — возьмём первую картинку из текста или герб</span>')}</div>
      <div class="acts"><label class="btn sm file-btn">Загрузить баннер<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${value ? raw('<button type="button" class="btn sm" data-clear>Убрать</button>') : ''}</div>`;
    box.querySelector('input').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      toast('Загружаю…');
      try { value = (await uploadMedia(f, { folder, max: 1600 })).url; draw(); toast('Баннер загружен'); } catch (err) { toast(err.message, 'err'); }
    };
    const c = box.querySelector('[data-clear]'); if (c) c.onclick = () => { value = null; draw(); };
  };
  draw();
  return { get value() { return value; } };
}

// ── новость державы ──
async function newsForm(root, draftId, H) {
  if (!session.user) { root.innerHTML = '<section class="panel gate"><div><h1>Войдите</h1><p>Писать в вестник могут игроки с державой.</p></div></section>'; return; }
  if (!session.factionId) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-flag')}</span><div><h1>Нужна держава</h1><p>Новости в вестник пишут от имени державы.</p></div><a class="btn gold" href="#/apply">Подать заявку</a></section>`;
    return;
  }
  let n = { title: '', excerpt: '', body: '', image_url: null };
  if (draftId) {
    const { data } = await sb.from('faction_news').select('id,title,excerpt,body,image_url,status,reject_reason').eq('id', draftId).maybeSingle();
    if (data) n = data;
  }
  const me = H[session.factionId] || {};
  root.innerHTML = html`
    <section class="panel compose">
      <div class="sec-h"><h1>${n.id ? 'Изменить новость' : 'Новость в вестник'}</h1><small>от имени: ${me.name || 'вашей державы'}</small></div>
      ${n.status === 'rejected' && n.reject_reason ? raw(html`<p class="note warn">Отклонено командой проекта: ${n.reject_reason}</p>`) : ''}
      <label for="nw-title">Заголовок</label><input id="nw-title" type="text" maxlength="140" value="${n.title}">
      <label for="nw-ex">Анонс для карточки <small>необязательно, до 260 знаков</small></label><input id="nw-ex" type="text" maxlength="260" value="${n.excerpt || ''}">
      <label>Баннер</label><div id="nw-ban"></div>
      <label>Текст</label><div id="nw-ed"></div>
      <p class="hint">После отправки новость проверит член команды проекта. Отредактированная опубликованная новость снова уходит на проверку.</p>
      <div class="acts"><button type="button" class="btn gold" id="nw-send">Отправить на проверку</button><button type="button" class="btn" id="nw-draft">Сохранить черновик</button><a class="btn" href="#/news">Мои новости</a></div>
    </section>`;
  const ban = bannerField($('#nw-ban', root), n.image_url, 'news');
  const ed = richEditor($('#nw-ed', root), { value: n.body || '', heralds: H, folder: 'news' });
  const save = async (status) => {
    const title = $('#nw-title', root).value.trim(), body = ed.value.trim();
    if (!title) { toast('Нужен заголовок', 'err'); return; }
    if (status === 'pending' && body.length < 20) { toast('Текст слишком короткий', 'err'); return; }
    const row = {
      title, body, excerpt: $('#nw-ex', root).value.trim() || null,
      image_url: ban.value || firstImage(body), status, kind: 'news',
      mentions: mentionsOf(body).filter((id) => id !== session.factionId), updated_at: new Date().toISOString(),
    };
    const { error } = n.id
      ? await sb.from('faction_news').update(row).eq('id', n.id)
      : await sb.from('faction_news').insert({ ...row, faction_id: session.factionId, faction_name: me.name || null, faction_color: me.color || null, author_herald: me.herald_url || null, owner_id: session.user.id, owner_email: session.user.email });
    if (error) { toast(error.message, 'err'); return; }
    toast(status === 'pending' ? 'Отправлено на проверку' : 'Черновик сохранён');
    location.hash = '/news';
  };
  $('#nw-send', root).onclick = () => save('pending');
  $('#nw-draft', root).onclick = () => save('draft');
}

async function myNews(root, H, filter = '') {
  if (!session.user) { location.hash = '/'; return; }
  const { data } = await sb.from('faction_news')
    .select('id,title,excerpt,body,image_url,status,reject_reason,faction_id,created_at,published_at')
    .eq('owner_id', session.user.id).order('created_at', { ascending: false }).limit(100);
  const all = data || [];
  const count = (st) => all.filter((r) => r.status === st).length;
  const rows = filter ? all.filter((r) => r.status === filter) : all;
  const TABS = [['', 'Все', all.length], ['approved', 'Опубликованы', count('approved')], ['pending', 'На проверке', count('pending')], ['draft', 'Черновики', count('draft')], ['rejected', 'Отклонены', count('rejected')]];
  root.innerHTML = html`
    <section class="panel compose mynews">
      <div class="sec-h"><h1>Мои новости</h1>
        ${session.factionId ? raw(`<a class="btn gold sm" href="#/news?new">${icon('i-news').html}Написать новость</a>`) : ''}
        ${isTeam() ? raw('<a class="btn sm" href="#/news?new=post">Пост от команды проекта</a>') : ''}</div>
      <div class="seg mn-tabs" role="group" aria-label="Статус">${TABS.filter(([k, , n]) => !k || n).map(([k, t, n]) => raw(html`<button type="button" data-f="${k}" aria-pressed="${String(k === filter)}">${t} <small>${n}</small></button>`))}</div>
      <ol class="mn-list">${rows.length ? raw(rows.map((r) => {
        const h = H[r.faction_id] || {};
        const editable = ['draft', 'rejected', 'pending'].includes(r.status);
        const img = r.image_url || firstImage(r.body);
        return html`<li class="mn-item st-${r.status}">
          <a class="mn-main" href="#/news?${editable && r.status !== 'pending' ? 'draft' : 'id'}=${r.id}">
            <span class="mn-thumb">${img ? raw(html`<img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer">`) : crest(h.herald_url)}</span>
            <span class="mn-text"><b>${r.title}</b><small>${plain(r.excerpt || r.body).slice(0, 140)}</small>
              ${r.status === 'rejected' && r.reject_reason ? raw(html`<em class="mn-why">Причина: ${r.reject_reason}</em>`) : ''}</span>
          </a>
          <span class="mn-side"><span class="tag ${r.status === 'approved' ? 'new' : ''}">${NEWS_STATUS[r.status] || r.status}</span><time>${dateTime(r.published_at || r.created_at)}</time>
            ${editable ? raw(html`<a class="btn sm" href="#/news?draft=${r.id}">Изменить</a>`) : ''}</span>
        </li>`;
      }).join('')) : raw('<li class="empty">Здесь пока пусто.</li>')}</ol>
    </section>`;
  $('.mn-tabs', root).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) myNews(root, H, b.dataset.f); };
}

// ── пост команды проекта ──
async function postForm(root, id, H) {
  let p = { kind: 'announce', title: '', body: '', image_url: null, published: false };
  if (id) { const { data } = await sb.from('v1_posts').select('*').eq('id', id).maybeSingle(); if (data) p = data; }
  root.innerHTML = html`
    <section class="panel compose">
      <div class="sec-h"><h1>${p.id ? 'Изменить пост' : 'Пост от команды проекта'}</h1><small>появится в правой колонке главной</small></div>
      <div class="row2"><div><label for="po-kind">Тип</label><select id="po-kind">${Object.entries(POST_KIND).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === p.kind ? 'selected' : '')}>${v}</option>`))}</select></div>
        <label class="check" for="po-pub"><input id="po-pub" type="checkbox" ${raw(p.published ? 'checked' : '')}> Опубликовать на главной</label></div>
      <label for="po-title">Заголовок</label><input id="po-title" type="text" maxlength="160" value="${p.title}">
      <label>Баннер</label><div id="po-ban"></div>
      <label>Текст</label><div id="po-ed"></div>
      <div class="acts"><button type="button" class="btn gold" id="po-save">Сохранить</button>${p.id ? raw(html`<a class="btn" href="#/news?post=${p.id}">Открыть</a><button type="button" class="btn danger" id="po-del">Удалить</button>`) : ''}</div>
    </section>`;
  const ban = bannerField($('#po-ban', root), p.image_url, 'news');
  const ed = richEditor($('#po-ed', root), { value: p.body || '', heralds: H, folder: 'news', rows: 18 });
  $('#po-save', root).onclick = async () => {
    const row = { kind: $('#po-kind', root).value, title: $('#po-title', root).value.trim(), body: ed.value, image_url: ban.value || firstImage(ed.value), published: $('#po-pub', root).checked, updated_at: new Date().toISOString() };
    if (!row.title) { toast('Нужен заголовок', 'err'); return; }
    const r = p.id ? await sb.from('v1_posts').update(row).eq('id', p.id).select('id').maybeSingle()
      : await sb.from('v1_posts').insert({ ...row, author_id: session.user.id }).select('id').maybeSingle();
    if (r.error) { toast(r.error.message, 'err'); return; }
    toast('Пост сохранён');
    location.hash = `/news?post=${r.data?.id || p.id}`;
  };
  $('#po-del', root)?.addEventListener('click', async () => {
    if (!(await confirmBox(`Удалить пост «${p.title}»?`, 'Удалить'))) return;
    const r = await act('post.delete', p.id).catch(() => null);
    if (r?.status === 'done') location.hash = '/';
  });
}

