import { OVERLAY_ID, type Platform } from '../engine/types';
import { logicalSurfaceKey } from './surface-identity';
import { isDecorativeCanvas } from '../rendering/text-clearance';
import { composedParent } from './composed-dom';
import { mediaFrameOwner } from './media-owners';

const MAX_NODES = 6000;
const MAX_RECTS = 1600;
const MAX_PLATFORMS = 220;
const ANIMATION_DISCOVERY_MS = 250;
const MAX_ANIMATIONS = 1000;
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
  const style = getComputedStyle(element);
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

// Canvas 2D has no scene graph. Read a *small* transparent pixel buffer and
// identify horizontal runs whose upper edge is opaque enough to stand on.
// Never sample tainted canvases or infer a solid platform from an opaque bitmap.
const MAX_CANVAS_PIXELS = 512 * 256;
const CANVAS_STEP = 4;
function canvasSurfaceRects(element: HTMLCanvasElement): DOMRect[] {
  if (!element.width || !element.height || element.width * element.height > MAX_CANVAS_PIXELS) return [];
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return [];
  let ctx: CanvasRenderingContext2D | null;
  try { ctx = element.getContext('2d', { willReadFrequently: true }); } catch { return []; }
  if (!ctx) return []; // Includes WebGL, OffscreenCanvas or incompatible context modes.
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, element.width, element.height); } catch { return []; }
  const w = element.width, h = element.height;
  const alpha = (x: number, y: number): number => data.data[(y * w + x) * 4 + 3];
  // Opaque drawing backgrounds should not turn the entire canvas into ground.
  if (alpha(0, 0) > 32 && alpha(w - 1, 0) > 32 && alpha(0, h - 1) > 32 && alpha(w - 1, h - 1) > 32) return [];
  const result: DOMRect[] = [];
  for (let y = CANVAS_STEP; y < h && result.length < 24; y += CANVAS_STEP) {
    let start = -1;
    const flush = (end: number): void => {
      if (start < 0) return;
      const width = (end - start) * bounds.width / w;
      if (width >= 30) result.push(new DOMRect(bounds.left + start * bounds.width / w,
        bounds.top + y * bounds.height / h, width, Math.max(4, CANVAS_STEP * bounds.height / h)));
      start = -1;
    };
    for (let x = 0; x < w; x += CANVAS_STEP) {
      const topPixel = alpha(x, y) > 90 && alpha(x, y - CANVAS_STEP) <= 32;
      if (topPixel && start < 0) start = x;
      if (!topPixel) flush(x);
    }
    flush(w);
  }
  return result;
}

interface Area { left: number; right: number; top: number; bottom: number }
interface Source {
  node: Element | Text;
  element: Element;
  range?: Range;
  text: boolean;
  label: string;
  platforms: Map<number, Platform>;
  animated: boolean;
  pending: number;
  continuous: boolean;
  documentScroll: boolean;
  scrollers: Element[];
  ancestors: Element[];
}
interface Measurement {
  styles: Map<Element, CSSStyleDeclaration>;
  rects: number;
  scrollX: number;
  scrollY: number;
}

/** Cached DOM measurement, separate from simulation. Coordinates are document CSS pixels. */
export class PageGeometry {
  /** A newly discovered animation target needs one bounded source-cache rebuild. */
  needsRebuild = false;
  private ids = new WeakMap<Node, number>();
  private nextId = 1;
  private sources: Source[] = [];
  private platforms: Platform[] = [];
  private selected = new Set<Platform>();
  /** Connected discovered surfaces; viewport selection never owns their lifetime. */
  private registry: Platform[] = [];
  registryRevision = 0;
  selectionRevision = 0;
  get registryPlatforms(): readonly Platform[] { return this.registry; }
  private animationTargets = new Set<Element>();
  private roots = new Set<ShadowRoot>();
  private shadowHosts = new Set<Element>();
  get shadowRoots(): ReadonlySet<ShadowRoot> { return this.roots; }
  private nextAnimationDiscovery = 0;
  private nextCanvasSample = 0;
  private viewport: Area = { left: 0, right: 0, top: 0, bottom: 0 };
  private interest?: Area;
  private interestPoint?: { x: number; y: number };
  private retained?: { source: Source; index: number; id: string };

  rebuild(interest?: { x: number; y: number }): Platform[] {
    this.interestPoint = interest;
    this.updateAreas();
    this.discoverAnimations(true);
    this.roots.clear();
    this.shadowHosts.clear();
    const oldSources = new Map(this.sources.map(source => [source.node, source]));
    const nextSources: Source[] = [];
    const seen = new Set<Node>();
    const measurement: Measurement = { styles: new Map(), rects: 0, scrollX: window.scrollX, scrollY: window.scrollY };
    const collect = (node: Element | Text): void => {
      if (seen.has(node) || measurement.rects >= MAX_RECTS) return;
      seen.add(node);
      for (let root = node.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) this.roots.add(root);
      const source = oldSources.get(node) ?? this.createSource(node, measurement);
      if (!source) return;
      source.animated = this.hasAnimatedAncestor(source.element);
      this.measureSource(source, measurement, true);
      // Retain hidden animated/previously selected sources so an animation can
      // bring them back without waiting for another document traversal.
      if (source.platforms.size || source.animated || oldSources.has(node)) nextSources.push(source);
      else source.range?.detach();
    };

    if (this.retained?.source.node.isConnected) collect(this.retained.source.node);
    // Previously discovered terrain near the player gets first claim on the
    // measurement budget, including when it lies well outside the viewport.
    for (const source of this.sources) {
      if (source.node.isConnected && [...source.platforms.values()].some(platform => this.inInterest(platform))) collect(source.node);
    }
    let visited = 0;
    const walkedRoots = new Set<ShadowRoot>();
    const walk = (root: Element | ShadowRoot, animated: boolean): void => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          if (++visited >= MAX_NODES) return NodeFilter.FILTER_ACCEPT;
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          const element = node as Element;
          if (element.namespaceURI === 'http://www.w3.org/2000/svg' && !SVG_SHAPES.has(element.localName) && element.localName !== 'svg' && element.localName !== 'g') return NodeFilter.FILTER_SKIP;
          return (animated ? this.excluded(element) : this.hidden(element, measurement))
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Node | null;
      while (visited < MAX_NODES && measurement.rects < MAX_RECTS && (node = walker.nextNode())) {
        if (visited >= MAX_NODES) break;
        collect(node as Element | Text);
        if (node instanceof Element) {
          this.shadowHosts.add(node);
          const shadow = node.shadowRoot;
          if (shadow && !walkedRoots.has(shadow)) {
            this.roots.add(shadow);
            walkedRoots.add(shadow);
            walk(shadow, animated);
          }
        }
      }
    };
    // Animated roots get bounded discovery before the ordinary visible scan.
    // Keep their initially invisible/offscreen sources; sampling still applies
    // the normal visibility and viewport rules before exposing any platform.
    for (const target of this.animationTargets) {
      if (visited >= MAX_NODES || measurement.rects >= MAX_RECTS) break;
      let excluded = false;
      for (let ancestor: Element | null = target; ancestor; ancestor = composedParent(ancestor)) {
        if (this.excluded(ancestor)) { excluded = true; break; }
      }
      const parent = composedParent(target);
      if (excluded || parent && this.hasAnimatedAncestor(parent)) continue;
      visited++;
      collect(target);
      walk(target, true);
      if (target.shadowRoot && !walkedRoots.has(target.shadowRoot)) {
        this.roots.add(target.shadowRoot);
        walkedRoots.add(target.shadowRoot);
        walk(target.shadowRoot, true);
      }
    }
    if (document.body) walk(document.body, false);
    // Discovery budgets and scrolling must not evict previously discovered terrain.
    for (const source of this.sources) {
      if (source.node.isConnected && !seen.has(source.node)) {
        if (measurement.rects < MAX_RECTS) collect(source.node);
        else nextSources.push(source);
      }
    }
    for (const source of this.sources) if (!nextSources.includes(source)) source.range?.detach();
    this.sources = nextSources;
    this.selectPlatforms();
    this.needsRebuild = false;
    return this.platforms;
  }

  /** Sample only retained moving/changed handles; never walk the document here. */
  sampleMotion(): void {
    this.updateAreas();
    this.discoverAnimations(false);
    const canvasDue = performance.now() >= this.nextCanvasSample;
    if (canvasDue) this.nextCanvasSample = performance.now() + 250;
    if (!this.sources.some(source => source.animated || source.pending > 0 || !source.node.isConnected
      || canvasDue && source.element instanceof HTMLCanvasElement)) return;
    const measurement: Measurement = { styles: new Map(), rects: 0, scrollX: window.scrollX, scrollY: window.scrollY };
    for (const source of this.sources) {
      if (!source.node.isConnected) {
        source.platforms.clear();
        source.range?.detach();
        continue;
      }
      if (source.animated || source.pending > 0 || canvasDue && source.element instanceof HTMLCanvasElement) this.measureSource(source, measurement, false);
    }
    this.sources = this.sources.filter(source => source.node.isConnected);
    this.selectPlatforms();
  }

  /** Only fixed/sticky terrain or descendants of a nested scroller move on scroll. */
  markScrolled(target: EventTarget | null): void {
    const documentScroll = !target || target === document || target === window || target === document.scrollingElement;
    for (const source of this.sources) {
      if (documentScroll ? source.documentScroll : target instanceof Element && source.scrollers.includes(target)) {
        source.pending = 3;
        source.continuous = true;
      }
    }
  }

  /** Keep the last standing source measurable even far from both player and viewport. */
  retainPlatform(id: string): void {
    if (this.retained?.id === id) return;
    for (const source of this.sources) {
      for (const [index, platform] of source.platforms) {
        if (platform.id === id) {
          this.retained = { source, index, id };
          return;
        }
      }
    }
  }

  /** Mutation targets include JS transforms on a surface or any of its ancestors. */
  markChanged(target: Node, continuous = false): void {
    const stylesheet = target instanceof Element && (target.tagName === 'STYLE' || target.tagName === 'LINK')
      || target.parentElement?.tagName === 'STYLE';
    const hosts: Element[] = [];
    for (let root = target.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) hosts.push(root.host);
    for (const source of this.sources) {
      if (stylesheet || target === source.node || target.contains(source.node) || source.element.contains(target)
        || target instanceof Element && source.ancestors.includes(target)
        || hosts.some(host => source.element === host || source.element.contains(host))) {
        source.pending = 3;
        source.continuous ||= continuous;
      }
    }
  }

  clear(): void {
    for (const source of this.sources) source.range?.detach();
    this.sources = [];
    this.selected.clear();
    this.platforms.length = 0;
    this.registry.length = 0;
    this.registryRevision++;
    this.selectionRevision++;
    this.animationTargets.clear();
    this.roots.clear();
    this.shadowHosts.clear();
    this.ids = new WeakMap();
    this.nextId = 1;
    this.nextAnimationDiscovery = 0;
    this.nextCanvasSample = 0;
    this.needsRebuild = false;
    this.interest = undefined;
    this.interestPoint = undefined;
    this.retained = undefined;
  }

  private styleFor(element: Element, measurement: Measurement): CSSStyleDeclaration {
    let style = measurement.styles.get(element);
    if (!style) {
      style = getComputedStyle(element);
      measurement.styles.set(element, style);
    }
    return style;
  }

  private excluded(element: Element): boolean {
    return element.id === OVERLAY_ID || !!IGNORED_TAGS[element.tagName];
  }

  private hidden(element: Element, measurement: Measurement): boolean {
    if (this.excluded(element) || element.hasAttribute('hidden')) return true;
    const style = this.styleFor(element, measurement);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || style.contentVisibility === 'hidden' || Number(style.opacity) === 0;
  }

  private createSource(node: Element | Text, measurement: Measurement): Source | undefined {
    const text = node.nodeType === Node.TEXT_NODE;
    const element = text ? composedParent(node) : node as Element;
    if (!element) return;
    const owner = mediaFrameOwner(element);
    if (owner && owner !== element) return;
    let label: string;
    let range: Range | undefined;
    if (text) {
      if (!(node as Text).data.trim() || element.closest('button, input, select, textarea, [role="button"], [role="textbox"], svg, canvas')) return;
      const style = this.styleFor(element, measurement);
      if (Number.parseFloat(style.fontSize) < 8 || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)') return;
      label = (node as Text).data.trim().replace(/\s+/g, ' ').slice(0, 70);
      range = document.createRange();
    } else {
      const svgShape = element.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SHAPES.has(element.localName);
      const control = CONTROL_TAGS[element.tagName] || element.getAttribute('role') === 'button' || element.getAttribute('role') === 'textbox';
      const style = this.styleFor(element, measurement);
      const background = style.backgroundImage !== 'none';
      const image = element.tagName === 'IMG' || element.tagName === 'VIDEO' || element.tagName === 'IFRAME'
        || element.tagName === 'CANVAS' || element.getAttribute('role') === 'img' || background || !!owner;
      const painted = paintedBox(element, style);
      if ((!control && !image && !painted && !svgShape) || element.getAttribute('type') === 'hidden') return;
      const bounds = element.getBoundingClientRect();
      if (isDecorativeCanvas(element, style, bounds)) return;
      if (painted && !svgShape && !control && !owner && !/^(IMG|VIDEO|IFRAME|CANVAS)$/.test(element.tagName)
        && (bounds.width > innerWidth * 1.2 || bounds.height > innerHeight * 1.2)) return;
      // Empty alt is an accessibility choice, not evidence that an image has no
      // visible physical surface. Large hero and promotional images count too.
      label = owner ? 'Video player' : (element.getAttribute('aria-label') || element.getAttribute('alt')
        || element.getAttribute('value') || element.textContent || element.tagName).trim().slice(0, 70);
    }
    if (!this.ids.has(node)) this.ids.set(node, this.nextId++);
    return { node, element, range, text, label, platforms: new Map(), animated: false, pending: 0,
      continuous: false, documentScroll: false, scrollers: [], ancestors: [] };
  }

  private measureSource(source: Source, measurement: Measurement, rebuilding: boolean): void {
    const old = source.platforms;
    const visible = new Map<number, Platform>();
    let clipped: Area | undefined;
    let hidden = !source.node.isConnected;
    source.documentScroll = false;
    source.scrollers.length = 0;
    source.ancestors.length = 0;
    for (let element: Element | null = source.element; element && !hidden; element = composedParent(element)) {
      source.ancestors.push(element);
      hidden = this.hidden(element, measurement);
      const style = this.styleFor(element, measurement);
      const clipX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
      const clipY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
      if (style.position === 'fixed' || style.position === 'sticky') source.documentScroll = true;
      if (element !== document.scrollingElement && (clipX || clipY)) source.scrollers.push(element);
      if ((element === source.element && !source.text) || element === document.body || element === document.documentElement) continue;
      if (clipX || clipY) {
        const rect = element.getBoundingClientRect();
        clipped ??= { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
        if (clipX) { clipped.left = Math.max(clipped.left, rect.left); clipped.right = Math.min(clipped.right, rect.right); }
        if (clipY) { clipped.top = Math.max(clipped.top, rect.top); clipped.bottom = Math.min(clipped.bottom, rect.bottom); }
      }
    }
    if (!hidden && source.text) {
      const style = this.styleFor(source.element, measurement);
      hidden = Number.parseFloat(style.fontSize) < 8 || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)';
    }
    let moved = false;
    const logicalKey = logicalSurfaceKey(source.node);
    if (!hidden) {
      let rects: DOMRectList | DOMRect[];
      if (source.range) {
        const text = source.node as Text;
        source.range.setStart(text, 0);
        source.range.setEnd(text, Math.min(text.length, 8000));
        source.label = text.data.trim().replace(/\s+/g, ' ').slice(0, 70);
        rects = source.range.getClientRects();
      } else {
        rects = source.element instanceof SVGGraphicsElement && SVG_SHAPES.has(source.element.localName)
          ? svgShapeRects(source.element)
          : source.element instanceof HTMLCanvasElement
            ? canvasSurfaceRects(source.element)
            : [source.element.getBoundingClientRect()];
      }
      for (let index = 0; index < rects.length && index < 80 && measurement.rects < MAX_RECTS; index++) {
        measurement.rects++;
        const rect = rects[index];
        let left = rect.left;
        let right = rect.right;
        let top = rect.top;
        let bottom = rect.bottom;
        if (clipped) {
          if (source.text && (top < clipped.top || top >= clipped.bottom)) continue;
          top = Math.max(top, clipped.top);
          bottom = Math.min(bottom, clipped.bottom);
          left = Math.max(left, clipped.left);
          right = Math.min(right, clipped.right);
        }
        const x = left + measurement.scrollX;
        const y = top + measurement.scrollY;
        const width = right - left;
        const retained = this.retained?.source === source && this.retained.index === index;
        if (width < 30 || bottom - top < 4 || (source.text && rect.height > 80)
          || !Number.isFinite(x + y + width)) continue;
        if (!retained && !old.has(index)
          && !this.intersects({ left: x, right: x + width, top: y, bottom: bottom + measurement.scrollY })) continue;
        let platform = old.get(index);
        const changed = !!platform && (platform.x !== x || platform.y !== y || platform.width !== width);
        const identityChanged = !!platform?.logicalKey && platform.logicalKey !== logicalKey;
        if (identityChanged) this.registryRevision++;
        if (!platform) {
          platform = { id: `dom:${this.ids.get(source.node)}:${index}`, x, y, width, previousX: x, previousY: y, previousWidth: width };
        } else {
          // Large horizontal resets have no inferred swept path. This conservative
          // fallback may detach at an ambiguous seam; ordinary scrolling is vertical.
          platform.discontinuous ||= identityChanged || Math.abs(x - platform.x) > Math.max(innerWidth * 0.75, platform.width * 2);
          platform.reflow ||= changed && !source.animated && !source.continuous;
          platform.x = x;
          platform.y = y;
          platform.width = width;
        }
        platform.label = source.label;
        platform.logicalKey = logicalKey;
        platform.moving = source.animated || (!rebuilding && changed);
        moved ||= changed;
        visible.set(index, platform);
      }
    }
    source.platforms = visible;
    source.pending = moved && !rebuilding ? 2 : Math.max(0, source.pending - 1);
    if (!source.pending) source.continuous = false;
  }

  private updateAreas(): void {
    const marginX = Math.min(240, window.innerWidth * 0.4);
    const marginY = Math.min(320, window.innerHeight * 0.5);
    this.viewport = { left: window.scrollX - marginX, right: window.scrollX + window.innerWidth + marginX,
      top: window.scrollY - marginY, bottom: window.scrollY + window.innerHeight + marginY };
    const point = this.interestPoint;
    this.interest = point ? { left: point.x - 480, right: point.x + 480, top: point.y - 480, bottom: point.y + 480 } : undefined;
  }

  private intersects(area: Area): boolean {
    const overlaps = (other: Area): boolean => area.right >= other.left && area.left <= other.right && area.bottom >= other.top && area.top <= other.bottom;
    return overlaps(this.viewport) || !!this.interest && overlaps(this.interest);
  }

  private inInterest(platform: Platform): boolean {
    return !!this.interest && platform.x + platform.width >= this.interest.left && platform.x <= this.interest.right
      && platform.y >= this.interest.top && platform.y <= this.interest.bottom;
  }

  private selectPlatforms(): void {
    const candidates: Platform[] = [];
    for (const source of this.sources) for (const platform of source.platforms.values()) candidates.push(platform);
    if (candidates.length !== this.registry.length || candidates.some((platform, index) => platform !== this.registry[index])) this.registryRevision++;
    this.registry.length = 0;
    this.registry.push(...candidates);
    const centerX = window.scrollX + window.innerWidth / 2;
    const centerY = window.scrollY + window.innerHeight / 2;
    const distance = (platform: Platform): number => {
      const point = this.inInterest(platform) ? this.interestPoint : undefined;
      return Math.abs(platform.y - (point?.y ?? centerY)) + Math.abs(platform.x + platform.width / 2 - (point?.x ?? centerX)) * 0.35;
    };
    candidates.sort((a, b) => Number(b.id === this.retained?.id) - Number(a.id === this.retained?.id)
      || Number(this.inInterest(b)) - Number(this.inInterest(a)) || distance(a) - distance(b));
    const selected: Platform[] = [];
    for (const candidate of candidates) {
      // Coincident static sources describe one visible top. Never collapse
      // independently moving objects just because their paths briefly overlap.
      if (!candidate.moving && selected.some(p => !p.moving && Math.abs(p.y - candidate.y) < 0.5
        && Math.abs(p.x - candidate.x) < 0.5 && Math.abs(p.width - candidate.width) < 0.5)) continue;
      selected.push(candidate);
      if (selected.length === MAX_PLATFORMS) break;
    }
    selected.sort((a, b) => a.y - b.y || a.x - b.x);
    if (selected.length !== this.selected.size || selected.some(platform => !this.selected.has(platform))) {
      this.selectionRevision++;
      this.selected.clear();
      for (const platform of selected) this.selected.add(platform);
    }
    this.platforms.length = 0;
    this.platforms.push(...selected);
  }

  private hasAnimatedAncestor(element: Element): boolean {
    for (let ancestor: Element | null = element; ancestor; ancestor = composedParent(ancestor)) {
      if (this.animationTargets.has(ancestor)) return true;
    }
    return false;
  }

  private discoverAnimations(force: boolean): void {
    const now = performance.now();
    if (!force && now < this.nextAnimationDiscovery) return;
    this.nextAnimationDiscovery = now + ANIMATION_DISCOVERY_MS;
    for (const host of this.shadowHosts) {
      if (host.isConnected && host.shadowRoot && !this.roots.has(host.shadowRoot)) this.needsRebuild = true;
    }
    const targets = new Set<Element>();
    let inspected = 0;
    for (const tree of [document, ...this.roots]) {
      if (typeof tree.getAnimations !== 'function') continue;
      for (const animation of tree.getAnimations()) {
        if (++inspected > MAX_ANIMATIONS) break;
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (target instanceof Element && target.isConnected && (animation.playState === 'running' || animation.pending)) targets.add(target);
      }
      if (inspected >= MAX_ANIMATIONS) break;
    }
    // Element.animate() emits no DOM mutation or CSS animation event. Request
    // discovery once per newly active target, even if it has no cached source.
    if (!force) {
      for (const target of targets) {
        if (!this.animationTargets.has(target)) {
          this.needsRebuild = true;
          break;
        }
      }
    }
    this.animationTargets = targets;
    for (const source of this.sources) {
      const animated = this.hasAnimatedAncestor(source.element);
      // Sample the final frame when a transition ends, is cancelled, or pauses.
      if (animated !== source.animated) source.pending = 3;
      source.animated = animated;
    }
  }
}
