import { html, raw, icon } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { dayMonth } from '../lib/format.js';
import { rich, wireRich } from '../lib/rich.js';

/** Окно с полным текстом изменения правил и механик. */
export async function openRuleUpdate(id) {
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.innerHTML = html`<div class="panel modal wide rule-modal" role="dialog" aria-label="Изменение правил"><p class="skeleton">Загружаю…</p></div>`;
  document.body.appendChild(veil);
  const close = () => { veil.remove(); removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', esc);
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-close]')) close(); });
  const { data: r } = await sb.from('rules_updates').select('id,at,title,body,tag').eq('id', id).maybeSingle();
  const box = veil.querySelector('.modal');
  if (!r) { box.innerHTML = html`<button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button><p>Запись не найдена.</p>`; return; }
  box.innerHTML = html`
    <button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button>
    <div class="meta"><b>Изменения правил и механик</b>${r.tag ? raw(html`<span class="tag">${r.tag}</span>`) : ''}<time>${dayMonth(r.at)}</time></div>
    <h2>${r.title}</h2>
    <div class="rich" id="ru-body">${raw(rich(r.body || ''))}</div>`;
  wireRich(box.querySelector('#ru-body'));
  box.querySelector('[data-close]').focus();
}
