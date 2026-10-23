import { drawBody, groupOf, isGiant, seeded, hexA, BODY_COLOR } from '../lib/bodies.js';

/**
 * Вид системы: звезда в центре, планеты на орбитах. Тела вращаются вокруг своей
 * оси (арты из «Небесных тел»), планеты медленно идут по орбитам, пояса — кольца
 * из вращающихся астероидов. Анимация идёт, только пока холст виден на экране.
 *   new SystemView(canvas, system, bodiesCfg, { onHover(planet|null) })
 */
export class SystemView {
  constructor(canvas, system, cfg, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.s = system; this.cfg = cfg || {}; this.o = opts;
    this.calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t0 = performance.now(); this.visible = true; this.hot = null;
    this.layout();
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.loop(); });
    this.io.observe(canvas);
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', () => { this.hot = null; this.o.onHover?.(null); });
    this.redraw = () => { if (this.calm || !this.visible) this.draw(this.calm ? 0 : (performance.now() - this.t0) / 1000); };
    this.loop();
  }

  layout() {
    const ps = (this.s.planets || []).filter((p) => !(p.star && p.star !== 'A'));
    const sorted = [...ps].sort((a, b) => (a.dist ?? 9) - (b.dist ?? 9));
    const n = sorted.length || 1;
    this.bodies = sorted.map((p, i) => {
      const g = groupOf(p);
      return {
        p, g, ring: (i + 1) / (n + 0.6),                // доля радиуса орбиты
        a0: seeded(p.name || String(i), 9) * 6.283,     // стартовый угол
        size: g === 'belt' ? 0 : isGiant(g) ? 1.6 : g === 'micro' ? 0.6 : 1,
        moons: Math.min(3, p.moons || 0), rings: !!p.rings || (isGiant(g) && seeded(p.name || '', 11) > 0.6),
      };
    });
  }

  hover(e) {
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 14;
    for (const b of this.bodies) { if (!b.xy) continue; const d = Math.hypot(mx - b.xy[0], my - b.xy[1]); if (d < Math.max(bd, b.rr + 4)) { bd = d; best = b; } }
    if (best !== this.hot) { this.hot = best; this.o.onHover?.(best?.p || null); this.redraw(); }
  }

  loop() {
    if (this.raf || this.dead) return;
    let last = 0;
    const tick = (now) => {
      this.raf = 0;
      if (this.dead || !this.visible || document.hidden) return;
      if (now - last > 30) { last = now; this.draw((now - this.t0) / 1000); }   // ~30 кадров/с хватает
      if (!this.calm) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  draw(t) {
    const cv = this.cv, ctx = this.ctx, dpr = devicePixelRatio || 1;
    const rc = cv.getBoundingClientRect();
    if (!rc.width) return;
    if (cv.width !== Math.round(rc.width * dpr)) { cv.width = Math.round(rc.width * dpr); cv.height = Math.round(rc.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rc.width, rc.height);
    const cx = rc.width / 2, cy = rc.height / 2, R = Math.min(cx, cy) - 14;
    const flat = 0.62; // орбиты чуть наклонены к зрителю
    const starSlot = `star:${this.s.star_type || 'yellow'}`;
    const starR = Math.max(10, R * (this.s.is_giant ? 0.16 : 0.12));

    // орбиты
    ctx.lineWidth = 1;
    for (const b of this.bodies) {
      const or = starR + 10 + b.ring * (R - starR - 10);
      ctx.strokeStyle = b === this.hot ? 'rgba(233,185,73,0.55)' : 'rgba(233,185,73,0.12)';
      ctx.setLineDash(b.g === 'belt' ? [2, 4] : []);
      ctx.beginPath(); ctx.ellipse(cx, cy, or, or * flat, 0, 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]);

    // тела позади звезды рисуем до неё, впереди — после
    const pos = this.bodies.map((b) => {
      const or = starR + 10 + b.ring * (R - starR - 10);
      const a = b.a0 + t * 0.12 / Math.sqrt(0.3 + b.ring);
      return { b, or, a, x: cx + Math.cos(a) * or, y: cy + Math.sin(a) * or * flat };
    });
    const back = pos.filter((q) => Math.sin(q.a) < 0), front = pos.filter((q) => Math.sin(q.a) >= 0);
    back.forEach((q) => this.body(q, t, cx, cy));
    drawBody(ctx, cx, cy, starR, starSlot, this.cfg[starSlot], t, this.s.name || '', { onload: this.redraw });
    front.forEach((q) => this.body(q, t, cx, cy));
  }

  body({ b, or, a, x, y }, t, cx, cy) {
    const ctx = this.ctx;
    if (b.g === 'belt') {
      // пояс: россыпь астероидов по всей орбите
      const n = 26, cfg = this.cfg.belt;
      for (let i = 0; i < n; i++) {
        const k = seeded(b.p.name || 'belt', i);
        const aa = a + (i / n) * 6.283 + k * 0.2;
        const jr = or + (k - 0.5) * 8;
        const ax = cx + Math.cos(aa) * jr, ay = cy + Math.sin(aa) * jr * 0.62;
        drawBody(ctx, ax, ay, 1.6 + k * 2.4, 'belt', cfg, t * (0.6 + k), `${b.p.name}-${i}`, { onload: this.redraw });
      }
      b.xy = null; b.rr = 0;
      return;
    }
    const R = Math.min(this.cv.clientWidth, this.cv.clientHeight) / 2;
    const rr = Math.max(3.5, R * 0.06 * b.size);
    const dx = cx - x, dy = cy - y, dl = Math.hypot(dx, dy) || 1;
    if (b.rings) {
      ctx.strokeStyle = hexA(BODY_COLOR[b.g] || '#ccc', 0.5); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(x, y, rr * 1.9, rr * 0.55, -0.35, 0, 7); ctx.stroke();
    }
    drawBody(ctx, x, y, rr, b.g, this.cfg[b.g], t, b.p.name || '', { light: [dx / dl, dy / dl], onload: this.redraw });
    for (let m = 0; m < b.moons; m++) {
      const ma = t * (0.9 + m * 0.4) + m * 2.1, md = rr + 5 + m * 3.5;
      drawBody(ctx, x + Math.cos(ma) * md, y + Math.sin(ma) * md * 0.7, 1.4, 'moon', this.cfg.moon, t, `${b.p.name}-m${m}`, { light: [dx / dl, dy / dl] });
    }
    if (b === this.hot) { ctx.strokeStyle = '#e9b949'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, rr + 4, 0, 7); ctx.stroke(); }
    b.xy = [x, y]; b.rr = rr;
  }

  destroy() { this.dead = true; cancelAnimationFrame(this.raf); this.io.disconnect(); }
}
