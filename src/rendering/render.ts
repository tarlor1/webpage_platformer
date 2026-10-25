import type { Body, Level } from '../engine/types';
import { drawScenery } from './scenery-art';
import type { SceneryScene } from './scenery-types';
import type { PagePickup } from '../progression/progression-types';
export function drawWorld(ctx: CanvasRenderingContext2D, level: Level, player: Body, debug: boolean, facing: number, scenery: SceneryScene, pickups: readonly PagePickup[], collected: ReadonlySet<string>, jumpBoots: boolean, gliding = false): void {
  const sx = scrollX, sy = scrollY;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.save(); ctx.translate(-sx, -sy);
  if (scenery.ready) drawScenery(ctx, scenery.placements);
  drawShopkeeper(ctx, scenery);
  for (const pickup of pickups) {
    if (!pickup.available || collected.has(pickup.id)) continue;
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
      const strips = scenery.ready ? scenery.placements.filter(placement => placement.visible
        && Math.abs(placement.y + placement.height / 2 - p.y) < placement.height / 2
        && placement.x < p.x + p.width && placement.x + placement.width > p.x).sort((a, b) => a.x - b.x) : [];
      ctx.strokeStyle = p.moving ? '#e5b755' : '#17b8b0'; ctx.lineWidth = 2; ctx.beginPath();
      let start = p.x;
      for (const strip of strips) {
        if (strip.x > start) { ctx.moveTo(start, p.y); ctx.lineTo(strip.x, p.y); }
        start = Math.max(start, strip.x + strip.width);
      }
      if (start < p.x + p.width) { ctx.moveTo(start, p.y); ctx.lineTo(p.x + p.width, p.y); }
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
  if (gliding) {
    ctx.fillStyle = '#d5a653';
    ctx.fillRect(x - 9, y - 8, w + 18, 3);
    ctx.fillStyle = '#f5cb7d';
    ctx.fillRect(x - 5, y - 5, 3, 5); ctx.fillRect(x + w + 2, y - 5, 3, 5);
  }
  ctx.fillStyle = jumpBoots ? '#9bbfc8' : '#d3a159'; ctx.fillRect(x + 1, y + h - 5, 8, 5); ctx.fillRect(x + w - 9, y + h - 5, 8, 5);
  if (debug) { ctx.strokeStyle = '#e04467'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); }
  ctx.restore();
}

function drawShopkeeper(ctx: CanvasRenderingContext2D, scenery: SceneryScene): void {
  if (!scenery.ready) return;
  const shopkeeper = scenery.shopkeeper;
  if (!shopkeeper) return;
  const placement = scenery.placements.find(item => item.platformId === shopkeeper.placementId);
  if (!placement?.visible) return;
  const base = placement.y + placement.height / 2;
  const x = placement.x;
  const y = base - 16;
  ctx.save();
  // Two 16x16 train sprites: a front engine with the merchant and an attached car.
  ctx.fillStyle = '#344953'; ctx.fillRect(x, y, 16, 16);
  ctx.fillStyle = '#ad874e'; ctx.fillRect(x + 16, y, 16, 16);
  ctx.fillStyle = '#18262d'; ctx.fillRect(x + 2, y + 9, 28, 4);
  ctx.fillStyle = '#e7b24f'; ctx.fillRect(x + 4, y + 2, 7, 6);
  ctx.fillStyle = '#202f39'; ctx.fillRect(x + 3, y - 3, 9, 4);
  ctx.fillStyle = '#18262d';
  ctx.beginPath(); ctx.arc(x + 4, y + 16, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 26, y + 16, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
