/**
 * Карта сражения: рисует поле по данным генератора v1_bmap_gen.
 * Сервер присылает только строку клеток и сведения о системе; всё остальное
 * (звезда, планета, астероиды, туманности) рисуется здесь по зерну карты —
 * одно и то же зерно всегда даёт одну и ту же картинку.
 *
 * Сетка: шестиугольники с плоским верхом, нечётные столбцы сдвинуты вниз.
 * Центр клетки (x, y) в единицах радиуса: (1.5·x, √3·(y + ½·(x mod 2))).
 */

const SQ3 = Math.sqrt(3);

export const STAR = {
  white:  { name: 'Белая звезда',   core: '#f6f8ff', glow: [214, 228, 255], tint: [10, 13, 20],  neb: [170, 190, 230], light: [235, 240, 255] },
  yellow: { name: 'Жёлтая звезда',  core: '#ffe39a', glow: [255, 206, 110], tint: [16, 12, 5],   neb: [205, 150, 80],  light: [255, 226, 160] },
  red:    { name: 'Красная звезда', core: '#ff7a5c', glow: [255, 92, 64],   tint: [18, 6, 5],    neb: [196, 64, 54],   light: [255, 150, 120] },
  green:  { name: 'Зелёная звезда', core: '#98ffc4', glow: [96, 255, 168],  tint: [4, 15, 10],   neb: [64, 186, 128],  light: [170, 255, 205] },
  blue:   { name: 'Голубая звезда', core: '#a8ccff', glow: [118, 168, 255], tint: [5, 9, 20],    neb: [86, 128, 232],  light: [190, 215, 255] },
};

/** Клетки: подпись, правило, цвет обводки зоны. */
export const CELLS = {
  '.': { name: 'Открытый космос', rule: 'Без ограничений.' },
  a: { name: 'Астероиды', rule: 'Проходят только корветы и авиация. Цель внутри труднее поразить (−25 % к попаданию) и заметить (радар −30 %).', edge: [233, 185, 73] },
  R: { name: 'Глыба / луна', rule: 'Непроходима для всех. Закрывает линию огня.', edge: [233, 185, 73] },
  P: { name: 'Планета', rule: 'Непроходима. Закрывает огонь и радар.' },
  g: { name: 'Гравитационный колодец', rule: 'Движение вдвое дороже.', edge: [180, 160, 120] },
  d: { name: 'Обломки и кольца', rule: 'Крупным (L, XL) движение вдвое дороже. Лёгкое укрытие (−10 % к попаданию).', edge: [160, 150, 135] },
  n: { name: 'Туманность', rule: 'Корабль внутри виден чужому радару только с 2 клеток.', edge: null },
  i: { name: 'Ионный шторм', rule: 'Радар внутри работает вполсилы, щиты не восстанавливаются.', edge: [120, 190, 255] },
  f: { name: 'Корона звезды', rule: 'Щиты теряют часть заряда каждый ход.', edge: [255, 150, 70] },
};

export const ARCHE = { orbit: 'Орбита гиганта', field: 'Поле у планеты', belt: 'Пояс астероидов', storm: 'Аномалия и шторма', void: 'Глубокий космос' };

// ── случайные числа по зерну ──
function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c1, c2, k) => c1.map((v, i) => Math.round(v + (c2[i] - v) * k));
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

/** Облик планеты по её типу из данных системы. */
function planetLook(type = '') {
  const t = type.toLowerCase();
  if (/горяч/.test(t)) return { bands: ['#d4683c', '#8a2c18', '#f09a58', '#5c1c10', '#b84a28'], atm: [255, 120, 70], storm: '#ffd0a0' };
  if (/ледян.*гигант|ледяные гиганты/.test(t)) return { bands: ['#86c9dc', '#4f8fb0', '#b0e6f0', '#3d7395', '#6fb2cc'], atm: [140, 220, 255], storm: '#e4fbff' };
  if (/газов|гигант/.test(t)) return { bands: ['#caa06a', '#a6743f', '#e6c690', '#87582f', '#d8b07a'], atm: [255, 210, 150], storm: '#f3dcb0' };
  if (/океан/.test(t)) return { base: ['#1d4c86', '#2c6db0'], spots: ['#e8f1fa', '#3c86c4'], atm: [130, 190, 255] };
  if (/земл|идеальн|суперземл|гельвард|литара|тундр/.test(t)) return { base: ['#24577e', '#2d6a3a'], spots: ['#4f8a3c', '#c9b27a', '#eef4f8'], atm: [140, 200, 255] };
  if (/пустын|дюн|псамор/.test(t)) return { base: ['#b48a52', '#cfa96c'], spots: ['#8a6538', '#e3c58e'], atm: [255, 210, 150] };
  if (/лав|вулкан/.test(t)) return { base: ['#241210', '#3a1a12'], spots: ['#ff6a2a', '#ffb050'], atm: [255, 110, 60], glowSpots: true };
  if (/крио|лёд|ледян/.test(t)) return { base: ['#c4dae6', '#93b5c8'], spots: ['#e9f4fa', '#7f9fb4'], atm: [190, 230, 255] };
  if (/углерод/.test(t)) return { base: ['#2c2824', '#3a342e'], spots: ['#544a40', '#1a1714'], atm: [160, 140, 120] };
  if (/аномал|структур|руин|экзот/.test(t)) return { base: ['#3a2a6a', '#5a3f98'], spots: ['#9f7fe0', '#2a1a4a'], atm: [170, 130, 255], glowSpots: true };
  return { base: ['#58544e', '#6e6a63'], spots: ['#47433e', '#86817a'], atm: [200, 195, 185] };
}

export class BattleMap {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = { grid: true, fog: null, units: [], hover: null };
    this.bg = null;
  }

  setMap(map) { this.map = map; this.bg = null; this.draw(); }
  set(opts) { Object.assign(this.o, opts); this.draw(); }

  cell(x, y) { const m = this.map; return x < 0 || y < 0 || x >= m.w || y >= m.h ? null : m.grid[y * m.w + x]; }

  // ── геометрия ──
  layout() {
    const m = this.map, r = this.c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(320, r.width), unitsW = 1.5 * (m.w - 1) + 2, unitsH = SQ3 * (m.h + 0.5);
    const s = W / (unitsW + 1.2);
    const H = Math.round(s * (unitsH + 1.6));
    if (this.c.width !== Math.round(W * dpr) || this.c.height !== Math.round(H * dpr)) {
      this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr); this.c.style.height = `${H}px`; this.bg = null;
    }
    this.dpr = dpr; this.W = W; this.H = H; this.s = s;
    this.ox = (W - s * (1.5 * (m.w - 1))) / 2;
    this.oy = (H - s * SQ3 * (m.h - 0.5)) / 2;
  }
  center(x, y) { return [this.ox + this.s * 1.5 * x, this.oy + this.s * SQ3 * (y + 0.5 * (x & 1))]; }
  unitsToPx(ux, uy) { return [this.ox + this.s * ux, this.oy + this.s * uy]; }
  hexPath(ctx, x, y, k = 1) {
    const [cx, cy] = this.center(x, y), r = this.s * k;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath();
  }
  /** Клетка под точкой экрана (CSS-пиксели) или null. */
  cellAt(px, py) {
    if (!this.map) return null;
    const gx = Math.round((px - this.ox) / (1.5 * this.s));
    let best = null, bd = Infinity;
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (x < 0 || x >= this.map.w) continue;
      const gy = Math.round((py - this.oy) / (SQ3 * this.s) - 0.5 * (x & 1));
      for (let y = gy - 1; y <= gy + 1; y++) {
        if (y < 0 || y >= this.map.h) continue;
        const [cx, cy] = this.center(x, y), d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    return best && bd < (this.s * 1.05) ** 2 ? best : null;
  }
  neighbors(x, y) {
    const d = x & 1 ? [[1, 0], [1, 1], [-1, 0], [-1, 1], [0, -1], [0, 1]] : [[1, -1], [1, 0], [-1, -1], [-1, 0], [0, -1], [0, 1]];
    return d.map(([dx, dy]) => [x + dx, y + dy]);
  }
  static cube(x, y) { const q = x, r = y - (x - (x & 1)) / 2; return [q, r, -q - r]; }
  static dist(a, b) { const A = BattleMap.cube(...a), B = BattleMap.cube(...b); return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])); }

  // ── рисование ──
  draw() {
    if (!this.map) return;
    this.layout();
    if (!this.bg) this.bg = this.renderStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.o.fog) this.drawFog(ctx);
    this.drawUnits(ctx);
    if (this.o.hover) {
      const [x, y] = this.o.hover;
      this.hexPath(ctx, x, y, 0.94);
      ctx.strokeStyle = 'rgba(243,236,220,.9)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
  }

  renderStatic() {
    const m = this.map, P = STAR[m.system?.star] || STAR.yellow;
    const off = document.createElement('canvas');
    off.width = this.c.width; off.height = this.c.height;
    const ctx = off.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const rnd = prng(m.seed * 7919 + (m.w << 3));
    const W = this.W, H = this.H, s = this.s;
    const starTop = m.star_edge === 'top';

    // 1. глубина космоса с оттенком звезды
    const g0 = ctx.createLinearGradient(0, starTop ? 0 : H, 0, starTop ? H : 0);
    g0.addColorStop(0, rgba(mix(P.tint, P.glow, 0.12), 1));
    g0.addColorStop(0.45, rgba(P.tint, 1));
    g0.addColorStop(1, '#010101');
    ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);

    // 2. звёздное поле
    for (let i = 0; i < Math.round(W * H / 1400); i++) {
      const x = rnd() * W, y = rnd() * H, b = rnd();
      ctx.fillStyle = `rgba(243,236,220,${(0.08 + b * b * 0.6).toFixed(2)})`;
      ctx.fillRect(x, y, b > 0.93 ? 1.6 : 1, b > 0.93 ? 1.6 : 1);
      if (b > 0.985) { ctx.fillStyle = 'rgba(243,236,220,.25)'; ctx.fillRect(x - 3, y + 0.3, 7, 0.6); ctx.fillRect(x + 0.3, y - 3, 0.6, 7); }
    }
    // дымка далёких туманностей
    for (let i = 0; i < 5; i++) {
      const x = rnd() * W, y = rnd() * H, r = s * (5 + rnd() * 9);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(P.neb, 0.07)); gr.addColorStop(1, rgba(P.neb, 0));
      ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 3. звезда за краем поля
    const scx = W * (0.3 + rnd() * 0.4), scy = starTop ? -s * 9 : H + s * 9, sr = s * 7;
    const halo = ctx.createRadialGradient(scx, scy, sr * 0.6, scx, scy, sr * 6);
    halo.addColorStop(0, rgba(P.glow, 0.42)); halo.addColorStop(0.25, rgba(P.glow, 0.1)); halo.addColorStop(1, rgba(P.glow, 0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) { // лучи короны
      const a = (starTop ? 0 : Math.PI) + (rnd() - 0.5) * Math.PI * 0.9, len = sr * (2 + rnd() * 3.5);
      const gx = ctx.createLinearGradient(scx, scy, scx + Math.sin(a) * len, scy + Math.cos(a) * len);
      gx.addColorStop(0, rgba(P.glow, 0.12)); gx.addColorStop(1, rgba(P.glow, 0));
      ctx.strokeStyle = gx; ctx.lineWidth = 1 + rnd() * 3;
      ctx.beginPath(); ctx.moveTo(scx, scy); ctx.lineTo(scx + Math.sin(a) * len, scy + Math.cos(a) * len); ctx.stroke();
    }
    ctx.restore();
    const disc = ctx.createRadialGradient(scx, scy, 0, scx, scy, sr * 1.15);
    disc.addColorStop(0, '#fff'); disc.addColorStop(0.55, P.core); disc.addColorStop(1, rgba(P.glow, 0));
    ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(scx, scy, sr * 1.15, 0, 7); ctx.fill();
    this.lightDir = [scx, scy];

    // 4. планета на фоне (если бой не у самой планеты)
    if (!m.planet && m.backdrop) {
      // далеко за полем: в углу, наполовину за краем, приглушённо
      const br = s * (7 + rnd() * 3), left = rnd() < 0.5;
      const bx = left ? -br * 0.35 : W + br * 0.35, by = starTop ? H + br * 0.2 : -br * 0.2;
      this.drawPlanet(ctx, bx, by, br, m.backdrop.type, m.backdrop.rings, rnd, 0.55);
    }

    // 5. место боя — планета у края поля
    if (m.planet) {
      const pr = m.planet.r, dep = m.planet.depth, top = m.edge === 'top';
      const [pcx, pcy] = this.unitsToPx(1.5 * ((m.w - 1) / 2), top ? dep - pr : SQ3 * (m.h - 0.5) + pr - dep);
      // гравитационный ореол
      const gh = ctx.createRadialGradient(pcx, pcy, pr * s, pcx, pcy, (pr + 3) * s);
      const look = planetLook(m.site?.type);
      gh.addColorStop(0, rgba(look.atm, 0.22)); gh.addColorStop(1, rgba(look.atm, 0));
      ctx.fillStyle = gh; ctx.beginPath(); ctx.arc(pcx, pcy, (pr + 3) * s, 0, 7); ctx.fill();
      this.drawPlanet(ctx, pcx, pcy, pr * s, m.site?.type, 0, rnd, 1);
      if (m.site?.rings) this.drawRings(ctx, pcx, pcy, (pr + 4.6) * s, (pr + 6.4) * s, look, rnd);
      // орбиты гравитационного колодца
      ctx.setLineDash([2, 6]); ctx.strokeStyle = rgba(look.atm, 0.28); ctx.lineWidth = 1;
      for (const k of [1.0, 2.1]) { ctx.beginPath(); ctx.arc(pcx, pcy, (pr + k) * s, 0, 7); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    // 6. корона звезды над полем
    if (m.corona) {
      const y0 = starTop ? this.oy - s : this.oy + s * SQ3 * (m.h - 0.5) + s;
      const cg = ctx.createLinearGradient(0, y0, 0, y0 + (starTop ? 1 : -1) * s * 4.5);
      cg.addColorStop(0, rgba(P.glow, 0.32)); cg.addColorStop(1, rgba(P.glow, 0));
      ctx.fillStyle = cg; ctx.fillRect(0, Math.min(y0, y0 + (starTop ? 1 : -1) * s * 4.5), W, s * 4.5);
    }

    // 7. местность по клеткам
    this.drawTerrain(ctx, P, rnd);

    // 8. сетка и стартовые зоны
    this.drawGrid(ctx);
    return off;
  }

  drawPlanet(ctx, cx, cy, r, type, rings, rnd, alpha) {
    const look = planetLook(type);
    ctx.save(); ctx.globalAlpha = alpha;
    // атмосфера
    const atm = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.09);
    atm.addColorStop(0, rgba(look.atm, 0.5)); atm.addColorStop(1, rgba(look.atm, 0));
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, r * 1.09, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
    if (look.bands) {
      ctx.fillStyle = look.bands[0]; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      let y = cy - r;
      while (y < cy + r) {
        const hgt = r * (0.03 + rnd() * 0.09), col = look.bands[Math.floor(rnd() * look.bands.length)];
        ctx.fillStyle = col; ctx.globalAlpha = alpha * (0.55 + rnd() * 0.45);
        ctx.beginPath(); ctx.moveTo(cx - r, y);
        for (let x = -r; x <= r; x += r / 24) ctx.lineTo(cx + x, y + Math.sin(x / r * 9 + y) * hgt * 0.25);
        ctx.lineTo(cx + r, y + hgt); ctx.lineTo(cx - r, y + hgt); ctx.closePath(); ctx.fill();
        y += hgt * (0.7 + rnd() * 0.6);
      }
      ctx.globalAlpha = alpha;
      // вихрь
      const sx = cx + (rnd() - 0.5) * r * 0.9, sy = cy + (rnd() - 0.5) * r * 0.6, sw = r * (0.08 + rnd() * 0.08);
      ctx.fillStyle = look.storm; ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath(); ctx.ellipse(sx, sy, sw * 1.8, sw * 0.7, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = alpha;
    } else {
      const bg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      bg.addColorStop(0, look.base[0]); bg.addColorStop(1, look.base[1]);
      ctx.fillStyle = bg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      for (let i = 0; i < 70; i++) {
        const a = rnd() * 7, d = Math.sqrt(rnd()) * r, sz = r * (0.03 + rnd() * 0.14);
        ctx.fillStyle = look.spots[i % look.spots.length];
        ctx.globalAlpha = alpha * (look.glowSpots ? 0.35 + rnd() * 0.4 : 0.18 + rnd() * 0.3);
        ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, sz * 1.6, sz, rnd() * 3, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = alpha;
    }
    // свет от звезды и тень
    const [lx, ly] = this.lightDir || [cx, cy - r * 3];
    const ang = Math.atan2(ly - cy, lx - cx);
    const sh = ctx.createLinearGradient(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, cx - Math.cos(ang) * r, cy - Math.sin(ang) * r);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.45, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = sh; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    if (rings) this.drawRings(ctx, cx, cy, r * 1.4, r * 2.1, look, rnd, alpha, 0.32);
  }

  drawRings(ctx, cx, cy, r0, r1, look, rnd, alpha = 1, squash = 1) {
    ctx.save(); ctx.globalAlpha = alpha;
    const col = hex2rgb(look.bands ? look.bands[2] : look.base[1]);
    for (let r = r0; r < r1; r += 1.5 + rnd() * 2.5) {
      ctx.strokeStyle = rgba(col, 0.05 + rnd() * 0.16); ctx.lineWidth = 1 + rnd() * 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * squash, 0, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  /** Обводка зоны: рёбра клетки, за которыми клетка другого типа. */
  zoneEdges(ctx, type, color, dash, width = 1.2) {
    const m = this.map, s = this.s;
    ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    // порядок соседей совпадает с рёбрами шестиугольника (углы 0°…300°)
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (this.cell(x, y) !== type) continue;
      const [cx, cy] = this.center(x, y), odd = x & 1;
      const nb = [[1, odd ? 1 : 0], [0, 1], [-1, odd ? 1 : 0], [-1, odd ? 0 : -1], [0, -1], [1, odd ? 0 : -1]];
      for (let e = 0; e < 6; e++) {
        const n = this.cell(x + nb[e][0], y + nb[e][1]);
        if (n === type || n === null) continue; // край поля не обводим
        const a0 = Math.PI / 3 * e, a1 = Math.PI / 3 * (e + 1);
        ctx.moveTo(cx + s * Math.cos(a0), cy + s * Math.sin(a0)); ctx.lineTo(cx + s * Math.cos(a1), cy + s * Math.sin(a1));
      }
    }
    ctx.stroke(); ctx.restore();
  }

  drawTerrain(ctx, P, rnd) {
    const m = this.map, s = this.s;
    const [lx, ly] = this.lightDir;
    const cells = (t) => { const out = []; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (this.cell(x, y) === t) out.push([x, y]); return out; };

    // туманности: мягкие облака
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (const [x, y] of cells('n')) {
      const [cx, cy] = this.center(x, y);
      for (let k = 0; k < 2; k++) {
        const r = s * (1.3 + rnd() * 0.9), ox = (rnd() - 0.5) * s, oy = (rnd() - 0.5) * s;
        const gr = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        gr.addColorStop(0, rgba(mix(P.neb, [255, 255, 255], 0.15), 0.16)); gr.addColorStop(1, rgba(P.neb, 0));
        ctx.fillStyle = gr; ctx.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
      }
    }
    ctx.restore();

    // ионный шторм: свечение и разряды
    for (const [x, y] of cells('i')) {
      const [cx, cy] = this.center(x, y);
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.3);
      gr.addColorStop(0, 'rgba(110,180,255,0.16)'); gr.addColorStop(1, 'rgba(110,180,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(cx - s * 1.3, cy - s * 1.3, s * 2.6, s * 2.6);
      if (rnd() < 0.55) {
        ctx.strokeStyle = `rgba(190,225,255,${(0.35 + rnd() * 0.4).toFixed(2)})`; ctx.lineWidth = 0.9;
        ctx.beginPath(); let px = cx + (rnd() - 0.5) * s, py = cy - s * 0.7; ctx.moveTo(px, py);
        for (let k = 0; k < 4; k++) { px += (rnd() - 0.5) * s * 0.7; py += s * 0.35; ctx.lineTo(px, py); }
        ctx.stroke();
      }
    }

    // гравитационный колодец и корона: тонированная заливка клеток
    for (const [t, col] of [['g', [200, 180, 140]], ['f', P.glow]]) {
      ctx.fillStyle = rgba(col, t === 'f' ? 0.1 : 0.05);
      for (const [x, y] of cells(t)) { this.hexPath(ctx, x, y, 0.98); ctx.fill(); }
    }

    // обломки и кольца: осколки
    for (const [x, y] of cells('d')) {
      const [cx, cy] = this.center(x, y);
      for (let k = 0; k < 7; k++) {
        const px = cx + (rnd() - 0.5) * s * 1.5, py = cy + (rnd() - 0.5) * s * 1.4, l = s * (0.06 + rnd() * 0.14), a = rnd() * 3;
        ctx.strokeStyle = `rgba(190,180,160,${(0.25 + rnd() * 0.35).toFixed(2)})`; ctx.lineWidth = 0.8 + rnd();
        ctx.beginPath(); ctx.moveTo(px - Math.cos(a) * l, py - Math.sin(a) * l); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
      }
    }

    // астероиды: тёмные глыбы с подсветкой со стороны звезды
    const rock = (cx, cy, r) => {
      const n = 7 + Math.floor(rnd() * 4), pts = [];
      for (let k = 0; k < n; k++) { const a = (Math.PI * 2 / n) * k + rnd() * 0.4, rr = r * (0.7 + rnd() * 0.45); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      const ang = Math.atan2(ly - cy, lx - cx);
      const gr = ctx.createLinearGradient(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, cx - Math.cos(ang) * r, cy - Math.sin(ang) * r);
      gr.addColorStop(0, rgba(mix([92, 82, 68], P.light, 0.35), 1)); gr.addColorStop(0.5, '#2a251f'); gr.addColorStop(1, '#0d0b09');
      ctx.fillStyle = gr; ctx.beginPath(); pts.forEach(([px, py], k) => ctx[k ? 'lineTo' : 'moveTo'](px, py)); ctx.closePath(); ctx.fill();
      // кромка, освещённая звездой
      ctx.strokeStyle = rgba(P.light, 0.55); ctx.lineWidth = 0.9;
      ctx.beginPath();
      pts.forEach(([px, py], k) => { const [qx, qy] = pts[(k + 1) % n]; const mx = (px + qx) / 2 - cx, my = (py + qy) / 2 - cy; if (mx * Math.cos(ang) + my * Math.sin(ang) > 0) { ctx.moveTo(px, py); ctx.lineTo(qx, qy); } });
      ctx.stroke();
      if (r > s * 0.3) for (let k = 0; k < 2; k++) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(cx + (rnd() - 0.5) * r, cy + (rnd() - 0.5) * r, r * (0.1 + rnd() * 0.12), 0, 7); ctx.fill(); }
    };
    for (const [x, y] of cells('a')) {
      const [cx, cy] = this.center(x, y);
      this.hexPath(ctx, x, y, 0.98); ctx.fillStyle = 'rgba(233,185,73,0.045)'; ctx.fill();
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) rock(cx + (rnd() - 0.5) * s * 1.1, cy + (rnd() - 0.5) * s * 1.0, s * (0.16 + rnd() * 0.24));
      for (let k = 0; k < 5; k++) { ctx.fillStyle = 'rgba(200,185,160,.35)'; ctx.fillRect(cx + (rnd() - 0.5) * s * 1.4, cy + (rnd() - 0.5) * s * 1.3, 1.2, 1.2); }
    }
    for (const [x, y] of cells('R')) { const [cx, cy] = this.center(x, y); rock(cx, cy, s * 0.82); }

    // обводки зон — тактическая разметка
    this.zoneEdges(ctx, 'a', 'rgba(233,185,73,.75)', [5, 3], 1.3);
    this.zoneEdges(ctx, 'R', 'rgba(233,185,73,.95)', [], 1.6);
    this.zoneEdges(ctx, 'i', 'rgba(130,195,255,.6)', [2, 4], 1.2);
    this.zoneEdges(ctx, 'n', rgba(P.neb, 0.35), [1, 5], 1);
    this.zoneEdges(ctx, 'd', 'rgba(170,160,140,.4)', [1, 4], 1);
    this.zoneEdges(ctx, 'P', rgba(planetLook(m.site?.type).atm, 0.45), [4, 3], 1);
  }

  drawGrid(ctx) {
    const m = this.map, s = this.s;
    // стартовые зоны сторон
    for (const [side, [x0, x1], col] of [['A', m.spawn.a, [233, 185, 73]], ['B', m.spawn.b, [222, 108, 92]]]) {
      ctx.fillStyle = rgba(col, 0.05);
      for (let x = x0; x <= x1; x++) for (let y = 0; y < m.h; y++) if (this.cell(x, y) !== 'P') { this.hexPath(ctx, x, y, 0.98); ctx.fill(); }
      const [cx] = this.center((x0 + x1) / 2, 0);
      ctx.font = `800 ${Math.max(9, s * 0.42)}px Manrope, system-ui, sans-serif`;
      ctx.fillStyle = rgba(col, 0.75); ctx.textAlign = 'center';
      ctx.fillText(`СТАРТ ${side}`, cx, this.oy + s * SQ3 * (m.h - 0.5) + s * 1.35);
    }
    if (!this.o.grid) return;
    ctx.strokeStyle = 'rgba(233,185,73,0.085)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (this.cell(x, y) === 'P') continue;
      const [cx, cy] = this.center(x, y);
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx[i ? 'lineTo' : 'moveTo'](cx + s * Math.cos(a), cy + s * Math.sin(a)); }
      ctx.closePath();
    }
    ctx.stroke();
  }

  // ── туман войны (показ правил: что видит выбранная сторона) ──
  visibleFor(side) {
    const m = this.map, own = this.o.units.filter((u) => u.side === side), vis = new Set();
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = this.cell(x, y);
      for (const u of own) {
        let r = (u.radar || 4) * (m.radar || 1);
        if (this.cell(u.x, u.y) === 'i') r *= 0.5;
        if (t === 'a') r *= 0.7;
        const d = BattleMap.dist([u.x, u.y], [x, y]);
        if (t === 'n' ? d <= 2 : d <= r) { if (!this.blocked([u.x, u.y], [x, y])) { vis.add(`${x},${y}`); break; } }
      }
    }
    return vis;
  }
  /** Планета закрывает радар: линия между центрами проходит через клетку P. */
  blocked(a, b) {
    const d = BattleMap.dist(a, b); if (d < 2) return false;
    const A = this.center(...a), B = this.center(...b);
    for (let i = 1; i < d; i++) {
      const t = i / d, c = this.cellAt(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t);
      if (c && this.cell(...c) === 'P') return true;
    }
    return false;
  }
  drawFog(ctx) {
    const m = this.map, vis = this.visibleFor(this.o.fog);
    this.vis = vis;
    ctx.fillStyle = 'rgba(0,0,0,.58)';
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (vis.has(`${x},${y}`) || this.cell(x, y) === 'P') continue;
      this.hexPath(ctx, x, y, 1.02); ctx.fill();
    }
    // граница обзора
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(120,230,170,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
    const s = this.s;
    for (const k of vis) {
      const [x, y] = k.split(',').map(Number), [cx, cy] = this.center(x, y), odd = x & 1;
      const nb = [[1, odd ? 1 : 0], [0, 1], [-1, odd ? 1 : 0], [-1, odd ? 0 : -1], [0, -1], [1, odd ? 0 : -1]];
      for (let e = 0; e < 6; e++) {
        const nx = x + nb[e][0], ny = y + nb[e][1];
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || vis.has(`${nx},${ny}`)) continue;
        const a0 = Math.PI / 3 * e, a1 = Math.PI / 3 * (e + 1);
        ctx.moveTo(cx + s * Math.cos(a0), cy + s * Math.sin(a0)); ctx.lineTo(cx + s * Math.cos(a1), cy + s * Math.sin(a1));
      }
    }
    ctx.stroke(); ctx.restore();
  }

  drawUnits(ctx) {
    const s = this.s, fog = this.o.fog;
    for (const u of this.o.units) {
      const mine = !fog || u.side === fog;
      if (!mine && !this.vis?.has(`${u.x},${u.y}`)) continue; // необнаруженный враг не рисуется вовсе
      const [cx, cy] = this.center(u.x, u.y), col = u.side === 'a' ? [233, 185, 73] : [232, 104, 88];
      const dir = u.side === 'a' ? 1 : -1, r = s * (u.size === 'S' ? 0.38 : u.size === 'XL' ? 0.62 : 0.5);
      ctx.fillStyle = rgba(col, 0.18); ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, 7); ctx.fill();
      ctx.fillStyle = rgba(col, 1); ctx.strokeStyle = '#0a0806'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx + dir * r, cy); ctx.lineTo(cx - dir * r * 0.7, cy - r * 0.75); ctx.lineTo(cx - dir * r * 0.3, cy); ctx.lineTo(cx - dir * r * 0.7, cy + r * 0.75); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (u.label) {
        ctx.font = `700 ${Math.max(8, s * 0.34)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(243,236,220,.9)'; ctx.fillText(u.label, cx, cy + r + s * 0.42);
      }
    }
  }
}
