import { OVERLAY_ID } from '../engine/types';
import type { Rect } from './scenery-types';
import { composedParent } from '../page/composed-dom';

const MAX_NODES = 12000;
const MAX_CHANGED_NODES = 512;
const MAX_SOURCES = 4000;
const MAX_RECTS = 12000;
const MAX_ANCESTORS = 128;
const MAX_ANIMATIONS = 1000;
const PADDING = 4;
const BOX_TAGS: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true, IMG: true, VIDEO: true, CANVAS: true, SVG: true, IFRAME: true, OBJECT: true, EMBED: true, METER: true, PROGRESS: true };
const SKIP_TAGS: Record<string, true> = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true };
const MOTION_STYLES: Record<string, true> = { transform: true, translate: true, rotate: true, scale: true, opacity: true, visibility: true, clip: true, 'clip-path': true, filter: true, 'backdrop-filter': true };
const LOCAL_ANIMATION_PROPERTIES: Record<string, true> = { offset: true, computedOffset: true, easing: true, composite: true, transform: true, translate: true, rotate: true, scale: true, opacity: true, visibility: true, clip: true, clipPath: true, filter: true, backdropFilter: true, color: true, backgroundColor: true, borderTopColor: true, borderRightColor: true, borderBottomColor: true, borderLeftColor: true, fill: true, stroke: true, fillOpacity: true, strokeOpacity: true, outlineColor: true, textDecorationColor: true, caretColor: true };

/** Decorative compositor canvases are neither readable media nor native terrain. */
export function isDecorativeCanvas(element: Element, style?: CSSStyleDeclaration, bounds?: Pick<DOMRect, 'width' | 'height'>): boolean {
  if (element.tagName.toUpperCase() !== 'CANVAS') return false;
  // Explicitly named/interactive media keeps its native content protection.
  if (element.getAttribute('role') === 'img' || element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') || element.hasAttribute('tabindex')) return false;
  if (element.getAttribute('aria-hidden') === 'true' || /^(?:presentation|none)$/.test(element.getAttribute('role') ?? '')) return true;
  const box = bounds ?? element.getBoundingClientRect();
  if (box.width < innerWidth * 0.8 || box.height < innerHeight * 0.8) return false;
  const computed = style ?? getComputedStyle(element);
  let effectWrapper = false;
  for (let ancestor: Element | null = element, depth = 0; ancestor && depth < 5; ancestor = ancestor.parentElement, depth++) {
    if (/(?:^|[\s_-])(?:gl-wrap|rive|webgl|canvas-background)(?:$|[\s_-])/i.test(`${ancestor.id} ${ancestor.getAttribute('class') ?? ''}`)
      || ancestor.hasAttribute('data-rive') || ancestor.hasAttribute('data-rive-src')) effectWrapper = true;
  }
  return effectWrapper || computed.pointerEvents === 'none' && (computed.position === 'absolute' || computed.position === 'fixed');
}

interface Source {
  node: Element | Text;
  element: Element;
  range?: Range;
  ancestors: Element[];
  clips: { element: Element; x: boolean; y: boolean }[];
  scrollers: Element[];
  documentScroll: boolean;
  rectangles: Rect[];
}
interface Measurement {
  styles: Map<Element, CSSStyleDeclaration>;
  count: number;
  x: number;
  y: number;
  clips: Map<Element, DOMRect>;
  truncated: boolean;
}

/** Cosmetic exclusion masks in document CSS pixels; never contributes terrain. */
export class TextClearance {
  rectangles: Rect[] = [];
  /** A usable cache exists. Dirtiness never globally disables decoration. */
  complete = false;
  /** Discovery is deferred; cached source handles remain usable until rebuild. */
  needsRebuild = false;
  private sources: Source[] = [];
  private byNode = new Map<Node, Source>();
  private byAncestor = new Map<Element, Set<Source>>();
  private byScroller = new Map<Element, Set<Source>>();
  private documentScrollSources = new Set<Source>();
  private pending = new Set<Source>();
  private moving = new Set<Source>();
  private roots = new Set<ShadowRoot>();
  private dirtyAll = false;
  private fallbackElements = new Set<Element>();
  private layoutMotion = false;
  private previousStyle = document.createElement('span').style;

  rebuild(): void {
    this.clear();
    const measurement = this.measurement();
    if (document.documentElement) this.discover(document.documentElement, measurement, MAX_NODES);
    this.publish();
    this.complete = !measurement.truncated;
  }

  /** One frame snapshot: retained handles only, with no discovery or path sweeping. */
  sampleMotion(): void {
    if (!this.complete) return;
    const measurement = this.measurement();
    const nextMoving = this.discoverMotion();
    for (const source of this.moving) this.pending.add(source); // Final sample when an animation ends.
    for (const source of nextMoving) this.pending.add(source);
    this.moving = nextMoving;
    if (this.dirtyAll) for (const source of this.sources) this.pending.add(source);
    if (!this.pending.size) return;
    for (const source of this.pending) this.measure(source, measurement);
    this.pending.clear();
    this.dirtyAll = false;
    this.publish();
  }

  markScrolled(target: EventTarget | null): void {
    const sources = !target || target === document || target === window || target === document.scrollingElement
      ? this.documentScrollSources
      : target instanceof Element ? this.byScroller.get(target) : undefined;
    if (sources) for (const source of sources) this.pending.add(source);
  }

  /** Local paint/transform changes remeasure their cached descendants this frame. */
  markStyleMotion(target: Element, previousInlineStyle: string | null): boolean {
    if (!this.complete || !(target instanceof HTMLElement || target instanceof SVGElement)) return false;
    const previous = this.previousStyle, current = target.style;
    previous.cssText = previousInlineStyle ?? '';
    for (let index = 0; index < previous.length + current.length; index++) {
      const name = index < previous.length ? previous.item(index) : current.item(index - previous.length);
      if (previous.getPropertyValue(name) === current.getPropertyValue(name)
        && previous.getPropertyPriority(name) === current.getPropertyPriority(name)) continue;
      if (!MOTION_STYLES[name]) return false;
    }
    for (const source of this.byAncestor.get(target) ?? []) this.pending.add(source);
    return true;
  }

  /** Called outside the frame loop; pass added nodes to protect new text immediately. */
  markChanged(target: Node): void {
    this.needsRebuild = true;
    this.dirtyAll = true; // A class/style/text change can relayout siblings too.
    if (!this.complete || !target.isConnected) return;
    if (this.byNode.has(target) || target instanceof Element && this.byAncestor.has(target)) return;
    const measurement = this.measurement();
    this.discover(target, measurement, MAX_CHANGED_NODES);
    if (measurement.truncated) {
      const element = target instanceof Element ? target : target.parentElement;
      if (element) this.fallbackElements.add(element);
    }
    this.publish();
  }

  clear(): void {
    for (const source of this.sources) source.range?.detach();
    this.sources = [];
    this.byNode.clear();
    this.byAncestor.clear();
    this.byScroller.clear();
    this.documentScrollSources.clear();
    this.pending.clear();
    this.moving.clear();
    this.roots.clear();
    this.dirtyAll = false;
    this.fallbackElements.clear();
    this.layoutMotion = false;
    this.previousStyle.cssText = '';
    this.rectangles = [];
    this.complete = false;
    this.needsRebuild = false;
  }

  private discover(root: Node, measurement: Measurement, budget: number): void {
    let visited = 0;
    const collect = (node: Node): void => {
      if (node instanceof Element) {
        const opaque = (node.localName.includes('-') || node.hasAttribute('is')) && !node.shadowRoot;
        if (opaque || BOX_TAGS[node.tagName.toUpperCase()] || node instanceof HTMLElement && node.isContentEditable) this.addSource(node, measurement);
        if (node.shadowRoot) { this.roots.add(node.shadowRoot); walk(node.shadowRoot); }
      } else if (node instanceof Text && node.data.trim()) this.addSource(node, measurement);
    };
    const walk = (node: Node): void => {
      if (node instanceof Element && this.excluded(node)) return;
      if (++visited > budget) { measurement.truncated = true; return; }
      collect(node);
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: child => child instanceof Element && (this.excluded(child)
          || child.namespaceURI === 'http://www.w3.org/2000/svg' && child.localName !== 'svg')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      let child: Node | null;
      while (visited < budget && (child = walker.nextNode())) { visited++; collect(child); }
      if (visited >= budget && walker.nextNode()) measurement.truncated = true;
    };
    walk(root);
  }

  private excluded(element: Element): boolean {
    return element.id === OVERLAY_ID || !!SKIP_TAGS[element.tagName.toUpperCase()] || !!element.closest(`#${OVERLAY_ID}`);
  }

  private measurement(): Measurement {
    return { styles: new Map(), clips: new Map(), count: 0, x: window.scrollX, y: window.scrollY, truncated: false };
  }

  private style(element: Element, measurement: Measurement): CSSStyleDeclaration {
    let style = measurement.styles.get(element);
    if (!style) { style = getComputedStyle(element); measurement.styles.set(element, style); }
    return style;
  }


  private addSource(node: Element | Text, measurement: Measurement): void {
    if (this.byNode.has(node)) return;
    if (this.sources.length >= MAX_SOURCES) { measurement.truncated = true; return; }
    const element = node instanceof Element ? node : composedParent(node);
    if (!element || this.excluded(element)) return;
    const source: Source = { node, element, ancestors: [], clips: [], scrollers: [], documentScroll: false, rectangles: [] };
    if (node instanceof Text) {
      source.range = document.createRange();
      source.range.selectNodeContents(node);
    }
    this.sources.push(source);
    this.byNode.set(node, source);
    this.measure(source, measurement);
  }

  /** Refresh clipping/containing-block topology as well as bounds after script writes. */
  private relate(source: Source, measurement: Measurement): void {
    for (const ancestor of source.ancestors) this.byAncestor.get(ancestor)?.delete(source);
    for (const scroller of source.scrollers) this.byScroller.get(scroller)?.delete(source);
    this.documentScrollSources.delete(source);
    source.ancestors.length = source.clips.length = source.scrollers.length = 0;
    source.documentScroll = false;
    let containingBlock: 'absolute' | 'fixed' | undefined;
    for (let ancestor: Element | null = source.element; ancestor && source.ancestors.length < MAX_ANCESTORS; ancestor = composedParent(ancestor)) {
      source.ancestors.push(ancestor);
      let descendants = this.byAncestor.get(ancestor);
      if (!descendants) { descendants = new Set(); this.byAncestor.set(ancestor, descendants); }
      descendants.add(source);
      const style = this.style(ancestor, measurement);
      const establishesBlock = style.transform !== 'none' || style.perspective !== 'none'
        || style.filter !== 'none' || style.backdropFilter && style.backdropFilter !== 'none'
        || /(?:layout|paint|strict|content)/.test(style.contain) || /(?:transform|perspective|filter)/.test(style.willChange);
      if (containingBlock && (establishesBlock || containingBlock === 'absolute' && style.position !== 'static')) containingBlock = undefined;
      if (style.position === 'fixed' || style.position === 'sticky') source.documentScroll = true;
      const x = /^(?:auto|scroll|hidden|overlay|clip)$/.test(style.overflowX);
      const y = /^(?:auto|scroll|hidden|overlay|clip)$/.test(style.overflowY);
      const paintClip = style.clipPath && style.clipPath !== 'none' || /(?:paint|strict|content)/.test(style.contain);
      if (ancestor !== document.scrollingElement && (x || y || paintClip)) {
        source.scrollers.push(ancestor);
        let descendants = this.byScroller.get(ancestor);
        if (!descendants) { descendants = new Set(); this.byScroller.set(ancestor, descendants); }
        descendants.add(source);
        if (!containingBlock && (source.range || ancestor !== source.element || paintClip)) source.clips.push({ element: ancestor, x: x || !!paintClip, y: y || !!paintClip });
      }
      if (!containingBlock && (style.position === 'fixed' || style.position === 'absolute')) containingBlock = style.position;
    }
    if (source.documentScroll) this.documentScrollSources.add(source);
  }

  private measure(source: Source, measurement: Measurement): void {
    const previous = source.rectangles;
    source.rectangles = [];
    if (!source.node.isConnected) return;
    try {
      if (source.node instanceof Text) {
        const element = composedParent(source.node);
        if (!element) return;
        source.element = element;
      }
      this.relate(source, measurement);
      for (const ancestor of source.ancestors) {
        const style = this.style(ancestor, measurement);
        if (ancestor.id === OVERLAY_ID || style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return;
      }
      const style = this.style(source.element, measurement);
      if (style.visibility === 'hidden' || style.visibility === 'collapse' || !source.range && isDecorativeCanvas(source.element, style)) return;
      // Re-select because characterData edits can change a retained Range's endpoint.
      if (source.range) source.range.selectNodeContents(source.node);
      const fontSize = Number.parseFloat(style.fontSize) || 0;
      let padding = source.range ? Math.max(PADDING, fontSize / 2) : PADDING;
      if (source.range) {
        for (const layer of (style.textShadow ?? '').replace(/(?:rgba?|hsla?|color)\([^)]*\)/g, '').split(',')) {
          const lengths = layer.match(/-?(?:\d*\.)?\d+px/g);
          if (!lengths || lengths.length < 2) continue;
          const [x, y, blur = 0] = lengths.map(Number.parseFloat);
          padding = Math.max(padding, Math.abs(x) + Math.abs(y) + Math.max(0, blur) * 2 + fontSize / 2 + PADDING);
        }
        padding += Number.parseFloat(style.getPropertyValue('-webkit-text-stroke-width')) || 0;
      }
      // On unusually fragmented content, protect its local element box instead of
      // invalidating every unrelated track or publishing an incomplete text mask.
      const fragments = source.range ? source.range.getClientRects() : source.element.getClientRects();
      const bounds = measurement.count + fragments.length > MAX_RECTS ? [source.element.getBoundingClientRect()] : fragments;
      for (const bound of bounds) {
        measurement.count++;
        if (bound.width <= 0 || bound.height <= 0 || !Number.isFinite(bound.left + bound.top + bound.width + bound.height + padding)) continue;
        const rect = this.clip({ x: bound.left + measurement.x - padding, y: bound.top + measurement.y - padding, width: bound.width + padding * 2, height: bound.height + padding * 2 }, source, measurement);
        if (rect) source.rectangles.push(rect);
      }
    } catch {
      // Keep the last local mask until discovery can restore this source.
      source.rectangles = previous;
      this.needsRebuild = true;
    }
  }

  private clip(rect: Rect, source: Source, measurement: Measurement): Rect | undefined {
    let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
    for (const clip of source.clips) {
      let bounds = measurement.clips.get(clip.element);
      if (!bounds) { bounds = clip.element.getBoundingClientRect(); measurement.clips.set(clip.element, bounds); }
      if (clip.x) { left = Math.max(left, bounds.left + measurement.x - PADDING); right = Math.min(right, bounds.right + measurement.x + PADDING); }
      if (clip.y) { top = Math.max(top, bounds.top + measurement.y - PADDING); bottom = Math.min(bottom, bounds.bottom + measurement.y + PADDING); }
      if (right <= left || bottom <= top) return;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  private discoverMotion(): Set<Source> {
    const moving = new Set<Source>();
    if (this.layoutMotion) this.dirtyAll = true; // Final sibling-layout sample after animation removal.
    this.layoutMotion = false;
    try {
      let inspected = 0;
      for (const tree of [document, ...this.roots]) {
        if (typeof tree.getAnimations !== 'function') continue;
        for (const animation of tree.getAnimations()) {
          if (++inspected > MAX_ANIMATIONS) break;
          const effect = animation.effect;
          if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) continue;
          try {
            if (effect.getKeyframes().some(frame => Object.keys(frame).some(property => !LOCAL_ANIMATION_PROPERTIES[property]))) this.layoutMotion = true;
          } catch { this.layoutMotion = true; }
          for (const source of this.byAncestor.get(effect.target) ?? []) moving.add(source);
        }
        if (inspected >= MAX_ANIMATIONS) break;
      }
    } catch { /* Existing dirty handles remain sampleable without animation metadata. */ }
    if (this.layoutMotion) this.dirtyAll = true;
    return moving;
  }

  private publish(): void {
    this.rectangles = [];
    for (const source of this.sources) this.rectangles.push(...source.rectangles);
    // Newly inserted subtrees beyond the incremental discovery budget keep local
    // box protection until the deferred full scan can measure their actual text.
    for (const element of this.fallbackElements) {
      if (!element.isConnected) { this.fallbackElements.delete(element); continue; }
      const rect = element.getBoundingClientRect();
      this.rectangles.push({ x: rect.left + scrollX - PADDING, y: rect.top + scrollY - PADDING,
        width: rect.width + PADDING * 2, height: rect.height + PADDING * 2 });
    }
  }
}
