import { JUMP_HEIGHT, JUMP_REACH, MOTION, type Level, type Platform } from './types';

// These margins account for discrete integration, imperfect takeoff position,
// and a little player reaction time. Physics remains the source of the limits.
const MAX_RISE = JUMP_HEIGHT - MOTION.jump * MOTION.step - 10;
const LANDING_MARGIN = 10;

function canJump(from: Platform, to: Platform): boolean {
  const rise = from.y - to.y;
  if (rise > MAX_RISE) return false;
  const flight = (MOTION.jump + Math.sqrt(MOTION.jump * MOTION.jump - 2 * MOTION.gravity * rise)) / MOTION.gravity;
  const gap = Math.max(0, to.x + LANDING_MARGIN - (from.x + from.width - LANDING_MARGIN),
    from.x + LANDING_MARGIN - (to.x + to.width - LANDING_MARGIN));
  return gap <= MOTION.speed * flight * 0.82 - MOTION.width;
}

/** Build a bounded, connected route without measuring or touching the page DOM. */
export function buildLevel(platforms: Platform[], previous?: { x: number; y: number }): Level {
  const left = window.scrollX;
  const top = window.scrollY;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const right = left + width;
  const bottom = top + height;
  const measured = platforms.filter(p => p.kind === 'dom').length;
  const surfaces = platforms.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)
    && Number.isFinite(p.width) && p.width >= MOTION.width + 8
    && p.x + p.width >= left - 240 && p.x <= right + 240
    && p.y >= top - 320 && p.y <= bottom + 320).slice(0, 220);
  const anchor = previous && previous.x + MOTION.width / 2 >= left
    && previous.x + MOTION.width / 2 <= right && previous.y >= top
    && previous.y + MOTION.height <= bottom ? previous : undefined;
  const centerX = anchor ? anchor.x + MOTION.width / 2 : left + width / 2;
  const centerY = anchor ? anchor.y + MOTION.height : top + height * 0.56;
  const visible = surfaces.filter(p => p.y >= top + MOTION.height + 12 && p.y <= bottom - 32
    && p.x + p.width >= left + 20 && p.x <= right - 20);
  let start: Platform | undefined;
  let bestScore = Infinity;
  for (const p of visible) {
    const nearestX = Math.max(p.x + MOTION.width / 2, Math.min(centerX, p.x + p.width - MOTION.width / 2));
    const score = Math.abs(nearestX - centerX) * 0.8 + Math.abs(p.y - centerY)
      + (p.width < 64 ? 65 : 0) + (anchor && p.y < centerY - 4 ? 45 : 0);
    if (score < bestScore) {
      start = p;
      bestScore = score;
    }
  }
  const bridgeWidth = Math.min(100, Math.max(60, width * 0.2));
  if (!start) {
    start = {
      id: 'bridge:spawn', kind: 'bridge', label: 'Launch platform',
      x: left + width / 2 - Math.min(180, width - 32) / 2,
      y: top + Math.max(MOTION.height + 24, height * 0.7), width: Math.min(180, width - 32),
    };
    surfaces.push(start);
  }
  const spawnCenter = Math.max(start.x + MOTION.width / 2 + 3,
    Math.min(centerX, start.x + start.width - MOTION.width / 2 - 3));
  const spawn = { x: spawnCenter - MOTION.width / 2, y: start.y - MOTION.height };

  // A broad nearby destination gives the short route a useful landing area.
  const destinationWidth = Math.min(220, Math.max(120, width - 48));
  let destination: Platform | undefined;
  let destinationScore = Infinity;
  for (const p of visible) {
    if (p === start || p.width < destinationWidth) continue;
    const dx = Math.abs(p.x + p.width / 2 - spawnCenter);
    const rise = start.y - p.y;
    if (dx > Math.min(560, width * 0.8) || rise > MAX_RISE * 3 || rise < -height * 0.35
      || (dx < 65 && Math.abs(rise) < 42)) continue;
    const score = dx * 0.35 + Math.abs(rise - MAX_RISE) + (rise < 0 ? 65 : 0);
    if (score < destinationScore) {
      destination = p;
      destinationScore = score;
    }
  }
  if (!destination) {
    const desiredX = spawnCenter + (spawnCenter < left + width / 2 ? 1 : -1) * Math.min(240, width * 0.32);
    const destinationCenter = Math.max(left + destinationWidth / 2 + 12,
      Math.min(right - destinationWidth / 2 - 12, desiredX));
    const desiredY = start.y - MAX_RISE * 1.55;
    destination = {
      id: 'bridge:destination', kind: 'bridge', label: 'Destination',
      x: destinationCenter - destinationWidth / 2,
      y: desiredY >= top + MOTION.height + 20 ? desiredY : Math.min(bottom - 30, start.y + 80),
      width: destinationWidth,
    };
    surfaces.push(destination);
  }

  // Prefer a route composed entirely of measured surfaces. Search only during
  // rebuilds, and retain all measured footholds for free exploration.
  const seen = new Set<Platform>([start]);
  const queue: Platform[] = [start];
  for (let index = 0; index < queue.length && !seen.has(destination); index++) {
    const from = queue[index];
    for (const candidate of surfaces) {
      if (!seen.has(candidate) && canJump(from, candidate)) {
        seen.add(candidate);
        queue.push(candidate);
      }
    }
  }
  if (!seen.has(destination)) {
    const targetCenter = destination.x + destination.width / 2;
    const dx = targetCenter - spawnCenter;
    const dy = destination.y - start.y;
    const steps = Math.max(2, Math.ceil(Math.abs(dx) / (JUMP_REACH * 0.55)),
      Math.ceil(Math.abs(dy) / (MAX_RISE * 0.65)));
    for (let i = 1; i < steps; i++) {
      const progress = i / steps;
      // Offset stacked routes so the player traverses visible stepping stones.
      const bend = Math.abs(dx) < 80 ? Math.sin(progress * Math.PI) * Math.min(100, width * 0.2) : 0;
      const bridgeCenter = Math.max(left + bridgeWidth / 2 + 8,
        Math.min(right - bridgeWidth / 2 - 8, spawnCenter + dx * progress + bend));
      const bridge: Platform = {
        id: `bridge:route:${i}`, kind: 'bridge', label: 'Stepping stone',
        x: bridgeCenter - bridgeWidth / 2, y: start.y + dy * progress, width: bridgeWidth,
      };
      surfaces.push(bridge);
    }
  }
  return {
    platforms: surfaces,
    spawn,
    bounds: {
      left: Math.max(0, left - 240), right: right + 240,
      top: Math.max(0, Math.min(top - 200, ...surfaces.map(p => p.y - MOTION.height - 40))),
      bottom: Math.max(bottom + 200, ...surfaces.map(p => p.y + 180)),
    },
    measured,
  };
}
