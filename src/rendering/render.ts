import type { Body, Level } from '../engine/types';
import { drawScenery } from './scenery-art';
import type { SceneryScene } from './scenery-types';
import type { PagePickup } from '../progression/progression-types';
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
    if (!pickup.available || collected.has(pickup.id)
      || pickup.x + 8 < sx || pickup.x - 8 > sx + innerWidth
      || pickup.y + 8 < sy || pickup.y - 8 > sy + innerHeight) continue;
    if (pickup.kind === 'equipment') {
      const x = pickup.x, y = pickup.y;
      ctx.fillStyle = '#24343d';
      ctx.fillRect(x - 11, y - 11, 22, 20);
      ctx.strokeStyle = '#b9b3ff'; ctx.lineWidth = 1;
      ctx.strokeRect(x - 11, y - 11, 22, 20);
      ctx.fillStyle = pickup.equipment.color ?? '#ad874e';
      ctx.fillRect(x - 7, y - 8, 7, 12);
      ctx.fillRect(x - 7, y + 1, 15, 5);
      ctx.fillStyle = '#d8e3e8';
      ctx.fillRect(x - 6, y - 6, 5, 2);
      ctx.fillRect(x - 6, y - 2, 5, 2);
      ctx.fillRect(x - 7, y + 5, 16, 2);
      continue;
    }
    ctx.fillStyle = '#e7b24f';
    ctx.strokeStyle = '#704c25';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pickup.x, pickup.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff0ad'; ctx.fillRect(pickup.x - 1, pickup.y - 4, 2, 8);
  }
  for (const p of level.platforms) {
    if (debug) {
      const strip = scenery.ready ? scenery.placements.find(placement => placement.visible && placement.platformId === p.id) : undefined;
      ctx.strokeStyle = p.moving ? '#e5b755' : '#17b8b0'; ctx.lineWidth = 2; ctx.beginPath();
      if (strip) {
        if (strip.x > p.x) { ctx.moveTo(p.x, p.y); ctx.lineTo(strip.x, p.y); }
        if (strip.x + strip.width < p.x + p.width) { ctx.moveTo(strip.x + strip.width, p.y); ctx.lineTo(p.x + p.width, p.y); }
      } else { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.width, p.y); }
      ctx.stroke();
    }
    if (debug) {
      const label = (p.label ?? 'DOM').slice(0, 28);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#17343ee6'; ctx.fillRect(p.x, p.y - 16, ctx.measureText(label).width + 4, 12);
      ctx.fillStyle = '#8fe8de'; ctx.fillText(label, p.x + 2, p.y - 6);
    }
  }
  const { x, y, width: w, height: h } = player;
  // Trace the sprite silhouette rather than outlining its rectangular hitbox.
  // Adds an outline to the player
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + 2, y); ctx.lineTo(x + w - 2, y);
  ctx.lineTo(x + w - 2, y + 9); ctx.lineTo(x + w, y + 9);
  ctx.lineTo(x + w, y + 17); ctx.lineTo(x + w - 3, y + 17);
  ctx.lineTo(x + w - 3, y + h - 5); ctx.lineTo(x + w - 1, y + h - 5);
  ctx.lineTo(x + w - 1, y + h); ctx.lineTo(x + 1, y + h);
  ctx.lineTo(x + 1, y + h - 5); ctx.lineTo(x + 3, y + h - 5);
  ctx.lineTo(x + 3, y + 17); ctx.lineTo(x, y + 17);
  ctx.lineTo(x, y + 9); ctx.lineTo(x + 2, y + 9); ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#15212b'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = '#fff4d6'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();

  // Fills in the player
  ctx.fillStyle = '#202f39'; ctx.fillRect(x + 3, y + 10, w - 6, h - 10);
  ctx.fillStyle = '#70878b'; ctx.fillRect(x, y + 9, w, 8); ctx.fillRect(x + 2, y, w - 4, 13);
  ctx.fillStyle = '#e7b24f'; ctx.fillRect(x + (facing > 0 ? 11 : 3), y + 4, 8, 5);
  ctx.fillStyle = jumpBoots ? '#9bbfc8' : '#d3a159'; ctx.fillRect(x + 1, y + h - 5, 8, 5); ctx.fillRect(x + w - 9, y + h - 5, 8, 5);
  if (debug) { ctx.strokeStyle = '#e04467'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); }
  ctx.restore();
}
