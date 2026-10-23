import { html, raw, $, toast } from '../lib/dom.js';
import { rich, wireRich, COLORS, COLOR_NAME, BACKS, FX, FONTS, musicEmbed } from '../lib/rich.js';
import { uploadMedia } from '../lib/upload.js';

/**
 * Редактор новостей и постов: панель инструментов над полем, вкладка предпросмотра.
 * Разметку вставляет сам — игроку не нужно помнить теги.
 *   richEditor(box, { value, heralds, folder, rows, onChange }) → { value, focus() }
 */
export function richEditor(box, { value = '', heralds = {}, folder = 'news', rows = 14, onChange } = {}) {
  const facs = Object.entries(heralds).filter(([, h]) => h.name).sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru'));
  box.classList.add('rx-ed');
  box.innerHTML = html`
    <div class="rx-bar" role="toolbar" aria-label="Оформление текста">
      <div class="rx-g">
        <button type="button" data-w="**|**|жирный" title="Жирный" aria-label="Жирный"><b>Ж</b></button>
        <button type="button" data-w="*|*|курсив" title="Курсив" aria-label="Курсив"><i>К</i></button>
        <button type="button" data-w="\`|\`|код" title="Моноширинный" aria-label="Моноширинный"><code>M</code></button>
        <button type="button" data-l="## " title="Заголовок" aria-label="Заголовок">H2</button>
        <button type="button" data-l="### " title="Подзаголовок" aria-label="Подзаголовок">H3</button>
        <button type="button" data-l="> " title="Цитата" aria-label="Цитата">❝</button>
        <button type="button" data-l="- " title="Список" aria-label="Список">•</button>
        <button type="button" data-ins="\n---\n" title="Разделитель" aria-label="Разделитель">—</button>
      </div>
      <div class="rx-g">
        <button type="button" data-w="[left]\n|\n[/left]|текст" title="Влево" aria-label="Выровнять влево">⇤</button>
        <button type="button" data-w="[center]\n|\n[/center]|текст" title="По центру" aria-label="По центру">↔</button>
        <button type="button" data-w="[right]\n|\n[/right]|текст" title="Вправо" aria-label="Выровнять вправо">⇥</button>
      </div>
      <div class="rx-g">
        <select data-tag="c" aria-label="Цвет текста"><option value="">Цвет</option>${Object.keys(COLORS).map((k) => raw(html`<option value="${k}" style="color:${COLORS[k]}">${COLOR_NAME[k]}</option>`))}</select>
        <select data-tag="bg" aria-label="Плашка"><option value="">Плашка</option>${Object.entries(BACKS).map(([k, v]) => raw(html`<option value="${k}">${v}</option>`))}</select>
        <select data-tag="fx" aria-label="Эффект"><option value="">Эффект</option>${Object.entries(FX).map(([k, v]) => raw(html`<option value="${k}">${v}</option>`))}</select>
        <select data-tag="font" aria-label="Шрифт"><option value="">Шрифт</option>${Object.entries(FONTS).map(([k, v]) => raw(html`<option value="${k}">${v[0]}</option>`))}</select>
      </div>
      <div class="rx-g">
        <button type="button" data-pop="link" title="Ссылка" aria-label="Ссылка">🔗</button>
        <button type="button" data-pop="img" title="Картинка" aria-label="Картинка">🖼</button>
        <button type="button" data-pop="music" title="Музыка" aria-label="Музыка">♪</button>
        <button type="button" data-pop="fac" title="Упомянуть державу" aria-label="Упомянуть державу">⚑</button>
        <button type="button" data-pop="spoiler" title="Свёрнутый блок" aria-label="Свёрнутый блок">▸</button>
        <button type="button" data-pop="lock" title="Блок под паролем" aria-label="Блок под паролем">🔒</button>
      </div>
      <div class="seg rx-tabs" role="group" aria-label="Вид"><button type="button" data-tab="text" aria-pressed="true">Текст</button><button type="button" data-tab="view" aria-pressed="false">Предпросмотр</button></div>
    </div>
    <div class="rx-pop" hidden></div>
    <textarea class="rx-ta" rows="${rows}" aria-label="Текст">${value}</textarea>
    <div class="rx-view rich" hidden></div>
    <div class="rx-foot"><span class="hint">Можно перетащить картинку прямо в поле.</span><small class="rx-count"></small></div>`;

  const ta = $('.rx-ta', box), view = $('.rx-view', box), pop = $('.rx-pop', box), count = $('.rx-count', box);
  const changed = () => { count.textContent = `${ta.value.length} знаков`; onChange?.(ta.value); };
  changed();
  ta.addEventListener('input', changed);

  const wrap = (a, b, ph = 'текст') => {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph;
    ta.setRangeText(a + sel + b, s, e, 'end');
    ta.selectionStart = s + a.length; ta.selectionEnd = s + a.length + sel.length;
    ta.focus(); changed();
  };
  const insert = (text) => { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); changed(); };
  const linePrefix = (p) => {
    const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    ta.setRangeText(p, s, s, 'end'); ta.focus(); changed();
  };

  $('.rx-bar', box).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.w) { const [a, z, ph] = b.dataset.w.split('|'); wrap(a.replace(/\\n/g, '\n'), z.replace(/\\n/g, '\n'), ph); }
    else if (b.dataset.l) linePrefix(b.dataset.l);
    else if (b.dataset.ins) insert(b.dataset.ins.replace(/\\n/g, '\n'));
    else if (b.dataset.pop) openPop(b.dataset.pop);
    else if (b.dataset.tab) {
      const v = b.dataset.tab === 'view';
      box.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      ta.hidden = v; view.hidden = !v;
      if (v) { view.innerHTML = rich(ta.value, { heralds }) || '<p class="empty">Пока пусто.</p>'; wireRich(view); }
    }
  });
  $('.rx-bar', box).addEventListener('change', (e) => {
    const s = e.target.closest('select[data-tag]'); if (!s || !s.value) return;
    wrap(`[${s.dataset.tag}:${s.value}]`, `[/${s.dataset.tag === 'c' ? 'c' : s.dataset.tag}]`);
    s.value = '';
  });

  function openPop(kind) {
    const F = {
      link: html`<label>Текст ссылки<input data-k="text" type="text" value="${ta.value.slice(ta.selectionStart, ta.selectionEnd)}"></label><label>Адрес<input data-k="url" type="url" placeholder="https://"></label>`,
      img: html`<label>Файл<input data-k="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><label>или адрес<input data-k="url" type="url" placeholder="https://"></label><label>Подпись<input data-k="alt" type="text" placeholder="необязательно"></label>`,
      music: html`<label>Ссылка или файл<input data-k="url" type="url" placeholder="YouTube, SoundCloud, Яндекс Музыка или mp3"></label><label>или загрузить<input data-k="file" type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/webm"></label>`,
      fac: html`<label>Держава<select data-k="fid">${facs.map(([id, h]) => raw(html`<option value="${id}">${h.name}</option>`))}</select></label><label class="check"><input data-k="flag" type="checkbox" checked> с гербом</label>`,
      spoiler: html`<label>Заголовок блока<input data-k="title" type="text" value="Подробнее"></label>`,
      lock: html`<label>Пароль<input data-k="pass" type="text"></label><label>Заголовок<input data-k="title" type="text" value="Секретная часть"></label><p class="hint">Это игровая загадка, а не защита: текст хранится в новости открыто.</p>`,
    };
    pop.innerHTML = html`<form class="rx-pop-f">${raw(F[kind])}<div class="acts"><button type="submit" class="btn gold sm">Вставить</button><button type="button" class="btn sm" data-x>Отмена</button></div></form>`;
    pop.hidden = false;
    pop.querySelector('input,select')?.focus();
    const v = (k) => pop.querySelector(`[data-k="${k}"]`);
    pop.querySelector('[data-x]').onclick = () => { pop.hidden = true; };
    pop.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = pop.querySelector('[type=submit]');
      try {
        btn.disabled = true;
        if (kind === 'link') {
          const url = v('url').value.trim();
          if (!/^https?:\/\//.test(url)) throw new Error('Адрес должен начинаться с https://');
          insert(`[${v('text').value.trim() || url}](${url})`);
        } else if (kind === 'img') {
          let url = v('url').value.trim();
          if (v('file').files[0]) { btn.textContent = 'Загружаю…'; url = (await uploadMedia(v('file').files[0], { folder, max: 1600 })).url; }
          if (!/^https?:\/\//.test(url)) throw new Error('Выберите файл или вставьте адрес картинки');
          const alt = v('alt').value.trim();
          insert(alt ? `\n![${alt}](${url})\n` : `\n[img:${url}]\n`);
        } else if (kind === 'music') {
          let url = v('url').value.trim();
          if (v('file').files[0]) { btn.textContent = 'Загружаю…'; url = (await uploadMedia(v('file').files[0], { folder })).url; }
          if (!musicEmbed(url)) throw new Error('Поддерживаются YouTube, SoundCloud, Яндекс Музыка и аудиофайлы');
          insert(`\n[music:${url}]\n`);
        } else if (kind === 'fac') {
          const id = v('fid').value; if (!id) throw new Error('Нет держав для упоминания');
          insert(`[fac:${id}${v('flag').checked ? '|flag' : ''}]${heralds[id].name}[/fac]`);
        } else if (kind === 'spoiler') {
          wrap(`[spoiler:${v('title').value.trim() || 'Подробнее'}]\n`, '\n[/spoiler]', 'скрытый текст');
        } else if (kind === 'lock') {
          const pass = v('pass').value.trim(); if (!pass) throw new Error('Задайте пароль');
          wrap(`[lock:${pass.replace(/[|\]]/g, '')}|${v('title').value.trim()}]\n`, '\n[/lock]', 'секретный текст');
        }
        pop.hidden = true;
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Вставить'; }
    };
  }

  // перетаскивание картинки в поле
  ta.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) e.preventDefault(); });
  ta.addEventListener('drop', async (e) => {
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    toast('Загружаю картинку…');
    try { insert(`\n[img:${(await uploadMedia(f, { folder, max: 1600 })).url}]\n`); toast('Картинка вставлена'); } catch (err) { toast(err.message, 'err'); }
  });

  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; changed(); },
    focus: () => ta.focus(),
    textarea: ta,
  };
}
