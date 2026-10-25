import type { Platform } from '../engine/types';
import { composedParent } from '../page/composed-dom';
import { readBounds, readLayout, readStyle } from '../page/frame-measurement';
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
  placement.y = platform.y - placement.height / 2;
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
interface Owner {
  chain: Element[];
  stacks: Element[];
  z: number[];
}
interface FrameState {
  platforms: Map<string, Platform>;
  candidates: Candidate[];
  entries: Map<SceneryPlacement, Candidate>;
  accepted: Candidate[];
  owners: Map<Element, Owner>;
  hits: Map<string, Element[]>;
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

function owner(element: Element, owners: Map<Element, Owner>): Owner {
  let result = owners.get(element);
  if (result) return result;
  const chain: Element[] = [], stacks: Element[] = [], z: number[] = [];
  for (let current: Element | null = element; current; current = composedParent(current)) chain.push(current);
  chain.reverse();
  for (let index = 0; index < chain.length; index++) {
    const current = chain[index], style = readStyle(current);
    const positioned = style.position && style.position !== 'static';
    const indexed = !!style.zIndex && style.zIndex !== 'auto'
      && (positioned || index > 0 && /flex|grid/.test(readStyle(chain[index - 1]).display));
    if (index === 0 || indexed || style.position === 'fixed' || style.position === 'sticky'
      || !!style.opacity && Number(style.opacity) < 1 || style.isolation === 'isolate'
      || !!style.transform && style.transform !== 'none' || !!style.filter && style.filter !== 'none'
      || !!style.perspective && style.perspective !== 'none' || /(?:paint|layout|strict|content)/.test(style.contain)
      || /(?:transform|opacity|filter|perspective)/.test(style.willChange)) {
      stacks.push(current); z.push(indexed ? Number.parseInt(style.zIndex) || 0 : 0);
    }
  }
  result = { chain, stacks, z };
  owners.set(element, result);
  return result;
}

/** Descendant edges own their wrapper's band; unrelated siblings follow native paint order. */
function priority(a: Candidate, b: Candidate, owners: Map<Element, Owner>, hits: Map<string, Element[]>): number {
  const left = surfaceMetadata(a.platform)?.element;
  const right = surfaceMetadata(b.platform)?.element;
  if (left && right && left !== right) {
    const first = owner(left, owners), second = owner(right, owners);
    let index = 0;
    while (index < first.chain.length && index < second.chain.length && first.chain[index] === second.chain[index]) index++;
    if (index === first.chain.length) return 1;
    if (index === second.chain.length) return -1;
    if (overlaps(a.placement, b.placement) && typeof document !== 'undefined'
      && typeof document.elementsFromPoint === 'function' && typeof scrollX === 'number'
      && typeof scrollY === 'number' && typeof innerWidth === 'number' && typeof innerHeight === 'number') {
      const x = (Math.max(0, a.placement.x - scrollX, b.placement.x - scrollX)
        + Math.min(innerWidth, a.placement.x + a.placement.width - scrollX, b.placement.x + b.placement.width - scrollX)) / 2;
      const y = (Math.max(0, a.placement.y - scrollY, b.placement.y - scrollY)
        + Math.min(innerHeight, a.placement.y + a.placement.height - scrollY, b.placement.y + b.placement.height - scrollY)) / 2;
      // Probe only a visible overlap, never the document registry; reuse identical probes.
      const key = `${x}:${y}`;
      let stack = hits.get(key);
      if (!stack) { stack = document.elementsFromPoint(x, y); hits.set(key, stack); }
      const leftIndex = stack.indexOf(left), rightIndex = stack.indexOf(right);
      if (leftIndex >= 0 && rightIndex >= 0 && leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    // Compare stacking contexts before DOM order, never discovery/player order.
    index = 0;
    while (index < first.stacks.length && index < second.stacks.length && first.stacks[index] === second.stacks[index]) index++;
    const z = (second.z[index] ?? 0) - (first.z[index] ?? 0);
    if (z) return z;
    const relation = (first.stacks[index] ?? left).compareDocumentPosition(second.stacks[index] ?? right);
    if (!(relation & 1)) {
      if (relation & 4) return 1;
      if (relation & 2) return -1;
    }
  }
  // Numeric-only consumers have no paint metadata: prefer one complete wider edge.
  return b.placement.width - a.placement.width || a.placement.platformId.localeCompare(b.placement.platformId);
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
    state = { platforms: new Map(), candidates: [], entries: new Map(), accepted: [], owners: new Map(), hits: new Map(), visibility: new Map(), masks: [] };
    frames.set(placements, state);
  }
  const { candidates, accepted, owners, hits, visibility, masks } = state;
  state.platforms.clear(); candidates.length = 0; accepted.length = 0; owners.clear(); hits.clear(); visibility.clear(); masks.length = 0;
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
  candidates.sort((a, b) => priority(a, b, owners, hits));
  for (const candidate of candidates) {
    const strip = candidate.placement;
    if (accepted.some(other => overlaps(strip, other.placement))) continue;
    // A blocked front edge must not reveal a lower owner's unrelated material.
    accepted.push(candidate);
    if (reserved && overlaps(strip, reserved)) continue;
    let blocked = false;
    for (const rect of masks) {
      if (overlaps(strip, rect) && !ownMediaEdge(candidate, rect)) { blocked = true; break; }
    }
    strip.visible = !blocked;
  }
}
