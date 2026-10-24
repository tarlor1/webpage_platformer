import type { Platform } from './types';
import type { SceneryDesign, SceneryPlacement } from './scenery-types';

const EDGE_GAP = 4;
const MIN_SURFACE = 112;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function position(placement: SceneryPlacement, platform: Platform): void {
  placement.width = Math.min(platform.width - EDGE_GAP * 2, placement.design.width);
  placement.height = placement.design.height;
  placement.x = platform.x + EDGE_GAP + placement.fraction * (platform.width - EDGE_GAP * 2 - placement.width);
  placement.y = platform.y - placement.height - 6;
}

/**
 * Each original edge chooses its own material and anchor. Neither viewport bounds,
 * nearby candidates, nor text clearance can change that choice while scrolling.
 * Protected content is clipped by the renderer instead of hiding whole backdrops.
 */
export function placeScenery(designs: readonly SceneryDesign[], platforms: readonly Platform[], previous: readonly SceneryPlacement[] = []): SceneryPlacement[] {
  if (!designs.length) return [];
  const old = new Map(previous.map(placement => [placement.platformId, placement]));
  const placed: SceneryPlacement[] = [];
  for (const platform of platforms) {
    if (platform.width < MIN_SURFACE) continue;
    const rank = (hash(platform.id) ^ designs[0].rank) >>> 0;
    const design = designs[rank % designs.length];
    const cached = old.get(platform.id);
    const placement = cached?.design.id === design.id ? cached : {
      design, platformId: platform.id, fraction: ((rank >>> 8) % 5) / 4,
      x: 0, y: 0, width: 0, height: 0, visible: true,
    };
    placement.visible = true;
    position(placement, platform);
    placed.push(placement);
  }
  return placed;
}

/** Moving and resizing native edges carry their own material; no viewport respawn. */
export function updateScenery(placements: readonly SceneryPlacement[], platforms: readonly Platform[]): void {
  for (const placement of placements) {
    const platform = platforms.find(platform => platform.id === placement.platformId);
    placement.visible = !!platform && platform.width >= MIN_SURFACE;
    if (placement.visible) position(placement, platform!);
  }
}
