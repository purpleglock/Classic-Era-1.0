import { html, $ } from '../lib/dom.js';
import { sb, rpc } from '../lib/supabase.js';
import { session } from '../lib/session.js';
import { LEGAL_VERSION, LEGAL_DATE } from '../content/legal.js';

/**
 * Окно подтверждения документов. Показывается вошедшему игроку, пока он не примет
 * текущую редакцию (LEGAL_VERSION). Закрыть его, не согласившись, нельзя — только выйти.
 * Страницы самих документов остаются доступны, чтобы их можно было прочитать.
 */
let checkedFor = null;
export async function checkConsent() {
  if (!session.user) { document.getElementById('veil-consent')?.remove(); checkedFor = null; return; }
  if (location.hash.startsWith('#/legal')) return;
  if (checkedFor === `${session.user.id}:${LEGAL_VERSION}`) return;
  const { data, error } = await sb.from('v1_consents').select('version').eq('user_id', session.user.id).eq('version', LEGAL_VERSION).maybeSingle();
  if (error) return; // документы ещё не подключены в базе — не мешаем игре
  if (data) { checkedFor = `${session.user.id}:${LEGAL_VERSION}`; return; }
  let pre = null;
  try { pre = localStorage.getItem('ce-legal'); } catch { /* недоступно */ }
  if (pre && pre === `${(session.user.email || '').toLowerCase()}|${LEGAL_VERSION}`) {
    const ok = await rpc('v1_accept_docs', { p_version: LEGAL_VERSION, p_agent: navigator.userAgent }).then(() => true, () => false);
    try { localStorage.removeItem('ce-legal'); } catch { /* недоступно */ }
    if (ok) { checkedFor = `${session.user.id}:${LEGAL_VERSION}`; return; }
  }
  if (document.getElementById('veil-consent')) return;
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.id = 'veil-consent';
  veil.innerHTML = html`
    <form class="panel modal consent-modal" role="dialog" aria-labelledby="cs-t">
      <h2 id="cs-t">Обновлённые документы</h2>
      <p>Мы переписали документы проекта (редакция от ${LEGAL_DATE}). Чтобы продолжить игру, ознакомьтесь и подтвердите:</p>
      <ul class="cs-docs">
        <li><a href="#/legal?d=terms" target="_blank">Пользовательское соглашение</a></li>
        <li><a href="#/legal?d=privacy" target="_blank">Политика конфиденциальности</a></li>
        <li><a href="#/legal?d=consent" target="_blank">Согласие на обработку персональных данных</a></li>
      </ul>
      <label class="check"><input type="checkbox" id="cs-1"> <span>Принимаю Пользовательское соглашение и Политику конфиденциальности</span></label>
      <label class="check"><input type="checkbox" id="cs-2"> <span>Даю согласие на обработку персональных данных, в том числе на передачу за пределы России</span></label>
      <p class="msg" id="cs-msg" aria-live="polite"></p>
      <div class="acts"><button type="submit" class="btn gold" id="cs-ok" disabled>Принять и продолжить</button><button type="button" class="btn" id="cs-out">Выйти</button></div>
    </form>`;
  document.body.appendChild(veil);
  const ok = $('#cs-ok', veil);
  const sync = () => { ok.disabled = !($('#cs-1', veil).checked && $('#cs-2', veil).checked); };
  veil.addEventListener('change', sync);
  $('#cs-out', veil).onclick = async () => { await sb.auth.signOut(); veil.remove(); location.hash = '/'; };
  $('form', veil).onsubmit = async (e) => {
    e.preventDefault();
    ok.disabled = true;
    try {
      await rpc('v1_accept_docs', { p_version: LEGAL_VERSION, p_agent: navigator.userAgent });
      checkedFor = `${session.user.id}:${LEGAL_VERSION}`;
      veil.remove();
    } catch (err) { $('#cs-msg', veil).textContent = err.message; ok.disabled = false; }
  };
}
