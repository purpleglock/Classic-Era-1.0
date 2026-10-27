import { html, raw, icon, $, $$, toast } from '../lib/dom.js';
import { sb, rpc } from '../lib/supabase.js';
import { session, isTeam } from '../lib/session.js';
import { GroundMap, BIOMES, GCELL, cellInfo } from '../ui/ground-map.js';
import { STAR } from '../ui/battle-map.js';
import { cellOf } from '../lib/hexmap.js';

/**
 * #/groundmap — лаборатория наземных карт (для команды проекта).
 * Карта строится в базе (v1_gmap_preview) по планете и зерну; здесь — отрисовка 2D и 3D.
 * Адрес можно переслать: #/groundmap?sys=…&pid=…&seed=…&size=m|s&mode=3d
 */

let systems = null;
const BIOME_ORDER = ['temperate', 'tundra', 'desert', 'ocean', 'volcanic', 'ice', 'barren', 'carbon', 'exotic', 'ruins', 'gas'];

export async function renderGroundMap(root) {
  if (!session.user || !isTeam()) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-sword')}</span><div><h1>Наземные карты</h1><p>Лаборатория карт пока открыта только команде проекта.</p></div><a class="btn" href="#/">На главную</a></section>`;
    return;
  }
  if (!systems) {
    const { data } = await sb.from('map_systems').select('id,name,star_type').order('name');
    systems = data || [];
  }
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const st = {
    sys: q.get('sys') || systems[Math.floor(Math.random() * systems.length)]?.id,
    pid: q.get('pid') ? Number(q.get('pid')) : null,
    seed: q.get('seed') ? Number(q.get('seed')) : rndSeed(),
    size: q.get('size') === 's' ? 's' : 'm',
    view: 'a', grid: true, mode: q.get('mode') === '3d' ? '3d' : '2d', spin: false,
  };
  let g3 = null, map = null;

  root.innerHTML = html`<div class="bm-wrap">
    <section class="panel st-hero bm-hero">
      <div class="st-title">
        <a class="st-back" href="#/admin">${icon('i-back')}Админ-панель</a>
        <h1>Карты сражений</h1>
        <p>Наземный бой идёт на планете, где стоит колония: среда, цвета и рельеф берутся из типа планеты, свет — от звезды системы. Одно зерно — одна и та же карта.</p>
      </div>
      <div class="seg bm-kind" role="tablist"><a href="#/battlemap" role="tab">Космос</a><a href="#/groundmap" role="tab" aria-selected="true">Земля</a></div>
    </section>
    <section class="panel bm-ctl">
      <label class="bm-f"><span>Система</span><input id="gm-sys" list="gm-syslist" placeholder="Название системы" autocomplete="off"><datalist id="gm-syslist">${systems.map((s) => raw(html`<option value="${s.name}">`))}</datalist></label>
      <label class="bm-f"><span>Планета</span><select id="gm-pid"></select></label>
      <label class="bm-f"><span>Размер</span><select id="gm-size"><option value="m">Средняя 29×17</option><option value="s">Малая 23×13</option></select></label>
      <label class="bm-f"><span>Взгляд</span><select id="gm-view"><option value="a">Атакующего A (туман войны)</option><option value="b">Защитника B (туман войны)</option><option value="">Без тумана</option></select></label>
      <div class="bm-btns">
        <button type="button" class="btn sm gold" id="gm-reroll">${icon('i-spark')}Другая карта</button>
        <button type="button" class="btn sm" id="gm-rsys">${icon('i-planet')}Случайная планета</button>
        <button type="button" class="btn sm" id="gm-grid" aria-pressed="true">Сетка</button>
        <div class="seg bm-mode" role="group" aria-label="Вид"><button type="button" data-mode="2d">2D</button><button type="button" data-mode="3d">3D</button></div>
        <button type="button" class="btn sm" id="gm-spin" aria-pressed="false" hidden>Облёт</button>
      </div>
    </section>
    <section class="panel bm-stage">
      <div class="bm-meta" id="gm-meta"></div>
      <div class="bm-canvas"><canvas id="gm-c"></canvas><div class="bm-3d" id="gm-3d" hidden></div><div class="bm-tip" id="gm-tip" hidden></div></div>
      <p class="note bm-3dnote" id="gm-3dnote" hidden>3D: левая кнопка мыши — вращать на 360°, правая — сдвигать, колесо — приблизить. Техника и авиация берутся из «3D-моделей» по классу (Танк, БТР, Артиллерия, Истребитель…); пока файлов нет, видны заготовки.</p>
    </section>
    <div class="bm-cols">
      <section class="panel bm-legend" id="gm-legend"></section>
      <section class="panel bm-rules">
        <h2>Правила наземного боя</h2>
        <ul>
          <li><b>Десант</b> садится в зоне высадки на любом ходу — без ограничения по ходам.</li>
          <li><b>Пехота</b> проходит горы и занимает постройки (укрытие). Воду, лаву и пропасти не проходит.</li>
          <li><b>Техника</b> не заходит в горы и постройки; лес, неровности, холмы и брод — вдвое дороже, дорога — вдвое быстрее.</li>
          <li><b>Артиллерия</b> бьёт навесом через горы и постройки — по цели, которую видит своя сторона.</li>
          <li><b>Авиация</b> летает где угодно, даже над горами, водой и пропастями, и видит на клетку дальше и поверх гор. Её сбивает ПВО.</li>
          <li><b>Туман войны</b> — как в космосе: необнаруженного противника нет на карте вовсе. Горы закрывают обзор, с гор видно дальше; в лесу и постройках цель видна только вблизи. Выстрел выдаёт стрелка, «последний контакт» оставляет метку.</li>
          <li><b>Колония</b> защитника — справа; атакующий высаживается слева. Генератор проверяет, что техника может дойти от зоны высадки до колонии.</li>
          <li><b>Модули техники</b> обновим позже — сейчас карта и правила местности.</li>
        </ul>
        <p class="note">Отряды на карте — для показа тумана войны: у атакующего пехота, танки, артиллерия и разведчик в воздухе; у защитника гарнизон, танки и ПВО.</p>
      </section>
    </div>
  </div>`;

  const gm = new GroundMap($('#gm-c', root));
  const sysInp = $('#gm-sys', root), pidSel = $('#gm-pid', root), cv = $('#gm-c', root), tip = $('#gm-tip', root), host3 = $('#gm-3d', root);

  const load = async () => {
    sysInp.value = systems.find((s) => s.id === st.sys)?.name || '';
    history.replaceState(null, '', `#/groundmap?sys=${st.sys}${st.pid != null ? `&pid=${st.pid}` : ''}&seed=${st.seed}&size=${st.size}${st.mode === '3d' ? '&mode=3d' : ''}`);
    try {
      map = await rpc('v1_gmap_preview', { p_system: st.sys, p_pid: st.pid, p_seed: st.seed, p_size: st.size });
    } catch (e) {
      $('#gm-meta', root).innerHTML = html`<p class="note warn">${e.missingSchema ? 'Генератор наземных карт ещё не подключён в базе (миграция 37).' : e.message}</p>`;
      return;
    }
    const bodies = [...map.bodies].sort((a, b) => BIOME_ORDER.indexOf(a.biome) - BIOME_ORDER.indexOf(b.biome));
    pidSel.innerHTML = html`<option value="">Случайно (по зерну)</option>${bodies.map((b) => raw(html`<option value="${b.pid}" ${raw(st.pid === b.pid ? 'selected' : '')}>${b.name} · ${BIOMES[b.biome]?.name || b.biome}</option>`))}`;
    $('#gm-size', root).value = st.size;
    gm.setMap(map);
    gm.set({ units: demoUnits(map), fog: st.view || null, grid: st.grid });
    drawMeta();
    if (st.mode === '3d') show3d();
  };

  const drawMeta = () => {
    const P = STAR[map.system.star] || STAR.yellow, B = BIOMES[map.biome] || BIOMES.barren;
    $('#gm-meta', root).innerHTML = html`
      <span class="bm-chip"><i style="background:${P.core};box-shadow:0 0 10px ${P.core}"></i>${map.system.name} · ${P.name}</span>
      <span class="bm-chip">${icon('i-planet')}${map.body ? `${map.body.name} · ${map.body.type || map.body.kind}` : '—'}</span>
      <span class="bm-chip"><i style="background:${B.ground[1]}"></i>${B.name}</span>
      <span class="bm-chip">${icon('i-map')}${map.vname}</span>
      <span class="bm-chip mono">зерно ${map.seed}</span>`;
    const total = map.w * map.h;
    $('#gm-legend', root).innerHTML = html`<h2>Местность · ${B.name}</h2><ul>${Object.keys(GCELL).filter((k) => map.counts[k]).map((k) => {
      const [n, rule] = cellInfo(map.biome, k);
      return raw(html`<li><span class="bm-sw" style="background:${swatch(B, k)}"></span><div><b>${n}</b><small>${rule}</small></div><em>${Math.round(map.counts[k] * 100 / total)} %</em></li>`);
    })}</ul>`;
  };

  const hint = (c, x, y, w) => {
    if (!c) { tip.hidden = true; return; }
    const [n, rule] = cellInfo(map.biome, cellOf(map, c[0], c[1]));
    tip.hidden = false; tip.innerHTML = html`<b>${n}</b><small>${rule}</small>`;
    tip.style.left = `${Math.min(x + 14, w - 230)}px`; tip.style.top = `${y + 14}px`;
  };
  cv.onmousemove = (e) => {
    if (!map) return;
    const r = cv.getBoundingClientRect(), c = gm.cellAt(e.clientX - r.left, e.clientY - r.top);
    gm.set({ hover: c }); hint(c, e.clientX - r.left, e.clientY - r.top, r.width);
  };
  cv.onmouseleave = () => { tip.hidden = true; gm.set({ hover: null }); };

  const show3d = async () => {
    if (!map) return;
    try {
      if (!g3) {
        const { Ground3D } = await import('../ui/ground-3d.js');
        g3 = new Ground3D(host3);
        g3.onHover = (c, x, y) => hint(c, x, y, host3.clientWidth);
      }
      await g3.setMap(map, { units: demoUnits(map), fog: st.view || null, autoRotate: st.spin });
      g3.showGrid(st.grid);
    } catch (e) {
      console.error(e);
      toast('3D не запустился: браузер не поддерживает WebGL или не загрузилась библиотека', 'err');
      setMode('2d');
    }
  };
  const setMode = (mode) => {
    st.mode = mode;
    $$('[data-mode]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    cv.hidden = mode === '3d'; host3.hidden = mode !== '3d';
    $('#gm-spin', root).hidden = mode !== '3d'; $('#gm-3dnote', root).hidden = mode !== '3d';
    tip.hidden = true;
    if (mode === '3d') show3d(); else gm.draw();
    history.replaceState(null, '', location.hash.replace(/&mode=3d/, '') + (mode === '3d' ? '&mode=3d' : ''));
  };
  $$('[data-mode]', root).forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('#gm-spin', root).onclick = (e) => { st.spin = !st.spin; e.currentTarget.setAttribute('aria-pressed', String(st.spin)); g3?.set({ autoRotate: st.spin }); };
  $('#gm-reroll', root).onclick = () => { st.seed = rndSeed(); load(); };
  $('#gm-rsys', root).onclick = () => { st.sys = systems[Math.floor(Math.random() * systems.length)].id; st.pid = null; st.seed = rndSeed(); load(); };
  sysInp.onchange = () => { const s = systems.find((x) => x.name.toLowerCase() === sysInp.value.trim().toLowerCase()); if (!s) { toast('Такой системы нет', 'err'); return; } st.sys = s.id; st.pid = null; load(); };
  pidSel.onchange = () => { st.pid = pidSel.value === '' ? null : Number(pidSel.value); load(); };
  $('#gm-size', root).onchange = (e) => { st.size = e.target.value; load(); };
  $('#gm-view', root).onchange = (e) => { st.view = e.target.value; gm.set({ fog: st.view || null }); g3?.set({ fog: st.view || null }); };
  $('#gm-grid', root).onclick = (e) => { st.grid = !st.grid; e.currentTarget.setAttribute('aria-pressed', String(st.grid)); gm.bg = null; gm.set({ grid: st.grid }); g3?.showGrid(st.grid); };
  setMode(st.mode);
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (document.body.contains(cv)) { gm.bg = null; gm.draw(); } }, 120); });
  load();
}

const rndSeed = () => Math.floor(Math.random() * 999999) + 1;
const swatch = (B, k) => ({
  '.': B.ground[1], F: B.F, R: B.R, h: B.h, M: `linear-gradient(135deg,${B.M[1]},${B.M[0]})`, W: B.W[1], w: B.w,
  L: B.L ? `radial-gradient(circle,${B.L[1]},${B.L[0]})` : '#a33', X: B.clouds ? B.X : '#050403', S: B.S, C: '#e9b949', r: B.road,
}[k] || '#333');

/** Показательные отряды: атакующий — в зоне высадки, защитник — у колонии. */
function demoUnits(m) {
  const ok = (x, y, air) => { const t = m.grid[y * m.w + x]; return air || !'MWLXSC'.includes(t); };
  const near = (x0, y0, air) => {
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x >= 0 && y >= 0 && x < m.w && y < m.h && ok(x, y, air) && !taken.has(`${x},${y}`)) { taken.add(`${x},${y}`); return [x, y]; }
    }
    return [x0, y0];
  };
  const taken = new Set(), mid = Math.floor(m.h / 2), [cx, cy] = m.colony, u = [];
  const add = (side, x, y, type, label, radar, cls, air = false) => { const [px, py] = near(x, y, air); u.push({ side, x: px, y: py, type, label, radar, cls, air }); };
  add('a', 2, mid - 4, 'inf', 'Штурмовики', 3, 'Пехота');
  add('a', 3, mid, 'tank', 'Танки', 3, 'Танк');
  add('a', 2, mid + 4, 'art', 'Артиллерия', 2, 'Артиллерия');
  add('a', 6, mid - 2, 'air', 'Разведчик', 4, 'Разведчик', true);
  add('b', cx, cy, 'inf', 'Гарнизон', 3, 'Пехота');
  add('b', cx - 2, cy - 3, 'tank', 'Танки', 3, 'Танк');
  add('b', cx - 1, cy + 3, 'aa', 'ПВО', 3, 'ПВО');
  return u;
}
