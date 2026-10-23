import { settings } from './settings.js';

/**
 * Классикал-Тян: арты и реплики по времени суток. Хранятся в v1_settings.tyan:
 *   { speaker, defaultSprite, sprites: [{id, name, url}],
 *     dialogues: [{id, time: 'morning'|'day'|'evening'|'night'|'any', lines: [{text, sprite}]}] }
 * В тексте {name} заменяется на имя игрока.
 */
export const TIMES = { morning: 'Утро · 5–11', day: 'День · 11–17', evening: 'Вечер · 17–22', night: 'Ночь · 22–5', any: 'В любое время' };

export const FALLBACK = {
  speaker: 'Классикал-Тян',
  sprites: [],
  dialogues: [{ id: 'base', time: 'any', lines: [
    { text: 'Улыбнись. Галактика ждёт твоего хода.' },
    { text: 'На границах шевелятся флоты. Проверим оборону?' },
    { text: 'Новая держава? Я покажу, с чего начать.' },
  ] }],
};

export function timeOf(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export async function loadTyan() {
  const s = await settings().catch(() => ({}));
  const t = s.tyan;
  return t && Array.isArray(t.dialogues) && t.dialogues.some((d) => d.lines?.length) ? { ...FALLBACK, ...t } : FALLBACK;
}

/** Случайный диалог для текущего времени суток (кроме exceptId, чтобы не повторяться). */
export function pickDialogue(cfg, exceptId = null, now = new Date()) {
  const ok = (cfg.dialogues || []).filter((d) => d.lines?.some((l) => l.text?.trim()));
  const t = timeOf(now);
  let pool = ok.filter((d) => d.time === t);
  if (!pool.length) pool = ok.filter((d) => !d.time || d.time === 'any');
  if (!pool.length) pool = ok;
  const fresh = pool.length > 1 ? pool.filter((d) => d.id !== exceptId) : pool;
  return fresh[Math.floor(Math.random() * fresh.length)] || FALLBACK.dialogues[0];
}

export const fillName = (text, name) => String(text || '').replace(/\{name\}/gi, name || 'командир');

/** URL арта для реплики: свой у реплики → у диалога → арт по умолчанию → первый загруженный. */
export function spriteFor(cfg, dialogue, line) {
  const byId = Object.fromEntries((cfg.sprites || []).map((s) => [s.id, s.url]));
  return byId[line?.sprite] || byId[dialogue?.sprite] || byId[cfg.defaultSprite] || cfg.sprites?.[0]?.url || null;
}
