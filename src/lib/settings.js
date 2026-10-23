import { sb } from './supabase.js';

/**
 * Настройки сайта из таблицы v1_settings: Классикал-Тян, арты страниц.
 * Читаются одним запросом и запоминаются до перезагрузки страницы.
 */
let cache = null;
export async function settings(force = false) {
  if (cache && !force) return cache;
  const { data, error } = await sb.from('v1_settings').select('key,value');
  cache = error ? {} : Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return cache;
}
export function dropSettings() { cache = null; }

/** Места на сайте, куда команда ставит арты из медиатеки. */
export const ART_SLOTS = {
  home: ['Главная · фон баннера', 'За Классикал-Тян и заголовком. Лучше тёмный, 1920×800.'],
  login: ['Окно входа', 'Слева в окне входа и регистрации, 800×1000.'],
  apply: ['Регистрация державы', 'Шапка мастера заявки, 1920×400.'],
  cabinet: ['Кабинет · фон', 'Когда у державы нет своего герба, 1920×1080.'],
  guide: ['Гайдбук · шапка', '1920×400.'],
  rules: ['Правила · шапка', '1920×400.'],
  map: ['Карта · шапка', '1920×400.'],
  news: ['Новость без картинки', 'Баннер по умолчанию в вестнике, 1200×600.'],
};

/** URL арта страницы или null. */
export async function art(slot) {
  const s = await settings().catch(() => ({}));
  return s.arts?.[slot] || null;
}

/** Ставит арт фоном элемента (через CSS-переменную --art). */
export async function applyArt(el, slot) {
  const url = await art(slot);
  if (!url || !el) return;
  el.style.setProperty('--art', `url("${String(url).replace(/["\\]/g, '')}")`);
  el.classList.add('has-art');
}
