import type { Platform } from '../engine/types';
import { composedParent } from '../page/composed-dom';
import { readBounds, readLayout } from '../page/frame-measurement';
import { surfaceMetadata } from '../page/surface-metadata';
import type { Rect, SceneryDesign, SceneryPlacement } from './scenery-types';

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function position(placement: SceneryPlacement, platform: Platform): void {
  placement.width = platform.width;
  placement.height = placement.design.height;
  placement.x = platform.x;
  placement.y = platform.y - (placement.design.surfaceOffset ?? placement.height / 2);
}

/** A logical surface, including its clones and wrapped fragments, has one URL-seeded material. */
export function placeScenery(designs: readonly SceneryDesign[], platforms: readonly Platform[], previous: readonly SceneryPlacement[] = []): SceneryPlacement[] {
  if (!designs.length) return [];
  const designsById = new Map(designs.map(design => [design.id, design]));
  const placed = previous.filter(placement => designsById.has(placement.design.id));
  const old = new Map(placed.map(placement => [placement.platformId, placement]));
  for (const placement of placed) placement.visible = false;
  for (const platform of platforms) {
    if (platform.width <= 0 || !Number.isFinite(platform.width) || !Number.isFinite(platform.x + platform.width)
      || !Number.isFinite(platform.y) || surfaceMetadata(platform)?.text) continue;
    const logicalKey = platform.logicalKey ?? platform.id;
    const cached = old.get(platform.id);
    const design = cached?.logicalKey === logicalKey ? designsById.get(cached.design.id)!
      : designs[((hash(logicalKey) ^ designs[0].rank) >>> 0) % designs.length];
    const placement = cached ?? {
      design, platformId: platform.id, logicalKey,
      x: 0, y: 0, width: 0, height: 0, visible: false,
    };
    if (!cached) { placed.push(placement); old.set(platform.id, placement); }
    placement.logicalKey = logicalKey;
    placement.design = design;
    position(placement, platform);
  }
  updateScenery(placed, platforms);
  return placed;
}

interface Candidate {
  placement: SceneryPlacement;
  platform: Platform;
}
interface FrameState {
  platforms: Map<string, Platform>;
  candidates: Candidate[];
  entries: Map<SceneryPlacement, Candidate>;
  accepted: Candidate[];
  visibility: Map<Element, boolean>;
  masks: Rect[];
}
const frames = new WeakMap<readonly SceneryPlacement[], FrameState>();

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function visibleSurface(element: Element, cache: Map<Element, boolean>): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  let visible = element.isConnected !== false;
  if (visible) {
    const layout = readLayout(element);
    visible = layout.visibility !== 'hidden' && layout.visibility !== 'collapse';
    // Inherited visibility can be explicitly overridden by a child; display,
    // content-visibility and zero opacity on any ancestor cannot be overridden.
    for (let current: Element | null = element; visible && current; current = composedParent(current)) {
      if (readLayout(current).hidden) visible = false;
    }
  }
  cache.set(element, visible);
  return visible;
}

/** Prefer the widest complete native edge when two scenery strips overlap. */
function widerFirst(a: Candidate, b: Candidate): number {
  return b.placement.width - a.placement.width
    || a.placement.platformId.localeCompare(b.placement.platformId);
}

function ownMediaEdge(candidate: Candidate, rect: Rect): boolean {
  if (rect.kind !== 'media' || !rect.element) return false;
  const metadata = surfaceMetadata(candidate.platform);
  if (!metadata || metadata.text) return false;
  let related = false;
  for (let current: Element | null = rect.element; current; current = composedParent(current)) {
    if (current === metadata.element) { related = true; break; }
  }
  if (!related) return false;
  const bounds = readBounds(rect.element);
  const sx = typeof scrollX === 'number' ? scrollX : 0;
  const sy = typeof scrollY === 'number' ? scrollY : 0;
  const padding = rect.padding ?? 0;
  const top = Math.max(bounds.top + sy, rect.y + padding);
  const bottom = Math.min(bounds.bottom + sy, rect.y + rect.height - padding);
  const left = Math.max(bounds.left + sx, rect.x + padding);
  const right = Math.min(bounds.right + sx, rect.x + rect.width - padding);
  // The visible clipped border is safe; an arbitrary strip through the media body is not.
  return top < bottom && Math.abs(candidate.platform.y - top) <= 1
    && candidate.platform.x >= left - 1
    && candidate.platform.x + candidate.platform.width <= right + 1;
}

/** Resolve visible native owners before all-or-nothing content/HUD clearance. */
export function updateScenery(placements: readonly SceneryPlacement[], platforms: readonly Platform[], protectedRects: readonly Rect[] = [], reserved?: Rect): void {
  let state = frames.get(placements);
  if (!state) {
    state = { platforms: new Map(), candidates: [], entries: new Map(), accepted: [], visibility: new Map(), masks: [] };
    frames.set(placements, state);
  }
  const { candidates, accepted, visibility, masks } = state;
  state.platforms.clear(); candidates.length = 0; accepted.length = 0; visibility.clear(); masks.length = 0;
  for (const platform of platforms) state.platforms.set(platform.id, platform);
  const sx = typeof scrollX === 'number' ? scrollX : -Infinity;
  const sy = typeof scrollY === 'number' ? scrollY : -Infinity;
  const right = typeof innerWidth === 'number' && Number.isFinite(sx) ? sx + innerWidth : Infinity;
  const bottom = typeof innerHeight === 'number' && Number.isFinite(sy) ? sy + innerHeight : Infinity;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const placement of placements) {
    placement.visible = false;
    const platform = state.platforms.get(placement.platformId);
    if (!platform || platform.width <= 0 || !Number.isFinite(platform.width)
      || !Number.isFinite(platform.x + platform.width) || !Number.isFinite(platform.y)) continue;
    position(placement, platform);
    // Do not walk native ownership or read styles for the offscreen registry.
    if (placement.x + placement.width <= sx || placement.x >= right || placement.y + placement.height <= sy || placement.y >= bottom) continue;
    const metadata = surfaceMetadata(platform);
    if (metadata && (metadata.text || !visibleSurface(metadata.element, visibility))) continue;
    let candidate = state.entries.get(placement);
    if (!candidate) { candidate = { placement, platform }; state.entries.set(placement, candidate); }
    candidate.platform = platform;
    candidates.push(candidate);
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }
  if (!candidates.length) return;
  // Keep the complete edge's blockers, even outside the camera, so scrolling
  // cannot reveal a partial strip or switch a previously clean owner.
  for (const rect of protectedRects) {
    if (rect.x < maxX && rect.x + rect.width > minX && rect.y < maxY && rect.y + rect.height > minY) masks.push(rect);
  }
  candidates.sort(widerFirst);
  for (const candidate of candidates) {
    const strip = candidate.placement;
    if (accepted.some(other => overlaps(strip, other.placement))) continue;
    // A blocked front edge must not reveal a lower owner's unrelated material.
    accepted.push(candidate);
    // Checks if overlaps with extension toolbar, deemed unnecessary
    // if (reserved && overlaps(strip, reserved)) continue;
    let blocked = false;
    for (const rect of masks) {
      if (overlaps(strip, rect) && !ownMediaEdge(candidate, rect)) { blocked = true; break; }
    }
    strip.visible = !blocked;
  }
}
