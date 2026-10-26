/**
 * Геометрия поля боя и правила обзора — общие для 2D- и 3D-вида.
 * Шестиугольники с плоским верхом, нечётные столбцы сдвинуты вниз.
 * Центр клетки (x, y) в единицах радиуса: (1.5·x, √3·(y + ½·(x mod 2))).
 * Эти же правила потом повторит сервер: он присылает только то, что сторона видит.
 */

export const SQ3 = Math.sqrt(3);

export const center = (x, y) => [1.5 * x, SQ3 * (y + 0.5 * (x & 1))];
export const cellOf = (m, x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? null : m.grid[y * m.w + x]);

export function cube(x, y) { const q = x, r = y - (x - (x & 1)) / 2; return [q, r, -q - r]; }
export function dist(a, b) {
  const A = cube(a[0], a[1]), B = cube(b[0], b[1]);
  return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
}
function cubeRound(q, r, s) {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}
/** Клетки на прямой между центрами (без концов). */
export function hexLine(a, b) {
  const n = dist(a, b), A = cube(a[0], a[1]), B = cube(b[0], b[1]), out = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const [q, r] = cubeRound(A[0] + (B[0] - A[0]) * t + 1e-6, A[1] + (B[1] - A[1]) * t + 1e-6, A[2] + (B[2] - A[2]) * t - 2e-6);
    out.push([q, r + (q - (q & 1)) / 2]);
  }
  return out;
}

/** Соседи по рёбрам: порядок совпадает с рёбрами шестиугольника (углы 0°, 60° … 300°). */
export function edgeNeighbors(x, y) {
  const odd = x & 1;
  return [[x + 1, y + (odd ? 1 : 0)], [x, y + 1], [x - 1, y + (odd ? 1 : 0)], [x - 1, y + (odd ? 0 : -1)], [x, y - 1], [x + 1, y + (odd ? 0 : -1)]];
}

/**
 * Что видит сторона: набор клеток "x,y".
 * Радар отряда — в клетках; белая звезда даёт map.radar = 1.2.
 * Наблюдатель в ионном шторме видит вполсилы; цель в астероидах заметна на 30 % хуже;
 * цель в туманности видна только с 2 клеток; планета закрывает обзор.
 * Импульс радара (u.pulse) удваивает дальность на этот ход.
 */
export function visibleCells(m, units, side) {
  const own = units.filter((u) => u.side === side), vis = new Set();
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const t = cellOf(m, x, y);
    for (const u of own) {
      let r = (u.radar || 4) * (m.radar || 1) * (u.pulse ? 2 : 1);
      if (cellOf(m, u.x, u.y) === 'i') r *= 0.5;
      if (t === 'a') r *= 0.7;
      const d = dist([u.x, u.y], [x, y]);
      if (!(t === 'n' ? d <= 2 : d <= r)) continue;
      if (d > 1 && hexLine([u.x, u.y], [x, y]).some(([cx, cy]) => cellOf(m, cx, cy) === 'P')) continue;
      vis.add(`${x},${y}`); break;
    }
  }
  return vis;
}
