/**
 * Пометки боя поверх карты (2D, общий для космоса и земли):
 * досягаемые клетки выбранного отряда, цели в дальности, выбранный отряд и
 * «последний контакт» — где сторона в последний раз видела отряд противника.
 * m — карта с методами hexPath(ctx,x,y,k) и center(x,y); o.marks — { reach, targets, sel, contacts, turn }.
 */
export function drawMarks(m, ctx, mk) {
  if (!mk) return;
  const s = m.s;
  if (mk.reach?.size) {
    ctx.fillStyle = 'rgba(233,185,73,.16)'; ctx.strokeStyle = 'rgba(233,185,73,.45)'; ctx.lineWidth = 1;
    for (const k of mk.reach) { const [x, y] = k.split(',').map(Number); m.hexPath(ctx, x, y, 0.86); ctx.fill(); ctx.stroke(); }
  }
  for (const c of mk.contacts || []) {
    const [cx, cy] = m.center(c.x, c.y), age = Math.max(0, (mk.turn || 0) - c.turn);
    ctx.save(); ctx.globalAlpha = Math.max(0.3, 0.9 - age * 0.15);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(232,104,88,.95)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.48, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `800 ${Math.max(9, s * 0.42)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,104,88,.95)'; ctx.fillText('?', cx, cy + 0.5);
    ctx.font = `700 ${Math.max(7, s * 0.26)}px Manrope, system-ui, sans-serif`; ctx.fillStyle = 'rgba(243,236,220,.75)';
    ctx.fillText(age ? `${age} х. назад` : 'сейчас', cx, cy + s * 0.78);
    ctx.restore();
  }
  for (const [x, y] of mk.targets || []) {
    const [cx, cy] = m.center(x, y);
    ctx.strokeStyle = 'rgba(255,96,80,.95)'; ctx.lineWidth = 2;
    m.hexPath(ctx, x, y, 0.9); ctx.stroke();
    ctx.beginPath(); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { ctx.moveTo(cx + dx * s * 0.62, cy + dy * s * 0.62); ctx.lineTo(cx + dx * s * 0.86, cy + dy * s * 0.86); } ctx.stroke();
  }
  if (mk.sel) { m.hexPath(ctx, mk.sel[0], mk.sel[1], 0.96); ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 2.4; ctx.stroke(); }
}
