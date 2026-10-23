import { settings } from './settings.js';

/**
 * Арты небесных тел: звёзды, планеты по классам, астероиды, аномалии.
 * Хранятся в v1_settings.bodies: { <slot>: { mode, urls: [..], speed } }.
 *   mode 'surface' — карта поверхности (лучше 2:1), прокручивается внутри круга:
 *                    тело вращается вокруг своей оси, как глобус;
 *   mode 'sprite'  — готовая картинка тела (PNG с прозрачностью) поворачивается целиком.
 * Несколько картинок в слоте — варианты: каждой планете достаётся своя (по имени),
 * плюс у каждой свой оттенок и наклон, чтобы одинаковые классы не были близнецами.
 */
export const BODY_GROUPS = [
  ['Звёзды', {
    'star:yellow': 'Жёлтая звезда', 'star:red': 'Красная звезда', 'star:blue': 'Голубая звезда',
    'star:white': 'Белая звезда', 'star:green': 'Зелёная звезда',
  }],
  ['Планеты', {
    terrestrial: 'Землеподобная', oceanic: 'Океаническая', desert: 'Пустынная', volcanic: 'Вулканическая',
    lava: 'Лавовая', cryo: 'Криомир', micro: 'Малое тело', exotic: 'Экзотическая', gaia: 'Идеальный мир',
    gasgiant: 'Газовый гигант', icegiant: 'Ледяной гигант', hotgiant: 'Горячий гигант', dead: 'Мёртвый мир',
  }],
  ['Прочее', { belt: 'Астероид (для поясов)', anomaly: 'Аномалия', structure: 'Станция, руины', moon: 'Луна' }],
];
export const BODY_LABEL = Object.assign({}, ...BODY_GROUPS.map(([, m]) => m));
const DEFAULT_MODE = (slot) => (slot.startsWith('star:') || slot === 'belt' || slot === 'structure' || slot === 'anomaly' ? 'sprite' : 'surface');

/** Цвета-заглушки, пока арт не загружен. */
export const BODY_COLOR = {
  'star:yellow': '#ffd76a', 'star:red': '#ff8a5c', 'star:blue': '#8fb8ff', 'star:white': '#f4f1ea', 'star:green': '#9fe0a8',
  terrestrial: '#6f9a5a', oceanic: '#3f78b8', desert: '#c9a066', volcanic: '#7a4a3a', lava: '#d2552c', cryo: '#bcd8e6',
  micro: '#8b8378', exotic: '#a46fc4', gaia: '#58c08a', gasgiant: '#c8a27a', icegiant: '#7fb6d6', hotgiant: '#e08a4a',
  dead: '#4a4642', belt: '#8b8378', anomaly: '#b48cff', structure: '#c9c2b2', moon: '#9a958c',
};

const TYPE_TO_GROUP = [
  [/газов/i, 'gasgiant'], [/ледяные гиг/i, 'icegiant'], [/горячие гиг/i, 'hotgiant'], [/криом/i, 'cryo'],
  [/пустын|литара/i, 'desert'], [/лав/i, 'lava'], [/вулкан/i, 'volcanic'], [/океан/i, 'oceanic'],
  [/землепод|суперзем|тундр/i, 'terrestrial'], [/малые тела/i, 'micro'], [/экзот/i, 'exotic'], [/идеальн/i, 'gaia'],
  [/мёртв|мертв/i, 'dead'], [/структур|руин|станц/i, 'structure'], [/аномал/i, 'anomaly'],
];

/** Класс тела для арта: из поля g, иначе по названию типа (старые генераторы писали только type). */
export function groupOf(p) {
  if (!p) return 'micro';
  if (p.dead || p.doomed) return 'dead';
  if (p.kind === 'belt' || p.g === 'belt') return 'belt';
  if (p.kind === 'anomaly' || p.g === 'anomaly') return 'anomaly';
  if (p.g && BODY_LABEL[p.g]) return p.g;
  for (const [re, g] of TYPE_TO_GROUP) if (re.test(p.type || '')) return g;
  return p.kind ? 'micro' : 'structure';
}
export const isGiant = (g) => g === 'gasgiant' || g === 'icegiant' || g === 'hotgiant';

export async function loadBodies() {
  const s = await settings().catch(() => ({}));
  return s.bodies || {};
}

/** Детерминированное «случайное» число 0..1 по строке и номеру — у каждого тела свой вид. */
export function seeded(str, n = 0) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const imgs = new Map();
/** Картинка по URL с кэшем; вызывает onload один раз, когда загрузится. */
export function img(url, onload) {
  let i = imgs.get(url);
  if (!i) {
    i = new Image();
    i.crossOrigin = 'anonymous';
    i.decoding = 'async';
    i.src = url;
    imgs.set(url, i);
  }
  if (onload && !i.complete) i.addEventListener('load', onload, { once: true });
  return i;
}
const ready = (i) => i && i.complete && i.naturalWidth > 0;

/**
 * Нарисовать тело. cfg — слот из настроек (или undefined — заглушка).
 * t — секунды анимации; seed — имя тела; light — откуда свет [dx, dy] (для терминатора).
 */
export function drawBody(ctx, x, y, r, slot, cfg, t, seed = '', { light = [-1, -0.3], glow = false, onload } = {}) {
  const mode = cfg?.mode || DEFAULT_MODE(slot);
  const urls = cfg?.urls || [];
  const url = urls.length ? urls[Math.floor(seeded(seed, 1) * urls.length)] : null;
  const im = url ? img(url, onload) : null;
  const speed = cfg?.speed ?? 1;
  const isStar = slot.startsWith('star:');
  const base = BODY_COLOR[slot] || '#aaa';

  if (isStar || glow) {
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
    g.addColorStop(0, hexA(base, 0.45)); g.addColorStop(1, hexA(base, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, 7); ctx.fill();
  }

  if (ready(im) && mode === 'sprite') {
    const a = t * 0.25 * speed * (seeded(seed, 2) > 0.5 ? 1 : -1) + seeded(seed, 3) * 6.28;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const k = Math.max(im.naturalWidth, im.naturalHeight);
    const w = (im.naturalWidth / k) * r * 2, h = (im.naturalHeight / k) * r * 2;
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  if (ready(im)) {
    // поверхность: высота текстуры = диаметр, ширина по пропорции; едет по кругу
    const h = r * 2 * (1.05 + seeded(seed, 4) * 0.25);
    const w = h * (im.naturalWidth / im.naturalHeight);
    const off = ((t * 0.035 * speed * h + seeded(seed, 5) * w) % w + w) % w;
    const tilt = (seeded(seed, 6) - 0.5) * 0.5;
    ctx.translate(x, y); ctx.rotate(tilt); ctx.translate(-x, -y);
    const top = y - h / 2 + (seeded(seed, 7) - 0.5) * (h - r * 2);
    for (let k = -1; k <= 1; k++) ctx.drawImage(im, x - r - off + k * w, top, w, h);
  } else {
    ctx.fillStyle = base; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (isGiant(slot)) {
      ctx.globalAlpha = 0.25;
      for (let b = -3; b <= 3; b++) { ctx.fillStyle = b & 1 ? '#fff' : '#000'; ctx.fillRect(x - r, y + (b / 3.5) * r - r * 0.08, r * 2, r * 0.16); }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  if (!isStar) {
    // объём: освещённая сторона и тень (терминатор)
    const [lx, ly] = light;
    const sh = ctx.createRadialGradient(x + lx * r * 0.45, y + ly * r * 0.45, r * 0.1, x, y, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    if (slot !== 'dead' && slot !== 'micro' && slot !== 'moon') {
      ctx.strokeStyle = hexA(base, 0.35); ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath(); ctx.arc(x, y, r + ctx.lineWidth / 2, 0, 7); ctx.stroke();
    }
  }
}

export function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
