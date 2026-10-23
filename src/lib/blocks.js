import { esc } from './dom.js';
import { rich } from './rich.js';

/**
 * Страница лора из блоков (тот же формат, что у старой вики, поэтому перенос без потерь):
 *   text {content} · heading {text, style} · quote {text, author} · callout {title, content, icon}
 *   alert {title, content, variant} · divider {style} · stats {items:[{val,label}]}
 *   table {headers, rows} · toc · vis_timeline {items:[{date,text,category}]}
 *   cols {cols, items:[markup]} · infobox {label, title, image_url, sections:[{name, rows:[{key,val}]}]}
 * Текст внутри блоков — разметка новостей (rich.js): [c:gold], [fac:…], [center] и т. д.
 */
export const BLOCK_LABEL = {
  text: 'Текст', heading: 'Заголовок', quote: 'Цитата', callout: 'Врезка', alert: 'Донесение', divider: 'Разделитель',
  stats: 'Цифры', table: 'Таблица', toc: 'Оглавление', vis_timeline: 'Хроника', cols: 'Колонки', infobox: 'Карточка фракции',
};
const ALERT = { intel: 'Разведданные', classified: 'Секретно', secret: 'Секретно', lore: 'Летопись', warn: 'Внимание' };
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '');

export function renderBlocks(blocks = [], opts = {}) {
  const r = (s) => rich(String(s || ''), opts);
  const heads = [];
  const body = (Array.isArray(blocks) ? blocks : []).map((b, i) => {
    if (!b || typeof b !== 'object') return '';
    switch (b.type) {
      case 'text': return `<div class="lb-text">${r(b.content)}</div>`;
      case 'heading': {
        const id = `h-${i}`;
        heads.push([id, b.text]);
        return `<h2 class="lb-h ${esc(b.style || '')}" id="${id}">${esc(b.text || '')}</h2>`;
      }
      case 'quote': return `<blockquote class="lb-quote"><p>${esc(b.text || '')}</p>${b.author ? `<cite>— ${esc(b.author)}</cite>` : ''}</blockquote>`;
      case 'callout': return `<aside class="lb-callout">${b.title ? `<b>${b.icon ? `${esc(b.icon)} ` : ''}${esc(b.title)}</b>` : ''}${r(b.content)}</aside>`;
      case 'alert': return `<aside class="lb-alert v-${esc(b.variant || 'warn')}"><b>${esc(b.title || ALERT[b.variant] || 'Внимание')}</b>${r(b.content)}</aside>`;
      case 'divider': return `<hr class="lb-hr ${esc(b.style || '')}">`;
      case 'stats': return `<div class="lb-stats">${(b.items || []).map((x) => `<div><b>${esc(x.val)}</b><span>${esc(x.label)}</span></div>`).join('')}</div>`;
      case 'table': return `<div class="tbl"><table>${b.headers?.length ? `<thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${(b.rows || []).map((row) => `<tr>${row.map((c) => `<td>${r(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'toc': return '<nav class="lb-toc" data-toc></nav>';
      case 'vis_timeline': return `<ol class="lb-time">${(b.items || []).map((x) => `<li class="c-${esc(x.category || 'default')}"><time>${esc(x.date)}</time><div>${r(x.text)}</div></li>`).join('')}</ol>`;
      case 'cols': return `<div class="lb-cols" style="--n:${Math.min(3, Math.max(1, Number(b.cols) || 2))}">${(b.items || []).map((x) => `<div>${r(x)}</div>`).join('')}</div>`;
      case 'infobox': return `<aside class="lb-info">${safeUrl(b.image_url) ? `<img src="${safeUrl(b.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <div class="lb-info-h">${b.label ? `<small>${esc(b.label)}</small>` : ''}<b>${esc(b.title || '')}</b></div>
        ${(b.sections || []).map((s) => `${s.name ? `<h4>${esc(s.name)}</h4>` : ''}<dl>${(s.rows || []).map((x) => `<dt>${esc(x.key)}</dt><dd>${r(x.val)}</dd>`).join('')}</dl>`).join('')}</aside>`;
      default: return b.content ? `<div class="lb-text">${r(b.content)}</div>` : '';
    }
  }).join('');
  const toc = heads.length ? `<b>Содержание</b><ol>${heads.map(([id, t]) => `<li><a href="#${id}" data-anchor="${id}">${esc(t)}</a></li>`).join('')}</ol>` : '';
  return { html: body.replace('<nav class="lb-toc" data-toc></nav>', toc ? `<nav class="lb-toc">${toc}</nav>` : ''), heads };
}

/** Плоский текст блоков — для поиска и анонсов. */
export function blocksText(blocks = []) {
  return (blocks || []).map((b) => [b.text, b.content, b.title, ...(b.items || []).map((x) => (typeof x === 'string' ? x : x.text || x.label)),
    ...((b.sections || []).flatMap((s) => (s.rows || []).map((x) => `${x.key} ${x.val}`)))].filter(Boolean).join(' ')).join(' ');
}
