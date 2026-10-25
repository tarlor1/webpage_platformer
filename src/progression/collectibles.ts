import { coinId, eligibleLootPlatform } from './encounters';
import type { CoinPickup, EquipmentPickup, PageEncounter, PagePickup } from './progression-types';
import { MOTION, type Platform } from '../engine/types';
import { worldEquipmentId } from './equipment-id';

const EDGE_MARGIN = 3;
const LOW_LIFT = 18;
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
  claimedEquipment?: ReadonlySet<string>,
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
      const cached = existing.get(id);
      const pickup: CoinPickup = cached?.kind === 'coin' ? cached : {
        kind: 'coin', id, index, logicalKey: encounter.logicalKey, platformId: '',
        fraction: (index + 0.5) / encounter.coinCount,
        lift: LOW_LIFT + (SAFE_LIFT - LOW_LIFT) * index / (encounter.coinCount - 1),
        x: 0, y: 0, available: false,
      };
      position(pickup, surface);
      pickups.push(pickup);
    }
    const equipment = encounter.equipment;
    const pickupId = worldEquipmentId(encounter.id);
    if (equipment?.slot === 'boots' && !seen.has(pickupId) && !claimedEquipment?.has(encounter.id) && !claimedEquipment?.has(pickupId)) {
      seen.add(pickupId);
      const cached = existing.get(pickupId);
      const pickup: EquipmentPickup = cached?.kind === 'equipment' ? cached : {
        kind: 'equipment', id: pickupId, equipment, encounterId: encounter.id, logicalKey: encounter.logicalKey,
        platformId: '', fraction: 0.5, lift: 14, x: 0, y: 0, available: false,
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

const PICKUP_CELL_SIZE = 256;
const COIN_RADIUS = 8;
const EQUIPMENT_RADIUS = 11;

interface PickupEntry {
  pickup: PagePickup;
  cellX: number;
  cellY: number;
  bucket: Set<PickupEntry>;
  revision: number;
}

/** Cached page-wide anchors; viewport and contact queries only visit nearby cells. */
export class PickupIndex {
  private readonly entries = new Map<string, PickupEntry>();
  private readonly rows = new Map<number, Map<number, Set<PickupEntry>>>();
  private revision = 0;

  update(pickups: readonly PagePickup[]): void {
    const revision = ++this.revision;
    for (const pickup of pickups) {
      if (!pickup.available) continue;
      const cellX = Math.floor(pickup.x / PICKUP_CELL_SIZE);
      const cellY = Math.floor(pickup.y / PICKUP_CELL_SIZE);
      let entry = this.entries.get(pickup.id);
      if (!entry) {
        const bucket = this.bucket(cellX, cellY);
        entry = { pickup, cellX, cellY, bucket, revision };
        bucket.add(entry);
        this.entries.set(pickup.id, entry);
      } else {
        entry.pickup = pickup;
        entry.revision = revision;
        if (entry.cellX !== cellX || entry.cellY !== cellY) {
          this.removeMembership(entry);
          entry.cellX = cellX;
          entry.cellY = cellY;
          entry.bucket = this.bucket(cellX, cellY);
          entry.bucket.add(entry);
        }
      }
    }
    for (const entry of this.entries.values()) {
      if (entry.revision === revision) continue;
      this.removeMembership(entry);
      this.entries.delete(entry.pickup.id);
    }
  }

  query(bounds: { x: number; y: number; width: number; height: number }, output: PagePickup[]): void {
    output.length = 0;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    // Store each center once and expand the query by the largest sprite radius.
    const minX = Math.floor((bounds.x - EQUIPMENT_RADIUS) / PICKUP_CELL_SIZE);
    const maxX = Math.floor((right + EQUIPMENT_RADIUS) / PICKUP_CELL_SIZE);
    const minY = Math.floor((bounds.y - EQUIPMENT_RADIUS) / PICKUP_CELL_SIZE);
    const maxY = Math.floor((bottom + EQUIPMENT_RADIUS) / PICKUP_CELL_SIZE);
    for (let y = minY; y <= maxY; y++) {
      const row = this.rows.get(y);
      if (!row) continue;
      for (let x = minX; x <= maxX; x++) {
        const bucket = row.get(x);
        if (!bucket) continue;
        for (const { pickup } of bucket) {
          if (!pickup.available) continue;
          const radius = pickup.kind === 'equipment' ? EQUIPMENT_RADIUS : COIN_RADIUS;
          if (pickup.x + radius >= bounds.x && pickup.x - radius <= right
            && pickup.y + radius >= bounds.y && pickup.y - radius <= bottom) output.push(pickup);
        }
      }
    }
  }

  private bucket(x: number, y: number): Set<PickupEntry> {
    let row = this.rows.get(y);
    if (!row) {
      row = new Map();
      this.rows.set(y, row);
    }
    let bucket = row.get(x);
    if (!bucket) {
      bucket = new Set();
      row.set(x, bucket);
    }
    return bucket;
  }

  private removeMembership(entry: PickupEntry): void {
    entry.bucket.delete(entry);
    if (entry.bucket.size !== 0) return;
    const row = this.rows.get(entry.cellY)!;
    row.delete(entry.cellX);
    if (row.size === 0) this.rows.delete(entry.cellY);
  }
}
