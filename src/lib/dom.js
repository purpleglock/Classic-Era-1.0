/** Экранирование текста для вставки в HTML. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Шаблон: html`<b>${x}</b>` — значения экранируются, raw(...) вставляется как есть. */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i >= values.length) return out + s;
    const v = values[i];
    const str = Array.isArray(v) ? v.map((x) => (x && x.__raw ? x.html : esc(x))).join('')
      : v && v.__raw ? v.html : esc(v);
    return out + s + str;
  }, '');
}
export const raw = (h) => ({ __raw: true, html: String(h ?? '') });

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, cls = 'i') {
  return raw(`<svg class="${cls}" aria-hidden="true"><use href="#${name}"/></svg>`);
}

let toastTimer = 0;
export function toast(message, kind = 'ok') {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/** Подтверждение прямо на странице (без confirm()). */
export function confirmBox(text, yesLabel = 'Да, выполнить') {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'confirm panel';
    box.setAttribute('role', 'alertdialog');
    box.innerHTML = html`<p>${text}</p><div class="acts"><button type="button" class="btn sm danger" data-yes>${yesLabel}</button><button type="button" class="btn sm" data-no>Отмена</button></div>`;
    document.body.appendChild(box);
    const done = (v) => { box.remove(); resolve(v); };
    box.querySelector('[data-yes]').onclick = () => done(true);
    box.querySelector('[data-no]').onclick = () => done(false);
    box.querySelector('[data-no]').focus();
  });
}
