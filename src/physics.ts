import { MOTION, type Body, type Platform } from './types';

// Only explicit detachments need memory: a rising top must not immediately reclaim a jump or drop.
const detachedTops = new WeakMap<Body, string>();
const droppingBodies = new WeakSet<Body>();
const TOP_TOLERANCE = 0.25;

function at(previous: number | undefined, current: number, fraction: number): number {
  return (previous ?? current) + (current - (previous ?? current)) * fraction;
}

function overlaps(x: number, width: number, platformX: number, platformWidth: number): boolean {
  return x + width > platformX + 1 && x < platformX + platformWidth - 1;
}

export function createPlayer(x: number, y: number): Body {
  return { x, y, width: MOTION.width, height: MOTION.height, vx: 0, vy: 0, grounded: false };
}

/** Restore the same character on the current geometry of its last standing surface. */
export function respawnOnPlatform(body: Body, platform: Platform, offset: number): void {
  body.x = platform.x + Math.max(3, Math.min(offset, platform.width - body.width - 3));
  body.y = platform.y - body.height;
  body.vx = body.vy = 0;
  body.grounded = true;
  body.platformId = platform.id;
  detachedTops.delete(body);
  droppingBodies.delete(body);
}

/** Skip the supporting top until the whole body has passed beneath it; lower tops still collide. */
export function dropThrough(body: Body): boolean {
  if (!body.grounded) return false;
  if (body.platformId !== undefined) detachedTops.set(body, body.platformId);
  droppingBodies.add(body);
  body.y += 3;
  body.vy = 60;
  body.grounded = false;
  body.platformId = undefined;
  return true;
}

function riderPlatform(body: Body, platforms: readonly Platform[], from: number): Platform | undefined {
  if (body.vy < 0) {
    if (body.platformId !== undefined) detachedTops.set(body, body.platformId);
    droppingBodies.delete(body);
    return undefined;
  }
  if (!body.grounded) return undefined;
  for (const p of platforms) {
    if (p.id !== body.platformId || detachedTops.get(body) === p.id) continue;
    const x = at(p.previousX, p.x, from);
    const y = at(p.previousY, p.y, from);
    const width = at(p.previousWidth, p.width, from);
    if (Math.abs(body.y + body.height - y) <= TOP_TOLERANCE && overlaps(body.x, body.width, x, width)) return p;
  }
  return undefined;
}

function releaseDetachedTop(body: Body, platforms: readonly Platform[], from: number): void {
  const id = detachedTops.get(body);
  if (id === undefined) return;
  let p: Platform | undefined;
  for (const platform of platforms) {
    if (platform.id === id) {
      p = platform;
      break;
    }
  }
  if (!p || (droppingBodies.has(body)
    ? body.y >= at(p.previousY, p.y, from) + TOP_TOLERANCE
    : body.vy >= 0)) {
    detachedTops.delete(body);
    droppingBodies.delete(body);
  }
}

/** Transport an existing rider without gravity, velocity integration, or creating a new landing. */
export function carryBody(body: Body, platforms: readonly Platform[], from = 0, to = 1): boolean {
  releaseDetachedTop(body, platforms, from);
  const rider = riderPlatform(body, platforms, from);
  if (!rider) {
    body.grounded = false;
    body.platformId = undefined;
    return false;
  }
  body.x += at(rider.previousX, rider.x, to) - at(rider.previousX, rider.x, from);
  body.y += at(rider.previousY, rider.y, to) - at(rider.previousY, rider.y, from);
  return true;
}

/** Sweep feet relative to interpolated one-way tops; the earliest crossing owns the remaining ride. */
export function stepBody(body: Body, platforms: readonly Platform[], dt: number, from = 0, to = 1): void {
  releaseDetachedTop(body, platforms, from);
  const rider = riderPlatform(body, platforms, from);
  const oldX = body.x;
  const oldBottom = body.y + body.height;
  let carryX = 0;
  let carryY = 0;
  if (rider) {
    carryX = at(rider.previousX, rider.x, to) - at(rider.previousX, rider.x, from);
    carryY = at(rider.previousY, rider.y, to) - at(rider.previousY, rider.y, from);
  }
  if (!rider) body.vy += MOTION.gravity * dt;
  body.x += body.vx * dt + carryX;
  body.y += rider ? carryY : body.vy * dt;
  body.grounded = false;
  body.platformId = undefined;
  const newBottom = body.y + body.height;
  const detachedId = detachedTops.get(body);
  let landing = rider;
  let landingTime = Infinity;
  for (const p of platforms) {
    // Existing support is the fallback, so its resting contact cannot hide a later interception.
    if (p === rider || p.id === detachedId) continue;
    const startY = at(p.previousY, p.y, from);
    const endY = at(p.previousY, p.y, to);
    const startGap = oldBottom - startY;
    const endGap = newBottom - endY;
    const relativeTravel = endGap - startGap;
    if (startGap > TOP_TOLERANCE || endGap < 0 || relativeTravel <= 0) continue;
    const time = Math.max(0, -startGap / relativeTravel);
    if (time >= landingTime) continue;
    const fraction = from + (to - from) * time;
    const crossingX = oldX + (body.x - oldX) * time;
    if (!overlaps(crossingX, body.width, at(p.previousX, p.x, fraction), at(p.previousWidth, p.width, fraction))) continue;
    landing = p;
    landingTime = time;
  }
  if (landing) {
    // Keep the old carrier only until impact, then take the new carrier's remaining motion.
    if (landing !== rider) {
      const deltaX = at(landing.previousX, landing.x, to) - at(landing.previousX, landing.x, from);
      body.x += (deltaX - carryX) * (1 - landingTime);
    }
    body.y = at(landing.previousY, landing.y, to) - body.height;
    body.vy = 0;
    body.grounded = true;
    body.platformId = landing.id;
  }
}
