import { html, raw, icon } from '../lib/dom.js';
import { markup } from '../lib/markup.js';
import { LEGAL, LEGAL_DATE } from '../content/legal.js';

/** #/legal?d=terms|privacy|consent — документы проекта. */
export function renderLegal(root) {
  const d = new URLSearchParams(location.hash.split('?')[1] || '').get('d');
  const doc = LEGAL[d] || LEGAL.terms;
  root.innerHTML = html`
    <section class="panel guide-head"><span class="m-ic">${icon('i-scroll')}</span>
      <div><h1>${doc.title}</h1><p>Classic Era · редакция от ${LEGAL_DATE}</p></div></section>
    <nav class="seg legal-tabs" aria-label="Документы">${Object.entries(LEGAL).map(([k, v]) => raw(html`<a href="#/legal?d=${k}" aria-pressed="${String(LEGAL[k] === doc)}">${v.title}</a>`))}</nav>
    <article class="panel guide-body legal-body">${raw(markup(doc.body))}</article>`;
}
