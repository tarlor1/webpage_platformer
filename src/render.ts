import type { Body, Level } from './types';
import { drawScenery } from './scenery-art';
import type { SceneryScene } from './scenery-types';
import type { PagePickup } from './progression-types';
export function drawWorld(ctx: CanvasRenderingContext2D, level: Level, player: Body, debug: boolean, facing: number, scenery: SceneryScene, pickups: readonly PagePickup[], collected: ReadonlySet<string>, jumpBoots: boolean): void {
  const sx = scrollX, sy = scrollY;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.save(); ctx.translate(-sx, -sy);
  if (scenery.ready) {
    drawScenery(ctx, scenery.placements);
    // Erase decoration pixels under protected content, including overlapping masks.
    // This layer is painted before all game geometry/character drawing.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    for (const rect of scenery.protectedRects) ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (scenery.reserved) {
      const rect = scenery.reserved;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
  }
  for (const pickup of pickups) {
    if (collected.has(pickup.id) || !level.platforms.some(platform => platform.id === pickup.platformId)) continue;
    ctx.fillStyle = '#e7b24f';
    ctx.strokeStyle = '#704c25';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pickup.x, pickup.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff0ad'; ctx.fillRect(pickup.x - 1, pickup.y - 4, 2, 8);
  }
  for (const p of level.platforms) {
    if (debug) {
      ctx.strokeStyle = p.moving ? '#e5b755' : '#17b8b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.width, p.y); ctx.stroke();
    }
    if (debug) {
      const label = (p.label ?? 'DOM').slice(0, 28);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#17343ee6'; ctx.fillRect(p.x, p.y - 16, ctx.measureText(label).width + 4, 12);
      ctx.fillStyle = '#8fe8de'; ctx.fillText(label, p.x + 2, p.y - 6);
    }
  }
  const { x, y, width: w, height: h } = player;
  ctx.fillStyle = '#202f39'; ctx.fillRect(x + 3, y + 10, w - 6, h - 10);
  ctx.fillStyle = '#70878b'; ctx.fillRect(x, y + 9, w, 8); ctx.fillRect(x + 2, y, w - 4, 13);
  ctx.fillStyle = '#e7b24f'; ctx.fillRect(x + (facing > 0 ? 11 : 3), y + 4, 8, 5);
  ctx.fillStyle = jumpBoots ? '#9bbfc8' : '#d3a159'; ctx.fillRect(x + 1, y + h - 5, 8, 5); ctx.fillRect(x + w - 9, y + h - 5, 8, 5);
  if (debug) { ctx.strokeStyle = '#e04467'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); }
  ctx.restore();
}
