import { OVERLAY_ID } from '../engine/types';
import type { Rect } from './scenery-types';
import { composedParent } from '../page/composed-dom';
import { readBounds, readLayout, readStyle } from '../page/frame-measurement';

const SLICE_MS = 2;
const MAX_RECTS = 12000;
const PADDING = 4;
const BOX_TAGS: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true, IMG: true, VIDEO: true, CANVAS: true, SVG: true, IFRAME: true, OBJECT: true, EMBED: true, METER: true, PROGRESS: true };
const CONTROL_TAGS: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true, METER: true, PROGRESS: true };
const SKIP_TAGS: Record<string, true> = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true };
const MOTION_STYLES: Record<string, true> = { transform: true, translate: true, rotate: true, scale: true, opacity: true, visibility: true, clip: true, 'clip-path': true, filter: true, 'backdrop-filter': true };
const LOCAL_ANIMATION_PROPERTIES: Record<string, true> = { offset: true, computedOffset: true, easing: true, composite: true, transform: true, translate: true, rotate: true, scale: true, opacity: true, visibility: true, clip: true, clipPath: true, filter: true, backdropFilter: true, color: true, backgroundColor: true, borderTopColor: true, borderRightColor: true, borderBottomColor: true, borderLeftColor: true, fill: true, stroke: true, fillOpacity: true, strokeOpacity: true, outlineColor: true, textDecorationColor: true, caretColor: true };

/** Decorative compositor canvases are neither readable media nor native terrain. */
export function isDecorativeCanvas(element: Element, style?: CSSStyleDeclaration, bounds?: Pick<DOMRect, 'width' | 'height'>): boolean {
  if (element.tagName.toUpperCase() !== 'CANVAS') return false;
  if (element.getAttribute('role') === 'img' || element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') || element.hasAttribute('tabindex')) return false;
  if (element.getAttribute('aria-hidden') === 'true' || /^(?:presentation|none)$/.test(element.getAttribute('role') ?? '')) return true;
  const box = bounds ?? readBounds(element);
  if (box.width < innerWidth * 0.8 || box.height < innerHeight * 0.8) return false;
  const computed = style ?? readStyle(element);
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
  rectangles: Rect[];
  topologyDirty: boolean;
  opaque: boolean;
  measuredEpoch: number;
  relatedEpoch: number;
}
interface Discovery {
  node: Node;
  element: Element | null;
  blocker?: Rect;
  started: boolean;
  nearby: boolean;
  child?: Node | null;
  shadowChild?: Node | null;
  dynamic: boolean;
  scrollVersion: number;
  opaque?: boolean;
}
interface Invalidation {
  root: Node;
  discover: boolean;
  scope?: Set<Source>;
  sources?: Iterator<Source>;
  remaining: number;
  started: boolean;
  epoch: number;
}
interface Motion {
  target: Element;
  topology: boolean;
  sources?: Iterator<Source>;
  remaining?: number;
}
interface AnimationState {
  effect: KeyframeEffect;
  target: Element;
  layout: boolean;
  epoch: number;
}
interface Measurement { count: number; x: number; y: number }

/** Cosmetic exclusion masks in document CSS pixels; never contributes terrain. */
export class TextClearance {
  rectangles: Rect[] = [];
  /** Pending local masks make an unfinished inspection safe to consume. */
  complete = false;
  needsRebuild = false;
  private sources = new Set<Source>();
  private byNode = new Map<Node, Source>();
  private byAncestor = new Map<Element, Set<Source>>();
  private byScroller = new Map<Element, Set<Source>>();
  private documentScrollSources = new Set<Source>();
  private pending = new Set<Source>();
  private retry = new Set<Source>();
  private invalidations = new Map<Node, Invalidation>();
  private discovery = new Map<Node, Discovery>();
  private inspected = new WeakSet<Element>();
  private nearby: Discovery[] = [];
  private distant: Discovery[] = [];
  private motions = new Map<Element, Motion>();
  private scrolls = new Set<EventTarget | null>();
  private scrollVersion = 0;
  private mutationEpoch = 0;
  private unmeasuredMotion = new Set<Element>();
  private blockedElements = new Set<Element>();
  private roots = new Set<ShadowRoot>();
  private animations = new Map<Animation, AnimationState>();
  private animationScan: Animation[] = [];
  private animationIndex = 0;
  private animationEpoch = 0;
  private animationTrees: (Document | ShadowRoot)[] = [];
  private animationTreeIndex = 0;
  private previousStyle = document.createElement('span').style;
  private sweep?: Iterator<Source>;

  get inspecting(): boolean {
    return !!(this.invalidations.size || this.discovery.size || this.pending.size || this.motions.size || this.scrolls.size || this.retry.size || this.sweep);
  }

  /** Queue a broad refresh without discarding connected, already measured masks. */
  rebuild(): void {
    const root = document.documentElement;
    if (root) this.markChanged(root);
  }

  /** Mutation callbacks only enqueue; all DOM measurement belongs to the frame. */
  markChanged(target: Node, discover = true): void {
    const epoch = ++this.mutationEpoch;
    const existing = this.invalidations.get(target);
    if (existing) {
      existing.discover ||= discover;
      existing.started = false;
      existing.epoch = epoch;
    } else this.invalidations.set(target, { root: target, discover, remaining: 0, started: false, epoch });
    this.needsRebuild = true;
  }

  markScrolled(target: EventTarget | null): void { this.scrolls.add(target); }

  /** Classification must work even while initial discovery is still in flight. */
  markStyleMotion(target: Element, previousInlineStyle: string | null): boolean {
    if (!(target instanceof HTMLElement || target instanceof SVGElement)) return false;
    const previous = this.previousStyle, current = target.style;
    previous.cssText = previousInlineStyle ?? '';
    let topology = false;
    for (let index = 0; index < previous.length + current.length; index++) {
      const name = index < previous.length ? previous.item(index) : current.item(index - previous.length);
      const before = previous.getPropertyValue(name), after = current.getPropertyValue(name);
      if (before === after && previous.getPropertyPriority(name) === current.getPropertyPriority(name)) continue;
      if (!MOTION_STYLES[name]) return false;
      if ((name === 'transform' || name === 'filter' || name === 'backdrop-filter' || name === 'clip-path')
        && (!before || before === 'none') !== (!after || after === 'none')) topology = true;
    }
    this.queueMotion(target, topology);
    return true;
  }

  sampleMotion(): void {
    const deadline = performance.now() + SLICE_MS;
    const measurement: Measurement = { count: 0, x: window.scrollX, y: window.scrollY };
    for (const source of this.retry) this.pending.add(source);
    this.retry.clear();
    // A scroll changes viewport priority even when document-coordinate masks do not move.
    if (this.scrolls.size) {
      this.scrollVersion++;
      this.prioritizeViewport();
    }
    for (const target of this.scrolls) {
      const sources = !target || target === document || target === window || target === document.scrollingElement
        ? this.documentScrollSources : target instanceof Element ? this.byScroller.get(target) : undefined;
      if (sources) for (const source of sources) this.pending.add(source);
    }
    this.scrolls.clear();
    this.sampleAnimations(Math.min(deadline, performance.now() + SLICE_MS / 4));
    // Alternate queue classes: a busy player or animation must not starve discovery.
    let worked: boolean;
    do {
      worked = this.invalidateOne(measurement);
      worked = this.motionOne(measurement) || worked;
      worked = this.measureOne(measurement) || worked;
      if (performance.now() < deadline) worked = this.discoverOne(measurement) || worked;
      if (performance.now() < deadline && this.sweep) {
        const entry = this.sweep.next();
        if (entry.done) this.sweep = undefined;
        else if (!entry.value.node.isConnected) this.remove(entry.value);
        worked = true;
      }
    } while (worked && performance.now() < deadline);
    this.publish(measurement);
    this.complete = true;
    this.needsRebuild = this.invalidations.size > 0 || this.discovery.size > 0;
  }

  clear(): void {
    for (const source of this.sources) source.range?.detach();
    this.sources.clear(); this.byNode.clear(); this.byAncestor.clear(); this.byScroller.clear();
    this.documentScrollSources.clear(); this.pending.clear(); this.retry.clear();
    this.invalidations.clear(); this.discovery.clear(); this.nearby.length = this.distant.length = 0;
    this.motions.clear(); this.scrolls.clear(); this.roots.clear(); this.animations.clear();
    this.unmeasuredMotion.clear(); this.blockedElements.clear(); this.scrollVersion = 0;
    this.mutationEpoch = 0;
    this.animationScan.length = this.animationTrees.length = 0;
    this.animationIndex = this.animationTreeIndex = this.animationEpoch = 0;
    this.sweep = undefined;
    this.inspected = new WeakSet();
    this.previousStyle.cssText = '';
    this.rectangles.length = 0;
    this.complete = false; this.needsRebuild = false;
  }

  private queueMotion(target: Element, topology = false): void {
    const existing = this.motions.get(target);
    if (existing) existing.topology ||= topology;
    else this.motions.set(target, { target, topology });
  }

  private motionOne(measurement: Measurement): boolean {
    const motion = this.motions.values().next().value as Motion | undefined;
    if (!motion) return false;
    if (this.discovery.size) this.unmeasuredMotion.add(motion.target);
    if (!motion.sources) {
      const sources = this.byAncestor.get(motion.target);
      if (!sources?.size && !this.inspected.has(motion.target)) {
        const style = readStyle(motion.target);
        if (style.display !== 'none' && style.contentVisibility !== 'hidden') this.enqueue(motion.target, measurement);
      }
      motion.sources = sources?.values();
      motion.remaining = sources?.size ?? 0;
    }
    const next = motion.sources?.next();
    if (!next || next.done || !motion.remaining) this.motions.delete(motion.target);
    else {
      motion.remaining = (motion.remaining ?? 0) - 1;
      next.value.topologyDirty ||= motion.topology;
      this.pending.add(next.value);
    }
    return true;
  }

  private invalidateOne(measurement: Measurement): boolean {
    const invalidation = this.invalidations.values().next().value as Invalidation | undefined;
    if (!invalidation) return false;
    const root = invalidation.root;
    if (!invalidation.started) {
      invalidation.started = true;
      // Coalesce descendant records, including the usual childList + added-node pair.
      for (let ancestor = composedParent(root); ancestor; ancestor = composedParent(ancestor)) {
        const ancestorChange = this.invalidations.get(ancestor);
        if (ancestorChange?.discover && !ancestorChange.started || this.discovery.get(ancestor)?.started === false) {
          this.invalidations.delete(root);
          return true;
        }
      }
      const element = root instanceof Element ? root : composedParent(root);
      if (!invalidation.discover && root instanceof Element && (this.byNode.get(root)?.opaque
        || (root.localName.includes('-') || root.hasAttribute('is')) && !root.shadowRoot && !root.firstChild)) invalidation.discover = true;
      if (root.isConnected && invalidation.discover) this.enqueue(root, measurement, false, true);
      // Sibling layout can move after a text/childList edit. Refresh cached handles
      // in the immediate layout scope, without rediscovering its unrelated DOM.
      const scope = element && composedParent(element);
      invalidation.scope = scope ? this.byAncestor.get(scope) : element ? this.byAncestor.get(element) : undefined;
      invalidation.sources = invalidation.scope?.values();
      invalidation.remaining = invalidation.scope?.size ?? 0;
      if (element === document.documentElement && invalidation.discover) {
        // The continuing broad walk already refreshes every handle. A second
        // all-source pass would duplicate work and recreate whole-page dirtiness.
        invalidation.scope = undefined;
        invalidation.sources = undefined;
        invalidation.remaining = 0;
        this.sweep ??= this.sources.values();
        this.prioritizeViewport();
      }
    }
    const next = invalidation.sources?.next();
    if (!next || next.done || !invalidation.remaining) this.invalidations.delete(root);
    else {
      invalidation.remaining--;
      const source = next.value;
      const insideRoot = root instanceof Element ? source.ancestors.includes(root) : source.node === root;
      if (invalidation.discover && root instanceof Element && insideRoot && source.relatedEpoch < invalidation.epoch) source.topologyDirty = true;
      // Discovery refreshes changed descendants once. Reflowed siblings only
      // need fresh bounds, and may already have been sampled by another queue.
      if ((!invalidation.discover || !insideRoot) && (source.measuredEpoch < invalidation.epoch || source.topologyDirty)) this.pending.add(source);
    }
    return true;
  }

  private enqueue(node: Node, measurement: Measurement, urgent = false, restart = false): void {
    const existing = this.discovery.get(node);
    if (existing) {
      if (existing.element) existing.blocker = this.blocker(existing.element, measurement);
      if (restart) {
        existing.started = false;
        existing.child = existing.shadowChild = undefined;
      }
      return;
    }
    if (node instanceof Text && !node.data.trim() && !this.byNode.has(node)) return;
    const element = node instanceof Element ? node : composedParent(node);
    if (!element || this.excluded(element)) return;
    const blocker = this.blocker(element, measurement);
    const parent = composedParent(node);
    const parentTask = parent ? this.discovery.get(parent) : undefined;
    const layout = readLayout(element);
    const dynamic = !!parentTask?.dynamic || layout.position === 'fixed' || layout.position === 'sticky' || layout.clipX || layout.clipY;
    const task: Discovery = { node, element, blocker, started: false, nearby: urgent || this.inViewport(blocker), dynamic, scrollVersion: this.scrollVersion };
    this.discovery.set(node, task);
    (task.nearby ? this.nearby : this.distant).push(task);
  }

  private discoverOne(measurement: Measurement): boolean {
    const task = this.nearby.pop() ?? this.distant.pop();
    if (!task) return false;
    if (this.discovery.get(task.node) !== task) return true;
    const node = task.node;
    if (!node.isConnected) { this.discovery.delete(node); return true; }
    if (!task.started) {
      task.started = true;
      if (node instanceof Element) {
        if (this.excluded(node)) { this.discovery.delete(node); return true; }
        const style = readStyle(node);
        // Unlike opacity/visibility, these subtrees have no painted descendants.
        if (style.display === 'none' || style.contentVisibility === 'hidden') {
          this.queueMotion(node, true);
          this.discovery.delete(node);
          return true;
        }
        this.inspected.add(node);
        const nativeBox = BOX_TAGS[node.tagName.toUpperCase()] || node instanceof HTMLElement && node.isContentEditable;
        task.opaque = !nativeBox && (node.localName.includes('-') || node.hasAttribute('is')) && !node.shadowRoot;
        if (nativeBox) this.addSource(node, measurement);
        else if (!task.opaque) {
          const old = this.byNode.get(node);
          if (old) this.remove(old);
        }
        if (node.shadowRoot) {
          this.roots.add(node.shadowRoot);
          task.shadowChild = node.shadowRoot.firstChild;
        }
        // SVG internals are protected by the native outer SVG box.
        if (node.namespaceURI !== 'http://www.w3.org/2000/svg') task.child = node.firstChild;
      } else if (node instanceof Text) {
        if (node.data.trim()) this.addSource(node, measurement);
        else { const old = this.byNode.get(node); if (old) this.remove(old); }
      }
    }
    // A mutation can remove the saved next sibling between slices. Restart only
    // that local sibling list, rather than losing its remaining coverage.
    if (task.child && task.child.parentNode !== node) task.child = node.firstChild;
    if (task.shadowChild && node instanceof Element && task.shadowChild.parentNode !== node.shadowRoot) task.shadowChild = node.shadowRoot?.firstChild;
    // Even a single container with thousands of children is split over slices.
    // Its conservative local box remains until every child has its own coverage.
    const child = task.shadowChild ?? task.child;
    if (child) {
      if (task.shadowChild) task.shadowChild = child.nextSibling;
      else task.child = child.nextSibling;
      if (task.opaque && (child instanceof Element && !this.excluded(child) || child instanceof Text && !!child.data.trim())) {
        task.opaque = false;
        const old = this.byNode.get(node);
        if (old) this.remove(old);
      }
      this.enqueue(child, measurement);
      if (!task.child && !task.shadowChild) this.finishDiscovery(task, measurement);
      // Split broad unknown roots before descending; narrow local regions can
      // yield immediately to their visible text and native media.
      else if (task.blocker && task.blocker.width >= innerWidth * 0.8) this.nearby.push(task);
      else this.distant.push(task);
    } else this.finishDiscovery(task, measurement);
    return true;
  }

  private finishDiscovery(task: Discovery, measurement: Measurement): void {
    if (task.opaque && task.node instanceof Element) this.addSource(task.node, measurement, true);
    this.discovery.delete(task.node);
  }

  private prioritizeViewport(measurement: Measurement = { count: 0, x: scrollX, y: scrollY }): void {
    if (typeof document.elementsFromPoint !== 'function') return;
    // Start inside visible branches even if a huge offscreen sibling precedes them.
    for (const y of [1, innerHeight / 2, Math.max(1, innerHeight - 1)]) {
      for (const x of [1, innerWidth / 2, Math.max(1, innerWidth - 1)]) {
        for (const element of document.elementsFromPoint(x, y)) {
          if (this.discovery.size && !this.byAncestor.has(element) && !this.discovery.has(element)) this.enqueue(element, measurement, true);
          for (let ancestor: Element | null = element; ancestor; ancestor = composedParent(ancestor)) {
            const task = this.discovery.get(ancestor);
            if (!task) continue;
            if (!task.nearby || task.started) { task.nearby = true; this.nearby.push(task); }
            break;
          }
        }
      }
    }
  }

  private inViewport(rect?: Rect): boolean {
    return !!rect && rect.x < scrollX + innerWidth && rect.x + rect.width > scrollX
      && rect.y < scrollY + innerHeight && rect.y + rect.height > scrollY;
  }

  private excluded(element: Element): boolean {
    return element.id === OVERLAY_ID || !!SKIP_TAGS[element.tagName.toUpperCase()] || !!element.closest(`#${OVERLAY_ID}`);
  }

  private addSource(node: Element | Text, measurement: Measurement, opaque = false): void {
    let source = this.byNode.get(node);
    if (!source) {
      const element = node instanceof Element ? node : composedParent(node);
      if (!element) return;
      source = { node, element, ancestors: [], clips: [], scrollers: [], rectangles: [], topologyDirty: true, opaque, measuredEpoch: 0, relatedEpoch: 0 };
      if (node instanceof Text) source.range = document.createRange();
      this.sources.add(source);
      this.byNode.set(node, source);
    } else source.topologyDirty = true;
    source.opaque = opaque;
    this.pending.delete(source);
    this.measure(source, measurement);
  }

  private unlink(source: Source): void {
    for (const ancestor of source.ancestors) {
      const entries = this.byAncestor.get(ancestor);
      entries?.delete(source);
      if (!entries?.size) this.byAncestor.delete(ancestor);
    }
    for (const scroller of source.scrollers) {
      const entries = this.byScroller.get(scroller);
      entries?.delete(source);
      if (!entries?.size) this.byScroller.delete(scroller);
    }
    this.documentScrollSources.delete(source);
  }

  private remove(source: Source): void {
    this.unlink(source);
    this.sources.delete(source); this.byNode.delete(source.node);
    this.pending.delete(source); this.retry.delete(source);
    source.range?.detach();
  }

  /** Topology changes only for structural/CSS invalidations, not ordinary motion. */
  private relate(source: Source): void {
    this.unlink(source);
    source.ancestors.length = source.clips.length = source.scrollers.length = 0;
    let containingBlock: 'absolute' | 'fixed' | undefined;
    for (let ancestor: Element | null = source.element; ancestor; ancestor = composedParent(ancestor)) {
      source.ancestors.push(ancestor);
      let descendants = this.byAncestor.get(ancestor);
      if (!descendants) { descendants = new Set(); this.byAncestor.set(ancestor, descendants); }
      descendants.add(source);
      const layout = readLayout(ancestor);
      if (containingBlock && (layout.containingBlock || containingBlock === 'absolute' && layout.position !== 'static')) containingBlock = undefined;
      if (layout.position === 'fixed' || layout.position === 'sticky') this.documentScrollSources.add(source);
      if (ancestor !== document.scrollingElement && (layout.clipX || layout.clipY || layout.paintClip)) {
        source.scrollers.push(ancestor);
        let entries = this.byScroller.get(ancestor);
        if (!entries) { entries = new Set(); this.byScroller.set(ancestor, entries); }
        entries.add(source);
        if (!containingBlock && (source.range || ancestor !== source.element || layout.paintClip)) source.clips.push({ element: ancestor, x: layout.clipX || layout.paintClip, y: layout.clipY || layout.paintClip });
      }
      if (!containingBlock && (layout.position === 'fixed' || layout.position === 'absolute')) containingBlock = layout.position;
    }
    source.topologyDirty = false;
    source.relatedEpoch = this.mutationEpoch;
  }

  private measureOne(measurement: Measurement): boolean {
    const source = this.pending.values().next().value as Source | undefined;
    if (!source) return false;
    this.pending.delete(source);
    this.measure(source, measurement);
    return true;
  }

  private measure(source: Source, measurement: Measurement): void {
    if (!source.node.isConnected) { this.remove(source); return; }
    const previous = source.rectangles;
    const previousEpoch = source.measuredEpoch;
    source.rectangles = [];
    try {
      source.measuredEpoch = this.mutationEpoch;
      if (source.node instanceof Text) {
        const element = composedParent(source.node);
        if (!element) { this.remove(source); return; }
        if (source.element !== element) { source.element = element; source.topologyDirty = true; }
      }
      if (source.topologyDirty) this.relate(source);
      for (const ancestor of source.ancestors) if (ancestor.id === OVERLAY_ID || readLayout(ancestor).hidden) return;
      const style = readStyle(source.element);
      const visibility = readLayout(source.element).visibility;
      if (visibility === 'hidden' || visibility === 'collapse' || !source.range && isDecorativeCanvas(source.element, style)) return;
      if (source.range) source.range.selectNodeContents(source.node);
      const padding = source.range ? this.textPadding(style) : PADDING;
      const fragments = source.range ? source.range.getClientRects() : source.element.getClientRects();
      const bounds = measurement.count + fragments.length > MAX_RECTS ? [readBounds(source.element)] : fragments;
      const kind: Rect['kind'] = source.opaque || source.element instanceof HTMLElement && source.element.isContentEditable || CONTROL_TAGS[source.element.tagName.toUpperCase()]
        ? 'control' : source.range ? 'text' : 'media';
      for (const bound of bounds) {
        measurement.count++;
        if (bound.width <= 0 || bound.height <= 0 || !Number.isFinite(bound.left + bound.top + bound.width + bound.height + padding)) continue;
        const rect = this.clip({ x: bound.left + measurement.x - padding, y: bound.top + measurement.y - padding, width: bound.width + padding * 2, height: bound.height + padding * 2, kind, element: source.element, padding }, source, measurement);
        if (rect) source.rectangles.push(rect);
      }
    } catch {
      source.rectangles = previous;
      source.measuredEpoch = previousEpoch;
      source.topologyDirty = true;
      this.retry.add(source);
    }
  }

  private clip(rect: Rect, source: Source, measurement: Measurement): Rect | undefined {
    let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
    for (const clip of source.clips) {
      const bounds = readBounds(clip.element);
      if (clip.x) { left = Math.max(left, bounds.left + measurement.x - PADDING); right = Math.min(right, bounds.right + measurement.x + PADDING); }
      if (clip.y) { top = Math.max(top, bounds.top + measurement.y - PADDING); bottom = Math.min(bottom, bounds.bottom + measurement.y + PADDING); }
      if (right <= left || bottom <= top) return;
    }
    rect.x = left; rect.y = top; rect.width = right - left; rect.height = bottom - top;
    return rect;
  }

  private sampleAnimations(deadline: number): void {
    // Existing motion scopes stay local, including the final sample on removal.
    for (const state of this.animations.values()) {
      this.queueMotion(state.target, false);
      if (state.layout) this.queueMotion(composedParent(state.target) ?? state.target);
    }
    if (!this.animationTrees.length) {
      this.animationTrees = [document, ...this.roots];
      this.animationTreeIndex = 0;
      this.animationEpoch++;
    }
    do {
      if (this.animationIndex >= this.animationScan.length) {
        if (this.animationTreeIndex >= this.animationTrees.length) {
          for (const [animation, state] of this.animations) if (state.epoch !== this.animationEpoch) {
            this.queueMotion(state.target, true);
            this.animations.delete(animation);
          }
          this.animationTrees.length = this.animationScan.length = 0;
          this.animationIndex = 0;
          break;
        }
        const tree = this.animationTrees[this.animationTreeIndex++];
        try { this.animationScan = typeof tree.getAnimations === 'function' ? tree.getAnimations() : []; }
        catch { this.animationScan = []; }
        this.animationIndex = 0;
      }
      const animation = this.animationScan[this.animationIndex++];
      if (!animation) continue;
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) continue;
      let state = this.animations.get(animation);
      if (!state || state.effect !== effect || state.target !== effect.target) {
        let layout = true;
        try { layout = effect.getKeyframes().some(frame => Object.keys(frame).some(property => !LOCAL_ANIMATION_PROPERTIES[property])); } catch { /* Conservative local layout scope. */ }
        state = { effect, target: effect.target, layout, epoch: this.animationEpoch };
        this.animations.set(animation, state);
        this.queueMotion(state.target, true);
      }
      state.epoch = this.animationEpoch;
      this.queueMotion(state.target);
      if (state.layout) this.queueMotion(composedParent(state.target) ?? state.target);
    } while (performance.now() < deadline);
  }

  private textPadding(style: CSSStyleDeclaration): number {
    const fontSize = Number.parseFloat(style.fontSize) || 0;
    let padding = Math.max(PADDING, fontSize / 2);
    for (const layer of (style.textShadow ?? '').replace(/(?:rgba?|hsla?|color)\([^)]*\)/g, '').split(',')) {
      const lengths = layer.match(/-?(?:\d*\.)?\d+px/g);
      if (!lengths || lengths.length < 2) continue;
      const [x, y, blur = 0] = lengths.map(Number.parseFloat);
      padding = Math.max(padding, Math.abs(x) + Math.abs(y) + Math.max(0, blur) * 2 + fontSize / 2 + PADDING);
    }
    return padding + (Number.parseFloat(style.getPropertyValue('-webkit-text-stroke-width')) || 0);
  }

  private blocker(element: Element, measurement: Measurement): Rect | undefined {
    if (!element.isConnected) return;
    let bounds = readBounds(element);
    // display:contents and zero-sized wrappers can still paint descendant text.
    for (let ancestor = composedParent(element); (bounds.width <= 0 || bounds.height <= 0) && ancestor; ancestor = composedParent(ancestor)) bounds = readBounds(ancestor);
    if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(bounds.left + bounds.top + bounds.width + bounds.height)) return;
    const padding = this.textPadding(readStyle(element));
    return { x: bounds.left + measurement.x - padding, y: bounds.top + measurement.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2, kind: 'pending', element, padding };
  }

  private publish(measurement: Measurement): void {
    this.rectangles.length = 0;
    for (const source of this.sources) for (const rect of source.rectangles) this.rectangles.push(rect);
    const blocked = this.blockedElements;
    blocked.clear();
    const protect = (element: Element | null): void => {
      if (!element || blocked.has(element)) return;
      blocked.add(element);
      const rect = this.blocker(element, measurement);
      if (rect) this.rectangles.push(rect);
    };
    // Fresh uncertainty wins over cached frontier boxes for the same element.
    // In particular, inline motion may have moved a still-uninspected root.
    for (const invalidation of this.invalidations.values()) {
      if (!invalidation.started && invalidation.discover) protect(invalidation.root instanceof Element ? invalidation.root : composedParent(invalidation.root));
      if (invalidation.scope) for (const source of invalidation.scope) {
        const topologyStale = invalidation.discover && invalidation.root instanceof Element
          && source.ancestors.includes(invalidation.root) && source.relatedEpoch < invalidation.epoch;
        if (source.measuredEpoch < invalidation.epoch || topologyStale) protect(source.element);
      }
    }
    for (const motion of this.motions.values()) protect(motion.target);
    for (const source of this.pending) protect(source.element);
    for (const source of this.retry) protect(source.element);
    if (!this.discovery.size) this.unmeasuredMotion.clear();
    for (const element of this.unmeasuredMotion) protect(element);
    for (const task of this.discovery.values()) {
      if (task.dynamic && task.scrollVersion !== this.scrollVersion && task.element) {
        task.blocker = this.blocker(task.element, measurement);
        task.scrollVersion = this.scrollVersion;
      }
      if (task.element && !blocked.has(task.element)) {
        blocked.add(task.element);
        if (task.blocker) this.rectangles.push(task.blocker);
      }
    }
  }
}
