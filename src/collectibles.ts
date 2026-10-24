import { coinId } from './encounters';
import type { PageEncounter, PagePickup } from './progression-types';
import { MOTION, type Body, type Platform } from './types';

const MAX_CANDIDATES = 220;
const EDGE_MARGIN = 3;
const APEX_MARGIN = 12;
const FLIGHT_MARGIN = 0.05;
const LIFTS = [18, 48, 80] as const;
const HALF_BODY = MOTION.width / 2;

function leftCenter(platform: Platform): number {
  return platform.x + Math.min(platform.width / 2, HALF_BODY + EDGE_MARGIN);
}

function centerSpan(platform: Platform): number {
  return Math.max(0, platform.width - MOTION.width - EDGE_MARGIN * 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function position(pickup: PagePickup, platform: Platform): void {
  pickup.x = leftCenter(platform) + centerSpan(platform) * pickup.fraction;
  pickup.y = platform.y - pickup.lift;
}

/** A witnessed jump using base controls: run at full speed toward the landing, then release. */
function canJump(source: Platform, target: Platform, obstacles: readonly Platform[]): boolean {
  const deltaY = target.y - source.y;
  const apex = MOTION.jump * MOTION.jump / (2 * MOTION.gravity);
  if (deltaY < -apex + APEX_MARGIN) return false;
  const landingTime = (MOTION.jump + Math.sqrt(MOTION.jump * MOTION.jump + 2 * MOTION.gravity * deltaY)) / MOTION.gravity;
  const reach = MOTION.speed * (landingTime - FLIGHT_MARGIN);
  const sourceLeft = leftCenter(source);
  const sourceRight = sourceLeft + centerSpan(source);
  const targetLeft = leftCenter(target);
  const targetRight = targetLeft + centerSpan(target);
  if (Math.max(targetLeft - sourceRight, sourceLeft - targetRight) > reach) return false;

  const targetMiddle = (targetLeft + targetRight) / 2;
  const launches = [clamp(targetMiddle, sourceLeft, sourceRight), sourceLeft, sourceRight];
  for (const launch of launches) {
    const landings = [clamp(launch, targetLeft, targetRight), targetMiddle, targetLeft, targetRight];
    for (const landing of landings) {
      if (Math.abs(landing - launch) > reach) continue;
      const direction = Math.sign(landing - launch);
      let blocked = false;
      for (const obstacle of obstacles) {
        if (obstacle === target) continue;
        const discriminant = MOTION.jump * MOTION.jump + 2 * MOTION.gravity * (obstacle.y - source.y);
        if (discriminant < 0) continue;
        const crossing = (MOTION.jump + Math.sqrt(discriminant)) / MOTION.gravity;
        if (crossing >= landingTime - 1e-6 || crossing <= 0) continue;
        const x = launch + direction * Math.min(MOTION.speed * crossing, Math.abs(landing - launch));
        // Native tops are one-way. An earlier descending interception invalidates this route,
        // including landing back on the launch surface before reaching a lower target.
        if (x + HALF_BODY > obstacle.x + 1 && x - HALF_BODY < obstacle.x + obstacle.width - 1) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return true;
    }
  }
  return false;
}

/** Search directed native-surface edges, allowing a return through an already visited coin surface. */
function nextSurface(start: Platform, used: ReadonlySet<string>, candidates: readonly Platform[]): Platform | undefined {
  const queue = [start];
  const seen = new Set([start.id]);
  for (let head = 0; head < queue.length; head++) {
    for (const target of candidates) {
      if (seen.has(target.id) || !canJump(queue[head]!, target, candidates)) continue;
      if (!used.has(target.id)) return target;
      seen.add(target.id);
      queue.push(target);
    }
  }
  return undefined;
}

/**
 * Plan a collectable route on measured native terrain only. Geometry is local and bounded;
 * rewards themselves remain page-seeded. No boots are needed for any planned jump.
 */
export function planPickups(encounter: PageEncounter, platforms: readonly Platform[], origin: Body): PagePickup[] {
  const usable = platforms.filter(platform => Number.isFinite(platform.x + platform.y + platform.width)
    && platform.width >= MOTION.width + EDGE_MARGIN * 2);
  const standing = usable.find(platform => platform.id === origin.platformId)
    ?? usable.find(platform => Math.abs(platform.y - origin.y - origin.height) <= 4
      && origin.x + origin.width > platform.x + 1 && origin.x < platform.x + platform.width - 1);
  // Without an actual support there is no honest promise that even the first coin is reachable.
  if (!standing) return [];
  const centerX = origin.x + origin.width / 2;
  const distance = (platform: Platform): number => Math.abs(platform.y - standing.y)
    + Math.max(platform.x - centerX, centerX - platform.x - platform.width, 0);
  const candidates = usable.filter(platform => platform !== standing)
    .sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATES - 1);
  candidates.unshift(standing);

  const pickups: PagePickup[] = [];
  const used = new Set<string>();
  let surface = standing;
  for (let index = 0; index < encounter.coinCount; index++) {
    if (index > 0) surface = nextSurface(surface, used, candidates) ?? surface;
    used.add(surface.id);
    const siblings = pickups.filter(pickup => pickup.platformId === surface.id);
    const span = centerSpan(surface);
    let fraction = surface === standing && !siblings.length && span > 0
      ? clamp((centerX - leftCenter(surface)) / span, 0, 1) : 0.5;
    let lift: number = LIFTS[0];
    if (siblings.length) {
      let separation = -1;
      for (const candidate of [0, 1, 0.5, 0.25, 0.75]) {
        const gap = Math.min(...siblings.map(sibling => Math.abs(candidate - sibling.fraction) * span));
        if (gap > separation) { separation = gap; fraction = candidate; }
      }
      if (separation < 24) {
        fraction = siblings[0]!.fraction;
        lift = LIFTS[Math.min(siblings.length, LIFTS.length - 1)]!;
      }
    }
    const pickup: PagePickup = {
      id: coinId(encounter, index), index, platformId: surface.id, fraction, lift, x: 0, y: 0,
    };
    position(pickup, surface);
    pickups.push(pickup);
  }
  return pickups;
}

/** Stable native IDs and fractional anchors follow real motion/resize; absent sources stay retained. */
export function updatePickups(pickups: readonly PagePickup[], platforms: readonly Platform[]): void {
  for (const pickup of pickups) {
    const platform = platforms.find(platform => platform.id === pickup.platformId);
    if (platform) position(pickup, platform);
  }
}
