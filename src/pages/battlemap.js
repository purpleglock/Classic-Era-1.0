import { html, raw, icon, $, $$, toast } from '../lib/dom.js';
import { sb, rpc } from '../lib/supabase.js';
import { session, isTeam } from '../lib/session.js';
import { BattleMap, STAR, CELLS, ARCHE } from '../ui/battle-map.js';
import { cellOf } from '../lib/hexmap.js';

/**
 * #/battlemap — лаборатория карт сражений (для команды проекта).
 * Карта строится в базе (v1_bmap_preview) по системе и зерну; здесь — только отрисовка.
 * Адрес можно переслать: #/battlemap?sys=…&seed=…&site=…&size=m|s
 */

let systems = null;

export async function renderBattleMap(root) {
  if (!session.user || !isTeam()) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-sword')}</span><div><h1>Карты сражений</h1><p>Лаборатория карт пока открыта только команде проекта.</p></div><a class="btn" href="#/">На главную</a></section>`;
    return;
  }
  if (!systems) {
    const { data } = await sb.from('map_systems').select('id,name,star_type').order('name');
    systems = data || [];
  }
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const st = {
    sys: q.get('sys') || systems[Math.floor(Math.random() * systems.length)]?.id,
    seed: q.get('seed') ? Number(q.get('seed')) : rndSeed(),
    site: q.get('site') ? Number(q.get('site')) : null,
    size: q.get('size') === 's' ? 's' : 'm',
    view: 'a', grid: true, mode: q.get('mode') === '3d' ? '3d' : '2d', spin: false,
  };
  let b3 = null;

  root.innerHTML = html`<div class="bm-wrap">
    <section class="panel st-hero bm-hero">
      <div class="st-title">
        <a class="st-back" href="#/admin">${icon('i-back')}Админ-панель</a>
        <h1>Карты сражений</h1>
        <p>Карта строится из настоящей системы: цвет звезды, тело, у которого идёт бой, его кольца и луны, зона орбиты, прошлые сражения. Одно зерно — одна и та же карта.</p>
      </div>
    </section>
    <section class="panel bm-ctl">
      <label class="bm-f"><span>Система</span><input id="bm-sys" list="bm-syslist" placeholder="Название системы" autocomplete="off"><datalist id="bm-syslist">${systems.map((s) => raw(html`<option value="${s.name}">`))}</datalist></label>
      <label class="bm-f"><span>Место боя</span><select id="bm-site"></select></label>
      <label class="bm-f"><span>Размер</span><select id="bm-size"><option value="m">Средняя 29×17</option><option value="s">Малая 23×13</option></select></label>
      <label class="bm-f"><span>Взгляд</span><select id="bm-view"><option value="a">Стороны A (туман войны)</option><option value="b">Стороны B (туман войны)</option><option value="">Без тумана</option></select></label>
      <div class="bm-btns">
        <button type="button" class="btn sm gold" id="bm-reroll">${icon('i-spark')}Другая карта</button>
        <button type="button" class="btn sm" id="bm-rsys">${icon('i-map')}Случайная система</button>
        <button type="button" class="btn sm" id="bm-grid" aria-pressed="true">Сетка</button>
        <div class="seg bm-mode" role="group" aria-label="Вид"><button type="button" data-mode="2d">2D</button><button type="button" data-mode="3d">3D</button></div>
        <button type="button" class="btn sm" id="bm-spin" aria-pressed="false" hidden>Облёт</button>
      </div>
    </section>
    <section class="panel bm-stage">
      <div class="bm-meta" id="bm-meta"></div>
      <div class="bm-canvas"><canvas id="bm-c"></canvas><div class="bm-3d" id="bm-3d" hidden></div><div class="bm-tip" id="bm-tip" hidden></div></div>
      <p class="note bm-3dnote" id="bm-3dnote" hidden>3D: левая кнопка мыши — вращать на 360°, правая — сдвигать, колесо — приблизить. Корабли берутся из «3D-моделей» по классу (Корвет, Эсминец, Крейсер, Линкор…), звёзды и планеты — из «Небесных тел». Пока файлов нет, видны заготовки.</p>
    </section>
    <div class="bm-cols">
      <section class="panel bm-legend" id="bm-legend"></section>
      <section class="panel bm-rules">
        <h2>Как это будет работать в бою</h2>
        <ul>
          <li><b>Противника не видно вовсе</b>, пока его не нашёл радар: сервер просто не присылает чужие отряды вне обзора, поэтому подсмотреть их нельзя даже через код страницы.</li>
          <li><b>Радар</b> даёт дальность обзора отряда. Белая звезда: обзор +20 %. Туманность прячет корабль, пока к нему не подошли на 2 клетки. В астероидах цель заметна хуже, в ионном шторме слепнет сам наблюдатель.</li>
          <li><b>Астероиды</b> проходят только корветы и авиация. Глыбы и планета непроходимы для всех.</li>
          <li><b>Карта зеркальная</b> слева направо: у обеих сторон одинаковые условия. Генератор проверяет, что крупный корабль может дойти от края до края.</li>
          <li><b>Выстрел выдаёт стрелка:</b> тот, кто стрелял, на один ход виден тому, по кому стрелял.</li>
          <li><b>Импульс радара:</b> раз в несколько ходов обзор отряда удваивается, но сам отряд на этот ход виден противнику.</li>
          <li><b>Последний контакт:</b> где врага видели в последний раз, остаётся метка. Новых сведений она не даёт.</li>
          <li><b>Нагрузка:</b> карта строится в базе один раз в начале боя (около 25 мс) и весит ~0,5 КБ. Картинку рисует браузер игрока, сервер изображений не хранит.</li>
        </ul>
        <p class="note">Отряды на карте — для показа тумана войны: у стороны A радары 5, 6 и 4 клетки, у стороны B — 5 и 4.</p>
      </section>
    </div>
  </div>`;

  const bm = new BattleMap($('#bm-c', root));
  const sysInp = $('#bm-sys', root), siteSel = $('#bm-site', root);
  let map = null;

  const load = async () => {
    const sys = systems.find((s) => s.id === st.sys);
    sysInp.value = sys?.name || '';
    history.replaceState(null, '', `#/battlemap?sys=${st.sys}&seed=${st.seed}${st.site != null ? `&site=${st.site}` : ''}&size=${st.size}${st.mode === '3d' ? '&mode=3d' : ''}`);
    try {
      map = await rpc('v1_bmap_preview', { p_system: st.sys, p_seed: st.seed, p_site: st.site, p_size: st.size });
    } catch (e) {
      $('#bm-meta', root).innerHTML = html`<p class="note warn">${e.missingSchema ? 'Генератор карт ещё не подключён в базе (миграция 34).' : e.message}</p>`;
      return;
    }
    siteSel.innerHTML = html`<option value="">Случайно (по зерну)</option>${map.bodies.map((b) => raw(html`<option value="${b.pid}" ${raw(st.site === b.pid ? 'selected' : '')}>${b.name} · ${b.type || b.kind}</option>`))}`;
    $('#bm-size', root).value = st.size;
    bm.setMap(map);
    bm.set({ units: demoUnits(map), fog: st.view || null, grid: st.grid });
    drawMeta();
    if (st.mode === '3d') show3d();
  };

  const drawMeta = () => {
    const P = STAR[map.system.star] || STAR.yellow;
    $('#bm-meta', root).innerHTML = html`
      <span class="bm-chip"><i style="background:${P.core};box-shadow:0 0 10px ${P.core}"></i>${map.system.name} · ${P.name}</span>
      <span class="bm-chip">${icon('i-planet')}${map.site ? `${map.site.name} · ${map.site.type || map.site.kind}` : 'Открытый космос'}</span>
      <span class="bm-chip">${icon('i-map')}${ARCHE[map.arche] || map.arche}</span>
      ${map.site?.rings ? raw(html`<span class="bm-chip">Кольца</span>`) : ''}${map.site?.moons ? raw(html`<span class="bm-chip">Лун: ${map.site.moons}</span>`) : ''}
      ${map.corona ? raw(html`<span class="bm-chip hot">Корона звезды</span>`) : ''}
      ${map.old_battles ? raw(html`<span class="bm-chip">Прошлых сражений: ${map.old_battles}</span>`) : ''}
      <span class="bm-chip mono">зерно ${map.seed}</span>`;
    const total = map.w * map.h;
    $('#bm-legend', root).innerHTML = html`<h2>Местность</h2><ul>${Object.entries(CELLS).filter(([k]) => map.counts[k]).map(([k, c]) => raw(html`
      <li><span class="bm-sw sw-${k === '.' ? 'o' : k}"></span><div><b>${c.name}</b><small>${c.rule}</small></div><em>${Math.round(map.counts[k] * 100 / total)} %</em></li>`))}</ul>`;
  };

  // наведение: подсказка по клетке
  const cv = $('#bm-c', root), tip = $('#bm-tip', root);
  cv.onmousemove = (e) => {
    if (!map) return;
    const r = cv.getBoundingClientRect(), c = bm.cellAt(e.clientX - r.left, e.clientY - r.top);
    bm.set({ hover: c });
    if (!c) { tip.hidden = true; return; }
    const t = CELLS[bm.cell(...c)] || CELLS['.'];
    tip.hidden = false;
    tip.innerHTML = html`<b>${t.name}</b><small>${t.rule}</small>`;
    tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 230)}px`; tip.style.top = `${e.clientY - r.top + 14}px`;
  };
  cv.onmouseleave = () => { tip.hidden = true; bm.set({ hover: null }); };

  $('#bm-reroll', root).onclick = () => { st.seed = rndSeed(); load(); };
  $('#bm-rsys', root).onclick = () => { st.sys = systems[Math.floor(Math.random() * systems.length)].id; st.site = null; st.seed = rndSeed(); load(); };
  sysInp.onchange = () => { const s = systems.find((x) => x.name.toLowerCase() === sysInp.value.trim().toLowerCase()); if (!s) { toast('Такой системы нет', 'err'); return; } st.sys = s.id; st.site = null; load(); };
  siteSel.onchange = () => { st.site = siteSel.value === '' ? null : Number(siteSel.value); load(); };
  $('#bm-size', root).onchange = (e) => { st.size = e.target.value; load(); };
  $('#bm-view', root).onchange = (e) => { st.view = e.target.value; bm.set({ fog: st.view || null }); b3?.set({ fog: st.view || null }); };
  $('#bm-grid', root).onclick = (e) => { st.grid = !st.grid; e.currentTarget.setAttribute('aria-pressed', String(st.grid)); bm.bg = null; bm.set({ grid: st.grid }); b3?.showGrid(st.grid); };
  // ── 3D ──
  const host3 = $('#bm-3d', root);
  const show3d = async () => {
    if (!map) return;
    try {
      if (!b3) {
        const { Battle3D } = await import('../ui/battle-3d.js');
        b3 = new Battle3D(host3);
        b3.onHover = (c, x, y) => {
          if (!c) { tip.hidden = true; return; }
          const t = CELLS[cellOf(map, c[0], c[1])] || CELLS['.'];
          tip.hidden = false; tip.innerHTML = html`<b>${t.name}</b><small>${t.rule}</small>`;
          tip.style.left = `${Math.min(x + 14, host3.clientWidth - 230)}px`; tip.style.top = `${y + 14}px`;
        };
      }
      await b3.setMap(map, { units: demoUnits(map), fog: st.view || null, autoRotate: st.spin });
      b3.showGrid(st.grid);
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
    $('#bm-spin', root).hidden = mode !== '3d'; $('#bm-3dnote', root).hidden = mode !== '3d';
    tip.hidden = true;
    if (mode === '3d') show3d(); else bm.draw();
    history.replaceState(null, '', location.hash.replace(/&mode=3d/, '') + (mode === '3d' ? '&mode=3d' : ''));
  };
  $$('[data-mode]', root).forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('#bm-spin', root).onclick = (e) => { st.spin = !st.spin; e.currentTarget.setAttribute('aria-pressed', String(st.spin)); b3?.set({ autoRotate: st.spin }); };
  setMode(st.mode);

  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (document.body.contains(cv)) { bm.bg = null; bm.draw(); } }, 120); });
  load();
}

const rndSeed = () => Math.floor(Math.random() * 999999) + 1;

/** Показательные отряды: свои — у левого края, чужие — у правого и один корвет в астероидах. */
function demoUnits(m) {
  const free = (x0, x1, y0) => {
    for (let dy = 0; dy < m.h; dy++) for (const y of [y0 + dy, y0 - dy]) for (let x = x0; x0 <= x1 ? x <= x1 : x >= x1; x += x0 <= x1 ? 1 : -1) {
      if (y >= 0 && y < m.h && m.grid[y * m.w + x] === '.') return [x, y];
    }
    return [x0, y0];
  };
  const mid = Math.floor(m.h / 2), u = [];
  [[mid - 4, 5, 'M', 'Эсминцы', 'Эсминец'], [mid, 6, 'L', 'Крейсер', 'Крейсер'], [mid + 4, 4, 'S', 'Корветы', 'Корвет']].forEach(([y, radar, size, label, cls]) => {
    const [x, yy] = free(1, 3, y); u.push({ side: 'a', x, y: yy, radar, size, label, cls });
  });
  [[mid - 3, 5, 'XL', 'Линкор', 'Линкор'], [mid + 3, 4, 'M', 'Эсминцы', 'Эсминец']].forEach(([y, radar, size, label, cls]) => {
    const [x, yy] = free(m.w - 2, m.w - 4, y); u.push({ side: 'b', x, y: yy, radar, size, label, cls });
  });
  // корвет противника прячется в ближайших к центру астероидах правой половины
  let best = null;
  for (let y = 0; y < m.h; y++) for (let x = Math.ceil(m.w / 2); x < m.w; x++) if (m.grid[y * m.w + x] === 'a' && (!best || x < best[0])) best = [x, y];
  if (best) u.push({ side: 'b', x: best[0], y: best[1], radar: 4, size: 'S', label: 'Корвет', cls: 'Корвет' });
  return u;
}
