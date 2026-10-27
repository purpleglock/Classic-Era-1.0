/**
 * 3D-вид поля боя: та же карта, что и в 2D, но объёмная — её можно вращать на 360°.
 *
 * Откуда берутся модели и тела:
 *   • корабли — «3D-модели» в админ-панели (v1_models, .glb из Blender). Модель
 *     подбирается по классу отряда (поле «Класс»: Корвет, Эсминец, Линкор…).
 *     Нос корабля в Blender — по оси +X. Пока модели нет, рисуется заготовка.
 *   • звёзды и планеты — «Небесные тела» в админ-панели (v1_settings.bodies):
 *     «Поверхность» натягивается на шар, «Картинка» ставится плоским спрайтом.
 *     Пока арта нет, поверхность рисуется по типу планеты.
 *
 * three.js подгружается только при открытии 3D (importmap в index.html).
 */
import { STAR, planetLook } from './battle-map.js';
import { center, cellOf, visibleCells, edgeNeighbors, SQ3 } from '../lib/hexmap.js';
import { groupOf, loadBodies } from '../lib/bodies.js';
import { sb } from '../lib/supabase.js';

let LIB = null;
export function lib() {
  LIB ||= Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
  ]).then(([THREE, oc, gl, dr]) => ({ THREE, OrbitControls: oc.OrbitControls, GLTFLoader: gl.GLTFLoader, DRACOLoader: dr.DRACOLoader }));
  return LIB;
}

let MODELS = null;
/** Модели кораблей и авиации по классу: { 'корвет': url, … }. */
async function shipModels() {
  MODELS ||= (async () => {
    const out = {};
    try {
      const { data } = await sb.from('v1_models').select('kind,class,url').in('kind', ['ship', 'air']);
      for (const m of data || []) if (m.class && m.url) out[m.class.trim().toLowerCase()] ||= m.url;
    } catch { /* модели не обязательны */ }
    return out;
  })();
  return MODELS;
}

function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export class Battle3D {
  constructor(host) {
    this.host = host;
    this.o = { fog: null, units: [], autoRotate: false };
    this.anim = [];
    this.gltf = new Map();
  }

  async init() {
    const L = await lib();
    this.L = L;
    const { THREE } = L;
    this.THREE = THREE;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.host.appendChild(r.domElement);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    this.controls = new L.OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 8, maxDistance: 150, maxPolarAngle: Math.PI * 0.94, rotateSpeed: 0.7 });
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.clock = new THREE.Clock();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.resize();
    const loop = () => {
      if (!this.host.isConnected) { this.dispose(); return; }
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
      this.controls.autoRotate = this.o.autoRotate;
      this.controls.update();
      // камера не залетает внутрь планеты
      if (this.solid) {
        const c = this.camera.position, d = c.distanceTo(this.solid.c);
        if (d < this.solid.r) c.sub(this.solid.c).setLength(this.solid.r).add(this.solid.c);
      }
      for (const f of this.anim) f(dt, t);
      r.render(this.scene, this.camera);
    };
    loop();
    // наведение на клетку
    r.domElement.addEventListener('pointermove', (e) => this.onPointer(e));
    r.domElement.addEventListener('pointerleave', () => { this.setHover(null); this.onHover?.(null); });
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(300, this.host.clientWidth), h = Math.round(Math.min(760, Math.max(380, w * 0.6)));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.clear();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  clear() {
    const { scene } = this;
    if (!scene) return;
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { m.map?.dispose?.(); m.dispose?.(); }
    });
    scene.clear();
    this.anim = [];
    this.dyn = null;
  }

  // координаты клетки в мире: поле лежит в плоскости XZ, центр поля — в нуле
  pos(x, y) { const [ux, uy] = center(x, y); return [ux - this.cx0, uy - this.cz0]; }

  async setMap(map, opts = {}) {
    if (!this.renderer) await this.init();
    Object.assign(this.o, opts);
    this.map = map;
    this.clear();
    this.solid = null;
    const { THREE } = this, m = map, scene = this.scene;
    const P = STAR[m.system?.star] || STAR.yellow;
    this.P = P;
    this.cx0 = 1.5 * (m.w - 1) / 2;
    this.cz0 = SQ3 * (m.h - 0.5) / 2;
    const rnd = prng(m.seed * 104729 + m.w);
    const bodies = await loadBodies().catch(() => ({}));
    this.bodies = bodies;

    // ── небо: цвет звезды, звёзды, дальняя дымка ──
    scene.background = new THREE.Color(`rgb(${P.tint.map((v) => Math.round(v * 0.9)).join(',')})`);
    {
      const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, R = 700, s = Math.sqrt(1 - u * u);
        pos.set([R * s * Math.cos(th), R * u, R * s * Math.sin(th)], i * 3);
        const b = 0.35 + rnd() * 0.65; col.set([b, b * 0.97, b * 0.9], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));
      const haze = this.glowTexture(P.neb);
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haze, color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
        const a = rnd() * Math.PI * 2, e = (rnd() - 0.3) * 0.8;
        s.position.set(Math.cos(a) * 500, Math.sin(e) * 300, Math.sin(a) * 500);
        s.scale.setScalar(260 + rnd() * 260);
        scene.add(s);
      }
    }

    // ── звезда и свет ──
    const sdir = m.star_edge === 'top' ? -1 : 1;
    const spos = new THREE.Vector3((rnd() - 0.5) * 60, 34, sdir * (this.cz0 + 140));
    {
      const art = bodies[`star:${m.system?.star}`]?.urls?.[0];
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(P.glow, 0.95), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.copy(spos); glow.scale.setScalar(150); scene.add(glow);
      if (art) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(art), transparent: true, depthWrite: false }));
        sp.position.copy(spos); sp.scale.setScalar(36); scene.add(sp);
        this.anim.push((dt) => { sp.material.rotation += dt * 0.02; });
      } else {
        const core = new THREE.Mesh(new THREE.SphereGeometry(11, 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(P.core) }));
        core.position.copy(spos); scene.add(core);
      }
      const sun = new THREE.DirectionalLight(new THREE.Color(css(P.light)), 2.6);
      sun.position.copy(spos); scene.add(sun);
      scene.add(new THREE.AmbientLight(new THREE.Color(css(P.glow)), 0.22));
      scene.add(new THREE.HemisphereLight(0x8890a0, 0x050403, 0.25));
      this.sunPos = spos;
    }

    // ── место боя: планета у края поля, гравитация, кольца ──
    if (m.planet) {
      const pr = m.planet.r, dep = m.planet.depth, top = m.edge === 'top';
      const pz = (top ? dep - pr : SQ3 * (m.h - 0.5) + pr - dep) - this.cz0;
      const planet = this.planet(m.site, pr, rnd);
      planet.position.set(0, -pr * 0.15, pz);
      scene.add(planet);
      this.solid = { c: planet.position.clone(), r: pr * 1.12 };
      if (m.site?.rings) scene.add(this.rings(pr + 4.6, pr + 6.4, planetLook(m.site.type), planet.position, rnd));
    } else if (m.backdrop) {
      // фоновая планета далеко за полем
      const br = 30 + rnd() * 14, p = this.planet(m.backdrop, br, rnd);
      p.position.set((this.o.fog === 'b' ? -1 : 1) * (this.cx0 + 120 + rnd() * 30), -32 - rnd() * 12, (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 26));
      this.solid = { c: p.position.clone(), r: br * 1.12 };
      scene.add(p);
      if (m.backdrop.rings) scene.add(this.rings(br * 1.35, br * 2, planetLook(m.backdrop.type), p.position, rnd, 0.35));
    }

    this.buildTerrain(rnd);
    this.buildGrid();
    this.buildDynamic();

    // камера: со стороны A, над полем
    if (!this.placed) {
      // камера за спиной своей стороны: свои ближе, противник впереди, планета сбоку
      const me = this.o.fog === 'b' ? 1 : -1;
      this.camera.position.set(me * (this.cx0 + 20), 24, 6);
      this.controls.target.set(0, 0, 0);
      this.placed = true;
    }
  }

  set(opts) {
    Object.assign(this.o, opts);
    if (this.map && ('fog' in opts || 'units' in opts)) this.buildDynamic();
  }

  // ── текстуры ──
  glowTexture(c, core = 0.6) {
    const { THREE } = this, cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, css([255, 255, 255], core)); gr.addColorStop(0.18, css(c, core * 0.75)); gr.addColorStop(0.5, css(c, 0.18)); gr.addColorStop(1, css(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  texture(url) {
    const { THREE } = this;
    const t = new THREE.TextureLoader().setCrossOrigin('anonymous').load(url);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  /** Поверхность планеты по её типу — пока команда не загрузила арт. */
  surface(type, rnd) {
    const { THREE } = this, look = planetLook(type), cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 512;
    const g = cv.getContext('2d'), W = 1024, H = 512;
    if (look.bands) {
      g.fillStyle = look.bands[0]; g.fillRect(0, 0, W, H);
      let y = 0;
      while (y < H) {
        const h = 6 + rnd() * 30;
        g.fillStyle = look.bands[Math.floor(rnd() * look.bands.length)];
        g.globalAlpha = 0.5 + rnd() * 0.5;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x / 70 + y) * h * 0.25);
        g.lineTo(W, y + h); g.lineTo(0, y + h); g.closePath(); g.fill();
        y += h * (0.7 + rnd() * 0.5);
      }
      g.globalAlpha = 0.6; g.fillStyle = look.storm;
      g.beginPath(); g.ellipse(W * (0.2 + rnd() * 0.6), H * (0.35 + rnd() * 0.3), 46, 18, 0, 0, 7); g.fill();
    } else {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, look.base[1]); bg.addColorStop(0.5, look.base[0]); bg.addColorStop(1, look.base[1]);
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 420; i++) {
        g.fillStyle = look.spots[i % look.spots.length];
        g.globalAlpha = look.glowSpots ? 0.25 + rnd() * 0.45 : 0.12 + rnd() * 0.25;
        const r = 4 + rnd() * 34;
        g.beginPath(); g.ellipse(rnd() * W, rnd() * H, r * 1.8, r, 0, 0, 7); g.fill();
      }
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  planet(body, r, rnd) {
    const { THREE } = this, look = planetLook(body?.type);
    const grp = new THREE.Group();
    const slot = this.bodies[groupOf(body)] || {};
    const art = slot.urls?.length ? slot.urls[Math.floor(rnd() * slot.urls.length)] : null;
    if (art && slot.mode === 'sprite') {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(art), transparent: true }));
      sp.scale.setScalar(r * 2.05); grp.add(sp);
      return grp;
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64),
      new THREE.MeshStandardMaterial({ map: art ? this.texture(art) : this.surface(body?.type, rnd), roughness: 0.92, metalness: 0 }));
    mesh.rotation.z = (rnd() - 0.5) * 0.4;
    grp.add(mesh);
    this.anim.push((dt) => { mesh.rotation.y += dt * 0.012 * (slot.speed ?? 1); });
    // атмосфера: свечение по краю
    const atm = new THREE.Mesh(new THREE.SphereGeometry(r * 1.035, 64, 32), new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(css(look.atm)) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(c, f * 0.9); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    }));
    grp.add(atm);
    return grp;
  }

  rings(r0, r1, look, at, rnd, tilt = 0) {
    const { THREE } = this, cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const g = cv.getContext('2d'), col = look.bands ? look.bands[2] : look.base[1];
    for (let r = (r0 / r1) * 512; r < 512; r += 1.5 + rnd() * 4) {
      g.strokeStyle = col; g.globalAlpha = 0.08 + rnd() * 0.35; g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); g.arc(512, 512, r, 0, 7); g.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 160, 1), new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
    mesh.rotation.x = -Math.PI / 2 + tilt;
    mesh.position.set(at.x, 0.02, at.z);
    return mesh;
  }

  // ── местность ──
  cells(t) { const m = this.map, out = []; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (cellOf(m, x, y) === t) out.push([x, y]); return out; }

  hexFill(list, color, opacity, y = 0.01, scale = 0.97) {
    const { THREE } = this;
    if (!list.length) return null;
    const geo = new THREE.CircleGeometry(scale, 6); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), list.length);
    const mt = new THREE.Matrix4();
    list.forEach(([x, y2], i) => { const [px, pz] = this.pos(x, y2); mt.makeTranslation(px, y, pz); mesh.setMatrixAt(i, mt); });
    return mesh;
  }

  /** Камни: икосаэдр с неровной поверхностью (одинаковый сдвиг для общих вершин — без щелей). */
  rockGeometry(rnd, detail = 1) {
    const { THREE } = this, geo = new THREE.IcosahedronGeometry(1, detail), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!seen.has(k)) seen.set(k, 0.72 + rnd() * 0.5);
      const f = seen.get(k);
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.8, p.getZ(i) * f);
    }
    geo.computeVertexNormals();
    return geo;
  }

  buildTerrain(rnd) {
    const { THREE } = this, scene = this.scene, P = this.P;
    // гравитационный колодец, корона, стартовые зоны — подсветка клеток
    for (const f of [this.hexFill(this.cells('g'), 0xc8b48c, 0.07), this.hexFill(this.cells('f'), new THREE.Color(css(P.glow)), 0.12)]) if (f) scene.add(f);

    // астероиды и глыбы
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f665a, roughness: 1, metalness: 0.05, flatShading: true });
    const variants = [0, 1, 2, 3].map(() => this.rockGeometry(rnd));
    const rocks = variants.map(() => []);
    for (const [x, y] of this.cells('a')) {
      const [px, pz] = this.pos(x, y), n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.62;
        rocks[Math.floor(rnd() * 4)].push({ p: [px + Math.cos(a) * d, -0.35 + rnd() * 1.2, pz + Math.sin(a) * d], s: 0.16 + rnd() * 0.28, r: [rnd() * 6, rnd() * 6, rnd() * 6], w: (rnd() - 0.5) * 0.5 });
      }
    }
    const moonArt = this.bodies.moon?.urls?.[0];
    for (const [x, y] of this.cells('R')) {
      const [px, pz] = this.pos(x, y);
      if (moonArt) {
        const mm = new THREE.Mesh(new THREE.SphereGeometry(0.95, 48, 32), new THREE.MeshStandardMaterial({ map: this.texture(moonArt), roughness: 1 }));
        mm.position.set(px, 0.4, pz); scene.add(mm);
        this.anim.push((dt) => { mm.rotation.y += dt * 0.05; });
      } else rocks[0].push({ p: [px, 0.3, pz], s: 0.95, r: [rnd(), rnd(), rnd()], w: 0.04 });
    }
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), mt = new THREE.Matrix4();
    variants.forEach((geo, i) => {
      const list = rocks[i];
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(geo, rockMat, list.length);
      const put = (t) => list.forEach((r, j) => {
        e.set(r.r[0] + t * r.w, r.r[1] + t * r.w * 0.7, r.r[2]); q.setFromEuler(e);
        v.set(r.p[0], r.p[1] + Math.sin(t * 0.4 + j) * 0.04, r.p[2]); sc.setScalar(r.s);
        inst.setMatrixAt(j, mt.compose(v, q, sc));
      });
      put(0); scene.add(inst);
      this.anim.push((dt, t) => { put(t); inst.instanceMatrix.needsUpdate = true; });
    });

    // обломки и кольца: мелкие осколки
    const shards = [];
    for (const [x, y] of this.cells('d')) {
      const [px, pz] = this.pos(x, y);
      for (let k = 0; k < 9; k++) shards.push([px + (rnd() - 0.5) * 1.6, -0.2 + rnd() * 0.7, pz + (rnd() - 0.5) * 1.5, 0.04 + rnd() * 0.08, rnd() * 6]);
    }
    if (shards.length) {
      const inst = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), new THREE.MeshStandardMaterial({ color: 0x9a9286, roughness: 0.6, metalness: 0.5, flatShading: true }), shards.length);
      shards.forEach(([x, y, z, s, r], j) => { e.set(r, r * 1.3, r * 0.7); q.setFromEuler(e); inst.setMatrixAt(j, mt.compose(v.set(x, y, z), q, sc.setScalar(s))); });
      scene.add(inst);
    }

    // туманности и шторма: светящиеся облака
    const nebTex = this.glowTexture(P.neb, 0.35), ionTex = this.glowTexture([110, 180, 255], 0.5);
    for (const [t, tex, op, n] of [['n', nebTex, 0.32, 3], ['i', ionTex, 0.28, 2]]) {
      for (const [x, y] of this.cells(t)) {
        const [px, pz] = this.pos(x, y);
        for (let k = 0; k < n; k++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
          sp.position.set(px + (rnd() - 0.5) * 1.2, 0.2 + rnd() * 1.6, pz + (rnd() - 0.5) * 1.2);
          sp.scale.setScalar(2.6 + rnd() * 2.2);
          const ph = rnd() * 6;
          this.anim.push((dt, tt) => { sp.material.opacity = op * (0.75 + Math.sin(tt * 0.6 + ph) * 0.25); });
          scene.add(sp);
        }
      }
    }
    // разряды в ионных штормах
    const ion = this.cells('i');
    if (ion.length) {
      const pts = [];
      for (const [x, y] of ion) {
        if (rnd() < 0.5) continue;
        const [px, pz] = this.pos(x, y);
        let a = [px + (rnd() - 0.5), 1.8, pz + (rnd() - 0.5)];
        for (let k = 0; k < 4; k++) { const b = [a[0] + (rnd() - 0.5) * 0.6, a[1] - 0.45, a[2] + (rnd() - 0.5) * 0.6]; pts.push(...a, ...b); a = b; }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const bolts = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
      scene.add(bolts);
      this.anim.push((dt, t) => { bolts.material.opacity = Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 2.1)) * 0.9; });
    }
  }

  /** Сетка и обводки зон (пунктир, как на 2D-карте). */
  buildGrid() {
    const { THREE } = this, m = this.map, scene = this.scene;
    const grid = [], zones = { a: [], R: [], i: [], d: [] };
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = cellOf(m, x, y), [cx, cz] = this.pos(x, y), nb = edgeNeighbors(x, y);
      for (let k = 0; k < 6; k++) {
        const a0 = Math.PI / 3 * k, a1 = Math.PI / 3 * (k + 1);
        const seg = [cx + Math.cos(a0), 0, cz + Math.sin(a0), cx + Math.cos(a1), 0, cz + Math.sin(a1)];
        const n = cellOf(m, nb[k][0], nb[k][1]);
        if (t !== 'P' && (k < 3 || n === null)) grid.push(...seg); // каждое ребро один раз
        if (zones[t] && n !== t && n !== null) zones[t].push(...seg.map((v2, i) => (i % 3 === 1 ? 0.03 : v2)));
      }
    }
    const lines = (pts, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const l = new THREE.LineSegments(g, mat); l.computeLineDistances?.(); return l; };
    this.gridLines = lines(grid, new THREE.LineBasicMaterial({ color: 0xe9b949, transparent: true, opacity: 0.13, depthWrite: false }));
    scene.add(this.gridLines);
    const Z = { a: [0xe9b949, 0.85, 0.32, 0.18], R: [0xe9b949, 1, 1, 0], i: [0x82c3ff, 0.7, 0.12, 0.22], d: [0xaaa08c, 0.45, 0.08, 0.2] };
    for (const [t, pts] of Object.entries(zones)) {
      if (!pts.length) continue;
      const [c, op, dash, gap] = Z[t];
      scene.add(lines(pts, gap ? new THREE.LineDashedMaterial({ color: c, transparent: true, opacity: op, dashSize: dash, gapSize: gap }) : new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op })));
    }
    // стартовые зоны
    for (const [side, col] of [['a', 0xe9b949], ['b', 0xde6c5c]]) {
      const [x0, x1] = m.spawn[side], list = [];
      for (let x = x0; x <= x1; x++) for (let y = 0; y < m.h; y++) if (cellOf(m, x, y) !== 'P') list.push([x, y]);
      const f = this.hexFill(list, col, 0.06, 0.005); if (f) scene.add(f);
    }
    // невидимая подсветка клетки под курсором
    const hg = new THREE.BufferGeometry(), hp = [];
    for (let k = 0; k <= 6; k++) hp.push(Math.cos(Math.PI / 3 * k) * 0.94, 0.04, Math.sin(Math.PI / 3 * k) * 0.94);
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    this.hover = new THREE.Line(hg, new THREE.LineBasicMaterial({ color: 0xf3ecdc }));
    this.hover.visible = false;
    scene.add(this.hover);
  }

  showGrid(on) { if (this.gridLines) this.gridLines.visible = on; }

  // ── туман войны и отряды: перестраиваются при смене взгляда ──
  buildDynamic() {
    const { THREE } = this, scene = this.scene, m = this.map;
    if (this.dyn) { scene.remove(this.dyn); this.dyn.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    const dyn = new THREE.Group(); this.dyn = dyn; scene.add(dyn);
    this.anim = this.anim.filter((f) => !f.dyn);
    const fog = this.o.fog, vis = fog ? visibleCells(m, this.o.units, fog) : null;
    if (vis) {
      const hidden = [];
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (!vis.has(`${x},${y}`) && cellOf(m, x, y) !== 'P') hidden.push([x, y]);
      const f = this.hexFill(hidden, 0x000000, 0.62, 0.06, 1.0); if (f) dyn.add(f);
      // граница обзора
      const pts = [];
      for (const k of vis) {
        const [x, y] = k.split(',').map(Number), [cx, cz] = this.pos(x, y), nb = edgeNeighbors(x, y);
        nb.forEach(([nx, ny], e) => {
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || vis.has(`${nx},${ny}`)) return;
          const a0 = Math.PI / 3 * e, a1 = Math.PI / 3 * (e + 1);
          pts.push(cx + Math.cos(a0), 0.08, cz + Math.sin(a0), cx + Math.cos(a1), 0.08, cz + Math.sin(a1));
        });
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: 0x78e6aa, transparent: true, opacity: 0.7, dashSize: 0.25, gapSize: 0.18 }));
      l.computeLineDistances(); dyn.add(l);
    }
    this.vis = vis;
    for (const u of this.o.units) {
      if (vis && u.side !== fog && !vis.has(`${u.x},${u.y}`)) continue; // необнаруженного врага нет в сцене вовсе
      this.addUnit(u, dyn);
    }
  }

  async addUnit(u, parent) {
    const { THREE } = this, [px, pz] = this.pos(u.x, u.y);
    const col = u.side === 'a' ? 0xe9b949 : 0xe86858;
    const grp = new THREE.Group();
    grp.position.set(px, 0.55, pz);
    parent.add(grp);
    // метка стороны на плоскости
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.84, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(px, 0.07, pz); parent.add(ring);
    // подпись
    if (u.label) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
      const g = cv.getContext('2d'); g.font = '700 30px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#f3ecdc';
      g.shadowColor = '#000'; g.shadowBlur = 8; g.fillText(u.label, 128, 42);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
      sp.scale.set(2.4, 0.6, 1); sp.position.set(px, 1.75, pz); parent.add(sp);
    }
    const len = { S: 0.95, M: 1.25, L: 1.55, XL: 1.85 }[u.size] || 1.2;
    const url = u.cls ? (await shipModels())[u.cls.toLowerCase()] : null;
    let body = null;
    if (url) body = await this.loadModel(url, len).catch((e) => { console.warn('Модель не загрузилась', url, e); return null; });
    if (body && url) this.host.dataset.models = String(Number(this.host.dataset.models || 0) + 1);
    if (!body) body = this.stubShip(len, col);
    if (u.side === 'b') body.rotation.y = Math.PI;
    grp.add(body);
    const ph = Math.random() * 6;
    const f = (dt, t) => { grp.position.y = 0.55 + Math.sin(t * 1.2 + ph) * 0.06; };
    f.dyn = true; this.anim.push(f);
  }

  async loadModel(url, len) {
    const { THREE, GLTFLoader, DRACOLoader } = this.L;
    if (!this.gltf.has(url)) {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      loader.setDRACOLoader(draco);
      this.gltf.set(url, loader.loadAsync(url));
    }
    const gltf = await this.gltf.get(url);
    const obj = gltf.scene.clone(true);
    // привести к размеру клетки и поставить по центру
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    const k = len / Math.max(size.x, size.y, size.z, 1e-6);
    const wrap = new THREE.Group();
    obj.position.sub(mid);
    wrap.add(obj); wrap.scale.setScalar(k);
    return wrap;
  }

  /** Заготовка корабля, пока нет модели: корпус-клин, крылья, свечение двигателей. Нос — по +X. */
  stubShip(len, col) {
    const { THREE } = this, g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x8c867a, roughness: 0.45, metalness: 0.7, flatShading: true });
    const hull = new THREE.Mesh(new THREE.ConeGeometry(len * 0.2, len, 6), metal);
    hull.rotation.z = -Math.PI / 2; g.add(hull);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(len * 0.38, len * 0.04, len * 0.62), metal);
    wing.position.x = -len * 0.18; g.add(wing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.28, len * 0.22, len * 0.03), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.4, emissive: col, emissiveIntensity: 0.25 }));
    fin.position.set(-len * 0.26, len * 0.12, 0); g.add(fin);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture([255, 190, 120], 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.x = -len * 0.55; glow.scale.setScalar(len * 0.55); g.add(glow);
    return g;
  }

  // ── наведение ──
  onPointer(e) {
    if (!this.map) return;
    const { THREE } = this, rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) { this.setHover(null); this.onHover?.(null); return; }
    const ux = hit.x + this.cx0, uz = hit.z + this.cz0, m = this.map, gx = Math.round(ux / 1.5);
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
    this.setHover(best);
    this.onHover?.(best, e.clientX - rect.left, e.clientY - rect.top);
  }
  setHover(c) {
    if (!this.hover) return;
    this.hover.visible = !!c;
    if (c) { const [px, pz] = this.pos(c[0], c[1]); this.hover.position.set(px, 0, pz); }
  }
}
