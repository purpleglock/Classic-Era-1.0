import { sb } from './supabase.js';

/** Цвета звёзд по классу. */
export const STAR_COLOR = { yellow: '#ffd76a', red: '#ff8a5c', blue: '#8fb8ff', white: '#f4f1ea', green: '#9fe0a8' };
export const STAR_NAME = { yellow: 'Жёлтая', red: 'Красная', blue: 'Голубая', white: 'Белая', green: 'Зелёная' };

let cache = null;

const SYS_COLS = 'id,name,star_type,x,y,is_giant,faction,description';

/**
 * Карта: системы, гиперпути, секторы и державы (имя, цвет, герб).
 * Планеты НЕ грузятся: это 1,2 МБ на каждого зрителя карты. Их число приходит
 * из функции базы v1_planet_count, а сами планеты — по клику (planetsOf).
 */
export async function loadGalaxy(force = false) {
  if (cache && !force) return cache;
  const sysQuery = (cols) => sb.from('map_systems').select(cols).limit(5000);
  const [sys0, lanes, sectors, apps] = await Promise.all([
    sysQuery(`${SYS_COLS},planets_n:v1_planet_count`),
    sb.from('map_hyperlanes').select('id,a_id,b_id').limit(20000),
    sb.from('map_sectors').select('id,name,color,lore,system_ids'),
    sb.from('faction_applications').select('faction_id,name,color,herald_url,system_id').eq('status', 'approved'),
  ]);
  // до миграции 06 функции счёта планет нет — берём системы без него
  const sys = sys0.error ? await sysQuery(SYS_COLS) : sys0;
  if (sys.error) throw new Error(sys.error.message);
  const factions = {};
  for (const a of apps.data || []) if (a.faction_id) factions[a.faction_id] = { name: a.name, color: a.color, herald: a.herald_url, capital: a.system_id };
  const systems = (sys.data || []).map((s) => ({
    ...s, x: Number(s.x), y: Number(s.y),
    planets: Array.isArray(s.planets) ? s.planets : null,
    planets_n: s.planets_n ?? (Array.isArray(s.planets) ? s.planets.length : null),
  }));
  cache = {
    systems,
    byId: Object.fromEntries(systems.map((s) => [s.id, s])),
    lanes: lanes.data || [],
    sectors: (sectors.data || []).map((s) => ({ ...s, system_ids: s.system_ids || [] })),
    factions,
  };
  return cache;
}

/** Планеты одной системы — грузятся по требованию и запоминаются в объекте системы. */
export async function planetsOf(s) {
  if (Array.isArray(s.planets)) return s.planets;
  const { data, error } = await sb.from('map_systems').select('planets').eq('id', s.id).maybeSingle();
  if (error) throw new Error(error.message);
  s.planets = Array.isArray(data?.planets) ? data.planets : [];
  s.planets_n = s.planets.length;
  return s.planets;
}

/** Все планеты разом — только для редактора карты (каталог ресурсов). */
export async function allPlanets(g) {
  if (g.allPlanets) return;
  const { data } = await sb.from('map_systems').select('id,planets').limit(5000);
  for (const r of data || []) if (g.byId[r.id] && !Array.isArray(g.byId[r.id].planets)) g.byId[r.id].planets = Array.isArray(r.planets) ? r.planets : [];
  g.allPlanets = true;
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

/**
 * Ячейки секторов: у каждой звезды своя область — точки, которые к ней ближе,
 * чем к любой другой звезде (диаграмма Вороного), но не дальше radius.
 * Поэтому границы соседних секторов совпадают и никогда не накладываются.
 * Каждое ребро ячейки помечено соседом, который его «отрезал» (или null — внешний край).
 * Ячейки зависят только от координат и считаются один раз.
 */
export function cellsOf(systems, radius) {
  const R = radius || autoRadius(systems);
  const cell = R * 2, grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const s of systems) { const k = key(s.x, s.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  const SIDES = 24, out = new Map();
  for (const s of systems) {
    // стартовый многоугольник — круг радиуса R
    let poly = [];
    for (let i = 0; i < SIDES; i++) { const a = (i / SIDES) * Math.PI * 2; poly.push([s.x + Math.cos(a) * R, s.y + Math.sin(a) * R, null]); }
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    const near = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get(`${gx + dx},${gy + dy}`) || []) {
      if (o === s) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < R * 2) near.push([d, o]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [d, o] of near) {
      if (d === 0) continue;
      poly = clipHalf(poly, s, o);
      if (poly.length < 3) break;
    }
    out.set(s.id, poly);
  }
  out.radius = R;
  return out;
}

/** Обрезка многоугольника полуплоскостью «ближе к a, чем к b». Вершина хранит метку ребра, которое из неё выходит. */
function clipHalf(poly, a, b) {
  const nx = b.x - a.x, ny = b.y - a.y, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny; // <= 0 — внутри
  const res = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const sp = side(P), sq = side(Q);
    const cut = () => { const t = sp / (sp - sq); return [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]; };
    if (sp <= 0 && sq <= 0) res.push(P);
    else if (sp <= 0 && sq > 0) { res.push(P); const [x, y] = cut(); res.push([x, y, b.id]); }
    else if (sp > 0 && sq <= 0) { const [x, y] = cut(); res.push([x, y, P[2]]); }
  }
  return res;
}

/** Радиус ячейки по плотности карты: ~1,6 медианного расстояния до ближайшей звезды. */
export function autoRadius(systems) {
  if (systems.length < 2) return 60;
  const sample = systems.length > 400 ? systems.filter((_, i) => i % Math.ceil(systems.length / 400) === 0) : systems;
  const d = sample.map((s) => {
    let m = Infinity;
    for (const o of systems) if (o !== s) m = Math.min(m, Math.hypot(o.x - s.x, o.y - s.y));
    return m;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  return Math.max(10, d[Math.floor(d.length / 2)] * 1.6);
}

/**
 * Гиперпути как дорожная сеть. Для каждой трассы:
 *   • изгиб — мягкая дуга, у каждой своя (по координатам концов), чтобы сеть не была
 *     сеткой прямых;
 *   • ранг — 2 магистраль, 1 трасса, 0 местная ветка. Ранг = сколько кратчайших путей
 *     между столицами держав проходит по трассе; без столиц — по числу соседей у концов;
 *   • оттенок — если оба конца у одной державы, синий подмешивает её цвет.
 */
export function laneGeometry(g) {
  const { lanes, byId, factions } = g;
  const adj = {}, deg = {}, use = {};
  for (const l of lanes) {
    (adj[l.a_id] ||= []).push([l.b_id, l.id]); (adj[l.b_id] ||= []).push([l.a_id, l.id]);
    deg[l.a_id] = (deg[l.a_id] || 0) + 1; deg[l.b_id] = (deg[l.b_id] || 0) + 1;
  }
  const caps = [...new Set(Object.values(factions || {}).map((f) => f.capital).filter((id) => id && adj[id]))];
  for (const src of caps) {
    const prev = { [src]: null }, q = [src];
    for (let h = 0; h < q.length; h++) for (const [nb, lid] of adj[q[h]] || []) if (!(nb in prev)) { prev[nb] = [q[h], lid]; q.push(nb); }
    for (const dst of caps) {
      if (dst === src || !(dst in prev)) continue;
      let n = dst, guard = 0;
      while (prev[n] && guard++ < 5000) { use[prev[n][1]] = (use[prev[n][1]] || 0) + 1; n = prev[n][0]; }
    }
  }
  const max = Math.max(0, ...Object.values(use));
  const trunk = Math.max(2, max * 0.45);
  const out = [];
  for (const l of lanes) {
    const a = byId[l.a_id], b = byId[l.b_id];
    if (!a || !b) continue;
    const u = use[l.id] || 0, md = Math.min(deg[l.a_id] || 0, deg[l.b_id] || 0);
    const rank = max > 0 ? (u >= trunk ? 2 : u > 0 ? 1 : 0) : (md >= 3 ? 2 : md >= 2 ? 1 : 0);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const h = hash01(Math.min(a.x, b.x) + Math.max(a.x, b.x) * 0.31, Math.min(a.y, b.y) + Math.max(a.y, b.y) * 0.47);
    const bend = 0 * h; // пути прямые; изгиб оставлен на будущее
    const cx = (a.x + b.x) / 2 + (-dy / len) * bend, cy = (a.y + b.y) / 2 + (dx / len) * bend;
    let tint = null;
    if (a.faction && a.faction === b.faction && factions?.[a.faction]) {
      const c = rgbOf(solid(factions[a.faction].color));
      if (c) tint = `rgb(${[240, 214, 150].map((v, i) => Math.round(v * 0.55 + c[i] * 0.45)).join(',')})`;
    }
    out.push({ lane: l, a, b, cx, cy, rank, tint });
  }
  return out;
}
const hash01 = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
function rgbOf(c) {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  if (/^#[0-9a-f]{6}$/i.test(c)) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  return null;
}
