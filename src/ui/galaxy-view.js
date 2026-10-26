import { STAR_COLOR, solid, bounds, cellsOf, distToSegment, laneGeometry } from '../lib/galaxy.js';
import { drawBody } from '../lib/bodies.js';

/**
 * Холст карты: отрисовка, панорама, зум, клики и перетаскивание.
 * opts:
 *   onPick(system|null, event)       — клик по звезде или пустому месту (event.world — координаты карты)
 *   onLane(lane)                     — клик по гиперпути (если laneClicks)
 *   onDrag(system, x, y, done)       — перетаскивание звезды (если draggable)
 *   style(system) → {fill, ring, dim, size} — свой вид звезды
 *   labels: 'auto' | 'all' | 'none'
 */
export class GalaxyView {
  constructor(canvas, data, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = data;
    this.o = { labels: 'auto', ...opts };
    this.selected = null;
    this.linkFrom = null;
    this.draft = null; // черновик сектора: Set id
    this.fit();
    this.bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
  }

  fit() {
    const b = bounds(this.data.systems);
    const r = this.cv.getBoundingClientRect();
    const w = r.width || 800, h = r.height || 500, pad = 30;
    this.k = Math.min((w - pad * 2) / (b.maxX - b.minX || 1), (h - pad * 2) / (b.maxY - b.minY || 1));
    this.ox = pad - b.minX * this.k + (w - pad * 2 - (b.maxX - b.minX) * this.k) / 2;
    this.oy = pad - b.minY * this.k + (h - pad * 2 - (b.maxY - b.minY) * this.k) / 2;
    this.k0 = this.k;
  }
  toScreen(x, y) { return [x * this.k + this.ox, y * this.k + this.oy]; }
  toWorld(sx, sy) { return [(sx - this.ox) / this.k, (sy - this.oy) / this.k]; }

  starAt(sx, sy, r = 10) {
    let best = null, bd = r;
    for (const s of this.data.systems) {
      const [x, y] = this.toScreen(s.x, s.y);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  laneAt(sx, sy) {
    let best = null, bd = 6;
    for (const g of this.lanesGeo()) {
      // дуга — ломаной из 8 отрезков
      let px, py;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        const [x, y] = this.toScreen(u * u * g.a.x + 2 * u * t * g.cx + t * t * g.b.x, u * u * g.a.y + 2 * u * t * g.cy + t * t * g.b.y);
        if (i) { const d = distToSegment(sx, sy, px, py, x, y); if (d < bd) { bd = d; best = g.lane; } }
        px = x; py = y;
      }
    }
    return best;
  }

  bind() {
    const cv = this.cv;
    let down = null, moved = false, dragSys = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      const [sx, sy] = pos(e);
      down = { sx, sy, ox: this.ox, oy: this.oy };
      moved = false;
      dragSys = this.o.draggable ? this.starAt(sx, sy) : null;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const [sx, sy] = pos(e);
      if (!down) {
        const hover = this.starAt(sx, sy) || (this.o.laneClicks && this.laneAt(sx, sy));
        cv.style.cursor = hover ? 'pointer' : 'grab';
        return;
      }
      if (Math.hypot(sx - down.sx, sy - down.sy) > 4) moved = true;
      if (!moved) return;
      if (dragSys) {
        const [wx, wy] = this.toWorld(sx, sy);
        dragSys.x = Math.round(wx); dragSys.y = Math.round(wy); this.cells = null; this.geo = null;
        this.o.onDrag?.(dragSys, dragSys.x, dragSys.y, false);
      } else {
        this.ox = down.ox + (sx - down.sx); this.oy = down.oy + (sy - down.sy);
        cv.style.cursor = 'grabbing';
      }
      this.draw();
    });
    cv.addEventListener('pointerup', (e) => {
      const [sx, sy] = pos(e);
      if (down && !moved) {
        const s = this.starAt(sx, sy);
        if (!s && this.o.laneClicks) { const l = this.laneAt(sx, sy); if (l) { this.o.onLane?.(l); down = null; return; } }
        const [wx, wy] = this.toWorld(sx, sy);
        this.o.onPick?.(s, { world: [Math.round(wx), Math.round(wy)] });
      } else if (down && moved && dragSys) {
        this.o.onDrag?.(dragSys, dragSys.x, dragSys.y, true);
      }
      down = null; dragSys = null;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = pos(e);
      this.zoomAt(sx, sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  zoomAt(sx, sy, f) {
    const k = Math.min(Math.max(this.k * f, this.k0 * 0.5), this.k0 * 12);
    const [wx, wy] = this.toWorld(sx, sy);
    this.k = k; this.ox = sx - wx * k; this.oy = sy - wy * k;
    this.draw();
  }
  zoom(f) { const r = this.cv.getBoundingClientRect(); this.zoomAt(r.width / 2, r.height / 2, f); }
  reset() { this.fit(); this.draw(); }
  centerOn(s) { const r = this.cv.getBoundingClientRect(); this.ox = r.width / 2 - s.x * this.k; this.oy = r.height / 2 - s.y * this.k; this.draw(); }

  draw() {
    const cv = this.cv, ctx = this.ctx, dpr = devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const { systems, byId, lanes, sectors, factions } = this.data;
    const zoomed = this.k / this.k0;

    // фон: звёздная пыль, привязанная к координатам карты
    this.drawDust(ctx, r);

    // ── Секторы — «острова» из ячеек звёзд ──
    // Заливка, внутренняя кайма по краю, территории держав, контур со свечением.
    if (!this.cells) this.cells = cellsOf(systems);
    const secs = this.draft ? [...sectors.filter((s) => s.id !== this.draft.id), this.draft] : sectors;
    const secOf = new Map();
    for (const sec of secs) for (const id of sec.system_ids || []) secOf.set(id, sec);
    const pt = (p) => this.toScreen(p[0], p[1]);
    const cellPath = (ids) => {
      ctx.beginPath();
      for (const id of ids) {
        const poly = this.cells.get(id);
        poly.forEach((p, i) => { const [x, y] = pt(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath();
      }
    };
    const edgePath = (ids, keep) => {
      ctx.beginPath();
      for (const id of ids) {
        const poly = this.cells.get(id);
        for (let i = 0; i < poly.length; i++) {
          if (!keep(id, poly[i][2])) continue;
          const [ax, ay] = pt(poly[i]), [bx, by] = pt(poly[(i + 1) % poly.length]);
          ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        }
      }
    };
    const layout = [];
    for (const sec of secs) {
      const ids = (sec.system_ids || []).filter((id) => this.cells.has(id));
      if (!ids.length) continue;
      const isDraft = sec === this.draft, col = mapColor(sec.color);
      const outer = (id, tag) => !(tag && secOf.get(tag) === sec);
      cellPath(ids);
      ctx.fillStyle = withAlpha(col, isDraft ? 0.2 : 0.1);
      ctx.fill();
      // внутренняя кайма: широкий мягкий край, обрезанный по форме сектора
      ctx.save();
      cellPath(ids); ctx.clip();
      edgePath(ids, outer);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = withAlpha(col, 0.2); ctx.lineWidth = 16; ctx.stroke();
      ctx.strokeStyle = withAlpha(col, 0.18); ctx.lineWidth = 6; ctx.stroke();
      ctx.restore();
      layout.push({ sec, ids, col, isDraft, outer });
    }
    // территории держав поверх секторов: заливка цветом державы и пунктир по её границе
    const byFac = new Map();
    for (const s of systems) {
      if (!s.faction || !factions[s.faction] || !this.cells.has(s.id)) continue;
      if (!byFac.has(s.faction)) byFac.set(s.faction, []);
      byFac.get(s.faction).push(s.id);
    }
    for (const [fid, ids] of byFac) {
      const col = mapColor(factions[fid].color);
      cellPath(ids);
      ctx.fillStyle = withAlpha(col, 0.2); ctx.fill();
      edgePath(ids, (id, tag) => !tag || byId[tag]?.faction !== fid);
      ctx.strokeStyle = withAlpha(col, 0.75); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    // контур секторов: свечение + чёткая линия + золотой пунктир по кромке
    for (const L of layout) {
      edgePath(L.ids, L.outer);
      ctx.save();
      ctx.shadowColor = withAlpha(L.col, 0.8); ctx.shadowBlur = 10;
      ctx.strokeStyle = withAlpha(L.col, L.isDraft ? 1 : 0.75); ctx.lineWidth = L.isDraft ? 2 : 1.4; ctx.lineJoin = 'round';
      ctx.setLineDash(L.isDraft ? [6, 4] : []);
      ctx.stroke();
      ctx.restore();
      if (!L.isDraft) {
        ctx.strokeStyle = 'rgba(233,185,73,0.3)'; ctx.lineWidth = 0.8; ctx.setLineDash([1.5, 5]);
        ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // ── Гиперпути: прямые; местные — светлые нити, трассы ярче, магистрали — золото со свечением ──
    {
      const geo = this.lanesGeo();
      const z = Math.min(1, Math.max(0, (zoomed - 1) / 3));
      const W = [0.7, 1, 1.6], A = [0.28 + 0.4 * z, 0.45 + 0.35 * z, 0.85];
      const BASE = ['#9d9580', '#d4c49a', '#e9b949'];
      const seg = (g) => { const [ax, ay] = this.toScreen(g.a.x, g.a.y), [bx, by] = this.toScreen(g.b.x, g.b.y); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); };
      ctx.save(); ctx.lineCap = 'round';
      for (const rank of [0, 1, 2]) {
        const groups = new Map();
        for (const g of geo) {
          if (g.rank !== rank || this.hotLane === g.lane.id) continue;
          const c = g.tint || BASE[rank];
          if (!groups.has(c)) groups.set(c, []);
          groups.get(c).push(g);
        }
        if (rank === 2) { ctx.shadowColor = 'rgba(233,185,73,0.7)'; ctx.shadowBlur = 6; }
        for (const [c, gs] of groups) {
          ctx.beginPath(); gs.forEach(seg);
          ctx.globalAlpha = A[rank]; ctx.lineWidth = W[rank]; ctx.strokeStyle = c; ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
      const hot = geo.find((g) => g.lane.id === this.hotLane);
      if (hot) { ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeStyle = '#ff6b5e'; ctx.beginPath(); seg(hot); ctx.stroke(); }
      ctx.restore();
    }
    if (this.linkFrom && this.mouse) {
      const [ax, ay] = this.toScreen(this.linkFrom.x, this.linkFrom.y);
      ctx.strokeStyle = '#e9b949'; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(this.mouse[0], this.mouse[1]); ctx.stroke(); ctx.setLineDash([]);
    }

    // звёзды
    const showLabels = this.o.labels === 'all' || (this.o.labels === 'auto' && zoomed >= 2.2);
    // крупный план: звёзды с артами вращаются — крутим анимацию, пока приближено
    const textured = !!this.o.bodies && zoomed >= 3 && Object.keys(this.o.bodies).some((k) => k.startsWith('star:') && this.o.bodies[k]?.urls?.length);
    this.t = (performance.now() - (this.t0 ||= performance.now())) / 1000;
    if (textured && !this.anim && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.anim = setInterval(() => { if (!this.cv.isConnected) { clearInterval(this.anim); this.anim = 0; return; } this.draw(); }, 50);
    } else if (!textured && this.anim) { clearInterval(this.anim); this.anim = 0; }
    for (const s of systems) {
      const [x, y] = this.toScreen(s.x, s.y);
      if (x < -20 || y < -20 || x > r.width + 20 || y > r.height + 20) continue;
      const st = this.o.style?.(s) || {};
      const owner = s.faction && factions[s.faction];
      const size = (st.size || (s.is_giant ? 3.6 : 2.6)) * Math.min(2.2, Math.max(1, zoomed * 0.55));
      if (!st.dim) {
        const halo = st.fill || STAR_COLOR[s.star_type] || '#fff';
        ctx.fillStyle = withAlpha(halo, 0.14); ctx.beginPath(); ctx.arc(x, y, size * 2.8, 0, 7); ctx.fill();
        ctx.fillStyle = withAlpha(halo, 0.26); ctx.beginPath(); ctx.arc(x, y, size * 1.7, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = st.dim ? 0.28 : 1;
      const slot = `star:${s.star_type}`;
      if (textured && !st.fill && this.o.bodies[slot]?.urls?.length) {
        drawBody(ctx, x, y, size * 1.5, slot, this.o.bodies[slot], this.t, s.name, { onload: () => this.draw() });
      } else {
        ctx.fillStyle = st.fill || STAR_COLOR[s.star_type] || '#fff';
        ctx.beginPath(); ctx.arc(x, y, size, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const ring = st.ring || (this.selected === s ? '#e9b949' : this.linkFrom === s ? '#e9b949' : this.draft?.system_ids.includes(s.id) ? solid(this.draft.color) : null);
      if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, size + 4, 0, 7); ctx.stroke(); }
      if (showLabels || this.selected === s) {
        ctx.fillStyle = st.dim ? 'rgba(243,236,220,0.35)' : 'rgba(243,236,220,0.85)';
        ctx.font = `${this.selected === s ? 700 : 500} 11px Manrope, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(s.name, x, y - size - 7);
      }
      if (owner && owner.capital === s.id && !st.dim) {
        const d = size + 6;
        ctx.strokeStyle = '#e9b949'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath(); ctx.stroke();
      }
    }

    // ── Плашки секторов — поверх всего, гаснут при сильном приближении ──
    if (this.o.labels !== 'none' && zoomed < 3.2) {
      ctx.globalAlpha = zoomed < 2.2 ? 1 : Math.max(0, 3.2 - zoomed);
      for (const L of layout) {
        let cx = 0, cy = 0;
        for (const id of L.ids) { cx += byId[id].x; cy += byId[id].y; }
        const [lx, ly] = this.toScreen(cx / L.ids.length, cy / L.ids.length);
        sectorBadge(ctx, lx, ly, String(L.sec.name || ''), L.col, Math.max(0.62, Math.min(1, (r.width / 900) * Math.max(1, zoomed))));
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Звёздная пыль: точки по псевдослучайной сетке мира, не дрожат при панораме. */
  drawDust(ctx, r) {
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(r.width, r.height);
    const step = 60;
    if (((x1 - x0) / step) * ((y1 - y0) / step) > 6000) return;
    for (let gx = Math.floor(x0 / step); gx <= Math.ceil(x1 / step); gx++) {
      for (let gy = Math.floor(y0 / step); gy <= Math.ceil(y1 / step); gy++) {
        const h = hash(gx, gy);
        if (h > 0.55) continue;
        const [sx, sy] = this.toScreen((gx + hash(gy, gx)) * step, (gy + hash(gx + 7, gy - 3)) * step);
        const d = h < 0.08 ? 1.6 : 1;
        ctx.fillStyle = `rgba(243,236,220,${(0.12 + h * 0.5).toFixed(2)})`;
        ctx.fillRect(sx, sy, d, d);
      }
    }
  }

  /** Новые данные карты: ячейки секторов пересчитаются. */
  setData(d) { this.data = d; this.cells = null; this.geo = null; this.draw(); }
  lanesGeo() { return (this.geo ||= laneGeometry(this.data)); }
  setMouse(e) { const r = this.cv.getBoundingClientRect(); this.mouse = [e.clientX - r.left, e.clientY - r.top]; }
  destroy() { this.ro.disconnect(); clearInterval(this.anim); this.anim = 0; }
}

const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };

/** Цвет для карты: слишком тёмные цвета держав и секторов осветляются, иначе их не видно на чёрном. */
function mapColor(c) {
  const col = solid(c);
  const m = String(col).match(/rgba?\(([^)]+)\)/);
  let rgb = null;
  if (m) rgb = m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  else if (/^#[0-9a-f]{6}$/i.test(col)) { const n = parseInt(col.slice(1), 16); rgb = [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  if (!rgb) return col;
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum >= 0.22) return `rgb(${rgb.join(',')})`;
  const k = ((0.22 - lum) / 0.22) * 0.6;
  return `rgb(${rgb.map((v) => Math.round(v + (185 - v) * k)).join(',')})`;
}

/** Плашка сектора: тёмная пластина со срезанными углами, ромбы цвета сектора, золотая кромка, подпись «сектор». */
function sectorBadge(ctx, x, y, name, col, k = 1) {
  const text = name.toUpperCase();
  ctx.font = `800 ${Math.round(12 * k)}px Manrope, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width, w = tw + 36 * k, h = 22 * k, c = 6 * k;
  const l = x - w / 2, t = y - h / 2;
  ctx.beginPath();
  ctx.moveTo(l + c, t); ctx.lineTo(l + w - c, t); ctx.lineTo(l + w, t + c); ctx.lineTo(l + w, t + h - c);
  ctx.lineTo(l + w - c, t + h); ctx.lineTo(l + c, t + h); ctx.lineTo(l, t + h - c); ctx.lineTo(l, t + c); ctx.closePath();
  ctx.fillStyle = 'rgba(8,7,5,0.9)'; ctx.fill();
  ctx.strokeStyle = withAlpha(col, 0.9); ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(l + c + 2, t + 0.5); ctx.lineTo(l + w - c - 2, t + 0.5);
  ctx.strokeStyle = 'rgba(233,185,73,0.6)'; ctx.stroke();
  const q = 3.5 * k;
  for (const dx of [l + 10 * k, l + w - 10 * k]) {
    ctx.beginPath(); ctx.moveTo(dx, y - q); ctx.lineTo(dx + q, y); ctx.lineTo(dx, y + q); ctx.lineTo(dx - q, y); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  }
  ctx.fillStyle = '#f3ecdc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  if (k >= 0.8) {
    ctx.font = '700 8px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(233,185,73,0.85)';
    ctx.fillText('С Е К Т О Р', x, t - 7);
  }
  ctx.textBaseline = 'alphabetic';
}

function withAlpha(color, a) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(',').map((x) => parseFloat(x)); return `rgba(${r},${g},${b},${a})`; }
  if (/^#[0-9a-f]{6}$/i.test(color)) { const n = parseInt(color.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  return color;
}
