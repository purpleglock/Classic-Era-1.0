import { html, raw, icon, $, $$, toast, confirmBox } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { act } from '../lib/act.js';
import { dateTime } from '../lib/format.js';
import { uploadMedia, uploadModelFile, fileSize } from '../lib/upload.js';
import { settings, dropSettings, ART_SLOTS } from '../lib/settings.js';
import { TIMES, FALLBACK, fillName } from '../lib/tyan.js';

const TAGS = { page: 'Страницы', tyan: 'Классикал-Тян', news: 'Новости', other: 'Разное' };
const needMig = '<p class="empty warn">Медиатека ещё не подключена в базе: примените миграцию 20261023_06_media_news.sql.</p>';

async function mediaRows(tag = null) {
  let q = sb.from('v1_media').select('id,path,url,name,mime,size,width,height,tag,created_at').order('created_at', { ascending: false }).limit(300);
  if (tag) q = q.eq('tag', tag);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { missingMedia: true });
  return data || [];
}

/** Загрузить файлы и записать их в медиатеку. */
async function uploadAll(files, tag, max) {
  const out = [];
  for (const f of files) {
    toast(`Загружаю ${f.name}…`);
    const r = await uploadMedia(f, { folder: tag, max });
    await act('media.add', null, { ...r, tag }, null, { quiet: true });
    out.push(r);
  }
  toast(files.length > 1 ? `Загружено файлов: ${files.length}` : 'Файл загружен');
  return out;
}

// ═ Медиатека и арты страниц ═
export async function media(sec, tag = '') {
  let rows;
  try { rows = await mediaRows(tag || null); } catch { sec.innerHTML = needMig; return; }
  const s = await settings(true);
  const arts = { ...(s.arts || {}) };
  sec.innerHTML = html`
    <div class="sec-h"><h2>Медиатека</h2><small>картинки и музыка сайта — без GitHub</small></div>
    <div class="drop" id="md-drop">
      <p><b>Перетащите файлы сюда</b> или <label class="link-btn">выберите на компьютере<input type="file" id="md-file" multiple accept="image/*,audio/mpeg,audio/ogg,audio/wav,audio/webm" hidden></label></p>
      <div class="row2"><label for="md-tag">Папка</label><select id="md-tag">${Object.entries(TAGS).map(([k, v]) => raw(html`<option value="${k}">${v}</option>`))}</select>
        <label for="md-max">Сжать до</label><select id="md-max"><option value="1920">1920 px — фоны и баннеры</option><option value="1200">1200 px — картинки в тексте</option><option value="2560">2560 px — крупные арты</option><option value="512">512 px — иконки, гербы</option></select></div>
      <p class="hint">PNG и JPEG автоматически переводятся в WebP: так снимок экрана весит в 5–10 раз меньше, а страница открывается быстрее. GIF и SVG загружаются как есть. До 15 МБ.</p>
    </div>

    <h3 class="sub-h">Арты страниц</h3>
    <div class="slots" id="slots">${Object.entries(ART_SLOTS).map(([k, [t, hint]]) => raw(html`
      <div class="slot" data-slot="${k}"><div class="slot-img">${arts[k] ? raw(html`<img src="${arts[k]}" alt="">`) : raw('<span>нет</span>')}</div>
        <div><b>${t}</b><small>${hint}</small>
        <div class="acts"><button type="button" class="btn sm" data-choose>Выбрать</button>${arts[k] ? raw('<button type="button" class="btn sm" data-clear>Убрать</button>') : ''}</div></div></div>`))}</div>

    <h3 class="sub-h">Файлы</h3>
    <div class="seg" role="group" aria-label="Папка" id="md-filter"><button type="button" data-t="" aria-pressed="${String(!tag)}">Все</button>${Object.entries(TAGS).map(([k, v]) => raw(html`<button type="button" data-t="${k}" aria-pressed="${String(tag === k)}">${v}</button>`))}</div>
    <div class="media-grid" id="md-grid">${rows.length ? raw(rows.map((r) => html`
      <figure class="mcard" data-id="${r.id}" data-url="${r.url}">
        ${/^image\//.test(r.mime || '') ? raw(html`<img src="${r.url}" alt="" loading="lazy">`) : raw(html`<div class="m-audio">${icon('i-play')}<span>аудио</span></div>`)}
        <figcaption><b title="${r.name}">${r.name}</b><small>${[r.width && `${r.width}×${r.height}`, fileSize(r.size), TAGS[r.tag]].filter(Boolean).join(' · ')}</small>
          <span class="acts"><button type="button" class="btn sm" data-copy>Ссылка</button><button type="button" class="btn sm" data-md>Для текста</button><button type="button" class="ib" data-del aria-label="Удалить">${icon('i-x')}</button></span></figcaption>
      </figure>`).join('')) : raw('<p class="empty">Файлов пока нет.</p>')}</div>`;

  const go = () => media(sec, tag);
  const send = async (files) => {
    if (!files.length) return;
    try { await uploadAll([...files], $('#md-tag', sec).value, Number($('#md-max', sec).value)); go(); } catch (e) { toast(e.message, 'err'); }
  };
  $('#md-file', sec).onchange = (e) => send(e.target.files);
  const drop = $('#md-drop', sec);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files); };
  $('#md-filter', sec).onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) media(sec, b.dataset.t); };

  $('#md-grid', sec).onclick = async (e) => {
    const card = e.target.closest('.mcard'); if (!card) return;
    const url = card.dataset.url;
    if (e.target.closest('[data-copy]')) { await navigator.clipboard?.writeText(url).catch(() => {}); toast('Ссылка скопирована'); }
    if (e.target.closest('[data-md]')) { await navigator.clipboard?.writeText(/\.(mp3|ogg|wav|webm)$/i.test(url) ? `[music:${url}]` : `![](${url})`).catch(() => {}); toast('Разметка скопирована — вставьте в текст гайдбука, правил или новости'); }
    if (e.target.closest('[data-del]')) {
      const used = Object.entries(arts).filter(([, u]) => u === url).map(([k]) => ART_SLOTS[k][0]);
      if (!(await confirmBox(used.length ? `Файл стоит артом: ${used.join(', ')}. Всё равно удалить?` : 'Удалить файл? Если он вставлен в тексты, там будет пустое место.', 'Удалить'))) return;
      const r = await act('media.delete', card.dataset.id).catch(() => null);
      if (r?.status === 'done') go();
    }
  };

  $('#slots', sec).onclick = async (e) => {
    const slot = e.target.closest('[data-slot]'); if (!slot) return;
    const k = slot.dataset.slot;
    const save = async (url) => {
      const next = { ...arts }; if (url) next[k] = url; else delete next[k];
      const r = await act('settings.save', 'arts', next).catch(() => null);
      if (r) { dropSettings(); go(); }
    };
    if (e.target.closest('[data-clear]')) return save(null);
    if (!e.target.closest('[data-choose]')) return;
    const url = await pickImage(await mediaRows().catch(() => []), 'page');
    if (url) save(url);
  };
}

/** Окно выбора картинки из медиатеки (или загрузки новой). Возвращает URL или null. */
export function pickImage(rows, uploadTag = 'page', max = 1920) {
  return new Promise((resolve) => {
    const veil = document.createElement('div');
    veil.className = 'veil';
    const imgs = rows.filter((r) => /^image\//.test(r.mime || ''));
    veil.innerHTML = html`<div class="panel modal wide" role="dialog" aria-label="Выбор картинки">
      <button type="button" class="ib x" data-x aria-label="Закрыть">${icon('i-x')}</button>
      <h2>Выберите картинку</h2>
      <p><label class="btn sm file-btn">Загрузить новую<input type="file" accept="image/*" hidden></label></p>
      <div class="media-grid pick">${imgs.length ? raw(imgs.map((r) => html`<button type="button" class="mcard" data-url="${r.url}"><img src="${r.url}" alt="" loading="lazy"><small>${r.name}</small></button>`).join('')) : raw('<p class="empty">В медиатеке нет картинок.</p>')}</div></div>`;
    document.body.appendChild(veil);
    const done = (v) => { veil.remove(); resolve(v); };
    veil.onclick = (e) => {
      if (e.target === veil || e.target.closest('[data-x]')) done(null);
      const b = e.target.closest('[data-url]'); if (b) done(b.dataset.url);
    };
    veil.querySelector('input').onchange = async (e) => {
      try { const [r] = await uploadAll([...e.target.files], uploadTag, max); done(r.url); } catch (err) { toast(err.message, 'err'); }
    };
  });
}

// ═ Классикал-Тян ═
export async function tyan(sec) {
  const s = await settings(true);
  const cfg = structuredClone(s.tyan?.dialogues ? { ...FALLBACK, ...s.tyan } : FALLBACK);
  if (!s.tyan) {
    const probe = await sb.from('v1_settings').select('key').limit(1);
    if (probe.error) { sec.innerHTML = needMig; return; }
  }
  const uid = () => Math.random().toString(36).slice(2, 10);
  cfg.dialogues.forEach((d) => { d.id ||= uid(); d.time ||= 'any'; d.lines ||= []; });
  let dirty = false;

  const draw = () => {
    const spriteOpts = (val, none = 'как у диалога') => raw(html`<option value="">${none}</option>${cfg.sprites.map((p) => raw(html`<option value="${p.id}" ${raw(p.id === val ? 'selected' : '')}>${p.name}</option>`))}`);
    const byTime = Object.keys(TIMES).map((t) => [t, cfg.dialogues.filter((d) => (d.time || 'any') === t)]);
    sec.innerHTML = html`
      <div class="sec-h"><h2>Классикал-Тян</h2><small>арты и реплики на главной</small><button type="button" class="btn gold sm" id="ty-save" ${raw(dirty ? '' : 'disabled')}>Сохранить</button></div>
      <div class="grp"><h4>Арты</h4>
        <div class="sprites">${cfg.sprites.map((p) => raw(html`<figure class="sprite ${p.id === cfg.defaultSprite ? 'on' : ''}" data-id="${p.id}">
          <img src="${p.url}" alt=""><input type="text" value="${p.name}" data-sname aria-label="Название арта">
          <span class="acts"><button type="button" class="btn sm" data-def>${p.id === cfg.defaultSprite ? 'Основной' : 'Сделать основным'}</button><button type="button" class="ib" data-sdel aria-label="Убрать арт">${icon('i-x')}</button></span></figure>`))}
          <label class="sprite add"><input type="file" id="ty-file" accept="image/png,image/webp,image/gif" multiple hidden><span>+ Загрузить арты</span><small>PNG с прозрачным фоном, до 1400 px по высоте</small></label></div>
        <p class="hint">Основной арт показывается, если у реплики и диалога свой не выбран. Без артов на главной — силуэт.</p></div>
      ${byTime.map(([t, list]) => raw(html`<div class="grp"><h4>${TIMES[t]} <small>${list.length}</small></h4>
        ${list.map((d) => raw(html`<div class="dlg" data-d="${d.id}">
          <div class="dlg-h"><select data-time aria-label="Время суток">${Object.entries(TIMES).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === (d.time || 'any') ? 'selected' : '')}>${v}</option>`))}</select>
            <select data-dsprite aria-label="Арт диалога">${spriteOpts(d.sprite, 'основной арт')}</select>
            <button type="button" class="btn sm" data-try>Показать</button><button type="button" class="ib" data-ddel aria-label="Удалить диалог">${icon('i-x')}</button></div>
          ${d.lines.map((l, j) => raw(html`<div class="ln" data-j="${j}"><textarea rows="2" data-text aria-label="Реплика">${l.text || ''}</textarea>
            <select data-lsprite aria-label="Арт реплики">${spriteOpts(l.sprite)}</select><button type="button" class="ib" data-ldel aria-label="Удалить реплику">${icon('i-x')}</button></div>`))}
          <button type="button" class="btn sm" data-ladd>+ Реплика</button></div>`))}
        <button type="button" class="btn sm" data-dadd="${t}">+ Диалог</button></div>`))}
      <p class="hint">{name} в тексте заменяется на имя игрока. Клик по облачку на главной листает реплики; после последней Тян начинает другой диалог того же времени суток.</p>
      <div class="ty-try" id="ty-try" hidden></div>`;
  };
  draw();
  const mark = () => { dirty = true; const b = $('#ty-save', sec); if (b) b.disabled = false; };
  const dlg = (el) => cfg.dialogues.find((d) => d.id === el.closest('[data-d]')?.dataset.d);

  sec.oninput = (e) => {
    const t = e.target;
    if (t.matches('[data-text]')) { dlg(t).lines[t.closest('[data-j]').dataset.j].text = t.value; mark(); }
    if (t.matches('[data-sname]')) { cfg.sprites.find((p) => p.id === t.closest('[data-id]').dataset.id).name = t.value; mark(); }
  };
  sec.onchange = async (e) => {
    const t = e.target;
    if (t.matches('[data-time]')) { dlg(t).time = t.value; mark(); draw(); }
    if (t.matches('[data-dsprite]')) { dlg(t).sprite = t.value || undefined; mark(); }
    if (t.matches('[data-lsprite]')) { dlg(t).lines[t.closest('[data-j]').dataset.j].sprite = t.value || undefined; mark(); }
    if (t.id === 'ty-file' && t.files.length) {
      try {
        const up = await uploadAll([...t.files], 'tyan', 1400);
        for (const r of up) cfg.sprites.push({ id: uid(), name: r.name.replace(/\.[^.]+$/, ''), url: r.url });
        cfg.defaultSprite ||= cfg.sprites[0]?.id;
        mark(); draw();
      } catch (err) { toast(err.message, 'err'); }
    }
  };
  sec.onclick = async (e) => {
    const t = e.target;
    if (t.closest('#ty-save')) {
      const clean = { ...cfg, dialogues: cfg.dialogues.map((d) => ({ ...d, lines: d.lines.filter((l) => l.text?.trim()) })).filter((d) => d.lines.length) };
      const r = await act('settings.save', 'tyan', clean).catch(() => null);
      if (r) { dirty = false; dropSettings(); draw(); }
      return;
    }
    if (t.closest('[data-dadd]')) { cfg.dialogues.push({ id: uid(), time: t.closest('[data-dadd]').dataset.dadd, lines: [{ text: '' }] }); mark(); draw(); return; }
    if (t.closest('[data-ladd]')) { dlg(t).lines.push({ text: '' }); mark(); draw(); return; }
    if (t.closest('[data-ldel]')) { dlg(t).lines.splice(t.closest('[data-j]').dataset.j, 1); mark(); draw(); return; }
    if (t.closest('[data-ddel]')) { if (await confirmBox('Удалить диалог целиком?', 'Удалить')) { cfg.dialogues = cfg.dialogues.filter((d) => d !== dlg(t)); mark(); draw(); } return; }
    if (t.closest('[data-def]')) { cfg.defaultSprite = t.closest('[data-id]').dataset.id; mark(); draw(); return; }
    if (t.closest('[data-sdel]')) { const id = t.closest('[data-id]').dataset.id; cfg.sprites = cfg.sprites.filter((p) => p.id !== id); if (cfg.defaultSprite === id) cfg.defaultSprite = cfg.sprites[0]?.id; mark(); draw(); return; }
    if (t.closest('[data-try]')) {
      const d = dlg(t), box = $('#ty-try', sec);
      const byId = Object.fromEntries(cfg.sprites.map((p) => [p.id, p.url]));
      box.hidden = false;
      box.innerHTML = html`<div class="panel try-in"><button type="button" class="ib x" data-tryx aria-label="Закрыть">${icon('i-x')}</button>
        ${d.lines.map((l) => raw(html`<div class="try-l">${(byId[l.sprite] || byId[d.sprite] || byId[cfg.defaultSprite]) ? raw(html`<img src="${byId[l.sprite] || byId[d.sprite] || byId[cfg.defaultSprite]}" alt="">`) : ''}<p><b>${cfg.speaker}</b>${fillName(l.text, session.displayName)}</p></div>`))}</div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (t.closest('[data-tryx]')) $('#ty-try', sec).hidden = true;
  };
}

// ═ 3D-модели ═
const KIND = { ship: 'Корабли', ground: 'Наземная техника', air: 'Авиация', station: 'Станции', other: 'Другое' };
let viewerLoading = null;
function loadViewer() {
  // <model-viewer> от Google: показывает .glb прямо в браузере, крутится мышью
  viewerLoading ||= import('https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js').catch(() => null);
  return viewerLoading;
}

export async function models(sec, kind = '') {
  let q = sb.from('v1_models').select('*').order('created_at', { ascending: false }).limit(300);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) { sec.innerHTML = needMig.replace('Медиатека', '3D-модели'); return; }
  const rows = data || [];
  sec.innerHTML = html`
    <div class="sec-h"><h2>3D-модели</h2><small>корабли, наземная техника, авиация</small></div>
    <div class="drop" id="mo-drop">
      <p><b>Перетащите .glb сюда</b> или <label class="link-btn">выберите файл<input type="file" id="mo-file" accept=".glb,model/gltf-binary" hidden></label></p>
      <p class="hint">Из Blender: Файл → Экспорт → glTF 2.0, формат «glTF Binary (.glb)». Текстуры попадут внутрь файла. Включите «Сжатие» (Draco) — файл станет в 3–10 раз легче. До 50 МБ; для сайта лучше до 10 МБ.</p>
    </div>
    <div class="seg" role="group" aria-label="Тип" id="mo-filter"><button type="button" data-k="" aria-pressed="${String(!kind)}">Все</button>${Object.entries(KIND).map(([k, v]) => raw(html`<button type="button" data-k="${k}" aria-pressed="${String(kind === k)}">${v}</button>`))}</div>
    <div class="split"><ol class="list" id="mo-list">${rows.length ? raw(rows.map((m, i) => html`<li data-i="${i}">${m.preview_url ? raw(html`<img class="mo-thumb" src="${m.preview_url}" alt="">`) : ''}<b>${m.name}</b><span>${KIND[m.kind]}${m.class ? ` · ${m.class}` : ''} · ${fileSize(m.size)}</span></li>`).join('')) : raw('<li class="empty-li">Моделей пока нет.</li>')}</ol>
      <div class="detail" id="mo-det"><p class="empty">Загрузите модель или выберите её в списке.</p></div></div>`;

  const det = $('#mo-det', sec);
  const form = async (m, file = null) => {
    await loadViewer();
    const src = file ? URL.createObjectURL(file) : m.url;
    det.innerHTML = html`
      <model-viewer id="mo-view" src="${src}" camera-controls auto-rotate shadow-intensity="1" exposure="1.1" environment-image="neutral" style="width:100%;height:340px;background:#050505;border-radius:14px" alt="${m.name || 'Модель'}"></model-viewer>
      <p class="hint" id="mo-info">${file ? `${file.name} · ${fileSize(file.size)}` : `${fileSize(m.size)} · загружена ${dateTime(m.created_at)}`}</p>
      <label for="mo-name">Название</label><input id="mo-name" type="text" value="${m.name || (file ? file.name.replace(/\.glb$/i, '') : '')}">
      <div class="row2"><div><label for="mo-kind">Тип</label><select id="mo-kind">${Object.entries(KIND).map(([k, v]) => raw(html`<option value="${k}" ${raw(k === (m.kind || kind || 'ship') ? 'selected' : '')}>${v}</option>`))}</select></div>
        <div><label for="mo-class">Класс</label><input id="mo-class" type="text" value="${m.class || ''}" placeholder="корвет, линкор, танк, истребитель…" list="mo-classes"></div></div>
      <datalist id="mo-classes">${['Корвет', 'Фрегат', 'Эсминец', 'Крейсер', 'Линкор', 'Дредноут', 'Авианосец', 'Транспорт', 'Танк', 'БТР', 'Артиллерия', 'Шагоход', 'Истребитель', 'Бомбардировщик', 'Штурмовик', 'Десантный бот'].map((c) => raw(html`<option value="${c}">`))}</datalist>
      <label for="mo-notes">Заметки</label><textarea id="mo-notes" rows="2" placeholder="Для какой державы, что исправить">${m.notes || ''}</textarea>
      <div class="acts"><button type="button" class="btn gold sm" id="mo-save">${file ? 'Загрузить' : 'Сохранить'}</button><button type="button" class="btn sm" id="mo-shot">Снять превью с ракурса</button>
        ${m.id ? raw(html`<a class="btn sm" href="${m.url}" download>Скачать .glb</a><button type="button" class="btn sm danger" id="mo-del">Удалить</button>`) : ''}</div>
      <p class="hint">Повернуть — мышью, приблизить — колесом. «Снять превью» делает картинку для списка с текущего ракурса.</p>`;
    const mv = $('#mo-view', det);
    let shot = null;
    if (!customElements.get('model-viewer')) $('#mo-info', det).textContent += ' · просмотрщик не загрузился, но файл можно сохранить';
    const takeShot = async () => (mv.toBlob ? mv.toBlob({ mimeType: 'image/webp', qualityArgument: 0.85, idealAspect: true }).catch(() => null) : null);
    $('#mo-shot', det).onclick = async () => { shot = await takeShot(); toast(shot ? 'Превью снято — сохраните модель' : 'Не удалось снять превью', shot ? 'ok' : 'err'); };
    $('#mo-save', det).onclick = async (e) => {
      const btn = e.target; btn.disabled = true;
      try {
        const name = $('#mo-name', det).value.trim();
        if (!name) throw new Error('Нужно название');
        let up = {};
        if (file) { btn.textContent = 'Загружаю модель…'; up = await uploadModelFile(file, name); }
        if (!shot && (file || !m.preview_url)) shot = await takeShot();
        let preview_url;
        if (shot) preview_url = (await uploadModelFile(shot, `${name}-preview`, 'image/webp')).url;
        const id = m.id || crypto.randomUUID();
        await act('model.save', id, { name, kind: $('#mo-kind', det).value, class: $('#mo-class', det).value.trim() || null, notes: $('#mo-notes', det).value, preview_url, ...up });
        if (file) URL.revokeObjectURL(src);
        models(sec, kind);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = file ? 'Загрузить' : 'Сохранить'; }
    };
    $('#mo-del', det)?.addEventListener('click', async () => {
      if (!(await confirmBox(`Удалить модель «${m.name}»?`, 'Удалить'))) return;
      const r = await act('model.delete', m.id).catch(() => null);
      if (r?.status === 'done') models(sec, kind);
    });
  };

  const take = (f) => {
    if (!f) return;
    if (!/\.glb$/i.test(f.name)) { toast('Нужен файл .glb (glTF Binary)', 'err'); return; }
    if (f.size > 50 * 1024 * 1024) { toast('Файл больше 50 МБ — включите сжатие при экспорте', 'err'); return; }
    $$('#mo-list li', sec).forEach((li) => li.classList.remove('sel'));
    form({}, f);
  };
  $('#mo-file', sec).onchange = (e) => take(e.target.files[0]);
  const drop = $('#mo-drop', sec);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); };
  $('#mo-filter', sec).onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) models(sec, b.dataset.k); };
  $('#mo-list', sec).onclick = (e) => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    $$('#mo-list li', sec).forEach((x) => x.classList.toggle('sel', x === li));
    form(rows[li.dataset.i]);
  };
}
