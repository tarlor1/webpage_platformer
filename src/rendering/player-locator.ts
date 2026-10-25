import type { Body } from '../engine/types';

export const LOCATOR_DURATION = 2400;

/** Viewport coordinates keep the marker visible even when its target is offscreen. */
export function locatorPose(player: Body, sx: number, sy: number, width: number, height: number, elapsed: number) {
  if (elapsed < 0 || elapsed >= LOCATOR_DURATION) return null;
  // Approach quickly, then slow down near the player.
  const approach = 1 - (1 - Math.min(elapsed / 900, 1))**3;
  
  // Decreases scale as time goes on
  const scale = 1 + 1.8 * (1 - approach);
  const margin = 40 * scale;
  const clamp = (value: number, extent: number) => Math.max(Math.min(margin, extent / 2), Math.min(extent - margin, value));
  
  // Center of screen
  const centerX = width / 2;
  const centerY = height / 2;
  
  const playerX = player.x + player.width / 2 - sx;
  const playerY = player.y + player.height / 2 - sy;
  const dx = playerX - centerX;
  const dy = playerY - centerY;
  const distance = Math.hypot(dx, dy);
  // At the exact screen center there is no direction; default to pointing down.
  const ux = distance > 0 ? dx / distance : 0;
  const uy = distance > 0 ? dy / distance : 1;
  const gap = Math.hypot(player.width, player.height) / 2 + 24 + 150 * (1 - approach);

  // Place the tip on the side of the player facing the viewport center.
  const x = clamp(playerX - ux * gap, width);
  const y = clamp(playerY - uy * gap, height);
  return {
    x, y, scale,
    angle: Math.atan2(playerY - y, playerX - x) - Math.PI / 2,
    opacity: Math.min(1, (LOCATOR_DURATION - elapsed) / 500),
  };
}

export function drawPlayerLocator(ctx: CanvasRenderingContext2D, player: Body, elapsed: number): void {
  const pose = locatorPose(player, scrollX, scrollY, innerWidth, innerHeight, elapsed);
  if (!pose) return;
  ctx.save();
  ctx.globalAlpha = pose.opacity;
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  ctx.scale(pose.scale, pose.scale);
  // The tip is the origin; the arrow points along its local positive Y axis.
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-12, -15); ctx.lineTo(-5, -15);
  ctx.lineTo(-5, -34); ctx.lineTo(5, -34); ctx.lineTo(5, -15);
  ctx.lineTo(12, -15); ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff4d6'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = '#15212b'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#ffd15c'; ctx.fill();
  ctx.restore();
}
