import { esc } from './dom.js';

/**
 * Простая безопасная разметка для гайдбука и правил.
 * Сначала всё экранируется, потом размечается — HTML из текста не проходит.
 *   пустая строка — новый абзац;  ## Подзаголовок;  - пункт;  1. пункт
 *   | a | b |  — таблица (первая строка — заголовок);  > совет;  >! важно;  **жирный**
 */
export function markup(src = '') {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = String(src).replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line.startsWith('## ')) { out.push(`<h3>${inline(line.slice(3))}</h3>`); i++; continue; }
    if (line.startsWith('>')) {
      const warn = line.startsWith('>!');
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>!?\s?/, '')); i++; }
      out.push(`<p class="callout${warn ? ' warn' : ''}">${inline(buf.join(' '))}</p>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^(-|\d+\.)\s/, '')); i++; }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(##\s|>|\||-\s|\d+\.\s)/.test(lines[i].trim())) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('');
}

/** Плоский текст раздела — для поиска. */
export const searchText = (s = '') => String(s).replace(/[*|#>]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
