import type { Body, Level } from './types';
export function drawWorld(ctx: CanvasRenderingContext2D, level: Level, player: Body, debug: boolean, facing: number): void {
  const sx = scrollX, sy = scrollY;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.save(); ctx.translate(-sx, -sy);
  for (const p of level.platforms) {
    if (p.kind === 'bridge') {
      ctx.fillStyle = '#293940'; ctx.fillRect(p.x, p.y, p.width, 8);
      ctx.strokeStyle = '#d9a34c'; ctx.lineWidth = 2; ctx.strokeRect(p.x, p.y, p.width, 8);
      ctx.fillStyle = '#f4d08b'; ctx.fillRect(p.x + 5, p.y + 3, 3, 3); ctx.fillRect(p.x + p.width - 8, p.y + 3, 3, 3);
    } else if (debug) {
      ctx.strokeStyle = '#17b8b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.width, p.y); ctx.stroke();
    }
    if (debug) {
      const label = p.kind === 'bridge' ? 'steam bridge' : (p.label ?? 'DOM').slice(0, 28);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#17343ee6'; ctx.fillRect(p.x, p.y - 16, ctx.measureText(label).width + 4, 12);
      ctx.fillStyle = '#8fe8de'; ctx.fillText(label, p.x + 2, p.y - 6);
    }
  }
  const { x, y, width: w, height: h } = player;
  ctx.fillStyle = '#202f39'; ctx.fillRect(x + 3, y + 10, w - 6, h - 10);
  ctx.fillStyle = '#70878b'; ctx.fillRect(x, y + 9, w, 8); ctx.fillRect(x + 2, y, w - 4, 13);
  ctx.fillStyle = '#e7b24f'; ctx.fillRect(x + (facing > 0 ? 11 : 3), y + 4, 8, 5);
  ctx.fillStyle = '#d3a159'; ctx.fillRect(x + 1, y + h - 5, 8, 5); ctx.fillRect(x + w - 9, y + h - 5, 8, 5);
  if (debug) { ctx.strokeStyle = '#e04467'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); }
  ctx.restore();
}
