import { MOTION, type Body, type Platform } from './types';

export function createPlayer(x: number, y: number): Body {
  return { x, y, width: MOTION.width, height: MOTION.height, vx: 0, vy: 0, grounded: false };
}

/** Move the feet beyond the current top; lower platforms remain collidable. */
export function dropThrough(body: Body): boolean {
  if (!body.grounded) return false;
  body.y += 3;
  body.vy = 60;
  body.grounded = false;
  body.platformId = undefined;
  return true;
}

/** Swept top-edge collision: ascending bodies pass through; the earliest crossed top wins. */
export function stepBody(body: Body, platforms: readonly Platform[], dt: number): void {
  const oldX = body.x;
  const oldBottom = body.y + body.height;
  body.vy += MOTION.gravity * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.grounded = false;
  body.platformId = undefined;
  if (body.vy < 0) return;
  const newBottom = body.y + body.height;
  let landing: Platform | undefined;
  for (const p of platforms) {
    if (oldBottom > p.y + 0.25 || newBottom < p.y) continue;
    const fraction = newBottom === oldBottom ? 0 : (p.y - oldBottom) / (newBottom - oldBottom);
    const crossingX = oldX + (body.x - oldX) * Math.max(0, fraction);
    if (crossingX + body.width <= p.x + 1 || crossingX >= p.x + p.width - 1) continue;
    if (!landing || p.y < landing.y) landing = p;
  }
  if (landing) {
    body.y = landing.y - body.height;
    body.vy = 0;
    body.grounded = true;
    body.platformId = landing.id;
  }
}

export function supported(body: Body, platforms: readonly Platform[]): boolean {
  return platforms.some(p => Math.abs(body.y + body.height - p.y) < 2 && body.x + body.width > p.x + 2 && body.x < p.x + p.width - 2);
}
