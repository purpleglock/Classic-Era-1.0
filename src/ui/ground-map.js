/**
 * Наземная карта сражения: 2D-отрисовка по данным генератора v1_gmap_gen.
 * Цвета, названия клеток и облик (лес, дюны, лава, ледяные шпили…) зависят от среды
 * планеты; правила клеток общие. Сетка и обзор — src/lib/hexmap.js.
 */
import { SQ3, center as hexCenter, cellOf, edgeNeighbors, visibleCellsGround } from '../lib/hexmap.js';

const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const hx = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const vh = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 0.013) * 43758.5453; return v - Math.floor(v); };
/** Плавный шум для пятен грунта. */
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = vh(xi, yi, s), b = vh(xi + 1, yi, s), c = vh(xi, yi + 1, s), d = vh(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Размытие слоя грунта (по строкам и столбцам), прозрачность учитывается. */
function boxBlur(d, w, h, r) {
  const tmp = new Float32Array(d.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? tmp : d, dst = pass ? d : tmp;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = pass ? x : Math.max(0, Math.min(w - 1, x + k)), yy = pass ? Math.max(0, Math.min(h - 1, y + k)) : y, i = (yy * w + xx) * 4;
        a0 += src[i]; a1 += src[i + 1]; a2 += src[i + 2]; a3 += src[i + 3]; n++;
      }
      const o = (y * w + x) * 4; dst[o] = a0 / n; dst[o + 1] = a1 / n; dst[o + 2] = a2 / n; dst[o + 3] = a3 / n;
    }
  }
}

/** Среды: палитра, небо (для 3D), облик укрытий и гор, снег на вершинах. */
export const BIOMES = {
  temperate: { name: 'Умеренный мир', ground: ['#3c5a29', '#56733a'], F: '#203d18', R: '#6d6a4c', h: '#5f7c3f', M: ['#6f6d66', '#a8a49a'], W: ['#1c4a74', '#2f70a0'], w: '#4f90b4', X: '#0b0a08', S: '#5a5650', road: '#6e6650', sky: [150, 190, 230], tree: 'pine', peak: 'snow' },
  tundra: { name: 'Тундра', ground: ['#b9c6cc', '#d3dce0'], F: '#26402f', R: '#eef3f6', h: '#a6b6be', M: ['#6c7a86', '#c4d0d8'], W: ['#22425a', '#2e5a78'], w: '#a7d0e2', X: '#0a1016', S: '#58606a', road: '#7a8288', sky: [176, 196, 216], tree: 'pine', peak: 'snow' },
  desert: { name: 'Пустыня', ground: ['#c49656', '#d9b072'], F: '#557a2c', R: '#e3bd7d', h: '#b4854a', M: ['#91522e', '#c27a46'], W: ['#226e80', '#2f8a9a'], w: '#5aa8a8', X: '#2a160a', S: '#8a7050', road: '#a88a5e', sky: [232, 196, 146], tree: 'palm', peak: 'mesa' },
  ocean: { name: 'Океанический мир', ground: ['#7f9446', '#a2ae5e'], F: '#2a5426', R: '#c8b882', h: '#6c8a3e', M: ['#5e6458', '#97998a'], W: ['#0e3666', '#195a9a'], w: '#3a8cc2', X: '#08101a', S: '#5a5a54', road: '#8a8060', sky: [140, 190, 236], tree: 'palm', peak: 'rock' },
  volcanic: { name: 'Вулканический мир', ground: ['#272120', '#382c28'], F: '#3a3028', R: '#4b4542', h: '#3d3330', M: ['#1c1816', '#3d3532'], W: ['#1a2a32', '#24363e'], w: '#3e5258', L: ['#ff4e14', '#ffb43c'], X: '#050302', S: '#3a3430', road: '#4a4038', sky: [120, 52, 30], tree: 'dead', peak: 'rock' },
  ice: { name: 'Ледяной мир', ground: ['#d6e4ee', '#c2d6e4'], F: '#7aa0b8', R: '#eef5fa', h: '#b6cee0', M: ['#8fbde0', '#e6f6ff'], W: ['#1a3756', '#24496e'], w: '#94c6e2', X: '#091626', S: '#5c6c7a', road: '#8ea4b4', sky: [168, 198, 230], tree: 'crystal', peak: 'spire' },
  barren: { name: 'Безжизненный мир', ground: ['#665f57', '#7c746a'], F: '#4a463e', R: '#8a8274', h: '#58524a', M: ['#46413b', '#89837a'], W: ['#22262a', '#2e3236'], w: '#4a5054', X: '#040303', S: '#4a4844', road: '#3a3834', sky: [14, 14, 20], tree: 'rock', peak: 'rock' },
  carbon: { name: 'Углеродный мир', ground: ['#1b1919', '#2a2626'], F: '#2c2822', R: '#3a3532', h: '#2a2626', M: ['#25252c', '#6c6c7c'], W: ['#141414', '#202020'], w: '#2a2a2a', L: ['#120c08', '#3e2c10'], X: '#030303', S: '#2e2c2c', road: '#3a3634', sky: [62, 52, 42], tree: 'dead', peak: 'spire' },
  exotic: { name: 'Экзотический мир', ground: ['#271a3c', '#382656'], F: '#8a5ad0', R: '#4a3a6a', h: '#3a2a5a', M: ['#170e2c', '#5a40a0'], W: ['#141a3c', '#20285a'], w: '#3a4a8a', L: ['#6cff32', '#c4ff6a'], X: '#05030a', S: '#3c3450', road: '#4c4060', sky: [92, 52, 142], tree: 'crystal', peak: 'monolith' },
  ruins: { name: 'Руины', ground: ['#4a4640', '#5a554c'], F: '#3a4a2a', R: '#6a645a', h: '#4e4a42', M: ['#3e3a36', '#7a746a'], W: ['#1e2e3a', '#2a3e4c'], w: '#40586a', X: '#060504', S: '#34302c', road: '#2a2826', sky: [112, 102, 92], tree: 'pine', peak: 'rock' },
  gas: { name: 'Газовый гигант', ground: ['#4a4e54', '#5a5f66'], F: '#3a4a3a', R: '#5e6268', h: '#52565c', M: ['#3a3e44', '#6a6e74'], W: ['#1a2a3a', '#24384a'], w: '#3a5068', X: '#c89b63', S: '#2d3137', road: '#6c7076', sky: [214, 170, 118], tree: 'pine', peak: 'rock', clouds: true },
};

/** Облик облаков газового гиганта — по типу гиганта. */
export function cloudColors(type = '') {
  if (/горяч/i.test(type)) return [[214, 104, 60], [140, 44, 24], [244, 154, 88]];
  if (/ледян/i.test(type)) return [[134, 200, 220], [80, 140, 176], [180, 230, 240]];
  return [[202, 160, 106], [166, 116, 63], [230, 198, 144]];
}

export const GCELL = {
  '.': ['Равнина', 'Без ограничений.'],
  F: ['Укрытие', 'Пехота в укрытии (−25 % к попаданию). Технике вдвое медленнее. Цель внутри видна только с 2 клеток.'],
  R: ['Неровности', 'Технике вдвое медленнее.'],
  h: ['Холмы', 'Технике вдвое медленнее. С холма обзор +1.'],
  M: ['Горы', 'Только пехота и авиация. Закрывают обзор и прямой огонь; артиллерия бьёт поверх. С горы обзор +2.'],
  W: ['Глубокая вода', 'Только авиация.'],
  w: ['Брод', 'Всем вдвое медленнее.'],
  L: ['Опасная зона', 'Только авиация.'],
  X: ['Пропасть', 'Только авиация.'],
  S: ['Постройки', 'Только пехота: укрытие (−40 % к попаданию). Цель внутри видна только с 2 клеток.'],
  C: ['Сердце колонии', 'Цель атакующего: занять и удержать.'],
  r: ['Дорога', 'Технике вдвое быстрее.'],
};
/** Названия клеток в каждой среде. */
const NAMES = {
  temperate: { F: 'Лес', R: 'Каменистая почва', M: 'Горы', W: 'Река, озеро' },
  tundra: { '.': 'Мёрзлая равнина', F: 'Тайга', R: 'Снежные заносы', M: 'Скалы', W: 'Незамёрзшее озеро', w: 'Тонкий лёд' },
  desert: { '.': 'Песчаная равнина', F: 'Оазис', R: 'Дюны', h: 'Барханы', M: 'Месы', W: 'Озеро', w: 'Мелководье', X: 'Каньон' },
  ocean: { '.': 'Суша', F: 'Джунгли', R: 'Пляж', W: 'Море', w: 'Отмель' },
  volcanic: { '.': 'Базальтовая равнина', F: 'Обгорелые заросли', R: 'Пепельные поля', h: 'Застывшие потоки', M: 'Базальтовые скалы', L: 'Лава' },
  ice: { '.': 'Ледяной щит', F: 'Ледяные заросли', R: 'Снег', h: 'Торосы', M: 'Ледяные шпили', W: 'Полынья', w: 'Тонкий лёд', X: 'Трещина' },
  barren: { '.': 'Реголит', R: 'Обломки', h: 'Вал кратера', M: 'Скалы', X: 'Разлом' },
  carbon: { '.': 'Графитовая равнина', F: 'Сажевые заросли', R: 'Сажа', M: 'Графитовые шпили', L: 'Смоляная топь' },
  exotic: { '.': 'Чужая почва', F: 'Кристаллический лес', R: 'Осколки', M: 'Монолиты', L: 'Кислотное озеро' },
  ruins: { F: 'Заросли', R: 'Завалы', S: 'Руины', r: 'Улица' },
  gas: { '.': 'Платформа', r: 'Мост', X: 'Облака — пустота', S: 'Постройки платформы', R: 'Обломки' },
};
export const cellInfo = (biome, t) => { const [n, rule] = GCELL[t] || GCELL['.']; return [NAMES[biome]?.[t] || n, rule]; };

export class GroundMap {
  constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.o = { grid: true, fog: null, units: [], hover: null }; }
  setMap(m) { this.map = m; this.bg = null; this.draw(); }
  set(o) { Object.assign(this.o, o); this.draw(); }
  cell(x, y) { return cellOf(this.map, x, y); }

  layout() {
    const m = this.map, r = this.c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(320, r.width), s = W / (1.5 * (m.w - 1) + 3.2), H = Math.round(s * (SQ3 * (m.h + 0.5) + 1.8));
    if (this.c.width !== Math.round(W * dpr) || this.c.height !== Math.round(H * dpr)) {
      this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr); this.c.style.height = `${H}px`; this.bg = null;
    }
    Object.assign(this, { dpr, W, H, s });
    this.ox = (W - s * 1.5 * (m.w - 1)) / 2; this.oy = (H - s * SQ3 * (m.h - 0.5)) / 2 - s * 0.3;
  }
  center(x, y) { const [ux, uy] = hexCenter(x, y); return [this.ox + this.s * ux, this.oy + this.s * uy]; }
  hexPath(ctx, x, y, k = 1) {
    const [cx, cy] = this.center(x, y), r = this.s * k;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath();
  }
  cellAt(px, py) {
    const m = this.map; if (!m) return null;
    const gx = Math.round((px - this.ox) / (1.5 * this.s)); let best = null, bd = Infinity;
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (x < 0 || x >= m.w) continue;
      const gy = Math.round((py - this.oy) / (SQ3 * this.s) - 0.5 * (x & 1));
      for (let y = gy - 1; y <= gy + 1; y++) {
        if (y < 0 || y >= m.h) continue;
        const [cx, cy] = this.center(x, y), d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    return best && bd < (this.s * 1.05) ** 2 ? best : null;
  }

  /** Ближайшая клетка (для точек за краем поля — продолжаем грунт). */
  nearCell(px, py) {
    const m = this.map, x = Math.max(0, Math.min(m.w - 1, Math.round((px - this.ox) / (1.5 * this.s))));
    const y = Math.max(0, Math.min(m.h - 1, Math.round((py - this.oy) / (SQ3 * this.s) - 0.5 * (x & 1))));
    return [x, y];
  }

  draw() {
    if (!this.map) return;
    this.layout();
    if (!this.bg) this.bg = this.renderStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.vis = this.o.fog ? visibleCellsGround(this.map, this.o.units, this.o.fog) : null;
    if (this.vis) this.drawFog(ctx);
    this.drawUnits(ctx);
    if (this.o.hover) { this.hexPath(ctx, ...this.o.hover, 0.94); ctx.strokeStyle = 'rgba(243,236,220,.95)'; ctx.lineWidth = 1.6; ctx.stroke(); }
  }

  cellsOf(t) { const m = this.map, out = []; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (this.cell(x, y) === t) out.push([x, y]); return out; }

  renderStatic() {
    const m = this.map, B = BIOMES[m.biome] || BIOMES.barren, s = this.s, W = this.W, H = this.H;
    const off = document.createElement('canvas'); off.width = this.c.width; off.height = this.c.height;
    const ctx = off.getContext('2d'); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const rnd = prng(m.seed * 31337 + m.w);
    const g0 = hx(B.ground[0]), g1 = hx(B.ground[1]);

    // 1. подложка: газовый гигант — облака внизу, иначе — грунт среды
    if (B.clouds) {
      const cc = cloudColors(m.body?.type);
      const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, rgba(cc[2])); bg.addColorStop(1, rgba(cc[1]));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * W, y = rnd() * H, r = s * (1.5 + rnd() * 4);
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(cc[rnd() < 0.5 ? 0 : 2], 0.55)); gr.addColorStop(1, rgba(cc[0], 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, r * 1.8, r * 0.6, 0, 0, 7); ctx.fill();
      }
    } else {
      ctx.fillStyle = rgba(mix(g0, [0, 0, 0], 0.35)); ctx.fillRect(0, 0, W, H);
    }

    // 2. грунт: сплошной слой в низком разрешении, растянутый со сглаживанием —
    //    переходы между лесом, водой, песком и скалами получаются мягкими, без сот
    {
      const k = 4, lw = Math.ceil(W / k), lh = Math.ceil(H / k);
      const low = document.createElement('canvas'); low.width = lw; low.height = lh;
      const lc = low.getContext('2d'), img = lc.createImageData(lw, lh), d = img.data;
      const TC = {
        R: hx(B.R), h: hx(B.h), F: mix(hx(B.F), g0, 0.35), M: hx(B.M[0]), W: hx(B.W[0]), w: hx(B.w),
        L: hx((B.L || ['#a33'])[0]), S: mix(g0, [40, 40, 40], 0.25), C: mix(g0, [40, 40, 40], 0.25), r: mix(g0, hx(B.road), 0.4), X: hx(B.X),
      };
      for (let py = 0; py < lh; py++) for (let px = 0; px < lw; px++) {
        const sx2 = px * k + k / 2, sy2 = py * k + k / 2, c = this.cellAt(sx2, sy2) || this.nearCell(sx2, sy2);
        const t = c ? this.cell(...c) : '.';
        const n = vnoise(sx2 / (s * 2.2), sy2 / (s * 2.2), m.seed) * 0.7 + vnoise(sx2 / (s * 0.6), sy2 / (s * 0.6), m.seed + 9) * 0.3;
        let col = mix(g0, g1, n);
        if (TC[t]) col = t === 'X' && B.clouds ? null : mix(col, TC[t], t === 'R' || t === 'h' ? 0.55 : 0.85);
        const i = (py * lw + px) * 4;
        if (!col) { d[i + 3] = 0; continue; }
        const shade = 0.9 + n * 0.2;
        d[i] = col[0] * shade; d[i + 1] = col[1] * shade; d[i + 2] = col[2] * shade; d[i + 3] = 255;
      }
      boxBlur(d, lw, lh, 2); boxBlur(d, lw, lh, 2);
      lc.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(low, 0, 0, lw * k, lh * k);
    }
    // пыль и крапинки
    for (let i = 0; i < W * H / 260; i++) {
      const x = rnd() * W, y = rnd() * H, c = this.cellAt(x, y);
      if (!c || 'XWwL'.includes(this.cell(...c))) continue;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.06)'; ctx.fillRect(x, y, 1.4, 1.4);
    }

    // 3. пропасти
    for (const [x, y] of this.cellsOf('X')) {
      if (B.clouds) continue;
      const [cx, cy] = this.center(x, y);
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.1);
      gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(cx - s * 1.1, cy - s * 1.1, s * 2.2, s * 2.2);
    }
    // 4. вода и брод: глубина и рябь поверх слоя грунта
    for (const t of ['W', 'w']) for (const [x, y] of this.cellsOf(t)) {
      const [cx, cy] = this.center(x, y);
      if (t === 'W') { const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.2); gr.addColorStop(0, rgba(hx(B.W[0]), 0.5)); gr.addColorStop(1, rgba(hx(B.W[0]), 0)); ctx.fillStyle = gr; ctx.fillRect(cx - s * 1.2, cy - s * 1.2, s * 2.4, s * 2.4); }
      ctx.strokeStyle = t === 'W' ? 'rgba(170,215,255,.22)' : 'rgba(255,255,255,.3)'; ctx.lineWidth = 0.8;
      for (let k = 0; k < 2; k++) { const xx = cx + (rnd() - 0.5) * s * 0.8, yy = cy + (rnd() - 0.5) * s; ctx.beginPath(); ctx.moveTo(xx - s * 0.3, yy); ctx.quadraticCurveTo(xx, yy - s * 0.1, xx + s * 0.3, yy); ctx.stroke(); }
    }
    // 5. лава, кислота, смола: свечение и трещины
    for (const [x, y] of this.cellsOf('L')) {
      const [cx, cy] = this.center(x, y), L = B.L || ['#ff4e14', '#ffb43c'];
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.3);
      gr.addColorStop(0, rgba(hx(L[1]), 0.9)); gr.addColorStop(0.5, rgba(hx(L[0]), 0.55)); gr.addColorStop(1, rgba(hx(L[0]), 0));
      ctx.fillStyle = gr; ctx.fillRect(cx - s * 1.3, cy - s * 1.3, s * 2.6, s * 2.6);
      ctx.strokeStyle = 'rgba(30,10,0,.55)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); let px = cx + (rnd() - 0.5) * s, py = cy + (rnd() - 0.5) * s; ctx.moveTo(px, py); for (let q = 0; q < 3; q++) { px += (rnd() - 0.5) * s * 0.5; py += (rnd() - 0.5) * s * 0.5; ctx.lineTo(px, py); } ctx.stroke(); }
    }
    // 6. холмы: изолинии
    for (const [x, y] of this.cellsOf('h')) {
      const [cx, cy] = this.center(x, y);
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
      for (const k of [0.75, 0.48]) { ctx.beginPath(); ctx.ellipse(cx + (rnd() - 0.5) * s * 0.2, cy, s * k, s * k * 0.62, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.6, s * 0.36, 0, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
    }
    // 7. неровности: дюны, сугробы, обломки
    for (const [x, y] of this.cellsOf('R')) {
      const [cx, cy] = this.center(x, y);
      if (m.biome === 'desert' || m.biome === 'tundra' || m.biome === 'ice') {
        ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.2;
        for (let k = 0; k < 3; k++) { const yy = cy + (k - 1) * s * 0.42; ctx.beginPath(); ctx.moveTo(cx - s * 0.6, yy + s * 0.08); ctx.quadraticCurveTo(cx, yy - s * 0.22, cx + s * 0.6, yy + s * 0.08); ctx.stroke(); }
      } else for (let k = 0; k < 6; k++) {
        ctx.fillStyle = `rgba(0,0,0,${(0.2 + rnd() * 0.25).toFixed(2)})`; const r = s * (0.05 + rnd() * 0.1);
        ctx.beginPath(); ctx.arc(cx + (rnd() - 0.5) * s * 1.3, cy + (rnd() - 0.5) * s * 1.2, r, 0, 7); ctx.fill();
      }
    }
    // 8. дороги и мосты: линии между соседними дорогами, постройками и колонией
    ctx.lineCap = 'round';
    for (const [x, y] of this.cellsOf('r')) {
      const [cx, cy] = this.center(x, y), base = this.baseUnder(x, y);
      for (const [nx, ny] of edgeNeighbors(x, y)) {
        const n = this.cell(nx, ny); if (!n || !'rCS'.includes(n)) continue;
        const [qx, qy] = this.center(nx, ny);
        ctx.strokeStyle = B.road; ctx.lineWidth = s * (base ? 0.5 : 0.36);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo((cx + qx) / 2, (cy + qy) / 2); ctx.stroke();
        if (base) { ctx.strokeStyle = 'rgba(233,185,73,.55)'; ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.fillStyle = B.road; ctx.beginPath(); ctx.arc(cx, cy, s * 0.2, 0, 7); ctx.fill();
    }
    // 9. укрытия: деревья, пальмы, кристаллы
    for (const [x, y] of this.cellsOf('F')) {
      const [cx, cy] = this.center(x, y);
      for (let k = 0; k < 6; k++) this.tree(ctx, cx + (rnd() - 0.5) * s * 1.3, cy + (rnd() - 0.5) * s * 1.2, s * (0.16 + rnd() * 0.12), B, rnd);
    }
    // 10. горы
    for (const [x, y] of this.cellsOf('M')) {
      const [cx, cy] = this.center(x, y);
      const n = B.peak === 'spire' || B.peak === 'monolith' ? 3 : 2;
      for (let k = 0; k < n; k++) this.peak(ctx, cx + (rnd() - 0.5) * s * 0.8, cy + s * 0.35 + (rnd() - 0.5) * s * 0.3, s * (0.55 + rnd() * 0.35), B, rnd);
    }
    // 11. постройки и колония
    for (const [x, y] of this.cellsOf('S')) {
      const [cx, cy] = this.center(x, y);
      for (let k = 0; k < 3; k++) {
        const bw = s * (0.28 + rnd() * 0.25), bh = s * (0.22 + rnd() * 0.2), bx = cx + (rnd() - 0.5) * s * 0.9, by = cy + (rnd() - 0.5) * s * 0.8;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(bx - bw / 2 + 2, by - bh / 2 + 2, bw, bh);
        ctx.fillStyle = B.S; ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
        ctx.fillStyle = m.biome === 'ruins' ? 'rgba(0,0,0,.25)' : 'rgba(233,185,73,.35)'; ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh * 0.3);
      }
    }
    for (const [x, y] of this.cellsOf('C')) {
      const [cx, cy] = this.center(x, y);
      const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.6); gl.addColorStop(0, 'rgba(233,185,73,.35)'); gl.addColorStop(1, 'rgba(233,185,73,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, s * 1.6, 0, 7); ctx.fill();
      ctx.fillStyle = B.S; this.hexPath(ctx, x, y, 0.62); ctx.fill();
      ctx.strokeStyle = '#e9b949'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = '#e9b949'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.16, 0, 7); ctx.fill();
    }

    // 12. обводки зон — тактическая разметка
    this.zoneEdges(ctx, 'M', 'rgba(233,185,73,.8)', [], 1.3);
    this.zoneEdges(ctx, 'L', 'rgba(255,150,60,.75)', [4, 3], 1.2);
    this.zoneEdges(ctx, 'X', B.clouds ? 'rgba(255,255,255,.55)' : 'rgba(233,185,73,.45)', [2, 3], 1);
    this.zoneEdges(ctx, 'W', 'rgba(140,200,255,.45)', [5, 3], 1);
    this.zoneEdges(ctx, 'S', 'rgba(220,214,200,.4)', [1, 3], 1);

    // 13. зоны высадки и обороны, сетка
    for (const [label, [x0, x1], col] of [['ЗОНА ВЫСАДКИ · A', m.landing, [233, 185, 73]], ['ОБОРОНА · B', m.defend, [222, 108, 92]]]) {
      ctx.fillStyle = rgba(col, 0.07);
      for (let x = x0; x <= x1; x++) for (let y = 0; y < m.h; y++) if (!'XWLM'.includes(this.cell(x, y))) { this.hexPath(ctx, x, y, 0.98); ctx.fill(); }
      const [cx] = this.center((x0 + x1) / 2, 0);
      ctx.font = `800 ${Math.max(9, s * 0.4)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = rgba(col, 0.9);
      ctx.fillText(label, cx, this.oy + s * SQ3 * (m.h - 0.5) + s * 1.45);
    }
    if (this.o.grid) {
      ctx.strokeStyle = B.clouds ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        if (B.clouds && this.cell(x, y) === 'X') continue;
        const [cx, cy] = this.center(x, y);
        for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx[i ? 'lineTo' : 'moveTo'](cx + s * Math.cos(a), cy + s * Math.sin(a)); }
        ctx.closePath();
      }
      ctx.stroke();
    }
    // освещение сверху-слева и виньетка
    const lg = ctx.createLinearGradient(0, 0, W, H); lg.addColorStop(0, 'rgba(255,240,210,.08)'); lg.addColorStop(1, 'rgba(0,0,0,.22)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    return off;
  }

  /** Что под дорогой: мост над водой или пропастью. */
  baseUnder(x, y) {
    const n = edgeNeighbors(x, y).map(([a, b]) => this.cell(a, b)).filter(Boolean);
    return n.filter((t) => 'WXL'.includes(t)).length >= 3;
  }

  tree(ctx, x, y, r, B, rnd) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + r * 0.35, y + r * 0.35, r, r * 0.7, 0, 0, 7); ctx.fill();
    if (B.tree === 'crystal') {
      const c = hx(B.F);
      ctx.fillStyle = rgba(mix(c, [255, 255, 255], 0.25)); ctx.strokeStyle = rgba(mix(c, [255, 255, 255], 0.6), 0.8); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x + r * 0.45, y); ctx.lineTo(x, y + r * 0.4); ctx.lineTo(x - r * 0.45, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      return;
    }
    if (B.tree === 'dead' || B.tree === 'rock') {
      ctx.fillStyle = rgba(mix(hx(B.F), [0, 0, 0], 0.2)); ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - r * 0.6, y - r); ctx.moveTo(x, y); ctx.lineTo(x + r * 0.5, y - r * 0.9); ctx.stroke();
      return;
    }
    const c = hx(B.F);
    ctx.fillStyle = rgba(c); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = rgba(mix(c, [255, 255, 255], B.tree === 'palm' ? 0.25 : 0.15)); ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, 7); ctx.fill();
  }

  peak(ctx, x, y, r, B, rnd) {
    const dark = hx(B.M[0]), lite = hx(B.M[1]);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.08, r * 0.75, r * 0.22, 0, 0, 7); ctx.fill();
    if (B.peak === 'mesa') {
      const w = r * 0.8, h = r * 0.5;
      ctx.fillStyle = rgba(dark); ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w * 0.7, y - h); ctx.lineTo(x + w * 0.7, y - h); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba(lite); ctx.fillRect(x - w * 0.7, y - h - r * 0.06, w * 1.4, r * 0.12);
      return;
    }
    if (B.peak === 'monolith') {
      ctx.fillStyle = rgba(dark); ctx.fillRect(x - r * 0.16, y - r * 1.1, r * 0.32, r * 1.1);
      ctx.strokeStyle = rgba(lite, 0.9); ctx.lineWidth = 1; ctx.strokeRect(x - r * 0.16, y - r * 1.1, r * 0.32, r * 1.1);
      return;
    }
    const tall = B.peak === 'spire' ? 1.35 : 0.85, w = B.peak === 'spire' ? r * 0.3 : r * 0.62;
    ctx.fillStyle = rgba(dark); ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x, y - r * tall); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(lite); ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x, y - r * tall); ctx.lineTo(x - w * 0.15, y); ctx.closePath(); ctx.fill();
    if (B.peak === 'snow') { ctx.fillStyle = '#f2f6f8'; ctx.beginPath(); ctx.moveTo(x - w * 0.32, y - r * tall * 0.66); ctx.lineTo(x, y - r * tall); ctx.lineTo(x + w * 0.32, y - r * tall * 0.66); ctx.closePath(); ctx.fill(); }
  }

  zoneEdges(ctx, type, color, dash, width) {
    const m = this.map, s = this.s;
    ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (this.cell(x, y) !== type) continue;
      const [cx, cy] = this.center(x, y);
      edgeNeighbors(x, y).forEach(([nx, ny], e) => {
        const n = this.cell(nx, ny); if (n === type || n === null) return;
        const a0 = Math.PI / 3 * e, a1 = Math.PI / 3 * (e + 1);
        ctx.moveTo(cx + s * Math.cos(a0), cy + s * Math.sin(a0)); ctx.lineTo(cx + s * Math.cos(a1), cy + s * Math.sin(a1));
      });
    }
    ctx.stroke(); ctx.restore();
  }

  drawFog(ctx) {
    const m = this.map, vis = this.vis, s = this.s;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (!vis.has(`${x},${y}`)) { this.hexPath(ctx, x, y, 1.02); ctx.fill(); }
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(120,230,170,.7)'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const k of vis) {
      const [x, y] = k.split(',').map(Number), [cx, cy] = this.center(x, y);
      edgeNeighbors(x, y).forEach(([nx, ny], e) => {
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || vis.has(`${nx},${ny}`)) return;
        const a0 = Math.PI / 3 * e, a1 = Math.PI / 3 * (e + 1);
        ctx.moveTo(cx + s * Math.cos(a0), cy + s * Math.sin(a0)); ctx.lineTo(cx + s * Math.cos(a1), cy + s * Math.sin(a1));
      });
    }
    ctx.stroke(); ctx.restore();
  }

  drawUnits(ctx) {
    const s = this.s, fog = this.o.fog;
    for (const u of this.o.units) {
      if (fog && u.side !== fog && !this.vis?.has(`${u.x},${u.y}`)) continue; // необнаруженного нет на карте
      const [cx, cy0] = this.center(u.x, u.y), cy = cy0 - (u.air ? s * 0.45 : 0);
      const col = u.side === 'a' ? [233, 185, 73] : [232, 104, 88], dir = u.side === 'a' ? 1 : -1, r = s * 0.42;
      if (u.air) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(cx + s * 0.2, cy0 + s * 0.15, r * 0.8, r * 0.3, 0, 0, 7); ctx.fill(); }
      ctx.fillStyle = 'rgba(8,7,5,.85)'; ctx.strokeStyle = rgba(col); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(col); ctx.strokeStyle = rgba(col); ctx.lineWidth = 1.6;
      if (u.type === 'inf') { for (const dx of [-0.35, 0, 0.35]) { ctx.beginPath(); ctx.arc(cx + dx * r, cy + r * 0.1, r * 0.14, 0, 7); ctx.fill(); } }
      else if (u.type === 'tank') { ctx.fillRect(cx - r * 0.55, cy - r * 0.25, r * 1.1, r * 0.55); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dir * r * 0.75, cy - r * 0.1); ctx.stroke(); }
      else if (u.type === 'art') { ctx.fillRect(cx - r * 0.45, cy, r * 0.9, r * 0.32); ctx.beginPath(); ctx.moveTo(cx - dir * r * 0.1, cy); ctx.lineTo(cx + dir * r * 0.6, cy - r * 0.55); ctx.stroke(); }
      else if (u.type === 'aa') { ctx.fillRect(cx - r * 0.45, cy, r * 0.9, r * 0.32); ctx.beginPath(); ctx.moveTo(cx - r * 0.15, cy); ctx.lineTo(cx - r * 0.15, cy - r * 0.6); ctx.moveTo(cx + r * 0.15, cy); ctx.lineTo(cx + r * 0.15, cy - r * 0.6); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(cx + dir * r * 0.7, cy); ctx.lineTo(cx - dir * r * 0.55, cy - r * 0.55); ctx.lineTo(cx - dir * r * 0.25, cy); ctx.lineTo(cx - dir * r * 0.55, cy + r * 0.55); ctx.closePath(); ctx.fill(); }
      if (u.label) { ctx.font = `700 ${Math.max(8, s * 0.32)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(243,236,220,.95)'; ctx.fillText(u.label, cx, cy + r + s * 0.38); }
    }
  }
}
