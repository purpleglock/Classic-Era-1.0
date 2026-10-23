import { STAR_COLOR, solid, bounds, cellsOf, distToSegment } from '../lib/galaxy.js';
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
    for (const l of this.data.lanes) {
      const a = this.data.byId[l.a_id], b = this.data.byId[l.b_id];
      if (!a || !b) continue;
      const [ax, ay] = this.toScreen(a.x, a.y), [bx, by] = this.toScreen(b.x, b.y);
      const d = distToSegment(sx, sy, ax, ay, bx, by);
      if (d < bd) { bd = d; best = l; }
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
        dragSys.x = Math.round(wx); dragSys.y = Math.round(wy); this.cells = null;
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

    // секторы: ячейки звёзд, залитые цветом сектора; граница — только там, где сектор кончается
    if (!this.cells) this.cells = cellsOf(systems);
    const secs = this.draft ? [...sectors.filter((s) => s.id !== this.draft.id), this.draft] : sectors;
    const secOf = new Map();
    for (const sec of secs) for (const id of sec.system_ids || []) secOf.set(id, sec);
    const pt = (p) => this.toScreen(p[0], p[1]);
    for (const sec of secs) {
      const ids = (sec.system_ids || []).filter((id) => this.cells.has(id));
      if (!ids.length) continue;
      const isDraft = sec === this.draft, col = solid(sec.color);
      ctx.beginPath();
      for (const id of ids) {
        const poly = this.cells.get(id);
        poly.forEach((p, i) => { const [x, y] = pt(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath();
      }
      ctx.fillStyle = withAlpha(col, isDraft ? 0.16 : 0.08);
      ctx.fill();
      ctx.beginPath();
      for (const id of ids) {
        const poly = this.cells.get(id);
        for (let i = 0; i < poly.length; i++) {
          const tag = poly[i][2];
          if (tag && secOf.get(tag) === sec) continue; // сосед из того же сектора — внутреннее ребро
          const [ax, ay] = pt(poly[i]), [bx, by] = pt(poly[(i + 1) % poly.length]);
          ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        }
      }
      ctx.strokeStyle = withAlpha(col, isDraft ? 0.95 : 0.55);
      ctx.lineWidth = isDraft ? 1.8 : 1.2;
      ctx.setLineDash(isDraft ? [6, 4] : []);
      ctx.stroke(); ctx.setLineDash([]);
      if (zoomed < 3 && this.o.labels !== 'none') {
        let cx = 0, cy = 0;
        for (const id of ids) { cx += byId[id].x; cy += byId[id].y; }
        const [lx, ly] = this.toScreen(cx / ids.length, cy / ids.length);
        ctx.fillStyle = withAlpha(col, 0.75);
        ctx.font = '700 11px Manrope, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(sec.name || '').toUpperCase(), lx, ly);
      }
    }

    // гиперпути
    ctx.lineWidth = 1;
    for (const l of lanes) {
      const a = byId[l.a_id], b = byId[l.b_id];
      if (!a || !b) continue;
      const [ax, ay] = this.toScreen(a.x, a.y), [bx, by] = this.toScreen(b.x, b.y);
      const own = a.faction && a.faction === b.faction;
      ctx.strokeStyle = this.hotLane === l.id ? '#ff8a7a' : own ? withAlpha(solid(factions[a.faction]?.color), 0.45) : 'rgba(233,185,73,0.16)';
      ctx.lineWidth = this.hotLane === l.id ? 2.5 : 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
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
      if (owner && !st.dim) {
        ctx.fillStyle = withAlpha(solid(owner.color), 0.22);
        ctx.beginPath(); ctx.arc(x, y, size + 5, 0, 7); ctx.fill();
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
    }
  }

  /** Новые данные карты: ячейки секторов пересчитаются. */
  setData(d) { this.data = d; this.cells = null; this.draw(); }
  setMouse(e) { const r = this.cv.getBoundingClientRect(); this.mouse = [e.clientX - r.left, e.clientY - r.top]; }
  destroy() { this.ro.disconnect(); clearInterval(this.anim); this.anim = 0; }
}

function withAlpha(color, a) {
  const m = String(color).match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(',').map((x) => parseFloat(x)); return `rgba(${r},${g},${b},${a})`; }
  if (/^#[0-9a-f]{6}$/i.test(color)) { const n = parseInt(color.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  return color;
}
