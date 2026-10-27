/**
 * 3D-вид наземного сражения: рельеф по клеткам карты (горы, холмы, вода, лава,
 * пропасти), леса, постройки, колония; небо и свет — по среде планеты и звезде системы.
 * У газового гиганта — металлические платформы над морем облаков.
 * Модели техники и авиации — из «3D-моделей» (тип «Наземная техника» / «Авиация»,
 * подбор по полю «Класс»), иначе — заготовки. Нос модели в Blender — по оси +X.
 */
import { lib } from './battle-3d.js';
import { STAR } from './battle-map.js';
import { BIOMES, cloudColors } from './ground-map.js';
import { center, cellOf, visibleCellsGround, edgeNeighbors, SQ3 } from '../lib/hexmap.js';
import { sb } from '../lib/supabase.js';

const HGT = { '.': 0.05, F: 0.12, R: 0.22, h: 1.0, M: 2.5, W: -0.8, w: -0.3, L: -0.28, X: -4.5, S: 0.06, C: 0.1, r: 0.03 };
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash2 = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function noise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

let MODELS = null;
async function models() {
  MODELS ||= (async () => {
    const out = {};
    try {
      const { data } = await sb.from('v1_models').select('kind,class,url').in('kind', ['ground', 'air']);
      for (const m of data || []) if (m.class && m.url) out[m.class.trim().toLowerCase()] ||= m.url;
    } catch { /* модели не обязательны */ }
    return out;
  })();
  return MODELS;
}

export class Ground3D {
  constructor(host) { this.host = host; this.o = { fog: null, units: [], autoRotate: false }; this.anim = []; this.gltf = new Map(); }

  async init() {
    const L = await lib(); this.L = L; const { THREE } = L; this.THREE = THREE;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    this.host.appendChild(r.domElement); this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1500);
    this.controls = new L.OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 5, maxDistance: 80, maxPolarAngle: Math.PI * 0.47, rotateSpeed: 0.7 });
    this.ray = new THREE.Raycaster(); this.clock = new THREE.Clock();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.host); this.resize();
    const loop = () => {
      if (!this.host.isConnected) { this.dispose(); return; }
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
      this.controls.autoRotate = this.o.autoRotate; this.controls.update();
      for (const f of this.anim) f(dt, t);
      r.render(this.scene, this.camera);
    };
    loop();
    r.domElement.addEventListener('pointermove', (e) => this.onPointer(e));
    r.domElement.addEventListener('pointerleave', () => { this.setHover(null); this.onHover?.(null); });
  }
  resize() {
    if (!this.renderer) return;
    const w = Math.max(300, this.host.clientWidth), h = Math.round(Math.min(760, Math.max(380, w * 0.6)));
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  dispose() { cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.clear(); this.renderer?.dispose(); this.renderer?.domElement.remove(); }
  clear() {
    if (!this.scene) return;
    this.scene.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) { m.map?.dispose?.(); m.dispose?.(); } });
    this.scene.clear(); this.anim = []; this.dyn = null;
  }

  pos(x, y) { const [ux, uz] = center(x, y); return [ux - this.cx0, uz - this.cz0]; }
  /** Высота рельефа в точке (единицы поля): взвешенно по ближним клеткам + шум гор. */
  heightAt(ux, uz) {
    const m = this.map, gx = Math.round(ux / 1.5);
    let sw = 0, sh = 0, near = null, nd = Infinity;
    for (let x = gx - 2; x <= gx + 2; x++) {
      const cx = Math.max(0, Math.min(m.w - 1, x));
      const gy = Math.round(uz / SQ3 - 0.5 * (cx & 1));
      for (let y = gy - 2; y <= gy + 2; y++) {
        const cy = Math.max(0, Math.min(m.h - 1, y));
        const [px, pz] = center(cx, cy), d = Math.hypot(px - ux, pz - uz);
        if (d < nd) { nd = d; near = cellOf(m, cx, cy); }
        const wgt = Math.max(0, 1.7 - d) ** 2; if (!wgt) continue;
        sw += wgt; sh += wgt * HGT[cellOf(m, cx, cy)];
      }
    }
    let hgt = sw ? sh / sw : 0;
    if (near === 'M') hgt += noise(ux * 1.3, uz * 1.3, 3) * 1.3;
    else if (near === 'h') hgt += noise(ux * 1.1, uz * 1.1, 5) * 0.3;
    else if (near !== 'W' && near !== 'X') hgt += (noise(ux * 0.7, uz * 0.7, 7) - 0.5) * 0.12;
    // за краем поля — подъём рельефа: поле в чаше
    const ox = Math.max(0, -ux - 0.5, ux - 1.5 * (m.w - 1) - 0.5), oz = Math.max(0, -uz - 0.5, uz - SQ3 * (m.h - 0.5) - 0.5);
    const out = Math.hypot(ox, oz);
    if (out > 0) hgt = Math.max(hgt, 0) + out * 0.28 + noise(ux * 0.5, uz * 0.5, 9) * out * 0.35;
    return { h: hgt, near };
  }
  cellHeight(x, y) {
    if (this.flat) return cellOf(this.map, x, y) === 'X' ? -9 : 0;
    const [ux, uz] = center(x, y); return this.heightAt(ux, uz).h;
  }

  async setMap(map, opts = {}) {
    if (!this.renderer) await this.init();
    Object.assign(this.o, opts);
    this.map = map; this.clear();
    const { THREE } = this, m = map, scene = this.scene, B = BIOMES[m.biome] || BIOMES.barren;
    this.B = B; this.flat = !!B.clouds;
    this.cx0 = 1.5 * (m.w - 1) / 2; this.cz0 = SQ3 * (m.h - 0.5) / 2;
    const rnd = prng(m.seed * 7121 + m.w), P = STAR[m.system?.star] || STAR.yellow;

    // ── небо, туман, свет ──
    const sky = B.sky, airless = m.biome === 'barren';
    {
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
      const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, css(sky.map((v) => Math.round(v * (airless ? 1 : 0.55))))); gr.addColorStop(0.62, css(sky)); gr.addColorStop(1, css(sky.map((v) => Math.min(255, v + 25))));
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      scene.background = t;
      if (!airless) scene.fog = new THREE.Fog(new THREE.Color(css(sky)), 38, 120);
      if (airless) { // звёзды над безвоздушным миром
        const n = 1500, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const u = rnd() * 0.9 + 0.1, th = rnd() * Math.PI * 2, R = 600, s = Math.sqrt(1 - u * u); pos.set([R * s * Math.cos(th), R * u, R * s * Math.sin(th)], i * 3); }
        const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        scene.add(new THREE.Points(g2, new THREE.PointsMaterial({ color: 0xf3ecdc, size: 1.5, sizeAttenuation: false })));
      }
    }
    const sunDir = new THREE.Vector3(-0.5 + rnd() * 0.3, 0.75, -0.45).normalize();
    const sun = new THREE.DirectionalLight(new THREE.Color(css(P.light)), 2.4); sun.position.copy(sunDir).multiplyScalar(100); scene.add(sun);
    scene.add(new THREE.HemisphereLight(new THREE.Color(css(sky)), new THREE.Color(B.ground[0]), 0.6));
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));
    { // солнце на небе
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.15, css(P.glow, 0.9)); gr.addColorStop(0.45, css(P.glow, 0.2)); gr.addColorStop(1, css(P.glow, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      sp.position.copy(sunDir).multiplyScalar(400); sp.scale.setScalar(airless ? 50 : 110); scene.add(sp);
    }

    if (B.clouds) this.buildPlatforms(rnd); else this.buildTerrain(rnd);
    this.buildDetails(rnd);
    this.buildDynamic();
    if (!this.placed) { this.camera.position.set(-(this.cx0 + 12), 15, 12); this.controls.target.set(0, 0, 0); this.placed = true; }
  }

  set(o) { Object.assign(this.o, o); if (this.map && ('fog' in o || 'units' in o)) this.buildDynamic(); }
  showGrid(on) { if (this.gridLines) this.gridLines.visible = on; }

  // ── рельеф ──
  buildTerrain(rnd) {
    const { THREE } = this, m = this.map, B = this.B, margin = 14;
    const Wd = 1.5 * (m.w - 1) + margin * 2, Dp = SQ3 * (m.h - 0.5) + margin * 2;
    const geo = new THREE.PlaneGeometry(Wd, Dp, Math.round(Wd * 3.2), Math.round(Dp * 3.2));
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const C = {
      '.': rgb(B.ground[1]), F: rgb(B.F), R: rgb(B.R), h: rgb(B.h), M: rgb(B.M[0]), W: rgb(B.ground[0]), w: rgb(B.ground[0]),
      L: rgb((B.L || ['#3a1a10'])[0]), X: rgb(B.X), S: rgb(B.ground[0]), C: rgb(B.ground[0]), r: rgb(B.road),
    };
    const g0 = rgb(B.ground[0]), mtTop = rgb(B.M[1]), snow = B.peak === 'snow' || B.peak === 'spire';
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i) + this.cx0, uz = p.getZ(i) + this.cz0;
      const { h, near } = this.heightAt(ux, uz);
      p.setY(i, h);
      let c = [...(C[near] || g0)];
      const k = noise(ux * 0.9, uz * 0.9, 11) * 0.25;
      c = c.map((v, j) => v * (0.88 + k) + g0[j] * 0.06);
      if (h > 1.4) { const t = Math.min(1, (h - 1.4) / 1.6); c = c.map((v, j) => v + (mtTop[j] - v) * t); }
      if (snow && h > 2.9) c = [0.93, 0.95, 0.97];
      if (near === 'X') c = c.map((v) => v * 0.25);
      col.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 }));
    this.scene.add(this.terrain);

    // вода и лава — плоскости над впадинами
    const hexGeo = () => { const g = new THREE.CircleGeometry(1.08, 6); g.rotateX(-Math.PI / 2); return g; };
    const place = (list, mat, y) => {
      if (!list.length) return null;
      const inst = new THREE.InstancedMesh(hexGeo(), mat, list.length), mt = new THREE.Matrix4();
      list.forEach(([x, yy], i) => { const [px, pz] = this.pos(x, yy); mt.makeTranslation(px, y, pz); inst.setMatrixAt(i, mt); });
      this.scene.add(inst); return inst;
    };
    place([...this.cells('W'), ...this.cells('w')], new THREE.MeshStandardMaterial({ color: new THREE.Color(B.W[1]), transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.2 }), -0.16);
    if (B.L) {
      const lava = place(this.cells('L'), new THREE.MeshBasicMaterial({ color: new THREE.Color(B.L[0]) }), -0.1);
      if (lava) this.anim.push((dt, t) => { lava.material.color.set(B.L[0]).lerp(new THREE.Color(B.L[1]), 0.35 + Math.sin(t * 1.7) * 0.25); });
    }
    this.pickables = [this.terrain];
    this.buildGrid((x, y) => this.cellHeight(x, y) + 0.04);
  }

  /** Газовый гигант: платформы-шестигранники над облаками. */
  buildPlatforms(rnd) {
    const { THREE } = this, m = this.map, B = this.B, cc = cloudColors(m.body?.type);
    // море облаков
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'); g.fillStyle = css(cc[1]); g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 10 + rnd() * 60, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, css(cc[rnd() < 0.5 ? 0 : 2], 0.6)); gr.addColorStop(1, css(cc[0], 0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 2, r * 0.7, 0, 0, 7); g.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -9; this.scene.add(sea);
    this.anim.push((dt) => { t.offset.x += dt * 0.004; t.offset.y += dt * 0.002; });
    this.scene.fog = new THREE.Fog(new THREE.Color(css(cc[2])), 24, 95);
    { // небо над облаками — в цветах гиганта
      const sk = document.createElement('canvas'); sk.width = 4; sk.height = 256;
      const sg = sk.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, css(cc[1].map((v) => Math.round(v * 0.55)))); gr.addColorStop(0.7, css(cc[2])); gr.addColorStop(1, css(cc[2]));
      sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256);
      const st = new THREE.CanvasTexture(sk); st.colorSpace = THREE.SRGBColorSpace; this.scene.background = st;
    }
    // платформы
    const tiles = [], bridges = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const c = cellOf(m, x, y); if (c === 'X') continue; (c === 'r' ? bridges : tiles).push([x, y]); }
    const mk = (list, r, hgt, color) => {
      if (!list.length) return null;
      const geo = new THREE.CylinderGeometry(r, r * 0.92, hgt, 6, 1, false, Math.PI / 6);
      const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.2, roughness: 0.6 }), list.length);
      const mt = new THREE.Matrix4();
      list.forEach(([x, y], i) => { const [px, pz] = this.pos(x, y); mt.makeTranslation(px, -hgt / 2, pz); inst.setMatrixAt(i, mt); });
      this.scene.add(inst); return inst;
    };
    const a = mk(tiles, 0.99, 0.5, B.ground[1]), b = mk(bridges, 0.8, 0.16, B.road);
    // опоры платформ уходят в облака
    if (tiles.length) {
      const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.7, roughness: 0.5 }), tiles.length);
      const mt = new THREE.Matrix4();
      tiles.forEach(([x, y], i) => { const [px, pz] = this.pos(x, y); mt.makeTranslation(px, -4.4, pz); legs.setMatrixAt(i, mt); });
      this.scene.add(legs);
    }
    this.pickables = [a, b].filter(Boolean);
    this.buildGrid(() => 0.02);
  }

  cells(t) { const m = this.map, out = []; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (cellOf(m, x, y) === t) out.push([x, y]); return out; }

  // ── леса, камни, постройки, колония, дороги ──
  buildDetails(rnd) {
    const { THREE } = this, B = this.B, scene = this.scene, m = this.map;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), mt = new THREE.Matrix4();
    const scatter = (list, per, geo, mat, scale, yoff = 0, spread = 0.75) => {
      const pts = [];
      for (const [x, y] of list) {
        const [px, pz] = this.pos(x, y);
        for (let k = 0; k < per; k++) {
          const a = rnd() * 6.28, d = Math.sqrt(rnd()) * spread, wx = px + Math.cos(a) * d, wz = pz + Math.sin(a) * d;
          const h = B.clouds ? 0 : this.heightAt(wx + this.cx0, wz + this.cz0).h;
          pts.push([wx, h + yoff, wz, scale[0] + rnd() * (scale[1] - scale[0]), rnd() * 6]);
        }
      }
      if (!pts.length) return;
      const inst = new THREE.InstancedMesh(geo, mat, pts.length);
      pts.forEach(([x, y, z, s, r], i) => { e.set(0, r, 0); q.setFromEuler(e); inst.setMatrixAt(i, mt.compose(v.set(x, y + s * 0.5, z), q, sc.set(s, s, s))); });
      scene.add(inst);
    };
    // укрытия по облику среды
    const F = this.cells('F');
    if (B.tree === 'crystal') {
      scatter(F, 5, new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: new THREE.Color(B.F), emissive: new THREE.Color(B.F), emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.3, flatShading: true }), [0.8, 1.6]);
    } else if (B.tree === 'dead' || B.tree === 'rock') {
      scatter(F, 6, new THREE.CylinderGeometry(0.02, 0.05, 0.6, 5), new THREE.MeshStandardMaterial({ color: new THREE.Color(B.F), roughness: 1 }), [0.7, 1.3]);
    } else {
      const g = new THREE.ConeGeometry(0.2, B.tree === 'palm' ? 0.45 : 0.75, 7);
      scatter(F, 6, g, new THREE.MeshStandardMaterial({ color: new THREE.Color(B.F), roughness: 0.9, flatShading: true }), [0.7, 1.25]);
    }
    // камни на неровностях
    const rock = new THREE.IcosahedronGeometry(0.12, 0);
    scatter(this.cells('R'), 3, rock, new THREE.MeshStandardMaterial({ color: new THREE.Color(B.M[1]), roughness: 1, flatShading: true }), [0.6, 1.4], -0.03);
    // постройки
    const S = this.cells('S');
    if (S.length) {
      const pts = [];
      for (const [x, y] of S) {
        const [px, pz] = this.pos(x, y), base = this.cellHeight(x, y);
        for (let k = 0; k < 3; k++) pts.push([px + (rnd() - 0.5) * 1.1, base, pz + (rnd() - 0.5) * 1.0, 0.25 + rnd() * 0.3, 0.2 + rnd() * (m.biome === 'ruins' ? 0.9 : 0.7), rnd() * 3]);
      }
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(B.S), roughness: 0.7, metalness: 0.25 }), pts.length);
      pts.forEach(([x, y, z, w, h, r], i) => { e.set(0, r, 0); q.setFromEuler(e); inst.setMatrixAt(i, mt.compose(v.set(x, y + h / 2, z), q, sc.set(w, h, w * 0.8))); });
      scene.add(inst);
    }
    // сердце колонии: башня, купол, маяк
    for (const [x, y] of this.cells('C')) {
      const [px, pz] = this.pos(x, y), base = this.cellHeight(x, y);
      const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(B.S), metalness: 0.5, roughness: 0.4 });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.8, 8), metal); tower.position.set(px, base + 0.9, pz); scene.add(tower);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe9b949, metalness: 0.6, roughness: 0.3, transparent: true, opacity: 0.85 }));
      dome.position.set(px + 0.4, base, pz + 0.2); scene.add(dome);
      const light = new THREE.PointLight(0xe9b949, 6, 8); light.position.set(px, base + 2, pz); scene.add(light);
      const bc = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd36a })); bc.position.set(px, base + 1.9, pz); scene.add(bc);
      this.anim.push((dt, t) => { light.intensity = 4 + Math.sin(t * 3) * 2.5; });
    }
    // дороги и мосты
    const segs = [];
    for (const [x, y] of this.cells('r')) {
      const [px, pz] = this.pos(x, y), h0 = Math.max(this.cellHeight(x, y), B.clouds ? 0 : -0.05);
      for (const [nx, ny] of edgeNeighbors(x, y)) {
        const n = cellOf(m, nx, ny); if (!n || !'rCS'.includes(n)) continue;
        const [qx, qz] = this.pos(nx, ny);
        segs.push([px, pz, (px + qx) / 2, (pz + qz) / 2, h0]);
      }
    }
    if (segs.length && !B.clouds) {
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 0.36), new THREE.MeshStandardMaterial({ color: new THREE.Color(B.road), roughness: 0.9 }), segs.length);
      segs.forEach(([x0, z0, x1, z1, h], i) => {
        const len = Math.hypot(x1 - x0, z1 - z0) + 0.2; e.set(0, -Math.atan2(z1 - z0, x1 - x0), 0); q.setFromEuler(e);
        inst.setMatrixAt(i, mt.compose(v.set((x0 + x1) / 2, h + 0.05, (z0 + z1) / 2), q, sc.set(len, 1, 1)));
      });
      scene.add(inst);
    }
  }

  buildGrid(hAt) {
    const { THREE } = this, m = this.map, pts = [], zone = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = cellOf(m, x, y); if (this.B.clouds && t === 'X') continue;
      const [cx, cz] = this.pos(x, y), hh = hAt(x, y), nb = edgeNeighbors(x, y);
      for (let k = 0; k < 6; k++) {
        const a0 = Math.PI / 3 * k, a1 = Math.PI / 3 * (k + 1), n = cellOf(m, nb[k][0], nb[k][1]);
        const seg = [cx + Math.cos(a0), hh, cz + Math.sin(a0), cx + Math.cos(a1), hh, cz + Math.sin(a1)];
        if (k < 3 || n === null) pts.push(...seg);
        if (t === 'M' && n !== 'M' && n !== null) zone.push(...seg);
      }
    }
    const lines = (p, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return new THREE.LineSegments(g, mat); };
    this.gridLines = lines(pts, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    this.scene.add(this.gridLines);
    if (zone.length) this.scene.add(lines(zone, new THREE.LineBasicMaterial({ color: 0xe9b949, transparent: true, opacity: 0.75 })));
    // зоны высадки и обороны
    for (const [[x0, x1], col] of [[m.landing, 0xe9b949], [m.defend, 0xde6c5c]]) {
      const list = [];
      for (let x = x0; x <= x1; x++) for (let y = 0; y < m.h; y++) if (!'XWLM'.includes(cellOf(m, x, y))) list.push([x, y]);
      const g = new THREE.CircleGeometry(0.96, 6); g.rotateX(-Math.PI / 2);
      const inst = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.08, depthWrite: false }), list.length);
      const mt = new THREE.Matrix4();
      list.forEach(([x, y], i) => { const [px, pz] = this.pos(x, y); mt.makeTranslation(px, hAt(x, y) + 0.02, pz); inst.setMatrixAt(i, mt); });
      this.scene.add(inst);
    }
    const hp = []; for (let k = 0; k <= 6; k++) hp.push(Math.cos(Math.PI / 3 * k) * 0.94, 0.06, Math.sin(Math.PI / 3 * k) * 0.94);
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    this.hover = new THREE.Line(hg, new THREE.LineBasicMaterial({ color: 0xf3ecdc, depthTest: false })); this.hover.visible = false; this.scene.add(this.hover);
    this.hAt = hAt;
  }

  // ── туман войны и отряды ──
  buildDynamic() {
    const { THREE } = this, scene = this.scene, m = this.map;
    if (this.dyn) { scene.remove(this.dyn); this.dyn.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    const dyn = new THREE.Group(); this.dyn = dyn; scene.add(dyn);
    this.anim = this.anim.filter((f) => !f.dyn);
    const fog = this.o.fog, vis = fog ? visibleCellsGround(m, this.o.units, fog) : null;
    if (vis) {
      const hidden = [];
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (!vis.has(`${x},${y}`) && !(this.B.clouds && cellOf(m, x, y) === 'X')) hidden.push([x, y]);
      if (hidden.length) {
        const g = new THREE.CircleGeometry(1.0, 6); g.rotateX(-Math.PI / 2);
        const inst = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }), hidden.length);
        const mt = new THREE.Matrix4();
        hidden.forEach(([x, y], i) => { const [px, pz] = this.pos(x, y); mt.makeTranslation(px, Math.max(this.hAt(x, y), -0.1) + 0.12, pz); inst.setMatrixAt(i, mt); });
        dyn.add(inst);
      }
    }
    for (const u of this.o.units) {
      if (vis && u.side !== fog && !vis.has(`${u.x},${u.y}`)) continue; // необнаруженного нет в сцене
      this.addUnit(u, dyn);
    }
  }

  async addUnit(u, parent) {
    const { THREE } = this, [px, pz] = this.pos(u.x, u.y), base = Math.max(this.hAt(u.x, u.y), -0.1);
    const col = u.side === 'a' ? 0xe9b949 : 0xe86858, grp = new THREE.Group();
    const lift = u.air ? 2.8 : 0.02;
    grp.position.set(px, base + lift, pz); parent.add(grp);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.82, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(px, base + 0.08, pz); parent.add(ring);
    if (u.label) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
      const g = cv.getContext('2d'); g.font = '700 30px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#f3ecdc'; g.shadowColor = '#000'; g.shadowBlur = 8; g.fillText(u.label, 128, 42);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
      sp.scale.set(2.2, 0.55, 1); sp.position.set(px, base + lift + 1.0, pz); parent.add(sp);
    }
    const len = { inf: 0.7, tank: 1.0, art: 1.0, aa: 0.9, air: 1.2 }[u.type] || 1;
    const url = u.cls ? (await models())[u.cls.toLowerCase()] : null;
    let body = url ? await this.loadModel(url, len).catch(() => null) : null;
    if (!body) body = this.stub(u.type, col);
    if (u.side === 'b') body.rotation.y = Math.PI;
    grp.add(body);
    if (u.air) {
      const ph = Math.random() * 6;
      const f = (dt, t) => { grp.position.y = base + lift + Math.sin(t * 1.4 + ph) * 0.12; grp.rotation.z = Math.sin(t * 0.9 + ph) * 0.06; };
      f.dyn = true; this.anim.push(f);
    }
  }

  async loadModel(url, len) {
    const { THREE, GLTFLoader, DRACOLoader } = this.L;
    if (!this.gltf.has(url)) {
      const loader = new GLTFLoader(), draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loader.setDRACOLoader(draco);
      this.gltf.set(url, loader.loadAsync(url));
    }
    const obj = (await this.gltf.get(url)).scene.clone(true);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    obj.position.sub(mid); obj.position.y += size.y / 2;
    const wrap = new THREE.Group(); wrap.add(obj); wrap.scale.setScalar(len / Math.max(size.x, size.y, size.z, 1e-6));
    return wrap;
  }

  /** Заготовки: пехота, танк, артиллерия, ПВО, самолёт. Нос — по +X. */
  stub(type, col) {
    const { THREE } = this, g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x6d6a5e, roughness: 0.55, metalness: 0.55, flatShading: true });
    const mark = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.3, emissive: col, emissiveIntensity: 0.2 });
    const add = (geo, mat, x, y, z, rz = 0, ry = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.z = rz; o.rotation.y = ry; g.add(o); return o; };
    if (type === 'inf') {
      for (const [x, z] of [[0, 0], [-0.22, 0.18], [-0.22, -0.18], [0.2, 0.22]]) { add(new THREE.CapsuleGeometry(0.06, 0.16, 3, 6), mark, x, 0.14, z); }
    } else if (type === 'air') {
      add(new THREE.ConeGeometry(0.14, 1.1, 6), metal, 0, 0, 0, -Math.PI / 2);
      add(new THREE.BoxGeometry(0.35, 0.03, 1.0), metal, -0.15, 0, 0);
      add(new THREE.BoxGeometry(0.22, 0.2, 0.03), mark, -0.4, 0.1, 0);
    } else {
      add(new THREE.BoxGeometry(0.75, 0.22, 0.46), metal, 0, 0.13, 0);
      add(new THREE.BoxGeometry(0.8, 0.1, 0.12), metal, 0, 0.06, 0.24); add(new THREE.BoxGeometry(0.8, 0.1, 0.12), metal, 0, 0.06, -0.24);
      add(new THREE.BoxGeometry(0.32, 0.14, 0.3), mark, -0.05, 0.31, 0);
      if (type === 'tank') add(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), metal, 0.35, 0.32, 0, -Math.PI / 2);
      if (type === 'art') add(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 6), metal, 0.3, 0.55, 0, -Math.PI / 3.2);
      if (type === 'aa') for (const z of [-0.06, 0.06]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), metal, 0.05, 0.6, z, -0.25);
    }
    return g;
  }

  onPointer(e) {
    if (!this.map || !this.pickables?.length) return;
    const { THREE } = this, rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.pickables, false)[0];
    if (!hit) { this.setHover(null); this.onHover?.(null); return; }
    const ux = hit.point.x + this.cx0, uz = hit.point.z + this.cz0, m = this.map, gx = Math.round(ux / 1.5);
    let best = null, bd = Infinity;
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (x < 0 || x >= m.w) continue;
      const gy = Math.round(uz / SQ3 - 0.5 * (x & 1));
      for (let y = gy - 1; y <= gy + 1; y++) {
        if (y < 0 || y >= m.h) continue;
        const [cx, cz] = center(x, y), d = (cx - ux) ** 2 + (cz - uz) ** 2;
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    if (bd > 1.1) best = null;
    this.setHover(best); this.onHover?.(best, e.clientX - rect.left, e.clientY - rect.top);
  }
  setHover(c) {
    if (!this.hover) return;
    this.hover.visible = !!c;
    if (c) { const [px, pz] = this.pos(c[0], c[1]); this.hover.position.set(px, Math.max(this.hAt(c[0], c[1]), -0.1), pz); }
  }
}
