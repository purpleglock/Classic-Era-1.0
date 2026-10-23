import { html, raw, icon, $ } from '../lib/dom.js';
import { sb } from '../lib/supabase.js';
import { session, isTeam } from '../lib/session.js';
import { num } from '../lib/format.js';

/**
 * Реестр кораблей и армий. Игрок видит ТОЛЬКО свои проекты и общедоступные:
 * база сама не отдаёт чужие (правила доступа faction_units), а миграция 09
 * закрывает служебные функции, через которые раньше утекали чужие ТТХ.
 */
const CATS = { ship: 'Корабли', aviation: 'Авиация', ground: 'Наземная техника', division: 'Дивизии' };
const STATS = [['hp', 'Корпус'], ['shield', 'Щиты'], ['armor', 'Броня'], ['dmg', 'Урон'], ['rng', 'Дальность'], ['speed', 'Скорость'], ['crew', 'Экипаж'], ['cost', 'Цена, ГС']];

/** Старые названия классов → новые (на случай, если миграция 09 ещё не применена). */
export const classLabel = (s = '') => String(s)
  .replace(/СС-13 \(станция\)/g, 'Станция').replace(/([Сс]танция) СС-13/g, '$1').replace(/СС-13/g, 'Станция')
  .replace(/ФАКЕЛЬЩИК/g, 'РЕЙДЕРСКИЙ КРЕЙСЕР').replace(/Факельщик/g, 'Рейдерский крейсер').replace(/факельщик/g, 'рейдерский крейсер');

export async function renderRegistry(root) {
  if (!session.user) { location.hash = '/'; return; }
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const cat = CATS[q.get('c')] ? q.get('c') : 'ship';
  root.innerHTML = '<div class="skeleton">Загружаю реестр…</div>';
  const { data, error } = await sb.from('faction_units')
    .select('id,category,name,faction_id,faction_name,summary,card_text,updated_at')
    .eq('category', cat).order('updated_at', { ascending: false }).limit(500);
  const fid = session.factionId;
  const rows = (data || []).filter((u) => isTeam() || !u.faction_id || u.faction_id === fid); // второй замок: на всякий случай и в браузере
  const mine = rows.filter((u) => u.faction_id && u.faction_id === fid);
  const pub = rows.filter((u) => !u.faction_id);
  const other = isTeam() ? rows.filter((u) => u.faction_id && u.faction_id !== fid) : [];

  const card = (u) => {
    const s = u.summary || {};
    return html`<details class="unit">
      <summary><span class="u-cls">${classLabel(s.className || '') || '—'}</span><b>${u.name}</b>${u.faction_id ? (u.faction_id !== fid ? raw(html`<span class="tag">${u.faction_name || u.faction_id}</span>`) : '') : raw('<span class="tag new">общедоступный</span>')}</summary>
      <dl class="u-stats">${STATS.filter(([k]) => s[k] != null && s[k] !== 0).map(([k, l]) => raw(html`<div><dt>${l}</dt><dd>${num(s[k])}</dd></div>`))}</dl>
      ${u.card_text ? raw(html`<pre class="u-card">${classLabel(u.card_text)}</pre>`) : ''}
    </details>`;
  };
  const block = (title, list, empty) => html`<section class="panel reg-sec"><div class="sec-h"><h2>${title}</h2><small>${list.length}</small></div>
    ${list.length ? raw(list.map(card).join('')) : raw(html`<p class="empty">${empty}</p>`)}</section>`;

  root.innerHTML = html`
    <section class="panel guide-head">
      <span class="m-ic">${icon('i-ship')}</span>
      <div><h1>Реестр</h1><p>Ваши проекты и общедоступные технологии. Проекты других держав скрыты — их ТТХ узнают в бою или через разведку.</p></div>
      <a class="btn sm" href="#/cabinet">${icon('i-back')}В кабинет</a>
    </section>
    <div class="seg reg-tabs" role="group" aria-label="Категория">${Object.entries(CATS).map(([k, v]) => raw(html`<button type="button" data-c="${k}" aria-pressed="${String(k === cat)}">${v}</button>`))}</div>
    ${error ? raw(html`<p class="note warn">Не удалось загрузить реестр: ${error.message}</p>`) : ''}
    ${raw(block('Мои проекты', mine, fid ? 'В этой категории у вашей державы проектов нет.' : 'У вас пока нет державы.'))}
    ${raw(block('Общедоступные', pub, 'Общедоступных проектов нет.'))}
    ${isTeam() ? raw(block('Проекты держав (видит только команда проекта)', other, 'Нет.')) : ''}`;
  $('.reg-tabs', root).onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) location.hash = `/registry?c=${b.dataset.c}`; };
}
