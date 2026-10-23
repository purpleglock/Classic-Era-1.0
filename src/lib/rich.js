import { esc } from './dom.js';

/**
 * Разметка новостей и постов. Понимает теги, которыми написаны старые новости,
 * чтобы архив открывался как раньше, и новые ([font:…]).
 *
 *   **жирный** *курсив* `моноширинный` [текст](https://ссылка)
 *   ## Заголовок  ### Подзаголовок  > цитата  - пункт  1. пункт
 *   [center]…[/center] [left]…[/left] [right]…[/right]
 *   [c:gold]…[/c]  [bg:cyber]…[/bg]  [fx:glitch]…[/fx]  [font:serif]…[/font]
 *   [img:https://…]  ![подпись](https://…)  [music:https://…]
 *   [fac:fac_id|flag]Название[/fac]  — упоминание державы с гербом
 *   [spoiler:Заголовок]…[/spoiler]   [lock:пароль|Заголовок]…[/lock]
 *
 * Всё экранируется до разметки: HTML из текста не проходит, ссылки — только http(s).
 */

export const COLORS = { gold: '#e9b949', amber: '#ffb347', white: '#f6f1e6', grey: '#9a948a', red: '#ff6b5e', cyan: '#6fd6e6', green: '#8fe08a', violet: '#b48cff' };
export const COLOR_NAME = { gold: 'Золото', amber: 'Янтарь', white: 'Белый', grey: 'Серый', red: 'Красный', cyan: 'Бирюза', green: 'Зелёный', violet: 'Фиолетовый' };
export const BACKS = { gold: 'Золотая плашка', dark: 'Тёмная плашка', cyber: 'Терминал', red: 'Тревога' };
export const FX = { scanner: 'Сканер', jitter: 'Дрожь', glitch: 'Глитч', schizo: 'Помехи' };
/** Шрифты для новостей — все с кириллицей, грузятся с Google Fonts только когда встречаются в тексте. */
export const FONTS = {
  serif: ['Книжный', 'PT Serif', 'PT+Serif:ital,wght@0,400;0,700;1,400'],
  antiqua: ['Антиква', 'Cormorant Garamond', 'Cormorant+Garamond:ital,wght@0,500;0,700;1,500'],
  mono: ['Терминал', 'JetBrains Mono', 'JetBrains+Mono:wght@400;700'],
  russo: ['Плакат', 'Russo One', 'Russo+One'],
  oswald: ['Узкий', 'Oswald', 'Oswald:wght@400;600'],
  play: ['Технический', 'Play', 'Play:wght@400;700'],
  unbounded: ['Широкий', 'Unbounded', 'Unbounded:wght@400;700'],
  pixel: ['Пиксели', 'Press Start 2P', 'Press+Start+2P'],
  script: ['Рукопись', 'Marck Script', 'Marck+Script'],
  ruslan: ['Древний', 'Ruslan Display', 'Ruslan+Display'],
};

const loadedFonts = new Set();
function ensureFont(key) {
  const f = FONTS[key];
  if (!f || loadedFonts.has(key) || typeof document === 'undefined') return;
  loadedFonts.add(key);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${f[2]}&display=swap`;
  document.head.appendChild(l);
}

const isUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim());

/** Плеер для ссылки на музыку или null, если сервис не поддерживается. */
export function musicEmbed(u) {
  u = String(u || '').trim();
  if (!isUrl(u)) return null;
  let m;
  if ((m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i))) {
    return `<div class="rx-music yt"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" title="Видео YouTube" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (/^https?:\/\/(www\.|m\.)?soundcloud\.com\//i.test(u)) {
    return `<div class="rx-music sc"><iframe src="https://w.soundcloud.com/player/?url=${encodeURIComponent(u)}&color=%23e9b949&visual=false&show_comments=false" title="SoundCloud" loading="lazy" allow="autoplay"></iframe></div>`;
  }
  if ((m = u.match(/music\.yandex\.(?:ru|com|by|kz)\/album\/(\d+)(?:\/track\/(\d+))?/i))) {
    const src = m[2] ? `track/${m[2]}/${m[1]}` : `album/${m[1]}`;
    return `<div class="rx-music ym ${m[2] ? '' : 'album'}"><iframe src="https://music.yandex.ru/iframe/#${src}" title="Яндекс Музыка" loading="lazy"></iframe></div>`;
  }
  if (/\.(mp3|ogg|wav|m4a|webm)(\?|#|$)/i.test(u) || /\/storage\/v1\/object\/public\/v1-media\/.+\.(mp3|ogg|wav|webm)/i.test(u)) {
    return `<div class="rx-music file"><audio controls preload="none" src="${esc(u)}"></audio></div>`;
  }
  return null;
}

function imgHtml(url, alt = '') {
  if (!isUrl(url)) return '';
  return `<figure class="rx-img"><img src="${esc(url.trim())}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">${alt ? `<figcaption>${esc(alt)}</figcaption>` : ''}</figure>`;
}

/**
 * HTML из разметки. opts.heralds — { faction_id: {name, color, herald_url} } для упоминаний.
 */
export function rich(src = '', opts = {}) {
  const H = opts.heralds || {};
  const blocks = [];
  const stash = (h) => `\n\n\u0000B${blocks.push(h) - 1}\u0000\n\n`;
  let t = String(src).replace(/\r/g, '');

  // многострочные блоки вынимаем заранее, содержимое размечаем рекурсивно
  t = t.replace(/\[spoiler:([^\]\n]*)\]([\s\S]*?)\[\/spoiler\]/gi, (_, title, inner) =>
    stash(`<details class="rx-spoiler"><summary>${esc(title.trim() || 'Подробнее')}</summary><div>${rich(inner, opts)}</div></details>`));
  t = t.replace(/\[lock:([^\]\n]*?)\]([\s\S]*?)\[\/lock\]/gi, (_, meta, inner) => {
    const [pass, ...title] = meta.split('|');
    // пароль — игровая условность, а не защита: текст всё равно есть в новости
    return stash(`<div class="rx-lock" data-pass="${esc(pass.trim())}"><b>${esc(title.join('|').trim() || 'Закрытый блок')}</b>`
      + `<form class="rx-lock-f"><input type="password" placeholder="Пароль" aria-label="Пароль"><button type="submit" class="btn sm">Открыть</button></form>`
      + `<template>${rich(inner, opts)}</template></div>`);
  });
  t = t.replace(/\[(left|center|right)\]([\s\S]*?)\[\/\1\]/gi, (_, side, inner) => stash(`<div class="rx-${side.toLowerCase()}">${rich(inner, opts)}</div>`));
  t = t.replace(/\[music:([^\]\s]+)\]/gi, (m0, u) => { const h = musicEmbed(u); return h ? stash(h) : m0; });
  t = t.replace(/^[ \t]*(https?:\/\/\S+)[ \t]*$/gim, (m0, u) => { const h = musicEmbed(u); return h ? stash(h) : m0; });
  t = t.replace(/\[img:([^\]\s]+)\]/gi, (m0, u) => (isUrl(u) ? stash(imgHtml(u)) : m0));
  t = t.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (m0, alt, u) => (isUrl(u) ? stash(imgHtml(u, alt)) : m0));

  const used = new Set();
  const inline = (s) => {
    let x = esc(s);
    x = x.replace(/\[fac:([\w-]+)(\|flag)?\]([\s\S]*?)\[\/fac\]/g, (_, id, flag, name) => {
      const h = H[id] || {};
      const col = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(h.color || '') ? h.color : '';
      const crest = flag && h.herald_url ? `<img src="${esc(h.herald_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
      return `<span class="rx-fac" data-fid="${id}"${col ? ` style="--fc:${esc(col)}"` : ''}>${crest}${name}</span>`;
    });
    x = x.replace(/\[c:(\w+)\]([\s\S]*?)\[\/c\]/g, (m0, c, inner) => (COLORS[c] ? `<span style="color:${COLORS[c]}">${inner}</span>` : inner));
    x = x.replace(/\[bg:(\w+)\]([\s\S]*?)\[\/bg\]/g, (m0, c, inner) => `<span class="rx-bg ${BACKS[c] ? `bg-${c}` : 'bg-dark'}">${inner}</span>`);
    x = x.replace(/\[fx:(\w+)\]([\s\S]*?)\[\/fx\]/g, (m0, f, inner) => (FX[f] ? `<span class="rx-fx fx-${f}" data-t="${inner.replace(/<[^>]+>/g, '')}">${inner}</span>` : inner));
    x = x.replace(/\[font:(\w+)\]([\s\S]*?)\[\/font\]/g, (m0, f, inner) => {
      if (!FONTS[f]) return inner;
      used.add(f);
      return `<span style="font-family:'${FONTS[f][1]}',serif">${inner}</span>`;
    });
    x = x.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
    x = x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    x = x.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>');
    x = x.replace(/`([^`]+)`/g, '<code>$1</code>');
    return x;
  };

  const lines = t.split('\n');
  const out = [];
  let i = 0;
  const isBlock = (l) => /^\u0000B\d+\u0000$/.test(l.trim());
  const starts = (l) => /^(#{2,3}\s|>|-\s|\d+\.\s|---$)/.test(l.trim()) || isBlock(l);
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (isBlock(line)) { out.push(blocks[Number(line.slice(2, -1))]); i++; continue; }
    if (line === '---') { out.push('<hr>'); i++; continue; }
    if (/^###\s/.test(line)) { out.push(`<h4>${inline(line.slice(4))}</h4>`); i++; continue; }
    if (/^##\s/.test(line)) { out.push(`<h3>${inline(line.slice(3))}</h3>`); i++; continue; }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(inline(lines[i].trim().replace(/^>\s?/, ''))); i++; }
      out.push(`<blockquote>${buf.join('<br>')}</blockquote>`);
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line), items = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i].trim())) { items.push(inline(lines[i].trim().replace(/^(-|\d+\.)\s/, ''))); i++; }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !starts(lines[i])) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  used.forEach(ensureFont);
  return out.join('');
}

/** Оживить отрисованный текст: блоки под паролем. Вызывать после вставки HTML. */
export function wireRich(root) {
  root.querySelectorAll('.rx-lock').forEach((box) => {
    const f = box.querySelector('form');
    if (!f || f.dataset.wired) return;
    f.dataset.wired = '1';
    f.onsubmit = (e) => {
      e.preventDefault();
      const inp = f.querySelector('input');
      if (inp.value.trim() !== box.dataset.pass) { inp.value = ''; inp.placeholder = 'Неверный пароль'; return; }
      const div = document.createElement('div');
      div.appendChild(box.querySelector('template').content.cloneNode(true));
      f.replaceWith(div);
      wireRich(div);
    };
  });
}

/** Упомянутые державы: id из тегов [fac:…]. */
export const mentionsOf = (src = '') => [...new Set([...String(src).matchAll(/\[fac:([\w-]+)/g)].map((m) => m[1]))];

/** Первая картинка текста — для баннера карточки. */
export function firstImage(src = '') {
  const m = String(src).match(/\[img:(https?:\/\/[^\]\s]+)\]|!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  return m ? m[1] || m[2] : null;
}
