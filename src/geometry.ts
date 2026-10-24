import { OVERLAY_ID, type Platform } from './types';

const MAX_NODES = 6000;
const MAX_RECTS = 1600;
const MAX_PLATFORMS = 220;
const ANIMATION_DISCOVERY_MS = 250;
const MAX_ANIMATIONS = 1000;
const IGNORED_TAGS: Record<string, true> = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true, IFRAME: true, OBJECT: true, EMBED: true };
const CONTROL_TAGS: Record<string, true> = { BUTTON: true, INPUT: true, SELECT: true, TEXTAREA: true };

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
  documentScroll: boolean;
  scrollers: Element[];
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
  private animationTargets = new Set<Element>();
  private nextAnimationDiscovery = 0;
  private viewport: Area = { left: 0, right: 0, top: 0, bottom: 0 };
  private interest?: Area;
  private interestPoint?: { x: number; y: number };
  private retained?: { source: Source; index: number; id: string };

  rebuild(interest?: { x: number; y: number }): Platform[] {
    this.interestPoint = interest;
    this.updateAreas();
    this.discoverAnimations(true);
    const oldSources = new Map(this.sources.map(source => [source.node, source]));
    const nextSources: Source[] = [];
    const seen = new Set<Node>();
    const measurement: Measurement = { styles: new Map(), rects: 0, scrollX: window.scrollX, scrollY: window.scrollY };
    const collect = (node: Element | Text): void => {
      if (seen.has(node) || measurement.rects >= MAX_RECTS) return;
      seen.add(node);
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
    const walk = (root: Element, animated: boolean): void => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          if (++visited >= MAX_NODES) return NodeFilter.FILTER_ACCEPT;
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          const element = node as Element;
          return (animated ? this.excluded(element) : this.hidden(element, measurement))
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Node | null;
      while (visited < MAX_NODES && measurement.rects < MAX_RECTS && (node = walker.nextNode())) {
        if (visited >= MAX_NODES) break;
        collect(node as Element | Text);
      }
    };
    // Animated roots get bounded discovery before the ordinary visible scan.
    // Keep their initially invisible/offscreen sources; sampling still applies
    // the normal visibility and viewport rules before exposing any platform.
    for (const target of this.animationTargets) {
      if (visited >= MAX_NODES || measurement.rects >= MAX_RECTS) break;
      let excluded = false;
      for (let ancestor: Element | null = target; ancestor; ancestor = ancestor.parentElement) {
        if (this.excluded(ancestor)) { excluded = true; break; }
      }
      if (excluded || target.parentElement && this.hasAnimatedAncestor(target.parentElement)) continue;
      visited++;
      collect(target);
      walk(target, true);
    }
    if (document.body) walk(document.body, false);
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
    if (!this.sources.some(source => source.animated || source.pending > 0 || !source.node.isConnected)) return;
    const measurement: Measurement = { styles: new Map(), rects: 0, scrollX: window.scrollX, scrollY: window.scrollY };
    for (const source of this.sources) {
      if (!source.node.isConnected) {
        source.platforms.clear();
        source.range?.detach();
        continue;
      }
      if (source.animated || source.pending > 0) this.measureSource(source, measurement, false);
    }
    this.sources = this.sources.filter(source => source.node.isConnected);
    this.selectPlatforms();
  }

  /** Only fixed/sticky terrain or descendants of a nested scroller move on scroll. */
  markScrolled(target: EventTarget | null): void {
    const documentScroll = !target || target === document || target === window || target === document.scrollingElement;
    for (const source of this.sources) {
      if (documentScroll ? source.documentScroll : target instanceof Element && source.scrollers.includes(target)) source.pending = 3;
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
  markChanged(target: Node): void {
    const stylesheet = target instanceof Element && (target.tagName === 'STYLE' || target.tagName === 'LINK')
      || target.parentElement?.tagName === 'STYLE';
    for (const source of this.sources) {
      if (stylesheet || target === source.node || target.contains(source.node) || source.element.contains(target)) source.pending = 3;
    }
  }

  clear(): void {
    for (const source of this.sources) source.range?.detach();
    this.sources = [];
    this.platforms.length = 0;
    this.animationTargets.clear();
    this.ids = new WeakMap();
    this.nextId = 1;
    this.nextAnimationDiscovery = 0;
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
    if (this.excluded(element) || element.hasAttribute('hidden')
      || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true') return true;
    const style = this.styleFor(element, measurement);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || style.contentVisibility === 'hidden' || Number(style.opacity) === 0;
  }

  private createSource(node: Element | Text, measurement: Measurement): Source | undefined {
    const text = node.nodeType === Node.TEXT_NODE;
    const element = text ? node.parentElement : node as Element;
    if (!element) return;
    let label: string;
    let range: Range | undefined;
    if (text) {
      if (!(node as Text).data.trim() || element.closest('button, input, select, textarea, [role="button"], [role="textbox"], svg, canvas')) return;
      const style = this.styleFor(element, measurement);
      if (Number.parseFloat(style.fontSize) < 8 || style.color === 'transparent' || style.color === 'rgba(0, 0, 0, 0)') return;
      label = (node as Text).data.trim().replace(/\s+/g, ' ').slice(0, 70);
      range = document.createRange();
    } else {
      const control = CONTROL_TAGS[element.tagName] || element.getAttribute('role') === 'button' || element.getAttribute('role') === 'textbox';
      const image = element.tagName === 'IMG' || element.tagName === 'VIDEO' || element.tagName === 'CANVAS' || element.getAttribute('role') === 'img';
      if ((!control && !image) || element.getAttribute('type') === 'hidden'
        || element.getAttribute('role') === 'presentation' || element.getAttribute('role') === 'none') return;
      // Empty alt is an accessibility choice, not evidence that an image has no
      // visible physical surface. Large hero and promotional images count too.
      label = (element.getAttribute('aria-label') || element.getAttribute('alt')
        || element.getAttribute('value') || element.textContent || element.tagName).trim().slice(0, 70);
    }
    if (!this.ids.has(node)) this.ids.set(node, this.nextId++);
    return { node, element, range, text, label, platforms: new Map(), animated: false, pending: 0, documentScroll: false, scrollers: [] };
  }

  private measureSource(source: Source, measurement: Measurement, rebuilding: boolean): void {
    const old = source.platforms;
    const visible = new Map<number, Platform>();
    let clipped: Area | undefined;
    let hidden = !source.node.isConnected;
    source.documentScroll = false;
    source.scrollers.length = 0;
    for (let element: Element | null = source.element; element && !hidden; element = element.parentElement) {
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
    if (!hidden) {
      let rects: DOMRectList | DOMRect[];
      if (source.range) {
        const text = source.node as Text;
        source.range.setStart(text, 0);
        source.range.setEnd(text, Math.min(text.length, 8000));
        source.label = text.data.trim().replace(/\s+/g, ' ').slice(0, 70);
        rects = source.range.getClientRects();
      } else {
        rects = [source.element.getBoundingClientRect()];
      }
      for (let index = 0; index < rects.length && index < 80 && measurement.rects < MAX_RECTS; index++) {
        measurement.rects++;
        const rect = rects[index];
        let left = rect.left;
        let right = rect.right;
        if (clipped) {
          if (rect.top < clipped.top || rect.top >= clipped.bottom) continue;
          left = Math.max(left, clipped.left);
          right = Math.min(right, clipped.right);
        }
        const x = left + measurement.scrollX;
        const y = rect.top + measurement.scrollY;
        const width = right - left;
        const retained = this.retained?.source === source && this.retained.index === index;
        if (width < 30 || rect.height < 4 || (source.text && rect.height > 80)
          || !Number.isFinite(x + y + width) || (!retained && !this.intersects({ left: x, right: x + width, top: y, bottom: y + rect.height }))) continue;
        let platform = old.get(index);
        const changed = !!platform && (platform.x !== x || platform.y !== y || platform.width !== width);
        const continuous = source.animated || !!platform?.moving;
        if (!platform) {
          platform = { id: `dom:${this.ids.get(source.node)}:${index}`, x, y, width, previousX: x, previousY: y, previousWidth: width };
        } else {
          platform.x = x;
          platform.y = y;
          platform.width = width;
          if (rebuilding && !continuous) {
            platform.previousX = x;
            platform.previousY = y;
            platform.previousWidth = width;
          }
        }
        platform.label = source.label;
        platform.moving = source.animated || (!rebuilding && changed);
        moved ||= changed;
        visible.set(index, platform);
      }
    }
    source.platforms = visible;
    source.pending = moved && !rebuilding ? 2 : Math.max(0, source.pending - 1);
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
    const centerX = window.scrollX + window.innerWidth / 2;
    const centerY = window.scrollY + window.innerHeight / 2;
    const distance = (platform: Platform): number => {
      const point = this.inInterest(platform) ? this.interestPoint : undefined;
      return Math.abs(platform.y - (point?.y ?? centerY)) + Math.abs(platform.x + platform.width / 2 - (point?.x ?? centerX)) * 0.35;
    };
    candidates.sort((a, b) => Number(b.id === this.retained?.id) - Number(a.id === this.retained?.id)
      || Number(this.inInterest(b)) - Number(this.inInterest(a)) || distance(a) - distance(b));
    this.platforms.length = 0;
    const selected: Platform[] = [];
    for (const candidate of candidates) {
      // Coincident static sources describe one visible top. Never collapse
      // independently moving objects just because their paths briefly overlap.
      if (!candidate.moving && selected.some(p => !p.moving && Math.abs(p.y - candidate.y) < 0.5
        && Math.abs(p.x - candidate.x) < 0.5 && Math.abs(p.width - candidate.width) < 0.5)) continue;
      selected.push(candidate);
      if (selected.length === MAX_PLATFORMS) break;
    }
    this.platforms.push(...selected.sort((a, b) => a.y - b.y || a.x - b.x));
  }

  private hasAnimatedAncestor(element: Element): boolean {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (this.animationTargets.has(ancestor)) return true;
    }
    return false;
  }

  private discoverAnimations(force: boolean): void {
    const now = performance.now();
    if (!force && now < this.nextAnimationDiscovery) return;
    this.nextAnimationDiscovery = now + ANIMATION_DISCOVERY_MS;
    const targets = new Set<Element>();
    if (typeof document.getAnimations === 'function') {
      const animations = document.getAnimations();
      for (let index = 0; index < animations.length && index < MAX_ANIMATIONS; index++) {
        const animation = animations[index];
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (target instanceof Element && target.isConnected && (animation.playState === 'running' || animation.pending)) targets.add(target);
      }
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
