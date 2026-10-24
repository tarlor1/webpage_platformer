import { OVERLAY_ID } from './types';
import type { Rect } from './scenery-types';

const MAX_NODES = 12000;
const MAX_SOURCES = 4000;
const MAX_RECTS = 12000;
const MAX_ANCESTORS = 128;
const MAX_ANIMATIONS = 256;
const MAX_KEYFRAMES = 128;
const PADDING = 4;
const SWEPT_PADDING = 8;
// These timing functions stay within their endpoint values. Custom curves may overshoot.
const BOUNDED_EASING = /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|steps\(\s*\d+\s*(?:,\s*(?:start|end|jump-start|jump-end|jump-none|jump-both))?\s*\))$/;
const BOX_TAGS: Record<string, true> = { INPUT: true, TEXTAREA: true, BUTTON: true, SELECT: true, IMG: true, VIDEO: true, CANVAS: true, SVG: true, IFRAME: true, OBJECT: true, EMBED: true, METER: true, PROGRESS: true };
const SKIP_TAGS: Record<string, true> = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true };
const PAINT_PROPERTIES: Record<string, true> = { opacity: true, visibility: true, color: true, backgroundColor: true, borderTopColor: true, borderRightColor: true, borderBottomColor: true, borderLeftColor: true, fill: true, stroke: true, fillOpacity: true, strokeOpacity: true, outlineColor: true, textDecorationColor: true, caretColor: true };
const FRAME_METADATA: Record<string, true> = { offset: true, computedOffset: true, easing: true, composite: true };
const MOTION_STYLES: Record<string, true> = { transform: true, translate: true, rotate: true, scale: true, opacity: true };

interface Source {
  node: Element | Text;
  element: Element;
  range?: Range;
  ancestors: Element[];
  clips: { element: Element; x: boolean; y: boolean }[];
  fixedRoot?: Element;
  rectangles: Rect[];
  previous: Rect[];
}
interface Bounds { left: number; right: number; top: number; bottom: number }
interface Motion extends Bounds { target: Element }
interface Measurement {
  styles: Map<Element, CSSStyleDeclaration>;
  count: number;
  x: number;
  y: number;
  clips: Map<Element, DOMRect>;
}

/** Cosmetic exclusion mask only. Never contributes collision geometry or mutates page layout. */
export class TextClearance {
  rectangles: Rect[] = [];
  complete = false;
  private inspected = false;
  private sources: Source[] = [];
  private byAncestor = new Map<Element, Source[]>();
  private staticRectangles: Rect[] = [];
  private staticReady = false;
  private moving: Source[] = [];
  private movingSet = new Set<Source>();
  private documentScrollSources: Source[] = [];
  private byScroller = new Map<Element, Source[]>();
  private pendingScroll = new Set<Source>();
  private previousStyle = document.createElement('span').style;

  rebuild(): void {
    this.clear();
    this.inspected = true;
    const measurement = this.measurement();
    let visited = 0;
    const visit = (root: Node): void => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          if (node instanceof Element && (node.id === OVERLAY_ID || SKIP_TAGS[node.tagName.toUpperCase()])) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (++visited > MAX_NODES) { this.inspected = false; return; }
        if (node instanceof Element) {
          if (['ANIMATE', 'ANIMATETRANSFORM', 'ANIMATEMOTION', 'SET', 'MARQUEE'].includes(node.tagName.toUpperCase())) { this.inspected = false; return; }
          // Opaque components can contain text unavailable to Range. Protect the
          // whole rendered host instead of disabling decoration on the whole page.
          const opaque = (node.localName.includes('-') || node.hasAttribute('is')) && !node.shadowRoot;
          if (node.shadowRoot) {
            visit(node.shadowRoot);
            if (!this.inspected) return;
          }
          // SVG and embedded documents/bitmaps may contain text with no DOM Text handle.
          if (opaque || BOX_TAGS[node.tagName.toUpperCase()] || node instanceof HTMLElement && node.isContentEditable) this.addSource(node, measurement);
        } else if (node instanceof Text && node.data.trim()) {
          this.addSource(node, measurement);
        }
        if (!this.inspected) return;
      }
    };
    if (document.documentElement) visit(document.documentElement);
    this.complete = this.inspected;
    if (this.inspected) this.sampleMotion();
  }

  /** Native animation and scroll sampling only remeasure retained source handles. */
  sampleMotion(): void {
    this.complete = this.inspected;
    if (!this.complete) { this.rectangles = []; return; }
    const measurement = this.measurement();
    const scrolling = this.pendingScroll.size > 0;
    if (scrolling) {
      // Finish the bounded affected set atomically: a time-sliced scroll refresh
      // would leave holes or old fixed/sticky masks in document coordinates.
      for (const source of this.pendingScroll) {
        this.measure(source, measurement);
        if (!this.complete) { this.inspected = false; this.rectangles = []; return; }
      }
      this.pendingScroll.clear();
      this.staticReady = false;
      measurement.count = 0;
    }
    // Finish the count-bounded mask atomically. A slow frame must not blank
    // otherwise complete protection and make all material flicker.
    const motions = this.discoverMotion(measurement);
    if (!this.complete) { this.rectangles = []; return; }
    const nextMoving = new Set<Source>();
    for (const motion of motions) for (const source of this.byAncestor.get(motion.target) ?? []) nextMoving.add(source);
    const changed = nextMoving.size !== this.movingSet.size || [...nextMoving].some(source => !this.movingSet.has(source));
    if (changed || !this.staticReady) {
      // Sources leaving an animation need one final measurement before becoming static.
      for (const source of this.moving) if (!nextMoving.has(source)) this.measure(source, measurement);
      if (!this.complete) { this.inspected = false; this.rectangles = []; return; }
      this.movingSet = nextMoving;
      this.moving = [...nextMoving];
      this.staticRectangles = [];
      for (const source of this.sources) if (!nextMoving.has(source)) this.staticRectangles.push(...source.rectangles);
      this.staticReady = true;
    }
    const rectangles = this.staticRectangles.slice();
    for (const source of this.moving) {
      if (!source.node.isConnected) { this.complete = false; break; }
      source.previous = source.rectangles;
      this.measure(source, measurement, false);
      if (!this.complete) break;
      const travel: Bounds = { left: 0, right: 0, top: 0, bottom: 0 };
      for (const ancestor of source.ancestors) {
        const style = this.style(ancestor, measurement);
        // A translation in a rotated/scaled/perspective coordinate system needs a different envelope.
        if (!this.translation(style.transform) || style.perspective !== 'none' || style.zoom && style.zoom !== '1' && style.zoom !== 'normal' || style.rotate && style.rotate !== 'none' || style.scale && style.scale !== 'none') {
          this.complete = false;
          break;
        }
      }
      if (!this.complete) break;
      for (const motion of motions) if (source.ancestors.includes(motion.target)) {
        travel.left += motion.left;
        travel.right += motion.right;
        travel.top += motion.top;
        travel.bottom += motion.bottom;
      }
      // Cover the full supported animation path, plus previous/current sampled bounds.
      // The extra margin absorbs subpixel/ink overhang and timing around 16 ms samples.
      const previous = source.previous;
      for (let index = 0; index < source.rectangles.length; index++) {
        const rect = source.rectangles[index];
        const old = previous[index] ?? rect;
        const left = Math.min(rect.x + travel.left, old.x) - SWEPT_PADDING;
        const top = Math.min(rect.y + travel.top, old.y) - SWEPT_PADDING;
        const right = Math.max(rect.x + rect.width + travel.right, old.x + old.width) + SWEPT_PADDING;
        const bottom = Math.max(rect.y + rect.height + travel.bottom, old.y + old.height) + SWEPT_PADDING;
        const clipped = this.clip({ x: left, y: top, width: right - left, height: bottom - top }, source, measurement);
        if (clipped) rectangles.push(clipped);
      }
      // A wrapping/disappearing line must not immediately expose its previous location.
      for (let index = source.rectangles.length; index < previous.length; index++) {
        const clipped = this.clip(previous[index], source, measurement);
        if (clipped) rectangles.push(clipped);
      }
      if (rectangles.length > MAX_RECTS) { this.complete = false; break; }
    }
    this.rectangles = this.complete ? rectangles : [];
  }

  /** Scroll changes masks, never source completeness or material placement. */
  markScrolled(target: EventTarget | null): void {
    const sources = !target || target === document || target === window || target === document.scrollingElement
      ? this.documentScrollSources
      : target instanceof Element ? this.byScroller.get(target) : undefined;
    if (sources) for (const source of sources) this.pendingScroll.add(source);
  }

  /** Scripted translations do not reflow siblings or invalidate the whole page. */
  markStyleMotion(target: Element, previousInlineStyle: string | null): boolean {
    if (!this.inspected || !(target instanceof HTMLElement || target instanceof SVGElement)) return false;
    const previous = this.previousStyle, current = target.style;
    previous.cssText = previousInlineStyle ?? '';
    let transformed = false;
    for (let index = 0; index < previous.length + current.length; index++) {
      const name = index < previous.length ? previous.item(index) : current.item(index - previous.length);
      if (previous.getPropertyValue(name) === current.getPropertyValue(name)
        && previous.getPropertyPriority(name) === current.getPropertyPriority(name)) continue;
      if (!Object.hasOwn(MOTION_STYLES, name)) return false;
      if (name !== 'opacity') transformed = true;
    }
    const sources = this.byAncestor.get(target) ?? [];
    // A transformed ancestor can change a fixed descendant's containing block.
    // Those rarer topology changes still require a full relationship rebuild.
    if (transformed && sources.some(source => source.fixedRoot && source.fixedRoot !== target
      && source.ancestors.indexOf(source.fixedRoot) < source.ancestors.indexOf(target))) return false;
    for (const source of sources) this.pendingScroll.add(source);
    return true;
  }

  /** Style changes can relayout siblings; only a complete rebuild restores the guarantee. */
  markChanged(_target: Node): void {
    this.inspected = false;
    this.complete = false;
    this.rectangles = [];
  }

  clear(): void {
    for (const source of this.sources) source.range?.detach();
    this.sources = [];
    this.byAncestor.clear();
    this.staticRectangles = [];
    this.staticReady = false;
    this.moving = [];
    this.movingSet.clear();
    this.documentScrollSources = [];
    this.byScroller.clear();
    this.pendingScroll.clear();
    this.previousStyle.cssText = '';
    this.rectangles = [];
    this.complete = false;
    this.inspected = false;
  }

  private measurement(): Measurement {
    return { styles: new Map(), clips: new Map(), count: 0, x: window.scrollX, y: window.scrollY };
  }

  private style(element: Element, measurement: Measurement): CSSStyleDeclaration {
    let style = measurement.styles.get(element);
    if (!style) { style = getComputedStyle(element); measurement.styles.set(element, style); }
    return style;
  }

  private parent(element: Element): Element | null {
    return element.assignedSlot ?? element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);
  }

  private addSource(node: Element | Text, measurement: Measurement): void {
    const root = node.getRootNode();
    const element = node instanceof Element ? node : node.assignedSlot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    if (!element || this.sources.length >= MAX_SOURCES) { this.inspected = false; return; }
    const ancestors: Element[] = [];
    for (let ancestor: Element | null = element; ancestor; ancestor = this.parent(ancestor)) {
      if (ancestor.id === OVERLAY_ID) return;
      if (ancestors.length >= MAX_ANCESTORS) { this.inspected = false; return; }
      ancestors.push(ancestor);
    }
    const clips: Source['clips'] = [];
    const scrollers: Element[] = [];
    let documentScroll = false;
    let fixedRoot: Element | undefined;
    // Out-of-flow boxes can escape overflow ancestors outside their containing
    // block. Keep those ancestors out of the clipping chain.
    let containingBlock: 'absolute' | 'fixed' | undefined;
    for (const ancestor of ancestors) {
      const style = this.style(ancestor, measurement);
      const establishesBlock = style.transform !== 'none' || style.perspective !== 'none'
        || style.filter !== 'none' || style.backdropFilter && style.backdropFilter !== 'none'
        || /(?:layout|paint|strict|content)/.test(style.contain)
        || /(?:transform|perspective|filter)/.test(style.willChange);
      if (containingBlock && (establishesBlock || containingBlock === 'absolute' && style.position !== 'static')) containingBlock = undefined;
      if (style.position === 'fixed' || style.position === 'sticky') documentScroll = true;
      if (style.position === 'fixed') fixedRoot ??= ancestor;
      const x = /^(?:auto|scroll|hidden|overlay|clip)$/.test(style.overflowX);
      const y = /^(?:auto|scroll|hidden|overlay|clip)$/.test(style.overflowY);
      if (ancestor !== document.scrollingElement && (x || y)) {
        scrollers.push(ancestor);
        if (!containingBlock && (node instanceof Text || ancestor !== element)) clips.push({ element: ancestor, x, y });
      }
      if (!containingBlock && (style.position === 'fixed' || style.position === 'absolute')) containingBlock = style.position;
    }
    const source: Source = { node, element, ancestors, clips, fixedRoot, rectangles: [], previous: [] };
    if (documentScroll) this.documentScrollSources.push(source);
    for (const scroller of scrollers) {
      let sources = this.byScroller.get(scroller);
      if (!sources) { sources = []; this.byScroller.set(scroller, sources); }
      sources.push(source);
    }
    if (node instanceof Text) {
      source.range = document.createRange();
      source.range.selectNodeContents(node);
    }
    this.sources.push(source);
    for (const ancestor of ancestors) {
      let sources = this.byAncestor.get(ancestor);
      if (!sources) { sources = []; this.byAncestor.set(ancestor, sources); }
      sources.push(source);
    }
    this.complete = true;
    this.measure(source, measurement);
    if (!this.complete) this.inspected = false;
  }

  private measure(source: Source, measurement: Measurement, clip = true): void {
    source.rectangles = [];
    try {
      for (const ancestor of source.ancestors) {
        const style = this.style(ancestor, measurement);
        if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return;
      }
      const style = this.style(source.element, measurement);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
      // Range rectangles include every rendered line, with no minimum glyph/line size.
      const bounds = source.range ? source.range.getClientRects() : source.element.getClientRects();
      let padding = PADDING;
      if (source.range) {
        const fontSize = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(fontSize)) { this.complete = false; return; }
        padding = Math.max(PADDING, fontSize / 2);
        const shadow = style.textShadow;
        if (shadow && shadow !== 'none') {
          // Computed colors contain commas; remove them before splitting shadow layers.
          for (const layer of shadow.replace(/(?:rgba?|hsla?|color)\([^)]*\)/g, '').split(',')) {
            const lengths = layer.match(/-?(?:\d*\.)?\d+px/g);
            if (!lengths || lengths.length < 2 || lengths.length > 3) { this.complete = false; return; }
            const [x, y, blur = 0] = lengths.map(Number.parseFloat);
            padding = Math.max(padding, Math.abs(x) + Math.abs(y) + Math.max(0, blur) * 2 + fontSize / 2 + PADDING);
          }
        }
        padding += Number.parseFloat(style.getPropertyValue('-webkit-text-stroke-width')) || 0;
      }
      for (const bound of bounds) {
        if (++measurement.count > MAX_RECTS || ![bound.left, bound.top, bound.width, bound.height, padding].every(Number.isFinite)) { this.complete = false; return; }
        if (bound.width <= 0 || bound.height <= 0) continue;
        const rect = { x: bound.left + measurement.x - padding, y: bound.top + measurement.y - padding, width: bound.width + padding * 2, height: bound.height + padding * 2 };
        const clipped = clip ? this.clip(rect, source, measurement) : rect;
        if (clipped) source.rectangles.push(clipped);
      }
    } catch {
      this.complete = false;
    }
  }

  private clip(rect: Rect, source: Source, measurement: Measurement): Rect | undefined {
    let left = rect.x;
    let top = rect.y;
    let right = left + rect.width;
    let bottom = top + rect.height;
    for (const clip of source.clips) {
      let bounds = measurement.clips.get(clip.element);
      if (!bounds) { bounds = clip.element.getBoundingClientRect(); measurement.clips.set(clip.element, bounds); }
      // Border-box clipping is deliberately conservative around borders,
      // scrollbars and transformed containers, preserving native ink padding.
      if (clip.x) {
        left = Math.max(left, bounds.left + measurement.x - PADDING);
        right = Math.min(right, bounds.right + measurement.x + PADDING);
      }
      if (clip.y) {
        top = Math.max(top, bounds.top + measurement.y - PADDING);
        bottom = Math.min(bottom, bounds.bottom + measurement.y + PADDING);
      }
      if (right <= left || bottom <= top) return;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  private translation(transform: string): { x: number; y: number } | undefined {
    if (!transform || transform === 'none') return { x: 0, y: 0 };
    try {
      const matrix = new DOMMatrixReadOnly(transform);
      if (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1 || !Number.isFinite(matrix.e) || !Number.isFinite(matrix.f)) return;
      return { x: matrix.e, y: matrix.f };
    } catch { return; }
  }

  private individualTranslation(value: string): { x: number; y: number } | undefined {
    if (!value || value === 'none') return { x: 0, y: 0 };
    const pieces = value.trim().split(/\s+/);
    if (pieces.length > 3 || pieces.some(piece => !/^-?(?:\d*\.)?\d+(?:px)?$/.test(piece))) return;
    const [x, y = 0, z = 0] = pieces.map(Number.parseFloat);
    return z === 0 && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
  }

  private discoverMotion(measurement: Measurement): Motion[] {
    const motions: Motion[] = [];
    try {
      const animations = document.getAnimations();
      for (const animation of animations) {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect)) { this.complete = false; break; }
        const target = effect.target;
        if (!(target instanceof Element)) { this.complete = false; break; }
        // Animations outside protected content cannot invalidate its mask.
        // For example, a rotating decorative div must not disable the whole page.
        if (!this.byAncestor.has(target)) continue;
        if (motions.length >= MAX_ANIMATIONS) { this.complete = false; break; }
        let nonRendered = false;
        let depth = 0;
        for (let ancestor: Element | null = target; ancestor; ancestor = this.parent(ancestor)) {
          if (++depth > MAX_ANCESTORS) { this.complete = false; break; }
          // Display-none descendants cannot paint or participate in surrounding layout.
          // Opacity, visibility, inert and aria-hidden do not establish that guarantee.
          if (ancestor.id === OVERLAY_ID || this.style(ancestor, measurement).display === 'none') { nonRendered = true; break; }
        }
        if (!this.complete) break;
        if (nonRendered) continue;
        const extendedEffect = effect as KeyframeEffect & { pseudoElement?: string | null; iterationComposite?: string };
        if (extendedEffect.pseudoElement || effect.composite !== 'replace' || extendedEffect.iterationComposite === 'accumulate') { this.complete = false; break; }
        const frames = effect.getKeyframes();
        if (frames.length > MAX_KEYFRAMES || !BOUNDED_EASING.test(effect.getTiming().easing ?? 'linear')) { this.complete = false; break; }
        const motion: Motion = { target, left: 0, right: 0, top: 0, bottom: 0 };
        const style = this.style(target, measurement);
        const currentTransform = this.translation(style.transform);
        const currentTranslate = this.individualTranslation(style.translate);
        const transformBounds: Bounds = { left: 0, right: 0, top: 0, bottom: 0 };
        const translateBounds: Bounds = { left: 0, right: 0, top: 0, bottom: 0 };
        const translatedProperties = ['transform', 'translate'].filter(property => frames.some(frame => property in frame));
        if (translatedProperties.length && (frames[0]?.computedOffset !== 0 || frames[frames.length - 1]?.computedOffset !== 1 || translatedProperties.some(property => frames.some(frame => !(property in frame))))) { this.complete = false; break; }
        for (const frame of frames) {
          if (frame.composite && frame.composite !== 'replace' && frame.composite !== 'auto' || !BOUNDED_EASING.test(frame.easing ?? 'linear')) { this.complete = false; break; }
          for (const property of Object.keys(frame)) {
            if (FRAME_METADATA[property] || PAINT_PROPERTIES[property]) continue;
            if (property !== 'transform' && property !== 'translate') { this.complete = false; break; }
            const current = property === 'transform' ? currentTransform : currentTranslate;
            const position = property === 'transform' ? this.translation(String(frame[property])) : this.individualTranslation(String(frame[property]));
            if (!current || !position) { this.complete = false; break; }
            const bounds = property === 'transform' ? transformBounds : translateBounds;
            bounds.left = Math.min(bounds.left, position.x - current.x);
            bounds.right = Math.max(bounds.right, position.x - current.x);
            bounds.top = Math.min(bounds.top, position.y - current.y);
            bounds.bottom = Math.max(bounds.bottom, position.y - current.y);
          }
          if (!this.complete) break;
        }
        if (!this.complete) break;
        motion.left = transformBounds.left + translateBounds.left;
        motion.right = transformBounds.right + translateBounds.right;
        motion.top = transformBounds.top + translateBounds.top;
        motion.bottom = transformBounds.bottom + translateBounds.bottom;
        motions.push(motion);
      }
    } catch { this.complete = false; }
    return motions;
  }
}
