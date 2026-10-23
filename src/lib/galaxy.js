import { sb } from './supabase.js';

/** Цвета звёзд по классу. */
export const STAR_COLOR = { yellow: '#ffd76a', red: '#ff8a5c', blue: '#8fb8ff', white: '#f4f1ea', green: '#9fe0a8' };
export const STAR_NAME = { yellow: 'Жёлтая', red: 'Красная', blue: 'Голубая', white: 'Белая', green: 'Зелёная' };

let cache = null;

/** Карта: системы, гиперпути, секторы и державы (имя, цвет, герб). */
export async function loadGalaxy(force = false) {
  if (cache && !force) return cache;
  const [sys, lanes, sectors, apps] = await Promise.all([
    sb.from('map_systems').select('id,name,star_type,x,y,is_giant,faction,description,planets').limit(5000),
    sb.from('map_hyperlanes').select('id,a_id,b_id').limit(20000),
    sb.from('map_sectors').select('id,name,color,lore,system_ids'),
    sb.from('faction_applications').select('faction_id,name,color,herald_url').eq('status', 'approved'),
  ]);
  if (sys.error) throw new Error(sys.error.message);
  const factions = {};
  for (const a of apps.data || []) if (a.faction_id) factions[a.faction_id] = { name: a.name, color: a.color, herald: a.herald_url };
  const systems = (sys.data || []).map((s) => ({ ...s, x: Number(s.x), y: Number(s.y), planets: Array.isArray(s.planets) ? s.planets : [] }));
  cache = {
    systems,
    byId: Object.fromEntries(systems.map((s) => [s.id, s])),
    lanes: lanes.data || [],
    sectors: (sectors.data || []).map((s) => ({ ...s, system_ids: s.system_ids || [] })),
    factions,
  };
  return cache;
}
export function dropGalaxyCache() { cache = null; }

/** Цвет державы без прозрачности: 'rgba(205,171,143,0.34)' → 'rgb(205,171,143)'. */
export function solid(color, fallback = '#e9b949') {
  if (!color) return fallback;
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(',').map((x) => parseFloat(x)); return `rgb(${r},${g},${b})`; }
  return color;
}

/** Границы карты для вписывания в экран. */
export function bounds(systems) {
  if (!systems.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of systems) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y); }
  return { minX, minY, maxX, maxY };
}

/** Выпуклая оболочка точек — граница сектора. */
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Новый id системы в формате базы: sys_ + 8 символов. */
export function newSystemId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'sys_';
  const buf = crypto.getRandomValues(new Uint8Array(8));
  for (const b of buf) s += a[b % a.length];
  return s;
}

/** Расстояние от точки до отрезка — для клика по гиперпути. */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
