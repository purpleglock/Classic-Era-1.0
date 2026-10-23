import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { markup, searchText } from '../lib/markup.js';
import { GUIDE } from '../content/guide.js';
import { RULES } from '../content/rules.js';
import { isTeam } from '../lib/session.js';
import { applyArt } from '../lib/settings.js';

/** Документы сайта: гайдбук и правила. Устроены одинаково. */
const DOCS = {
  guide: {
    path: '/guide', fallback: GUIDE, icon: 'i-guide', title: 'Игровой гайдбук',
    lead: 'Как устроена держава, экономика, флот и война. Числа здесь — действующие правила игры.',
    search: 'Поиск по гайдбуку', loading: 'Открываю гайдбук…',
  },
  rules: {
    path: '/rules', fallback: RULES, icon: 'i-rules', title: 'Правила проекта',
    lead: 'Принципы проекта, права и обязанности игроков и команды, дисциплинарный регламент.',
    search: 'Поиск по правилам', loading: 'Открываю правила…',
  },
};

/** Разделы из базы (v1_docs) или встроенная копия, если таблицы ещё нет. */
export async function loadDocs(kind) {
  try {
    const { data, error } = await sb.from('v1_docs').select('id,grp,title,body,sort').eq('kind', kind).order('sort');
    if (error || !data?.length) throw new Error('fallback');
    const groups = [];
    for (const d of data) {
      let g = groups.find((x) => x.group === d.grp);
      if (!g) { g = { group: d.grp, sections: [] }; groups.push(g); }
      g.sections.push({ id: d.id.replace(new RegExp(`^${kind}/`), ''), title: d.title, body: d.body });
    }
    return { groups, fromDb: true };
  } catch {
    return { groups: DOCS[kind].fallback, fromDb: false };
  }
}

export const renderGuide = (root) => renderDocs(root, 'guide');
export const renderRules = (root) => renderDocs(root, 'rules');

async function renderDocs(root, kind) {
  const cfg = DOCS[kind];
  const link = (id) => `#${cfg.path}?s=${id}`;
  root.innerHTML = html`<div class="skeleton">${cfg.loading}</div>`;
  const { groups } = await loadDocs(kind);
  const all = groups.flatMap((g) => g.sections.map((s) => ({ ...s, group: g.group, text: searchText(`${s.title} ${s.body}`) })));
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  let current = all.find((s) => s.id === want) || all[0];

  root.innerHTML = html`
    <section class="panel guide-head">
      <span class="m-ic">${icon(cfg.icon)}</span>
      <div><h1>${cfg.title}</h1><p>${cfg.lead}</p></div>
      ${isTeam() ? raw(html`<a class="btn sm" href="#/admin?s=pages">Редактировать</a>`) : ''}
    </section>
    <div class="guide">
      <nav class="panel guide-toc" aria-label="Оглавление">
        <details id="toc-d" open><summary>Оглавление и поиск</summary>
        <input class="search" type="search" id="g-q" placeholder="${cfg.search}" aria-label="${cfg.search}">
        <div id="toc"></div></details>
      </nav>
      <article class="panel guide-body" id="g-body" aria-live="polite"></article>
    </div>`;
  applyArt($('.guide-head', root), kind);

  const toc = $('#toc', root), body = $('#g-body', root);
  const drawToc = (q = '') => {
    const hits = q ? all.filter((s) => s.text.includes(q)) : all;
    toc.innerHTML = groups.map((g) => {
      const items = hits.filter((s) => s.group === g.group);
      if (!items.length) return '';
      return html`<b>${g.group}</b>${items.map((s) => raw(html`<a href="${link(s.id)}" data-id="${s.id}" ${raw(s.id === current.id ? 'aria-current="page"' : '')}>${s.title}</a>`))}`;
    }).join('') || '<p class="empty">Ничего не нашлось.</p>';
  };
  const show = (s, scroll) => {
    current = s;
    const i = all.indexOf(s), prev = all[i - 1], next = all[i + 1];
    body.innerHTML = html`<span class="fac"><i></i>${s.group}</span><h2>${s.title}</h2><div class="md">${raw(markup(s.body))}</div>
      <nav class="guide-pager" aria-label="Соседние разделы">
        ${prev ? raw(html`<a class="btn sm" href="${link(prev.id)}">${icon('i-back')}${prev.title}</a>`) : raw('<span></span>')}
        ${next ? raw(html`<a class="btn sm" href="${link(next.id)}">${next.title} →</a>`) : ''}
      </nav>`;
    $$('a[data-id]', toc).forEach((a) => a.toggleAttribute('aria-current', a.dataset.id === s.id));
    if (scroll) {
      if (innerWidth < 1100) $('#toc-d', root).open = false;
      body.scrollIntoView({ block: 'start' });
    }
  };
  drawToc();
  show(current, false);
  if (innerWidth < 1100) $('#toc-d', root).open = false;

  $('#g-q', root).oninput = (e) => drawToc(e.target.value.trim().toLowerCase());
  // переходы внутри документа — без перерисовки всей страницы
  $('.guide', root).addEventListener('click', (e) => {
    const a = e.target.closest(`a[href^="#${cfg.path}?s="]`); if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href').split('s=')[1];
    const s = all.find((x) => x.id === id); if (!s) return;
    history.replaceState(null, '', link(id));
    show(s, true);
  });
}
