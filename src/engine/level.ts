import { MOTION, type Body, type Level, type Platform } from './types';

/** Choose an initial/manual spawn on a real visible surface. Never add terrain. */
export function buildLevel(platforms: Platform[]): Level {
  const left = scrollX;
  const top = scrollY;
  const right = left + innerWidth;
  const bottom = top + innerHeight;
  const centerX = left + innerWidth / 2;
  const centerY = top + innerHeight * 0.56;
  let spawn: Level['spawn'];
  let bestScore = Infinity;
  for (const p of platforms) {
    if (p.y < top + MOTION.height + 8 || p.y > bottom - 20) continue;
    const minX = Math.max(p.x + 3, left + 4);
    const maxX = Math.min(p.x + p.width - MOTION.width - 3, right - MOTION.width - 4);
    if (maxX < minX) continue;
    const x = Math.max(minX, Math.min(centerX - MOTION.width / 2, maxX));
    const score = Math.abs(x + MOTION.width / 2 - centerX) * 0.8 + Math.abs(p.y - centerY);
    if (score < bestScore) {
      bestScore = score;
      spawn = { x, y: p.y - MOTION.height };
    }
  }
  // Keep the array identity: targeted DOM samples can remove hidden surfaces.
  return { platforms, spawn };
}

/** Grounded riders remain attached even beyond the document bounds. */
export function outsidePage(body: Body, height: number): boolean {
  return !body.grounded && body.y > height + 64;
}

/**
 * Recover only after actual downward motion leaves the entire character below the viewport.
 * previousY is the world-space top before this frame's physics, so scrolling alone is inert.
 */
export function fellBelowViewport(body: Body, previousY: number, viewportBottom: number): boolean {
  return !body.grounded && body.vy > 0 && body.y > previousY && body.y > viewportBottom;
}
