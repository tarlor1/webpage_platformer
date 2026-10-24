import { coinId, eligibleLootPlatform } from './encounters';
import type { PageEncounter, PagePickup } from './progression-types';
import { MOTION, type Body, type Platform } from '../engine/types';

const EDGE_MARGIN = 3;
const LOW_LIFT = 18;
export const MAX_ACTIVE_PICKUPS = 24;
// Semi-implicit fixed-step integration loses at most jump * step / 2 of ideal height.
// Keep the highest coin inside the body swept by an ordinary stationary base jump.
const SAFE_LIFT = Math.min(120, MOTION.height + MOTION.jump * MOTION.jump / (2 * MOTION.gravity)
  - MOTION.jump * MOTION.step - 16);

function position(pickup: PagePickup, platform: Platform): void {
  const inset = Math.min(platform.width / 2, MOTION.width / 2 + EDGE_MARGIN);
  pickup.platformId = platform.id;
  pickup.x = platform.x + inset + Math.max(0, platform.width - inset * 2) * pickup.fraction;
  pickup.y = platform.y - pickup.lift;
  pickup.available = true;
}

function surfacesByKey(platforms: readonly Platform[]): Map<string, Platform> {
  const surfaces = new Map<string, Platform>();
  for (const platform of platforms) {
    if (!eligibleLootPlatform(platform)) continue;
    const current = surfaces.get(platform.logicalKey!);
    // Select one wrapped segment/clone, independently of discovery order or the player.
    if (!current || platform.width > current.width || (platform.width === current.width && platform.id < current.id)) {
      surfaces.set(platform.logicalKey!, platform);
    }
  }
  return surfaces;
}

/**
 * Each coin is directly reachable by walking its assigned native top and jumping vertically.
 * Even a six-pixel top supports a centered body; seven distinct lifts avoid narrow-top piles.
 * Geometry only changes anchors, never platform reward membership or persistent identity.
 */
export function planPickups(
  encounters: readonly PageEncounter[],
  platforms: readonly Platform[],
  previous: readonly PagePickup[] = [],
  collected?: ReadonlySet<string>,
): PagePickup[] {
  const existing = new Map(previous.map(pickup => [pickup.id, pickup]));
  const pickups: PagePickup[] = [];
  const seen = new Set<string>();
  const surfaces = surfacesByKey(platforms);
  for (const encounter of encounters) {
    const surface = surfaces.get(encounter.logicalKey);
    if (!surface) continue;
    for (let index = 0; index < encounter.coinCount; index++) {
      const id = coinId(encounter, index);
      if (seen.has(id) || collected?.has(id)) continue;
      seen.add(id);
      const pickup = existing.get(id) ?? {
        id, index, logicalKey: encounter.logicalKey, platformId: '',
        fraction: (index + 0.5) / encounter.coinCount,
        lift: LOW_LIFT + (SAFE_LIFT - LOW_LIFT) * index / (encounter.coinCount - 1),
        x: 0, y: 0, available: false,
      };
      position(pickup, surface);
      pickups.push(pickup);
    }
  }
  return pickups;
}

/** Missing sources retain claims/anchors but are explicitly unavailable for drawing and collision. */
export function updatePickups(pickups: readonly PagePickup[], platforms: readonly Platform[]): void {
  const surfaces = surfacesByKey(platforms);
  for (const pickup of pickups) {
    const platform = surfaces.get(pickup.logicalKey);
    if (platform) position(pickup, platform);
    else pickup.available = false;
  }
}

/** Reuse a bounded nearest-coin window; no per-step walk through the full page's loot. */
export function selectActivePickups(
  pickups: readonly PagePickup[],
  player: Pick<Body, 'x' | 'y' | 'platformId'>,
  output: PagePickup[] = [],
): PagePickup[] {
  output.length = 0;
  for (const pickup of pickups) {
    if (!pickup.available) continue;
    const priority = pickup.platformId === player.platformId ? 0 : 1;
    const distance = Math.abs(pickup.x - player.x) + Math.abs(pickup.y - player.y);
    let index = 0;
    for (; index < output.length; index++) {
      const current = output[index]!;
      const currentPriority = current.platformId === player.platformId ? 0 : 1;
      const currentDistance = Math.abs(current.x - player.x) + Math.abs(current.y - player.y);
      if (priority < currentPriority || priority === currentPriority
        && (distance < currentDistance || distance === currentDistance && pickup.id < current.id)) break;
    }
    if (index >= MAX_ACTIVE_PICKUPS) continue;
    const end = Math.min(output.length, MAX_ACTIVE_PICKUPS - 1);
    if (output.length < MAX_ACTIVE_PICKUPS) output.push(pickup);
    for (let move = end; move > index; move--) output[move] = output[move - 1]!;
    output[index] = pickup;
  }
  return output;
}
