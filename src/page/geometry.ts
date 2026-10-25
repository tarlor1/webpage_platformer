import { OVERLAY_ID, type Platform } from '../engine/types';
import { logicalSurfaceKey } from './surface-identity';
import { isDecorativeCanvas } from '../rendering/text-clearance';
import { composedParent } from './composed-dom';
import { mediaFrameOwner } from './media-owners';
import { readBounds, readLayout, readStyle } from './frame-measurement';
import { setSurfaceMetadata } from './surface-metadata';

const MAX_PLATFORMS = 220;
const SLICE_MS = 2;
const MAX_SLICE_STEPS = 192;
const CELL_HEIGHT = 512;
const MAX_CELL_SPAN = 64;
const ANIMATION_DISCOVERY_MS = 250;
const HOT_ROOT_RETRY_MS = 120;
const MAX_HOT_ROOTS = 48;
const IGNORED_TAGS: Record<string, true> = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true, OBJECT: true, EMBED: true };
const CONTROL_TAGS: Record<string, true> = { BUTTON: true, INPUT: true, SELECT: true, TEXTAREA: true };
// A box is terrain only when the element itself paints a visible surface.
// Layout-only wrappers must not become invisible platforms.
const STRUCTURAL_TAGS = new Set(['HTML', 'BODY', 'MAIN']);
const MIN_SURFACE_ALPHA = 0.025;

function paintedColor(value: string): boolean {
  if (!value || value === 'transparent') return false;
  const match = value.match(/^rgba?\((.+)\)$/i);
  if (!match) return true; // Named/hex/other supported CSS colors.
  const parts = match[1].split(/[\s,\/]+/).filter(Boolean);
  return parts.length < 4 || Number(parts[3]) > MIN_SURFACE_ALPHA;
}

function paintedBox(element: Element, style: CSSStyleDeclaration): boolean {
  if (STRUCTURAL_TAGS.has(element.tagName) || style.display === 'contents') return false;
  const background = paintedColor(style.backgroundColor) || style.backgroundImage !== 'none';
  const border = (['Top', 'Right', 'Bottom', 'Left'] as const).some(side =>
    parseFloat(style[`border${side}Width`]) > 0 &&
    style[`border${side}Style`] !== 'none' &&
    paintedColor(style[`border${side}Color`]));
  const outline = parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none' && paintedColor(style.outlineColor);
  const shadow = style.boxShadow !== 'none';
  return background || border || outline || shadow;
}

// SVG primitives have no HTML box model. Convert their local painted bounds to
// viewport coordinates through the SVG's current transformation matrix.
const SVG_SHAPES = new Set(['rect', 'line', 'path', 'polyline', 'polygon', 'circle', 'ellipse']);
function svgShapeRects(element: Element): DOMRect[] {
  if (!(element instanceof SVGGraphicsElement) || !SVG_SHAPES.has(element.localName)) return [];
  const style = readStyle(element);
  if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return [];
  const fill = style.fill !== 'none' && paintedColor(style.fill);
  const stroke = style.stroke !== 'none' && paintedColor(style.stroke) && parseFloat(style.strokeWidth) > 0;
  if (!fill && !stroke) return [];
  try {
    const box = element.getBBox();
    const matrix = element.getScreenCTM();
    if (!matrix) return [];
    const pad = stroke ? Math.min(12, parseFloat(style.strokeWidth) / 2 || 0) : 0;
    const corners = [
      [box.x - pad, box.y - pad], [box.x + box.width + pad, box.y - pad],
      [box.x - pad, box.y + box.height + pad], [box.x + box.width + pad, box.y + box.height + pad],
    ].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f }));
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    // The physics engine uses horizontal tops. Curves/diagonal paths are a
    // bounding-box approximation, not pixel-perfect shape collisions.
    return right - left >= 30 && bottom - top >= 0 ? [new DOMRect(left, top, right - left, Math.max(4, bottom - top))] : [];
  } catch { return []; }
}


interface Area { left: number; right: number; top: number; bottom: number }
interface Clip { element: Element; x: boolean; y: boolean }
interface Source {
  node: Element | Text;
  element: Element;
  range?: Range;
  text: boolean;
  label: string;
  logicalKey: string;
  identityDirty: boolean;
  topologyDirty: boolean;
  platforms: Map<number, Platform>;
  spare: Map<number, Platform>;
  animated: boolean;
  pending: number;
  continuous: boolean;
  structural: boolean;
  documentScroll: boolean;
  scrollers: Element[];
  ancestors: Element[];
  owners: Node[];
  clips: Clip[];
  area?: Area;
  read?: SourceRead;
  refreshAgain: boolean;
  inspected: WeakMap<Inspection, number>;
  sampled: number;
}
interface SourceRead {
  next: Map<number, Platform>;
  rects: DOMRectList | DOMRect[];
  index: number;
  retainedIndex: number;
  old?: MapIterator<[number, Platform]>;
  clipped?: Area;
  area?: Area;
  scrollX: number;
  scrollY: number;
  moved: boolean;
  reflow: boolean;
  logicalKey: string;
  frame: number;
}
interface Inspection {
  root: Node;
  ancestors: Node[];
  serial: number;
  continuous: boolean;
  discover: boolean;
  started: boolean;
  repeat: boolean;
  priority: boolean;
  sources?: SetIterator<Source>;
  misses?: SetIterator<Text>;
  checkedMisses: boolean;
  walker?: TreeWalker;
  first: boolean;
  walking: boolean;
}
interface Selection {
  iterator: Generator<Platform>;
  seen: Set<Platform>;
  candidates: Platform[];
}
interface AnimationScan {
  tree: Document | ShadowRoot;
  animations: Animation[];
  index: number;
  targets: Set<Element>;
  removing?: SetIterator<Element>;
  adding?: SetIterator<Element>;
  phase?: 'remove' | 'add';
}

function overlaps(a: Area, b: Area): boolean {
  return a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;
}

/** Cached document-space buckets: querying a viewport never reads native layout. */
class GeometryIndex<T extends object> {
  private cells = new Map<number, Set<T>>();
  private entries = new Map<T, { first: number; last: number }>();
  private large = new Set<T>();

  update(value: T, area: Area): void {
    const first = Math.floor(area.top / CELL_HEIGHT);
    const last = Math.floor(area.bottom / CELL_HEIGHT);
    const old = this.entries.get(value);
    if (old && old.first === first && old.last === last) return;
    if (old) this.remove(value);
    this.entries.set(value, { first, last });
    if (last - first > MAX_CELL_SPAN) { this.large.add(value); return; }
    for (let cell = first; cell <= last; cell++) {
      let bucket = this.cells.get(cell);
      if (!bucket) { bucket = new Set(); this.cells.set(cell, bucket); }
      bucket.add(value);
    }
  }

  remove(value: T): void {
    const entry = this.entries.get(value);
    if (!entry) return;
    this.entries.delete(value);
    if (entry.last - entry.first > MAX_CELL_SPAN) { this.large.delete(value); return; }
    for (let cell = entry.first; cell <= entry.last; cell++) {
      const bucket = this.cells.get(cell);
      bucket?.delete(value);
      if (!bucket?.size) this.cells.delete(cell);
    }
  }

  *query(areas: readonly Area[]): Generator<T> {
    // Callers deduplicate while consuming bounded chunks. No full bucket copy.
    for (const area of areas) {
      const first = Math.floor(area.top / CELL_HEIGHT);
      const last = Math.floor(area.bottom / CELL_HEIGHT);
      for (let cell = first; cell <= last; cell++) {
        const bucket = this.cells.get(cell);
        if (!bucket) continue;
        yield* bucket;
      }
      yield* this.large;
    }
  }

  clear(): void { this.cells.clear(); this.entries.clear(); this.large.clear(); }
}

/** Incremental DOM measurement, separate from simulation. Coordinates are document CSS pixels. */
export class PageGeometry {
  /** Queued work drains internally; callers need no synchronous follow-up scan. */
  needsRebuild = false;
  private ids = new WeakMap<Node, number>();
  private nextId = 1;
  private sources = new Set<Source>();
  private byNode = new WeakMap<Node, Source>();
  private descendants = new Map<Node, Set<Source>>();
  private inspectedNodes = new WeakSet<Node>();
  private deferredText = new Map<Node, Set<Text>>();
  private deferredOwners = new WeakMap<Text, Node[]>();
  private platformOwners = new Map<string, { source: Source; index: number }>();
  private platforms: Platform[] = [];
  private selected = new Set<Platform>();
  private registry: Platform[] = [];
  private registryIndices = new Map<Platform, number>();
  private changedPlatforms = new Set<Platform>();
  private readyPlatforms = new Set<Platform>();
  private sourceIndex = new GeometryIndex<Source>();
  private platformIndex = new GeometryIndex<Platform>();
  private sourceQueue = new Set<Source>();
  private backgroundInspections = new Set<Inspection>();
  private inspections = new Map<Node, Inspection>();
  private inspectionDescendants = new Map<Node, Set<Inspection>>();
  private hotInspections = new Set<Inspection>();
  private hotSources = new Set<Source>();
  private hotSampled = new WeakMap<Element, number>();
  private hotPoint = 0;
  private nextHotQuery = 0;
  private serial = 0;
  private documentSources = new Set<Source>();
  private scrollerSources = new Map<Element, Set<Source>>();
  private scrollQueue = new Map<EventTarget, { sources: Set<Source>; iterator: SetIterator<Source>; repeat: boolean }>();
  private animatedSources = new Set<Source>();
  private animationCursor?: SetIterator<Source>;
  private animationTargets = new Set<Element>();
  private treeAnimations = new Map<Document | ShadowRoot, Set<Element>>();
  private animationCounts = new Map<Element, number>();
  private animationScan?: AnimationScan;
  private animationTrees?: ArrayIterator<Document | ShadowRoot>;
  private roots = new Set<ShadowRoot>();
  private shadowHosts = new Set<Element>();
  private hostCursor?: SetIterator<Element>;
  private nextHostInspection = 0;
  private nextAnimationDiscovery = 0;
  private viewport: Area = { left: 0, right: 0, top: 0, bottom: 0 };
  private lookahead: Area = { left: 0, right: 0, top: 0, bottom: 0 };
  private lastScrollY = window.scrollY;
  private scrollDirection = 1;
  private interest?: Area;
  private interestPoint?: { x: number; y: number };
  private interestX?: number;
  private interestY?: number;
  private retained?: { source: Source; index: number; id: string };
  private selection?: Selection;
  private selectionDirty = true;
  private activeCursor?: Generator<Source>;
  private activeSeen = new Set<Source>();
  private nextActiveQuery = 0;
  private frame = 0;
  private drainTurn = 0;
  registryRevision = 0;
  selectionRevision = 0;

  get registryPlatforms(): readonly Platform[] { return this.registry; }
  get shadowRoots(): ReadonlySet<ShadowRoot> { return this.roots; }
  get inspecting(): boolean {
    return !!(this.inspections.size || this.sourceQueue.size || this.scrollQueue.size || this.animationScan || this.selection || this.readyPlatforms.size);
  }

  /** Request a broad refresh without replacing connected cache entries or the live level array. */
  rebuild(interest?: { x: number; y: number }): Platform[] {
    this.setInterest(interest);
    if (document.documentElement) this.enqueueInspection(document.documentElement, false, true);
    this.needsRebuild = false;
    return this.platforms;
  }

  setInterest(interest?: { x: number; y: number }): void {
    this.interestPoint = interest;
    this.updateAreas();
  }

  /** Only measured/changed edges need simulation endpoints committed. */
  commitMotion(): void {
    for (const platform of this.changedPlatforms) {
      platform.previousX = platform.x;
      platform.previousY = platform.y;
      platform.previousWidth = platform.width;
      platform.discontinuous = false;
      platform.reflow = false;
    }
    this.changedPlatforms.clear();
  }

  /** Critical support first, then bounded active reads and fair discovery/dirty continuations. */
  sampleMotion(): void {
    this.frame++;
    this.updateAreas();
    const start = performance.now();
    const deadline = start + SLICE_MS;
    const retained = this.retained?.source;
    if (retained) {
      this.primeSource(retained);
      this.advanceSource(retained, deadline, true);
    }
    // Selected physics handles are bounded; they never require a registry/source scan.
    for (const platform of this.platforms) {
      if (performance.now() >= start + 0.45) break;
      const source = this.platformOwners.get(platform.id)?.source;
      if (!source || source === retained || source.sampled === this.frame) continue;
      this.primeSource(source);
      if (source.animated || source.pending || source.read) this.advanceSource(source, deadline);
    }
    this.sampleActiveSources(start + 0.75);
    this.sampleHotRoots(start + 1.25);
    this.sampleAnimatedSources(start + 1.35);
    // These probes also get a bounded turn while a long discovery pass is pending.
    if (performance.now() < start + 1.45) this.inspectAnimations(start + 1.45);
    if (performance.now() < start + 1.5) this.inspectShadowHosts(start + 1.5);
    // Even a costly native read cannot permanently starve the document continuation.
    this.drainStep(deadline);
    for (let step = 1; step < MAX_SLICE_STEPS && performance.now() < deadline; step++) {
      if (!this.drainStep(deadline)) break;
    }
    this.selectPlatforms(deadline);
  }

  /** Ordinary document scrolling only invalidates indexed fixed/sticky descendants. */
  markScrolled(target: EventTarget | null): void {
    const documentScroll = !target || target === document || target === window || target === document.scrollingElement;
    const key = documentScroll ? document : target;
    const sources = documentScroll ? this.documentSources : target instanceof Element ? this.scrollerSources.get(target) : undefined;
    if (sources && key) {
      const queued = this.scrollQueue.get(key);
      if (queued) queued.repeat = true;
      else this.scrollQueue.set(key, { sources, iterator: sources.values(), repeat: false });
    }
    this.updateAreas();
  }

  /** Pin support independently of viewport, selection budget, and source-discovery progress. */
  retainPlatform(id: string): void {
    if (this.retained?.id === id) return;
    const owner = this.platformOwners.get(id);
    if (!owner) return;
    this.retained = { ...owner, id };
    this.selectionDirty = true;
  }

  /** Queue/coalesce mutation roots; callbacks never walk their source subtrees. */
  markChanged(target: Node, continuous = false, discover = true): void {
    const stylesheet = target instanceof Element && (target.tagName === 'STYLE' || target.tagName === 'LINK')
      || target.parentElement?.tagName === 'STYLE';
    if (stylesheet) { this.enqueueInspection(document.documentElement, false, true); return; }
    if (target === document) target = document.documentElement;
    // A text edit also changes the logical content of adjacent wrapped segments.
    if (target.nodeType === Node.TEXT_NODE) target = composedParent(target) ?? target;
    if (continuous) discover = !this.inspectedNodes.has(target);
    const source = this.byNode.get(target);
    const priority = target.isConnected && (source?.area && overlaps(source.area, this.lookahead)
      || target instanceof Element && (this.hotSampled.get(target) ?? -Infinity) + HOT_ROOT_RETRY_MS * 2 >= performance.now());
    this.enqueueInspection(target, continuous, discover, !!priority);
    // A media/control owner can derive its label/identity from changed descendants.
    for (let parent = composedParent(target); parent; parent = composedParent(parent)) {
      const source = this.byNode.get(parent);
      if (source) this.invalidateSource(source, continuous);
    }
  }

  clear(): void {
    for (const source of this.sources) source.range?.detach();
    this.sources.clear();
    this.byNode = new WeakMap();
    this.descendants.clear();
    this.inspectedNodes = new WeakSet();
    this.deferredText.clear();
    this.deferredOwners = new WeakMap();
    this.platformOwners.clear();
    this.selected.clear();
    this.platforms.length = 0;
    this.registry.length = 0;
    this.registryIndices.clear();
    this.changedPlatforms.clear();
    this.readyPlatforms.clear();
    this.sourceIndex.clear();
    this.backgroundInspections.clear();
    this.platformIndex.clear();
    this.sourceQueue.clear();
    this.inspections.clear();
    this.inspectionDescendants.clear();
    this.hotInspections.clear();
    this.hotSources.clear();
    this.hotSampled = new WeakMap();
    this.hotPoint = this.nextHotQuery = 0;
    this.lastScrollY = window.scrollY;
    this.scrollDirection = 1;
    this.scrollQueue.clear();
    this.documentSources.clear();
    this.scrollerSources.clear();
    this.animatedSources.clear();
    this.animationCursor = undefined;
    this.animationTargets.clear();
    this.treeAnimations.clear();
    this.animationCounts.clear();
    this.animationScan = undefined;
    this.animationTrees = undefined;
    this.roots.clear();
    this.shadowHosts.clear();
    this.hostCursor = undefined;
    this.ids = new WeakMap();
    this.nextId = 1;
    this.nextAnimationDiscovery = this.nextHostInspection = this.nextActiveQuery = 0;
    this.needsRebuild = false;
    this.interest = this.interestPoint = undefined;
    this.interestX = this.interestY = undefined;
    this.retained = this.selection = this.activeCursor = undefined;
    this.activeSeen.clear();
    this.selectionDirty = true;
    this.registryRevision++;
    this.selectionRevision++;
  }

  private excluded(element: Element): boolean {
    return element.id === OVERLAY_ID || !!IGNORED_TAGS[element.tagName];
  }

  private createSource(node: Element | Text): Source | undefined {
    const text = node.nodeType === Node.TEXT_NODE;
    const element = text ? composedParent(node) : node as Element;
    if (!element) return;
    const owner = mediaFrameOwner(element);
    if (owner && owner !== element) return;
    let label: string;
    let range: Range | undefined;
    if (text) {
      if (!(node as Text).data.trim() || element.closest('button, input, select, textarea, [role="textbox"], [contenteditable=""], [contenteditable="true"], svg, canvas')) {
        this.forgetDeferredText(node as Text);
        return;
      }
      const style = readStyle(element);
      if (Number.parseFloat(style.fontSize) < 8 || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)') {
        this.deferText(node as Text);
        return;
      }
      label = (node as Text).data.trim().replace(/\s+/g, ' ').slice(0, 70);
      range = document.createRange();
    } else {
      const svgShape = element.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SHAPES.has(element.localName);
      const control = CONTROL_TAGS[element.tagName] || element.getAttribute('role') === 'button' || element.getAttribute('role') === 'textbox';
      const style = readStyle(element);
      const background = style.backgroundImage !== 'none';
      const image = element.tagName === 'IMG' || element.tagName === 'VIDEO' || element.tagName === 'IFRAME'
        || element.tagName === 'CANVAS' || element.getAttribute('role') === 'img' || background || !!owner;
      const painted = paintedBox(element, style);
      if ((!control && !image && !painted && !svgShape) || element.getAttribute('type') === 'hidden') return;
      const bounds = readBounds(element);
      if (isDecorativeCanvas(element, style, bounds)) return;
      if (painted && !svgShape && !control && !owner && !/^(IMG|VIDEO|IFRAME|CANVAS)$/.test(element.tagName)
        && (bounds.width > innerWidth * 1.2 || bounds.height > innerHeight * 1.2)) {
        // Transformed backgrounds can be much larger than their painted frame.
        // Apply the same overflow ancestry as measurement before judging size;
        // viewport cropping alone does not turn a page-wide backdrop into terrain.
        let left = bounds.left, right = bounds.right, top = bounds.top, bottom = bounds.bottom;
        for (let parent = composedParent(element); parent; parent = composedParent(parent)) {
          if (parent === document.body || parent === document.documentElement) continue;
          const layout = readLayout(parent);
          if (!layout.clipX && !layout.clipY) continue;
          const frame = readBounds(parent);
          if (layout.clipX) { left = Math.max(left, frame.left); right = Math.min(right, frame.right); }
          if (layout.clipY) { top = Math.max(top, frame.top); bottom = Math.min(bottom, frame.bottom); }
        }
        if (right - left > innerWidth * 1.2 || bottom - top > innerHeight * 1.2) return;
      }
      // Empty alt is an accessibility choice, not evidence that an image has no
      // visible physical surface. Large hero and promotional images count too.
      label = owner ? 'Video player' : (element.getAttribute('aria-label') || element.getAttribute('alt')
        || element.getAttribute('value') || element.textContent || element.tagName).trim().slice(0, 70);
    }
    if (!this.ids.has(node)) this.ids.set(node, this.nextId++);
    if (text) this.forgetDeferredText(node as Text);
    return { node, element, range, text, label, logicalKey: '', identityDirty: true, topologyDirty: true,
      platforms: new Map(), spare: new Map(), animated: false, pending: 1, continuous: false, structural: false,
      documentScroll: false, scrollers: [], ancestors: [], owners: [], clips: [], refreshAgain: false,
      inspected: new WeakMap(), sampled: 0 };
  }

  private deferText(text: Text): void {
    const owners = new Set<Node>([text]);
    for (let element = composedParent(text); element; element = composedParent(element)) {
      owners.add(element);
      const root = element.getRootNode();
      if (root instanceof ShadowRoot) owners.add(root);
    }
    const previous = this.deferredOwners.get(text);
    if (previous && previous.length === owners.size && previous.every(owner => owners.has(owner))) return;
    this.forgetDeferredText(text);
    this.deferredOwners.set(text, [...owners]);
    for (const owner of owners) {
      let misses = this.deferredText.get(owner);
      if (!misses) { misses = new Set(); this.deferredText.set(owner, misses); }
      misses.add(text);
    }
  }

  private forgetDeferredText(text: Text): void {
    const owners = this.deferredOwners.get(text);
    if (!owners) return;
    this.deferredOwners.delete(text);
    for (const owner of owners) {
      const misses = this.deferredText.get(owner);
      misses?.delete(text);
      if (!misses?.size) this.deferredText.delete(owner);
    }
  }

  private enqueueInspection(root: Node, continuous: boolean, discover: boolean, priority = false): void {
    if (!root) return;
    for (let node: Node | null = root; node; node = composedParent(node)) {
      const covering = this.inspections.get(node);
      if (!covering) continue;
      // Rendered roots must not wait for an unrelated document-wide continuation.
      if (priority && node !== root) continue;
      // Dirty-only parents do not turn an added local root into a broad walk,
      // and a light-DOM TreeWalker cannot cover an open shadow tree.
      if (discover && node !== root && (!covering.discover || covering.root.getRootNode() !== root.getRootNode())) continue;
      covering.continuous &&= continuous;
      covering.discover ||= discover;
      covering.serial = ++this.serial;
      covering.repeat ||= covering.started;
      if (priority) this.prioritizeInspection(covering);
      return;
    }
    // Root ancestry indexes coalesce covered work without scanning unrelated roots.
    const covered = priority ? undefined : this.inspectionDescendants.get(root);
    if (covered) for (const work of [...covered]) {
      if (work.priority || work.discover && (!discover || work.root.getRootNode() !== root.getRootNode())) continue;
      continuous &&= work.continuous;
      this.removeInspection(work);
    }
    const ancestors: Node[] = [];
    for (let node: Node | null = root; node; node = composedParent(node)) ancestors.push(node);
    const work: Inspection = { root, ancestors, serial: ++this.serial, continuous, discover, priority,
      started: false, repeat: false, first: true, walking: priority && discover, checkedMisses: priority && discover };
    this.inspections.set(root, work);
    if (priority) this.hotInspections.add(work);
    else this.backgroundInspections.add(work);
    for (const ancestor of ancestors) {
      let pending = this.inspectionDescendants.get(ancestor);
      if (!pending) { pending = new Set(); this.inspectionDescendants.set(ancestor, pending); }
      pending.add(work);
    }
  }

  private removeInspection(work: Inspection): void {
    this.inspections.delete(work.root);
    this.hotInspections.delete(work);
    this.backgroundInspections.delete(work);
    for (const ancestor of work.ancestors) {
      const pending = this.inspectionDescendants.get(ancestor);
      pending?.delete(work);
      if (!pending?.size) this.inspectionDescendants.delete(ancestor);
    }
  }

  private prioritizeInspection(work: Inspection): void {
    if (!work.priority && work.discover) {
      work.walking = work.checkedMisses = true;
      work.first = true;
      work.walker = undefined;
    }
    work.priority = true;
    this.backgroundInspections.delete(work);
    this.hotInspections.add(work);
  }

  private invalidateSource(source: Source, continuous: boolean, work?: Inspection): void {
    if (work) {
      if ((source.inspected.get(work) ?? 0) >= work.serial) return;
      source.inspected.set(work, work.serial);
    }
    source.pending = Math.max(source.pending, 3);
    if (!continuous) {
      source.identityDirty = source.topologyDirty = source.structural = true;
      source.continuous = false;
    } else if (!source.structural) source.continuous = true;
    if (source.read) source.refreshAgain = true;
    this.sourceQueue.add(source);
  }

  private primeSource(source: Source): void {
    for (const ancestor of source.owners) {
      const work = this.inspections.get(ancestor);
      if (work) this.invalidateSource(source, work.continuous, work);
    }
    if (this.scrollQueue.has(document) && source.documentScroll
      || source.scrollers.some(scroller => this.scrollQueue.has(scroller))) {
      source.pending = Math.max(source.pending, 2);
      if (!source.structural) source.continuous = true;
    }
  }

  private drainStep(deadline: number): boolean {
    // Round-robin queue kinds ensure broad scans eventually pass every node/rect.
    for (let attempt = 0; attempt < 3; attempt++) {
      const turn = this.drainTurn++ % 3;
      if (turn === 0 && this.sourceQueue.size) {
        const source = this.sourceQueue.values().next().value!;
        this.sourceQueue.delete(source);
        if (source.sampled !== this.frame || source.read) this.advanceSource(source, deadline);
        else if (source.pending) this.sourceQueue.add(source);
        return true;
      }
      if (turn === 1 && this.inspections.size) {
        // Hot roots already have their own earlier slice. They must not dilute
        // the document continuation's guaranteed background turn as well.
        const queue = this.backgroundInspections.size ? this.backgroundInspections : this.hotInspections;
        const work = queue.values().next().value!;
        this.advanceInspection(work);
        if (queue.delete(work)) queue.add(work);
        return true;
      }
      if (turn === 2 && this.scrollQueue.size) {
        const [target, work] = this.scrollQueue.entries().next().value!;
        const next = work.iterator.next();
        if (next.done) {
          if (work.repeat) { work.repeat = false; work.iterator = work.sources.values(); }
          else this.scrollQueue.delete(target);
        }
        else {
          const source = next.value;
          source.pending = Math.max(source.pending, 2);
          if (!source.structural) source.continuous = true;
          this.sourceQueue.add(source);
        }
        return true;
      }
    }
    return false;
  }

  private advanceInspection(work: Inspection): void {
    if (!work.root.isConnected) {
      // Cached descendant handles still need retirement after their parent is removed.
      work.discover = false;
    }
    if (!work.started) {
      work.started = true;
      work.sources = this.descendants.get(work.root)?.values();
      work.misses = this.deferredText.get(work.root)?.values();
    }
    if (!work.checkedMisses) {
      const next = work.misses?.next();
      if (next && !next.done) {
        const node = next.value;
        if (!node.isConnected) this.forgetDeferredText(node);
        else {
          const source = this.createSource(node);
          if (source) {
            this.sources.add(source);
            this.byNode.set(node, source);
            this.sourceQueue.add(source);
            if (work.priority) this.hotSources.add(source);
          }
        }
        return;
      }
      work.checkedMisses = true;
    }
    if (!work.walking) {
      const next = work.sources?.next();
      if (next && !next.done) {
        this.invalidateSource(next.value, work.continuous, work);
        return;
      }
      work.walking = true;
    }
    if (!work.discover) { this.finishInspection(work); return; }
    if (!work.walker && work.root.nodeType !== Node.TEXT_NODE) {
      if (work.root instanceof Element && this.excluded(work.root)) { this.finishInspection(work); return; }
      work.walker = document.createTreeWalker(work.root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => node instanceof Element && (this.excluded(node)
          || node.namespaceURI === 'http://www.w3.org/2000/svg' && node.localName !== 'svg'
            && node.localName !== 'g' && !SVG_SHAPES.has(node.localName))
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
    }
    const node = work.first ? work.root : work.walker?.nextNode();
    work.first = false;
    if (!node) { this.finishInspection(work); return; }
    this.inspectedNodes.add(node);
    if (node instanceof Element) {
      this.shadowHosts.add(node);
      if (node.shadowRoot && (!this.roots.has(node.shadowRoot) || work.priority)) {
        this.roots.add(node.shadowRoot);
        this.enqueueInspection(node.shadowRoot, work.continuous, true, work.priority);
      }
    }
    if (!(node instanceof Element || node instanceof Text)) return;
    let source = this.byNode.get(node);
    if (!source) {
      source = this.createSource(node);
      if (!source) return;
      this.sources.add(source);
      this.byNode.set(node, source);
      this.sourceQueue.add(source);
    } else this.invalidateSource(source, work.continuous, work);
    if (work.priority) this.hotSources.add(source);
  }

  private finishInspection(work: Inspection): void {
    const repeat = work.repeat;
    this.removeInspection(work);
    if (repeat) this.enqueueInspection(work.root, work.continuous, work.discover, work.priority);
  }

  private updateTopology(source: Source): void {
    const ancestors: Element[] = [];
    const scrollers: Element[] = [];
    const clips: Clip[] = [];
    let documentScroll = false;
    for (let element: Element | null = source.element; element; element = composedParent(element)) {
      ancestors.push(element);
      const layout = readLayout(element);
      documentScroll ||= layout.position === 'fixed' || layout.position === 'sticky';
      if (element !== document.scrollingElement && (layout.clipX || layout.clipY)) scrollers.push(element);
      if ((element !== source.element || source.text) && element !== document.body && element !== document.documentElement
        && (layout.clipX || layout.clipY)) clips.push({ element, x: layout.clipX, y: layout.clipY });
    }
    const owners = new Set<Node>([source.node, ...ancestors]);
    for (const ancestor of ancestors) {
      const root = ancestor.getRootNode();
      if (root instanceof ShadowRoot) owners.add(root);
    }
    if (ancestors.length !== source.ancestors.length || ancestors.some((element, index) => source.ancestors[index] !== element)) {
      for (const ancestor of source.owners) {
        const descendants = this.descendants.get(ancestor);
        descendants?.delete(source);
        if (!descendants?.size) this.descendants.delete(ancestor);
      }
      source.ancestors = ancestors;
      source.owners = [...owners];
      for (const ancestor of source.owners) {
        let descendants = this.descendants.get(ancestor);
        if (!descendants) { descendants = new Set(); this.descendants.set(ancestor, descendants); }
        descendants.add(source);
      }
    }
    for (const scroller of source.scrollers) {
      if (scrollers.includes(scroller)) continue;
      const sources = this.scrollerSources.get(scroller);
      sources?.delete(source);
      if (!sources?.size) this.scrollerSources.delete(scroller);
    }
    for (const scroller of scrollers) {
      let sources = this.scrollerSources.get(scroller);
      if (!sources) { sources = new Set(); this.scrollerSources.set(scroller, sources); }
      sources.add(source);
    }
    source.scrollers = scrollers;
    source.clips = clips;
    source.documentScroll = documentScroll;
    if (documentScroll) this.documentSources.add(source); else this.documentSources.delete(source);
    source.topologyDirty = false;
  }

  private beginSourceRead(source: Source): void {
    const previous = source.read;
    if (source.topologyDirty) this.updateTopology(source);
    source.animated = source.ancestors.some(element => this.animationTargets.has(element));
    if (source.animated) this.animatedSources.add(source); else this.animatedSources.delete(source);
    if (source.identityDirty) {
      source.logicalKey = logicalSurfaceKey(source.node);
      if (source.text) source.label = (source.node as Text).data.trim().replace(/\s+/g, ' ').slice(0, 70);
      else source.label = mediaFrameOwner(source.element) ? 'Video player' : (source.element.getAttribute('aria-label')
        || source.element.getAttribute('alt') || source.element.getAttribute('value') || source.element.textContent || source.element.tagName).trim().slice(0, 70);
      source.identityDirty = false;
    }
    let hidden = false;
    for (const element of source.ancestors) {
      const layout = readLayout(element);
      // Visibility is inherited but descendants may explicitly become visible;
      // display/content-visibility/opacity ancestry cannot be overridden this way.
      if (this.excluded(element) || layout.hidden || element === source.element
        && (layout.visibility === 'hidden' || layout.visibility === 'collapse')) { hidden = true; break; }
    }
    const owner = mediaFrameOwner(source.element);
    hidden ||= !!owner && owner !== source.element;
    if (!hidden && source.text) {
      const style = readStyle(source.element);
      hidden = Number.parseFloat(style.fontSize) < 8 || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)';
    }
    let clipped: Area | undefined;
    if (!hidden) for (const clip of source.clips) {
      const rect = readBounds(clip.element);
      clipped ??= { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
      if (clip.x) { clipped.left = Math.max(clipped.left, rect.left); clipped.right = Math.min(clipped.right, rect.right); }
      if (clip.y) { clipped.top = Math.max(clipped.top, rect.top); clipped.bottom = Math.min(clipped.bottom, rect.bottom); }
    }
    let rects: DOMRectList | DOMRect[] = [];
    if (!hidden) {
      if (source.range) {
        const text = source.node as Text;
        source.range.setStart(text, 0);
        source.range.setEnd(text, text.length);
        rects = source.range.getClientRects();
      } else rects = source.element.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SHAPES.has(source.element.localName)
        ? svgShapeRects(source.element) : [readBounds(source.element)];
    }
    if (!previous) {
      source.spare.clear();
      source.refreshAgain = false;
    }
    source.read = { next: previous?.next ?? source.spare, rects, index: previous?.index ?? 0, old: previous?.old,
      retainedIndex: this.retained?.source === source ? this.retained.index : -1,
      clipped, scrollX: window.scrollX, scrollY: window.scrollY, moved: previous?.moved ?? false, area: previous?.area,
      reflow: source.structural || !source.animated && !source.continuous, logicalKey: source.logicalKey, frame: this.frame };
  }

  private advanceSource(source: Source, deadline: number, critical = false): void {
    if (!source.node.isConnected) { this.removeSource(source); return; }
    if (!source.read || critical && source.read.frame !== this.frame) this.beginSourceRead(source);
    source.sampled = this.frame;
    const read = source.read!;
    // A rider's particular wrapped line cannot wait behind a long rect continuation.
    if (read.retainedIndex >= 0) {
      const index = read.retainedIndex;
      const platform = read.next.get(index) ?? source.platforms.get(index);
      if (index >= read.rects.length || !this.measureRect(source, read, index)) {
        read.next.delete(index);
        if (platform) this.removePlatform(platform);
      }
      read.retainedIndex = -1;
    }
    let steps = 0;
    while (steps++ < 32) {
      if (read.index < read.rects.length) {
        const index = read.index++;
        if (!(this.retained?.source === source && this.retained.index === index)) this.measureRect(source, read, index);
      } else {
        read.old ??= source.platforms.entries();
        const next = read.old.next();
        if (!next.done) {
          if (!read.next.has(next.value[0])) this.removePlatform(next.value[1]);
        } else {
          const old = source.platforms;
          source.platforms = read.next;
          source.spare = old;
          source.read = undefined;
          if (read.area) { source.area = read.area; this.sourceIndex.update(source, read.area); }
          source.pending = read.moved ? 2 : Math.max(0, source.pending - 1);
          if (!source.refreshAgain) source.structural = false;
          if (!source.pending) source.continuous = false;
          if (source.pending || source.refreshAgain) this.sourceQueue.add(source);
          return;
        }
      }
      if (performance.now() >= deadline && (!critical || steps > 0)) break;
    }
    this.sourceQueue.add(source);
  }

  private measureRect(source: Source, read: SourceRead, index: number): boolean {
    const rect = read.rects[index];
    const raw: Area = { left: rect.left + read.scrollX, right: rect.right + read.scrollX,
      top: rect.top + read.scrollY, bottom: rect.bottom + read.scrollY };
    if (Number.isFinite(raw.left + raw.right + raw.top + raw.bottom)) {
      if (!read.area) read.area = raw;
      else {
        read.area.left = Math.min(read.area.left, raw.left); read.area.right = Math.max(read.area.right, raw.right);
        read.area.top = Math.min(read.area.top, raw.top); read.area.bottom = Math.max(read.area.bottom, raw.bottom);
      }
    }
    let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
    if (read.clipped) {
      if (source.text && (top < read.clipped.top || top >= read.clipped.bottom)) return false;
      left = Math.max(left, read.clipped.left); right = Math.min(right, read.clipped.right);
      top = Math.max(top, read.clipped.top); bottom = Math.min(bottom, read.clipped.bottom);
    }
    const x = left + read.scrollX, y = top + read.scrollY, width = right - left;
    if (width < 30 || bottom - top < 4 || source.text && rect.height > 80 || !Number.isFinite(x + y + width)) return false;
    let platform = read.next.get(index) ?? source.platforms.get(index);
    const created = !platform;
    const changed = !!platform && (platform.x !== x || platform.y !== y || platform.width !== width);
    const identityChanged = !!platform?.logicalKey && platform.logicalKey !== read.logicalKey;
    if (!platform) {
      platform = { id: `dom:${this.ids.get(source.node)}:${index}`, x, y, width, previousX: x, previousY: y, previousWidth: width };
    } else {
      platform.discontinuous ||= identityChanged || Math.abs(x - platform.x) > Math.max(innerWidth * 0.75, platform.width * 2);
      platform.reflow ||= changed && read.reflow;
      platform.x = x; platform.y = y; platform.width = width;
      if (identityChanged) this.registryRevision++;
    }
    if (!this.registryIndices.has(platform)) {
      this.platformOwners.set(platform.id, { source, index });
      this.registryIndices.set(platform, this.registry.length);
      this.registry.push(platform);
      this.registryRevision++;
      this.selectionDirty = true;
    }
    platform.label = source.label;
    platform.logicalKey = read.logicalKey;
    platform.moving = source.animated || changed;
    setSurfaceMetadata(platform, source.element, source.text);
    read.moved ||= changed;
    read.next.set(index, platform);
    if (changed || identityChanged || created) this.selectionDirty = true;
    // Newly measured visible edges bypass any older cached selection iterator.
    if (!this.selected.has(platform) && (x + width >= this.viewport.left && x <= this.viewport.right
      && y >= this.viewport.top && y <= this.viewport.bottom || this.inInterest(platform))) this.readyPlatforms.add(platform);
    this.platformIndex.update(platform, { left: x, right: x + width, top: y, bottom: y });
    this.changedPlatforms.add(platform);
    return true;
  }

  private removePlatform(platform: Platform): void {
    const index = this.registryIndices.get(platform);
    if (index === undefined) return;
    const last = this.registry.pop()!;
    if (last !== platform) { this.registry[index] = last; this.registryIndices.set(last, index); }
    this.registryIndices.delete(platform);
    this.platformOwners.delete(platform.id);
    this.platformIndex.remove(platform);
    this.changedPlatforms.delete(platform);
    this.readyPlatforms.delete(platform);
    if (this.selected.delete(platform)) {
      const selectedIndex = this.platforms.indexOf(platform);
      if (selectedIndex >= 0) this.platforms.splice(selectedIndex, 1);
      this.selectionRevision++;
    }
    this.registryRevision++;
    this.selectionDirty = true;
  }

  private removeSource(source: Source): void {
    for (const platform of source.platforms.values()) this.removePlatform(platform);
    if (source.read) for (const platform of source.read.next.values()) this.removePlatform(platform);
    source.platforms.clear(); source.spare.clear(); source.read = undefined;
    source.range?.detach();
    this.sourceQueue.delete(source);
    this.hotSources.delete(source);
    this.sources.delete(source);
    this.byNode.delete(source.node);
    this.sourceIndex.remove(source);
    this.animatedSources.delete(source);
    this.documentSources.delete(source);
    for (const ancestor of source.owners) {
      const descendants = this.descendants.get(ancestor);
      descendants?.delete(source);
      if (!descendants?.size) this.descendants.delete(ancestor);
    }
    for (const scroller of source.scrollers) {
      const sources = this.scrollerSources.get(scroller);
      sources?.delete(source);
      if (!sources?.size) this.scrollerSources.delete(scroller);
    }
    if (this.retained?.source === source) this.retained = undefined;
  }

  private updateAreas(): void {
    const scrollY = window.scrollY;
    if (scrollY !== this.lastScrollY) this.scrollDirection = scrollY > this.lastScrollY ? 1 : -1;
    this.lastScrollY = scrollY;
    const marginX = Math.min(240, window.innerWidth * 0.4);
    const marginY = Math.min(320, window.innerHeight * 0.5);
    const left = window.scrollX - marginX, right = window.scrollX + window.innerWidth + marginX;
    const top = scrollY - marginY, bottom = scrollY + window.innerHeight + marginY;
    const point = this.interestPoint;
    const viewportChanged = left !== this.viewport.left || right !== this.viewport.right
      || top !== this.viewport.top || bottom !== this.viewport.bottom;
    if (!viewportChanged && point?.x === this.interestX && point?.y === this.interestY) return;
    const interestJumped = !!point !== !!this.interest || !!point && (Math.abs(point.x - (this.interestX ?? point.x)) > 480
      || Math.abs(point.y - (this.interestY ?? point.y)) > 480);
    this.viewport = { left, right, top, bottom };
    // Prepare incoming sources by CSS viewport height without expanding a task's budget.
    this.lookahead = { left, right, top: scrollY - window.innerHeight * (this.scrollDirection < 0 ? 2 : 1),
      bottom: scrollY + window.innerHeight * (this.scrollDirection > 0 ? 3 : 2) };
    this.interestX = point?.x; this.interestY = point?.y;
    this.interest = point ? { left: point.x - 480, right: point.x + 480, top: point.y - 480, bottom: point.y + 480 } : undefined;
    this.selectionDirty = true;
    // A moving player must not restart dense cached queries on every simulation tick.
    // Viewport jumps and checkpoint teleports do need fresh priority cursors.
    if (viewportChanged || interestJumped) {
      this.selection = this.activeCursor = undefined;
      this.activeSeen.clear();
    }
    this.nextActiveQuery = 0;
    if (viewportChanged) this.nextHotQuery = this.hotPoint = 0;
  }

  private sampleActiveSources(deadline: number): void {
    if (!this.activeCursor) {
      if (performance.now() < this.nextActiveQuery) return;
      this.activeCursor = this.sourceIndex.query(this.interest ? [this.viewport, this.lookahead, this.interest] : [this.viewport, this.lookahead]);
      this.activeSeen.clear();
    }
    for (let count = 0; count < 96 && performance.now() < deadline; count++) {
      const next = this.activeCursor.next();
      if (next.done) { this.activeCursor = undefined; this.nextActiveQuery = performance.now() + 50; return; }
      const source = next.value;
      if (this.activeSeen.has(source)) continue;
      this.activeSeen.add(source);
      if (!source.area || !overlaps(source.area, this.lookahead) && (!this.interest || !overlaps(source.area, this.interest))) continue;
      if (source.sampled === this.frame) continue;
      this.primeSource(source);
      if (source.animated || source.pending || source.read) this.advanceSource(source, deadline);
    }
  }

  /** A few native paint probes bypass hidden/global backlogs; never query the whole DOM. */
  private sampleHotRoots(deadline: number): void {
    const now = performance.now();
    if (now < deadline && now >= this.nextHotQuery && typeof document.elementsFromPoint === 'function') {
      // Incoming edge first. A sweep is spread across frames and restarted on scroll.
      const row = Math.floor(this.hotPoint / 3);
      const fraction = 0.85 - row * 0.35;
      const y = window.innerHeight * (this.scrollDirection > 0 ? fraction : 1 - fraction);
      const column = this.hotPoint % 3;
      const x = window.innerWidth * (column === 0 ? 0.5 : column === 1 ? 0.2 : 0.8);
      const painted = document.elementsFromPoint(x, y);
      for (let index = 0; index < Math.min(painted.length, 4); index++) {
        const leaf = painted[index];
        if (this.excluded(leaf) || leaf === document.body || leaf === document.documentElement) continue;
        this.enqueueHotRoot(mediaFrameOwner(leaf) ?? leaf, now);
        // Nearby rendered containers cover wrapped text and the next lazy card.
        // Inspect at most two ancestors, and never promote a page-sized root.
        let root = leaf;
        for (let depth = 0; depth < 2; depth++) {
          const parent = composedParent(root);
          if (!parent || parent === document.body || parent === document.documentElement || this.excluded(parent)) break;
          const rect = readBounds(parent);
          if (rect.height > window.innerHeight * 3 || rect.width > window.innerWidth * 1.5) break;
          root = parent;
        }
        if (root !== leaf) this.enqueueHotRoot(root, now);
        if (performance.now() >= deadline) break;
      }
      if (++this.hotPoint === 9) {
        this.hotPoint = 0;
        this.nextHotQuery = now + HOT_ROOT_RETRY_MS;
      }
    }
    for (let step = 0; step < 48 && performance.now() < deadline; step++) {
      const source = this.hotSources.values().next().value;
      if (source) {
        this.hotSources.delete(source);
        if (source.sampled !== this.frame || source.read) this.advanceSource(source, deadline);
        continue;
      }
      const work = this.hotInspections.values().next().value;
      if (!work) break;
      this.advanceInspection(work);
      if (this.hotInspections.delete(work)) this.hotInspections.add(work);
    }
  }

  private enqueueHotRoot(root: Element, now: number): void {
    if ((this.hotSampled.get(root) ?? -Infinity) + HOT_ROOT_RETRY_MS > now
      || this.hotInspections.size >= MAX_HOT_ROOTS) return;
    this.hotSampled.set(root, now);
    const pending = this.inspections.get(root);
    if (pending) {
      // A paint sample is not a mutation. Promote its continuation without
      // changing the serial or scheduling another whole-root pass.
      pending.discover = true;
      this.prioritizeInspection(pending);
    } else this.enqueueInspection(root, false, true, true);
  }

  private sampleAnimatedSources(deadline: number): void {
    this.animationCursor ??= this.animatedSources.values();
    for (let count = 0; count < 4 && performance.now() < deadline; count++) {
      const next = this.animationCursor.next();
      if (next.done) { this.animationCursor = undefined; return; }
      if (next.value.sampled !== this.frame) this.advanceSource(next.value, deadline);
    }
  }

  private inInterest(platform: Platform): boolean {
    return !!this.interest && platform.x + platform.width >= this.interest.left && platform.x <= this.interest.right
      && platform.y >= this.interest.top && platform.y <= this.interest.bottom;
  }

  private comparePlatforms = (a: Platform, b: Platform): number => {
    const priority = Number(b.id === this.retained?.id) - Number(a.id === this.retained?.id)
      || Number(this.inInterest(b)) - Number(this.inInterest(a));
    if (priority) return priority;
    const centerX = window.scrollX + window.innerWidth / 2, centerY = window.scrollY + window.innerHeight / 2;
    const aPoint = this.inInterest(a) ? this.interestPoint : undefined;
    const bPoint = this.inInterest(b) ? this.interestPoint : undefined;
    const aDistance = Math.abs(a.y - (aPoint?.y ?? centerY)) + Math.abs(a.x + a.width / 2 - (aPoint?.x ?? centerX)) * 0.35;
    const bDistance = Math.abs(b.y - (bPoint?.y ?? centerY)) + Math.abs(b.x + b.width / 2 - (bPoint?.x ?? centerX)) * 0.35;
    return aDistance - bDistance;
  };

  private selectPlatforms(deadline: number): void {
    if (!this.selection) {
      if (!this.selectionDirty && !this.readyPlatforms.size) return;
      this.selectionDirty = false;
      this.selection = { iterator: this.platformIndex.query(this.interest ? [this.viewport, this.interest] : [this.viewport]),
        seen: new Set(this.platforms), candidates: this.platforms.slice() };
    }
    const selection = this.selection;
    let ready = 0;
    for (const platform of this.readyPlatforms) {
      this.readyPlatforms.delete(platform);
      if (!selection.seen.has(platform)) {
        selection.seen.add(platform);
        selection.candidates.push(platform);
      }
      if (++ready === 256) break;
    }
    // Cached reads only; bounded even when thousands of tops share one viewport.
    for (let count = 0; count < 256; count++) {
      const next = selection.iterator.next();
      if (next.done) {
        this.publishCandidates(selection);
        this.selection = undefined;
        return;
      }
      const platform = next.value;
      if (!(platform.x + platform.width >= this.viewport.left && platform.x <= this.viewport.right
        && platform.y >= this.viewport.top && platform.y <= this.viewport.bottom) && !this.inInterest(platform)) continue;
      if (!selection.seen.has(platform)) {
        selection.seen.add(platform);
        if (platform.moving || !selection.candidates.some(candidate => !candidate.moving
          && Math.abs(candidate.y - platform.y) < 0.5 && Math.abs(candidate.x - platform.x) < 0.5
          && Math.abs(candidate.width - platform.width) < 0.5)) selection.candidates.push(platform);
      }
      if (selection.candidates.length >= MAX_PLATFORMS * 3) {
        selection.candidates.sort(this.comparePlatforms);
        selection.candidates.length = MAX_PLATFORMS * 2;
      }
      if (count > 0 && performance.now() >= deadline) break;
    }
    // Publish each cached chunk immediately, including pinned offscreen support.
    this.publishCandidates(selection);
  }

  private publishCandidates(selection: Selection): void {
    const retained = this.retained && (this.retained.source.read?.next.get(this.retained.index)
      ?? this.retained.source.platforms.get(this.retained.index));
    if (retained && !selection.candidates.includes(retained)) selection.candidates.push(retained);
    selection.candidates.sort(this.comparePlatforms);
    if (selection.candidates.length > MAX_PLATFORMS * 2) selection.candidates.length = MAX_PLATFORMS * 2;
    const selected: Platform[] = [];
    for (const candidate of selection.candidates) {
      if (!this.registryIndices.has(candidate)) continue;
      if (candidate !== retained && !(candidate.x + candidate.width >= this.viewport.left && candidate.x <= this.viewport.right
        && candidate.y >= this.viewport.top && candidate.y <= this.viewport.bottom) && !this.inInterest(candidate)) continue;
      // Independently moving objects remain separate when their paths overlap.
      if (!candidate.moving && selected.some(p => !p.moving && Math.abs(p.y - candidate.y) < 0.5
        && Math.abs(p.x - candidate.x) < 0.5 && Math.abs(p.width - candidate.width) < 0.5)) continue;
      selected.push(candidate);
      if (selected.length === MAX_PLATFORMS) break;
    }
    this.publishSelection(selected);
  }

  private publishSelection(selected: Platform[]): void {
    selected.sort((a, b) => a.y - b.y || a.x - b.x);
    if (selected.length !== this.selected.size || selected.some(platform => !this.selected.has(platform))) {
      this.selectionRevision++;
      this.selected.clear();
      for (const platform of selected) this.selected.add(platform);
    }
    this.platforms.length = 0;
    this.platforms.push(...selected);
  }

  private inspectShadowHosts(deadline: number): void {
    if (!this.hostCursor) {
      if (performance.now() < this.nextHostInspection) return;
      this.hostCursor = this.shadowHosts.values();
    }
    for (let count = 0; count < 32 && performance.now() < deadline; count++) {
      const next = this.hostCursor.next();
      if (next.done) { this.hostCursor = undefined; this.nextHostInspection = performance.now() + ANIMATION_DISCOVERY_MS; return; }
      const host = next.value;
      if (!host.isConnected) { this.shadowHosts.delete(host); continue; }
      const root = host.shadowRoot;
      if (root && !this.roots.has(root)) { this.roots.add(root); this.enqueueInspection(root, false, true); }
    }
  }

  private inspectAnimations(deadline: number): void {
    const now = performance.now();
    if (!this.animationScan) {
      if (!this.animationTrees) {
        if (now < this.nextAnimationDiscovery) return;
        this.animationTrees = [document, ...this.roots].values();
      }
      const next = this.animationTrees.next();
      if (next.done) {
        this.animationTrees = undefined;
        this.nextAnimationDiscovery = now + ANIMATION_DISCOVERY_MS;
        return;
      }
      const tree = next.value;
      this.animationScan = { tree, animations: typeof tree.getAnimations === 'function' ? tree.getAnimations() : [], index: 0, targets: new Set() };
    }
    const scan = this.animationScan;
    for (let count = 0; count < 64 && scan.index < scan.animations.length && performance.now() < deadline; count++) {
      const animation = scan.animations[scan.index++];
      const target = typeof KeyframeEffect !== 'undefined' && animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (target instanceof Element && target.isConnected && (animation.playState === 'running' || animation.pending)) scan.targets.add(target);
    }
    if (scan.index < scan.animations.length) return;
    const old = this.treeAnimations.get(scan.tree);
    if (!scan.phase) {
      scan.phase = 'remove';
      scan.removing = old?.values();
      scan.adding = scan.targets.values();
    }
    for (let step = 0; step < 64 && performance.now() < deadline; step++) {
      if (scan.phase === 'remove') {
        const next = scan.removing?.next();
        if (!next || next.done) { scan.phase = 'add'; continue; }
        const target = next.value;
        if (scan.targets.has(target)) continue;
        const count = (this.animationCounts.get(target) ?? 1) - 1;
        if (count) this.animationCounts.set(target, count);
        else { this.animationCounts.delete(target); this.animationTargets.delete(target); this.enqueueInspection(target, true, false); }
      } else {
        const next = scan.adding!.next();
        if (next.done) {
          this.treeAnimations.set(scan.tree, scan.targets);
          this.animationScan = undefined;
          return;
        }
        const target = next.value;
        if (old?.has(target)) continue;
        this.animationCounts.set(target, (this.animationCounts.get(target) ?? 0) + 1);
        if (!this.animationTargets.has(target)) {
          this.animationTargets.add(target);
          this.enqueueInspection(target, true, true);
        }
      }
    }
  }
}
