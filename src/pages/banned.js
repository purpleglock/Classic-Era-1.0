import { html, raw, icon, $ } from '../lib/dom.js';
import { rpc, sb } from '../lib/supabase.js';
import { dateTime, leftText } from '../lib/format.js';
import { CONTACT } from '../content/legal.js';

/** Экран блокировки: что случилось, до какого срока, как обжаловать. */
export async function renderBanned(root) {
  root.innerHTML = '<div class="skeleton">Проверяю доступ…</div>';
  const b = await rpc('v1_my_ban').catch(() => null) || {};
  const until = b.until ? new Date(b.until) : null;
  root.innerHTML = html`<section class="panel ban-screen">
    <div class="ban-lock" aria-hidden="true">${icon('i-shield')}</div>
    <h1>Доступ к игре ограничен</h1>
    <p class="ban-lead">Команда проекта заблокировала этот аккаунт за нарушение правил.</p>
    <dl class="ban-facts">
      <div><dt>Причина</dt><dd>${b.reason || 'не указана'}</dd></div>
      <div><dt>Срок</dt><dd>${until ? raw(html`до ${dateTime(until)} <small id="ban-left">· осталось ${leftText(until - Date.now())}</small>`) : 'бессрочно'}</dd></div>
      ${b.at ? raw(html`<div><dt>С</dt><dd>${dateTime(b.at)}</dd></div>`) : ''}
    </dl>
    <p>Пока блокировка действует, кабинет, карта, вестник и дипломатия недоступны. Держава сохраняется${until ? ' и вернётся к вам после окончания срока' : ''}.</p>
    <div class="ban-appeal">
      <h2>Не согласны с решением?</h2>
      <p>Вы вправе оспорить блокировку. Напишите команде проекта: что произошло и почему решение стоит пересмотреть. Ответим в течение трёх дней.</p>
      <div class="acts">
        <a class="btn gold" href="https://discord.gg/jApCDH2zyM" target="_blank" rel="noopener">${icon('i-chat')}Discord проекта</a>
        <a class="btn" href="mailto:${CONTACT}?subject=${encodeURIComponent('Обжалование блокировки')}">${CONTACT}</a>
      </div>
    </div>
    <div class="acts ban-links"><a class="btn sm" href="#/rules">Правила проекта</a><a class="btn sm" href="#/legal?d=terms">Пользовательское соглашение</a><button type="button" class="btn sm" id="ban-out">${icon('i-logout')}Выйти из аккаунта</button></div>
  </section>`;
  $('#ban-out', root).onclick = async () => { await sb.auth.signOut(); location.hash = '/'; location.reload(); };
}
