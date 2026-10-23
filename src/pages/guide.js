import { html, raw, icon, $, $$ } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { markup, searchText } from '../lib/markup.js';
import { GUIDE } from '../content/guide.js';
import { isTeam } from '../lib/session.js';

/** Разделы из базы (v1_docs) или встроенная копия, если таблицы ещё нет. */
export async function loadGuide() {
  try {
    const { data, error } = await sb.from('v1_docs').select('id,grp,title,body,sort').eq('kind', 'guide').order('sort');
    if (error || !data?.length) throw new Error('fallback');
    const groups = [];
    for (const d of data) {
      let g = groups.find((x) => x.group === d.grp);
      if (!g) { g = { group: d.grp, sections: [] }; groups.push(g); }
      g.sections.push({ id: d.id.replace(/^guide\//, ''), title: d.title, body: d.body });
    }
    return { groups, fromDb: true };
  } catch {
    return { groups: GUIDE, fromDb: false };
  }
}

export async function renderGuide(root) {
  root.innerHTML = '<div class="skeleton">Открываю гайдбук…</div>';
  const { groups } = await loadGuide();
  const all = groups.flatMap((g) => g.sections.map((s) => ({ ...s, group: g.group, text: searchText(`${s.title} ${s.body}`) })));
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  let current = all.find((s) => s.id === want) || all[0];

  root.innerHTML = html`
    <section class="panel guide-head">
      <span class="m-ic">${icon('i-guide')}</span>
      <div><h1>Игровой гайдбук</h1><p>Как устроена держава, экономика, флот и война. Числа здесь — действующие правила игры.</p></div>
      ${isTeam() ? raw(html`<a class="btn sm" href="#/admin?s=pages">Редактировать</a>`) : ''}
    </section>
    <div class="guide">
      <nav class="panel guide-toc" aria-label="Оглавление гайдбука">
        <details id="toc-d" open><summary>Оглавление и поиск</summary>
        <input class="search" type="search" id="g-q" placeholder="Поиск по гайдбуку" aria-label="Поиск по гайдбуку">
        <div id="toc"></div></details>
      </nav>
      <article class="panel guide-body" id="g-body" aria-live="polite"></article>
    </div>`;

  const toc = $('#toc', root), body = $('#g-body', root);
  const drawToc = (q = '') => {
    const hits = q ? all.filter((s) => s.text.includes(q)) : all;
    toc.innerHTML = groups.map((g) => {
      const items = hits.filter((s) => s.group === g.group);
      if (!items.length) return '';
      return html`<b>${g.group}</b>${items.map((s) => raw(html`<a href="#/guide?s=${s.id}" data-id="${s.id}" ${raw(s.id === current.id ? 'aria-current="page"' : '')}>${s.title}</a>`))}`;
    }).join('') || '<p class="empty">Ничего не нашлось.</p>';
  };
  const show = (s) => {
    current = s;
    const i = all.indexOf(s), prev = all[i - 1], next = all[i + 1];
    body.innerHTML = html`<span class="fac"><i></i>${s.group}</span><h2>${s.title}</h2><div class="md">${raw(markup(s.body))}</div>
      <nav class="guide-pager" aria-label="Соседние разделы">
        ${prev ? raw(html`<a class="btn sm" href="#/guide?s=${prev.id}">${icon('i-back')}${prev.title}</a>`) : raw('<span></span>')}
        ${next ? raw(html`<a class="btn sm" href="#/guide?s=${next.id}">${next.title} →</a>`) : ''}
      </nav>`;
    $$('a[data-id]', toc).forEach((a) => a.toggleAttribute('aria-current', a.dataset.id === s.id));
    if (innerWidth < 1100) { const d = document.getElementById('toc-d'); if (d) d.open = false; body.scrollIntoView({ block: 'start' }); }
  };
  drawToc();
  show(current);
  const tocD = $('#toc-d', root);
  if (innerWidth < 1100) tocD.open = false;

  $('#g-q', root).oninput = (e) => drawToc(e.target.value.trim().toLowerCase());
  // переходы внутри гайдбука — без перерисовки всей страницы
  $('.guide', root).addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/guide?s="]'); if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href').split('s=')[1];
    const s = all.find((x) => x.id === id); if (!s) return;
    history.replaceState(null, '', `#/guide?s=${id}`);
    show(s);
  });
}
