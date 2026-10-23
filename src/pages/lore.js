import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { isTeam } from '../lib/session.js';
import { renderBlocks, blocksText } from '../lib/blocks.js';
import { wireRich } from '../lib/rich.js';
import { solid } from '../lib/galaxy.js';
import { loadHeralds, crest } from './home.js';

/**
 * Лор: #/history — летопись (эры), #/wiki — вики фракций (только державы с системами на карте),
 * #/lore?p=<старый адрес> — переход по ссылкам [page:…] из старых текстов.
 */
const q = () => new URLSearchParams(location.hash.split('?')[1] || '');

async function loadLore(kind) {
  const { data, error } = await sb.from('v1_lore').select('id,kind,slug,title,cover_url,blocks,faction_id,sort,published,updated_at').eq('kind', kind).order('sort').order('title');
  if (error) throw Object.assign(new Error(error.message), { missing: /v1_lore/.test(error.message) });
  return data || [];
}

const missing = (root) => {
  root.innerHTML = '<section class="panel gate"><div><h1>Лор ещё не перенесён</h1><p>Нужна миграция 20261023_13_lore.sql.</p></div><a class="btn" href="#/">На главную</a></section>';
};

function article(el, page, H) {
  const { html: body } = renderBlocks(page.blocks, { heralds: H });
  el.innerHTML = html`
    ${page.cover_url ? raw(html`<div class="lore-cover"><img src="${page.cover_url}" alt="" referrerpolicy="no-referrer"></div>`) : ''}
    <div class="lore-title"><h1>${page.title}</h1>${isTeam() ? raw(html`<a class="btn sm" href="#/admin?s=lore&id=${encodeURIComponent(page.id)}">Редактировать</a>`) : ''}</div>
    <div class="rich lore-body">${raw(body)}</div>`;
  wireRich(el);
  el.onclick = (e) => {
    const a = e.target.closest('[data-anchor]');
    if (a) { e.preventDefault(); document.getElementById(a.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
}

// ═ Летопись ═
export async function renderHistory(root) {
  let list;
  try { list = await loadLore('history'); } catch (e) { if (e.missing) return missing(root); throw e; }
  const H = await loadHeralds().catch(() => ({}));
  const cur = list.find((p) => p.slug === q().get('s') || p.id === q().get('s')) || list[0];
  root.innerHTML = html`
    <section class="panel guide-head"><span class="m-ic">${icon('i-scroll')}</span>
      <div><h1>История</h1><p>Летопись Даллерии: от первых экспедиций до войн молодых держав.</p></div></section>
    <nav class="eras" aria-label="Эры">${list.map((p, i) => raw(html`<a class="era ${p === cur ? 'on' : ''}" href="#/history?s=${p.slug}" ${raw(p === cur ? 'aria-current="page"' : '')}>
      ${p.cover_url ? raw(html`<img src="${p.cover_url}" alt="" loading="lazy" referrerpolicy="no-referrer">`) : ''}<span><small>Эра ${i + 1}</small><b>${p.title}</b></span></a>`))}</nav>
    <article class="panel lore-page" id="lore-art"></article>`;
  if (!cur) { $('#lore-art', root).innerHTML = '<p class="empty">Пока пусто.</p>'; return; }
  article($('#lore-art', root), cur, H);
}

// ═ Вики фракций ═
export async function renderWiki(root) {
  let list;
  try { list = await loadLore('faction'); } catch (e) { if (e.missing) return missing(root); throw e; }
  const H = await loadHeralds().catch(() => ({}));
  const f = q().get('f');
  if (f) {
    const page = list.find((p) => p.faction_id === f || p.id === f);
    const h = H[f] || {};
    root.innerHTML = html`<a class="btn sm lore-back" href="#/wiki">${icon('i-back')}Все фракции</a><article class="panel lore-page" id="lore-art" style="--fc:${solid(h.color, '#e9b949')}"></article>`;
    if (!page) { $('#lore-art', root).innerHTML = html`<h1>${h.name || 'Фракция'}</h1><p class="empty">Страницы этой фракции в вики пока нет.</p>`; return; }
    article($('#lore-art', root), page, H);
    return;
  }
  const text = Object.fromEntries(list.map((p) => [p.id, blocksText(p.blocks).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ')]));
  root.innerHTML = html`
    <section class="panel guide-head"><span class="m-ic">${icon('i-flag')}</span>
      <div><h1>Вики фракций</h1><p>Державы Даллерии, которые сейчас держат системы на карте.</p></div>
      <input class="search" type="search" id="wk-q" placeholder="Найти фракцию" aria-label="Найти фракцию"></section>
    <div class="wiki-grid" id="wk">${list.map((p) => {
      const h = H[p.faction_id] || {};
      const lead = text[p.id].slice(0, 170);
      return raw(html`<a class="panel wiki-card" href="#/wiki?f=${p.faction_id}" data-q="${(p.title + ' ' + text[p.id]).toLowerCase()}" style="--fc:${solid(h.color, '#e9b949')}">
        <span class="wk-ban">${p.cover_url ? raw(html`<img src="${p.cover_url}" alt="" loading="lazy" referrerpolicy="no-referrer">`) : crest(h.herald_url)}</span>
        <span class="wk-body"><span class="wk-crest">${crest(h.herald_url)}</span><b>${p.title}</b><small>${lead}${lead.length >= 170 ? '…' : ''}</small></span></a>`);
    })}</div>`;
  $('#wk-q', root).oninput = (e) => {
    const v = e.target.value.trim().toLowerCase();
    $$('.wiki-card', root).forEach((c) => { c.hidden = !!v && !c.dataset.q.includes(v); });
  };
}

// ═ Ссылки [page:…] со старой вики ═
export async function renderLoreLink(root) {
  const slug = q().get('p');
  const { data } = await sb.from('v1_lore').select('kind,slug,faction_id').eq('slug', slug).maybeSingle();
  if (!data) { root.innerHTML = '<section class="panel gate"><div><h1>Страница не найдена</h1><p>Её ещё не перенесли со старого сайта.</p></div><a class="btn" href="#/history">К летописи</a></section>'; return; }
  location.replace(data.kind === 'history' ? `#/history?s=${data.slug}` : `#/wiki?f=${data.faction_id}`);
}
