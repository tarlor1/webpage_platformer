import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageGeometry } from '../src/page/geometry';
import { beginMeasurements } from '../src/page/frame-measurement';
import { surfaceMetadata } from '../src/page/surface-metadata';
import type { Platform } from '../src/engine/types';

interface Bounds { x: number; y: number; width: number; height: number }

// A layout fixture supplies native reads and a deterministic clock. Assertions
// use only PageGeometry's consumer API, not its queue/index implementation.
function pageFixture(run: (page: Fixture) => void): void {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const viewport = { scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 800 };
  const counters = { bounds: 0, styles: 0, walkers: 0, paint: 0 };
  let clock = 0;
  const style = {
    display: 'block', visibility: 'visible', contentVisibility: 'visible', opacity: '1', position: 'static',
    overflowX: 'visible', overflowY: 'visible', contain: '', clipPath: 'none', transform: 'none', perspective: 'none',
    filter: 'none', backdropFilter: 'none', willChange: '', backgroundImage: 'none', fontSize: '16px', color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none', outlineWidth: '0px', outlineStyle: 'none', outlineColor: 'rgb(0, 0, 0)',
    borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
    borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
    borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)', borderBottomColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)',
    fill: 'none', stroke: 'none', strokeWidth: '0px',
  };
  class FixtureNode {
    static readonly TEXT_NODE = 3;
    children: FixtureNode[] = [];
    parent: FixtureNode | null = null;
    assignedSlot = null;
    constructor(readonly nodeType: number) {}
    get parentElement(): FixtureElement | null { return this.parent instanceof FixtureElement ? this.parent : null; }
    getRootNode(): FixtureNode { return this.parent ? this.parent.getRootNode() : this; }
    get isConnected(): boolean {
      const root = this.getRootNode();
      return root instanceof FixtureDocument || root instanceof FixtureShadow && root.host.isConnected;
    }
    append(node: FixtureNode): void { node.parent = this; this.children.push(node); }
    remove(node: FixtureNode): void { this.children.splice(this.children.indexOf(node), 1); node.parent = null; }
  }
  class FixtureElement extends FixtureNode {
    attributes = new Map<string, string>();
    style = { ...style };
    namespaceURI = 'http://www.w3.org/1999/xhtml';
    shadowRoot: FixtureShadow | null = null;
    rect: Bounds = { x: 20, y: 100, width: 180, height: 30 };
    constructor(readonly tagName: string, id = '') { super(1); this.id = id; }
    get id(): string { return this.getAttribute('id') ?? ''; }
    set id(value: string) { this.attributes.set('id', value); }
    get localName(): string { return this.tagName.toLowerCase(); }
    get ownerDocument(): FixtureDocument { return documentFixture; }
    get textContent(): string {
      return this.children.map(node => node instanceof FixtureText ? node.data : node instanceof FixtureElement ? node.textContent : '').join('');
    }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    hasAttribute(name: string): boolean { return this.attributes.has(name); }
    closest(selectors: string): FixtureElement | null {
      for (let current: FixtureElement | null = this; current; current = current.parentElement) {
        if (selectors.split(',').some(selector => selector.trim().toUpperCase() === current!.tagName
          || /^\[role="([^"]+)"\]$/.exec(selector.trim())?.[1] === current!.getAttribute('role')
          || /^\[contenteditable="([^"]*)"\]$/.exec(selector.trim())?.[1] === current!.getAttribute('contenteditable'))) return current;
      }
      return null;
    }
    querySelector(): null { return null; }
    getBoundingClientRect(): DOMRect {
      counters.bounds++;
      return bounds(this.rect, this.style.position === 'fixed');
    }
  }
  class FixtureText extends FixtureNode {
    rects: Bounds[] = [];
    constructor(public data: string) { super(3); }
    get length(): number { return this.data.length; }
  }
  class FixtureShadow extends FixtureNode {
    constructor(readonly host: FixtureElement) { super(11); }
    getAnimations(): Animation[] { return []; }
  }
  class FixtureDocument extends FixtureNode {
    documentElement = new FixtureElement('HTML');
    body = new FixtureElement('BODY');
    scrollingElement = this.documentElement;
    location = { hostname: 'example.test' };
    baseURI = 'https://example.test/';
    constructor() { super(9); this.append(this.documentElement); this.documentElement.append(this.body); }
    getAnimations(): Animation[] { return []; }
    createTreeWalker(root: FixtureNode, _show: number, filter: { acceptNode(node: FixtureNode): number }): TreeWalker {
      counters.walkers++;
      const stack = [{ parent: root, index: 0 }];
      return { nextNode: () => {
        while (stack.length) {
          const frame = stack[stack.length - 1];
          const node = frame.parent.children[frame.index++];
          if (!node) { stack.pop(); continue; }
          if (filter.acceptNode(node) === 2) continue;
          if (node.children.length) stack.push({ parent: node, index: 0 });
          return node;
        }
        return null;
      } } as unknown as TreeWalker;
    }
    createRange(): Range {
      let text: FixtureText;
      return {
        setStart(node: FixtureText) { text = node; }, setEnd() {}, detach() {},
        getClientRects() { counters.bounds++; return text.rects.map(rect => bounds(rect)); },
      } as unknown as Range;
    }
  }
  function bounds(rect: Bounds, fixed = false): DOMRect {
    const x = rect.x - (fixed ? 0 : viewport.scrollX), y = rect.y - (fixed ? 0 : viewport.scrollY);
    return { x, y, left: x, right: x + rect.width, top: y, bottom: y + rect.height,
      width: rect.width, height: rect.height, toJSON: () => ({}) };
  }
  const documentFixture = new FixtureDocument();
  const globals: Record<string, unknown> = {
    Node: FixtureNode, Element: FixtureElement, Text: FixtureText, ShadowRoot: FixtureShadow,
    HTMLImageElement: class {}, HTMLVideoElement: class {}, HTMLIFrameElement: class {},
    SVGGraphicsElement: FixtureElement,
    DOMRect: class {
      constructor(x: number, y: number, width: number, height: number) {
        return { x, y, left: x, right: x + width, top: y, bottom: y + height, width, height, toJSON: () => ({}) };
      }
    },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: documentFixture, window: viewport, innerWidth: viewport.innerWidth, innerHeight: viewport.innerHeight,
    scrollX: 0, scrollY: 0,
    getComputedStyle: (element: FixtureElement) => { counters.styles++; return element.style; },
    performance: { now: () => { clock += 0.005; return clock; } },
  };
  for (const [name, value] of Object.entries(globals)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const geometry = new PageGeometry();
  const live = geometry.rebuild();
  const fixture: Fixture = {
    geometry, live, counters,
    add(tag, id, rect, parent) {
      const element = new FixtureElement(tag, id);
      if (rect) element.rect = rect;
      // The fixture exposes DOM types at the production API boundary.
      const owner = parent as unknown as FixtureNode | undefined;
      (owner ?? documentFixture.body).append(element);
      return element as unknown as Element;
    },
    text(parent, rects) {
      const text = new FixtureText('A native wrapped passage');
      text.rects = rects;
      const owner = parent as unknown as FixtureElement;
      owner.append(text);
      return text as unknown as Text;
    },
    shadow(host) {
      const element = host as unknown as FixtureElement;
      const shadow = new FixtureShadow(element);
      element.shadowRoot = shadow;
      return shadow as unknown as ShadowRoot;
    },
    remove(node) { const target = node as unknown as FixtureNode; target.parent!.remove(target); },
    move(element, y) {
      const target = element as unknown as FixtureElement;
      target.rect.y = y;
    },
    fixed(element) {
      const target = element as unknown as FixtureElement;
      target.style.position = 'fixed';
    },
    color(element, value) {
      const target = element as unknown as FixtureElement;
      target.style.color = value;
    },
    style(element, values) {
      Object.assign((element as unknown as FixtureElement).style, values);
    },
    svg(element) {
      const target = element as unknown as FixtureElement;
      target.namespaceURI = 'http://www.w3.org/2000/svg';
      Object.assign(target, {
        getBBox: () => ({ x: 0, y: 0, width: target.rect.width, height: target.rect.height }),
        getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: target.rect.x - viewport.scrollX, f: target.rect.y - viewport.scrollY }),
      });
    },
    paint(...elements) {
      Object.assign(documentFixture, { elementsFromPoint: (x: number, y: number) => {
        counters.paint++;
        return elements.filter(element => {
          const target = element as unknown as FixtureElement;
          const rect = bounds(target.rect, target.style.position === 'fixed');
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });
      } });
    },
    scroll(y) {
      viewport.scrollY = y;
      Object.defineProperty(globalThis, 'scrollY', { configurable: true, writable: true, value: y });
    },
    step() { beginMeasurements(); geometry.sampleMotion(); },
    drain(predicate = () => !geometry.inspecting) {
      for (let frame = 0; frame < 20000; frame++) {
        beginMeasurements(); geometry.sampleMotion();
        if (predicate()) return;
      }
      assert.fail('incremental geometry did not finish the requested consumer-visible work');
    },
  };
  try { run(fixture); }
  finally {
    geometry.clear(); beginMeasurements();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

interface Fixture {
  geometry: PageGeometry;
  live: Platform[];
  counters: { bounds: number; styles: number; walkers: number; paint: number };
  add(tag: string, id?: string, rect?: Bounds, parent?: Element | ShadowRoot): Element;
  text(parent: Element, rects: Bounds[]): Text;
  shadow(host: Element): ShadowRoot;
  remove(node: Node): void;
  move(element: Element, y: number): void;
  fixed(element: Element): void;
  color(element: Element, value: string): void;
  style(element: Element, values: Partial<CSSStyleDeclaration>): void;
  svg(element: Element): void;
  paint(...elements: Element[]): void;
  scroll(y: number): void;
  step(): void;
  drain(predicate?: () => boolean): void;
}

test('incremental discovery retains painted CSS surfaces without adding layout-only wrappers', () => pageFixture(page => {
  const transparent = page.add('DIV', 'layout-wrapper');
  const painted = page.add('DIV', 'painted-surface', { x: 50, y: 200, width: 180, height: 30 });
  page.style(painted, { backgroundColor: 'rgb(40, 80, 100)' });
  const bordered = page.add('DIV', 'bordered-surface', { x: 50, y: 300, width: 180, height: 30 });
  page.style(bordered, { borderTopWidth: '2px', borderTopStyle: 'solid' });
  page.drain();
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === painted));
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === bordered));
  assert.ok(!page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === transparent));
}));

test('incremental discovery reaches SVG primitives inside groups and retains stroke bounds on scroll', () => pageFixture(page => {
  const svg = page.add('svg', 'svg-root');
  const group = page.add('g', 'svg-group', undefined, svg);
  const shape = page.add('rect', 'svg-platform', { x: 80, y: 500, width: 120, height: 20 }, group);
  for (const element of [svg, group, shape]) page.svg(element);
  page.style(shape, { fill: '#abc', stroke: '#fff', strokeWidth: '4px' });
  page.drain();
  const platform = page.live.find(platform => surfaceMetadata(platform)?.element === shape);
  assert.ok(platform);
  assert.equal(platform.x, 78);
  assert.equal(platform.y, 498);
  assert.equal(platform.width, 124);
  page.scroll(150);
  page.geometry.markScrolled(null);
  page.geometry.markChanged(shape);
  page.drain();
  assert.equal(platform.y, 498, 'SVG bounds remain in document coordinates');
  assert.ok(page.live.includes(platform));
}));

test('canvas elements are measured as media without reading their pixel buffers', () => pageFixture(page => {
  const canvas = page.add('CANVAS', 'native-chart');
  Object.assign(canvas, { getContext: () => { assert.fail('canvas pixel sampling must stay disabled'); } });
  page.drain();
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === canvas));
}));

test('discovery reaches late native surfaces beyond former node and rectangle limits', () => pageFixture(page => {
  for (let index = 0; index < 6500; index++) page.add('SPAN');
  for (let index = 0; index < 1705; index++) page.add('BUTTON', `button-${index}`, { x: 20, y: index * 40, width: 180, height: 30 });
  assert.equal(page.counters.styles, 0, 'rebuild only enqueues discovery');
  page.drain(() => page.geometry.registryPlatforms.length === 1705 && !page.geometry.inspecting);
  const last = page.geometry.registryPlatforms.find(platform => surfaceMetadata(platform)?.element.id === 'button-1704');
  assert.ok(last, 'late native content is eventually registered');
  assert.equal(last.y, 1704 * 40);
  assert.ok(page.live.length, 'the original level array receives discovered viewport surfaces');
}));

test('broad refresh keeps connected cache identity and pins moving offscreen support', () => pageFixture(page => {
  const support = page.add('BUTTON', 'support');
  page.drain();
  const platform = page.live[0];
  assert.ok(platform);
  page.geometry.retainPlatform(platform.id);
  for (let index = 0; index < 7000; index++) page.add('SPAN');
  assert.equal(page.geometry.rebuild(), page.live);
  assert.ok(page.geometry.registryPlatforms.includes(platform), 'enqueueing a refresh never clears old terrain');
  page.move(support, 8000);
  page.geometry.markChanged(support, true, false);
  page.step();
  assert.equal(platform.y, 8000, 'critical support is measured before discovery');
  assert.ok(page.live.includes(platform), 'the rider keeps an offscreen selected support');
  page.drain();
  assert.ok(page.geometry.registryPlatforms.includes(platform), 'budget continuations preserve the same physical handle');
}));

test('scroll reselection uses cached sources and commits only sampled motion endpoints', () => pageFixture(page => {
  const support = page.add('BUTTON', 'fixed-support');
  page.fixed(support);
  for (let index = 0; index < 1700; index++) page.add('BUTTON', `static-${index}`, { x: 20, y: 2000 + index * 40, width: 180, height: 30 });
  page.drain();
  const platform = page.geometry.registryPlatforms.find(candidate => surfaceMetadata(candidate)?.element === support)!;
  page.geometry.retainPlatform(platform.id);
  page.geometry.commitMotion();
  const walkers = page.counters.walkers;
  const bounds = page.counters.bounds;
  page.scroll(5000);
  page.geometry.markScrolled(null);
  page.step();
  assert.equal(page.counters.walkers, walkers, 'scroll does not start a document traversal');
  assert.ok(page.counters.bounds - bounds < 20, 'offscreen static registry entries do not require native reads');
  assert.equal(platform.y, 5100);
  assert.equal(platform.previousY, 100);
  page.geometry.commitMotion();
  assert.equal(platform.previousY, 5100);
  assert.equal(platform.reflow, false);
  assert.equal(platform.discontinuous, false);
  assert.ok(page.live.includes(platform));
}));

test('open shadow sources are discovered and removed through their composed ownership root', () => pageFixture(page => {
  const host = page.add('DIV', 'host');
  const root = page.shadow(host);
  const button = page.add('BUTTON', 'shadow-button', undefined, root);
  page.drain();
  const platform = page.geometry.registryPlatforms.find(candidate => surfaceMetadata(candidate)?.element === button);
  assert.ok(platform);
  assert.ok(page.geometry.shadowRoots.has(root));
  page.remove(button);
  page.geometry.markChanged(root, false, false);
  page.drain();
  assert.ok(!page.geometry.registryPlatforms.includes(platform), 'deletion-only roots retire disconnected shadow terrain without a scan');
}));

test('long wrapped text continues past rectangle budgets while its retained line stays current', () => pageFixture(page => {
  const paragraph = page.add('P', 'passage');
  const rects = Array.from({ length: 1705 }, (_, index) => ({ x: 20, y: index * 20, width: 180, height: 16 }));
  const text = page.text(paragraph, rects);
  page.drain(() => page.geometry.registryPlatforms.length === rects.length && !page.geometry.inspecting);
  const platform = page.geometry.registryPlatforms.find(candidate => candidate.y === 1700 * 20)!;
  page.geometry.retainPlatform(platform.id);
  rects[1700].y += 500;
  page.geometry.markChanged(text, true, false);
  page.step();
  assert.equal(platform.y, 1700 * 20 + 500);
  assert.ok(page.live.includes(platform));
}));

test('dirty-only parents preserve local discovery and structural reflow wins over motion', () => pageFixture(page => {
  const container = page.add('DIV', 'container');
  const support = page.add('BUTTON', 'support', undefined, container);
  for (let index = 0; index < 3000; index++) page.add('SPAN', undefined, undefined, container);
  page.drain();
  const platform = page.live[0];
  assert.ok(platform);
  page.geometry.retainPlatform(platform.id);
  page.geometry.commitMotion();
  const styles = page.counters.styles;
  const added = page.add('BUTTON', 'added', { x: 20, y: 300, width: 180, height: 30 }, container);
  page.move(support, 200);
  page.geometry.markChanged(container, false, false);
  page.geometry.markChanged(added, false, true);
  page.geometry.markChanged(support, true, false);
  page.step();
  assert.equal(platform.y, 200);
  assert.equal(platform.reflow, true, 'structural invalidation cannot be downgraded to continuous motion');
  page.drain();
  assert.ok(page.geometry.registryPlatforms.some(candidate => surfaceMetadata(candidate)?.element === added));
  assert.ok(page.counters.styles - styles < 100, 'local insertion never re-inspects thousands of unaffected parent descendants');
  page.geometry.commitMotion();
  page.move(support, 240);
  page.geometry.markChanged(support, true, false);
  page.step();
  assert.equal(platform.reflow, false, 'motion-only writes retain a continuous physical path');
}));

test('motion cache misses discover unknown native roots and retry locally revealed text', () => pageFixture(page => {
  const paragraph = page.add('P', 'revealed-text');
  page.color(paragraph, 'transparent');
  page.text(paragraph, [{ x: 20, y: 100, width: 180, height: 16 }]);
  for (let index = 0; index < 3000; index++) page.add('SPAN');
  page.drain();
  assert.equal(page.geometry.registryPlatforms.length, 0);
  const walkers = page.counters.walkers;
  page.color(paragraph, 'rgb(0, 0, 0)');
  page.geometry.markChanged(paragraph, true, false);
  page.drain();
  assert.ok(page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === paragraph));
  assert.equal(page.counters.walkers, walkers, 'a known root retries only its indexed style-ineligible text');
  const button = page.add('BUTTON', 'new-motion-root', { x: 20, y: 200, width: 180, height: 30 });
  page.geometry.markChanged(button, true, false);
  page.drain();
  assert.ok(page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === button),
    'an unseen motion root still receives local discovery');
}));

test('paint-root sampling catches fast scroll before the background walk reaches visible media', () => pageFixture(page => {
  for (let index = 0; index < 12000; index++) page.add('SPAN', `backlog-${index}`);
  const player = page.add('VIDEO', 'incoming-player', { x: 100, y: 5600, width: 800, height: 450 });
  page.paint(player);
  page.scroll(5000);
  page.geometry.markScrolled(null);
  const reads = page.counters.bounds;
  for (let frame = 0; frame < 8; frame++) page.step();
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === player),
    'rendered media becomes playable while the preceding document nodes are still queued');
  assert.ok(page.geometry.inspecting, 'catch-up does not finish the global walk synchronously');
  assert.ok(page.counters.bounds - reads < 500, 'each frame keeps bounded native measurement work');
  assert.equal(page.counters.paint, 8, 'only one native paint point is sampled per frame');
}));

test('rendered local roots prepare not-yet-walked content ahead of the CSS viewport', () => pageFixture(page => {
  for (let index = 0; index < 12000; index++) page.add('SPAN');
  const section = page.add('SECTION', 'incoming-section', { x: 50, y: 600, width: 900, height: 1600 });
  const current = page.add('IMG', 'current-card', { x: 100, y: 600, width: 800, height: 150 }, section);
  const incoming = page.add('IMG', 'next-card', { x: 100, y: 1900, width: 800, height: 150 }, section);
  page.paint(current);
  for (let frame = 0; frame < 8; frame++) page.step();
  const prepared = page.geometry.registryPlatforms.find(platform => surfaceMetadata(platform)?.element === incoming);
  assert.ok(prepared, 'local rendered-container discovery prepares an upcoming native surface');
  assert.equal(prepared.y, 1900);
  assert.ok(!page.live.includes(prepared), 'preparation does not enlarge the selected physics viewport');
  assert.ok(page.geometry.inspecting);
}));

test('directional lookahead refreshes incoming cached sources ahead of a broad dirty queue', () => pageFixture(page => {
  for (let index = 0; index < 3000; index++) page.add('BUTTON', `background-${index}`, { x: 10, y: 30000 + index * 40, width: 90, height: 20 });
  const below = page.add('IMG', 'downward-ahead', { x: 50, y: 11700, width: 400, height: 100 });
  const above = page.add('IMG', 'upward-ahead', { x: 50, y: 9300, width: 400, height: 100 });
  page.drain();
  const downPlatform = page.geometry.registryPlatforms.find(platform => surfaceMetadata(platform)?.element === below)!;
  const upPlatform = page.geometry.registryPlatforms.find(platform => surfaceMetadata(platform)?.element === above)!;
  page.move(below, 11720);
  page.geometry.markChanged(below.ownerDocument.documentElement);
  page.scroll(10000);
  page.geometry.markScrolled(null);
  for (let frame = 0; frame < 4; frame++) page.step();
  assert.equal(downPlatform.y, 11720, 'two screens below the viewport are prepared during downward travel');
  assert.ok(!page.live.includes(downPlatform));
  page.scroll(11000);
  page.geometry.markScrolled(null);
  page.step();
  page.move(above, 9320);
  page.geometry.markChanged(above.ownerDocument.documentElement);
  page.scroll(10800);
  page.geometry.markScrolled(null);
  for (let frame = 0; frame < 4; frame++) page.step();
  assert.equal(upPlatform.y, 9320, 'upward travel reverses the longer preparation band');
}));

test('visible lazy media is retried from paint roots without waiting behind hidden UI', () => pageFixture(page => {
  for (let index = 0; index < 3000; index++) {
    const hidden = page.add('BUTTON', `hidden-ui-${index}`);
    page.style(hidden, { visibility: 'hidden' });
  }
  const image = page.add('IMG', 'lazy-visible', { x: 100, y: 600, width: 800, height: 160 });
  page.style(image, { visibility: 'hidden' });
  page.drain();
  assert.equal(page.geometry.registryPlatforms.length, 0);
  page.geometry.rebuild();
  page.style(image, { visibility: 'visible' });
  page.paint(image);
  for (let frame = 0; frame < 8; frame++) page.step();
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === image));
  assert.ok(page.geometry.inspecting);
}));

test('readable custom clickable text supplies native Range lines while literal controls do not duplicate text', () => pageFixture(page => {
  const wrapper = page.add('DIV', 'clickable-description');
  wrapper.setAttribute('role', 'button');
  page.text(wrapper, [{ x: 20, y: 150, width: 340, height: 16 }]);
  const native = page.add('BUTTON', 'literal-button', { x: 20, y: 250, width: 180, height: 30 });
  page.text(native, [{ x: 20, y: 250, width: 180, height: 16 }]);
  const editable = page.add('DIV', 'editable-description');
  editable.setAttribute('contenteditable', 'true');
  page.text(editable, [{ x: 20, y: 350, width: 180, height: 16 }]);
  page.drain();
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === wrapper && surfaceMetadata(platform)?.text && platform.y === 150));
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === native && !surfaceMetadata(platform)?.text));
  assert.ok(!page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === native && surfaceMetadata(platform)?.text));
  assert.ok(!page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === editable && surfaceMetadata(platform)?.text));
}));

test('computed visibility overrides and CSS-overridden hidden attributes retain genuinely painted descendants', () => pageFixture(page => {
  const ancestor = page.add('SECTION', 'hidden-visibility');
  page.style(ancestor, { visibility: 'hidden' });
  const visible = page.add('IMG', 'visible-descendant', undefined, ancestor);
  page.style(visible, { visibility: 'visible' });
  const overridden = page.add('IMG', 'hidden-overridden', { x: 20, y: 200, width: 180, height: 30 });
  overridden.setAttribute('hidden', '');
  page.style(overridden, { display: 'block' });
  const unpainted = page.add('SECTION', 'display-none');
  page.style(unpainted, { display: 'none' });
  const blocked = page.add('IMG', 'unpainted-descendant', undefined, unpainted);
  const transparent = page.add('SECTION', 'transparent-ancestor');
  page.style(transparent, { opacity: '0' });
  const invisible = page.add('IMG', 'transparent-descendant', undefined, transparent);
  page.drain();
  assert.ok(page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === visible));
  assert.ok(page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === overridden));
  assert.ok(!page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === blocked));
  assert.ok(!page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === invisible));
}));

test('dense cached scroll selection publishes immediately and preserves offscreen rider handles', () => pageFixture(page => {
  const support = page.add('BUTTON', 'rider-support');
  for (let index = 0; index < 1600; index++) page.add('BUTTON', `dense-${index}`,
    { x: 20 + index % 10 * 40, y: 5100 + Math.floor(index / 10) * 2, width: 35, height: 20 });
  page.drain();
  const rider = page.geometry.registryPlatforms.find(platform => surfaceMetadata(platform)?.element === support)!;
  page.geometry.retainPlatform(rider.id);
  const walkers = page.counters.walkers;
  const reads = page.counters.bounds;
  page.scroll(5000);
  page.geometry.markScrolled(null);
  page.step();
  assert.ok(page.live.some(platform => platform !== rider && platform.y >= 5100),
    'a partial cached candidate chunk is playable before the dense query finishes');
  assert.ok(page.live.includes(rider), 'offscreen support survives immediate viewport reselection');
  assert.ok(page.geometry.inspecting, 'selection continues in bounded chunks');
  assert.equal(page.counters.walkers, walkers);
  assert.ok(page.counters.bounds - reads < 20, 'cached reselection does not measure the page');
}));

test('newly measured description lines publish ahead of an unfinished dense cached selection', () => pageFixture(page => {
  for (let index = 0; index < 2000; index++) page.add('BUTTON', `cached-${index}`,
    { x: 20 + index % 10 * 40, y: 100 + Math.floor(index / 10) * 0.5, width: 35, height: 20 });
  page.drain();
  page.geometry.setInterest({ x: 500, y: 400 });
  page.step();
  const description = page.add('P', 'expanded-description', { x: 100, y: 380, width: 800, height: 100 });
  page.text(description, [{ x: 300, y: 400, width: 400, height: 16 }]);
  page.geometry.markChanged(description);
  for (let frame = 0; frame < 4; frame++) page.step();
  assert.ok(page.live.some(platform => surfaceMetadata(platform)?.element === description && surfaceMetadata(platform)?.text),
    'a new readable line reaches physics without waiting for every older cached candidate');
  assert.ok(page.geometry.inspecting);
}));

test('paint-root catch-up promotes visible open-shadow surfaces with native document coordinates', () => pageFixture(page => {
  for (let index = 0; index < 12000; index++) page.add('SPAN');
  const host = page.add('DIV', 'painted-host', { x: 100, y: 5600, width: 800, height: 160 });
  const root = page.shadow(host);
  const image = page.add('IMG', 'shadow-media', { x: 100, y: 5600, width: 800, height: 160 }, root);
  page.paint(host);
  page.scroll(5000);
  page.geometry.markScrolled(null);
  for (let frame = 0; frame < 8; frame++) page.step();
  const platform = page.live.find(candidate => surfaceMetadata(candidate)?.element === image);
  assert.ok(platform);
  assert.equal(platform.y, 5600);
  assert.equal(platform.x, 100);
  assert.ok(page.geometry.shadowRoots.has(root));
  assert.ok(page.geometry.inspecting);
}));

test('retaining a partially published text source preserves one registered handle through motion', () => pageFixture(page => {
  const paragraph = page.add('P', 'partial-rider');
  const rects = Array.from({ length: 8000 }, (_, index) => ({ x: 20, y: 100 + index * 20, width: 180, height: 16 }));
  const text = page.text(paragraph, rects);
  page.drain(() => page.live.some(platform => platform.y === 100));
  assert.ok(page.geometry.registryPlatforms.length < rects.length, 'support is published before the source read completes');
  const support = page.live.find(platform => platform.y === 100)!;
  page.geometry.retainPlatform(support.id);
  page.geometry.commitMotion();
  rects[0].y = 140;
  page.geometry.markChanged(text, true, false);
  page.step();
  assert.equal(support.y, 140);
  assert.equal(support.previousY, 100);
  assert.ok(page.live.includes(support));
  assert.deepEqual(page.geometry.registryPlatforms.filter(platform => platform.id === support.id), [support]);
  page.geometry.commitMotion();
  rects[0].y = 180;
  page.step();
  assert.equal(support.y, 180);
  assert.equal(support.previousY, 140);
  assert.deepEqual(page.geometry.registryPlatforms.filter(platform => platform.id === support.id), [support]);
}));

test('oversized transformed CSS backgrounds use their actual clipped frame without accepting page backdrops', () => pageFixture(page => {
  const frame = page.add('DIV', 'cropped-media-frame', { x: 80, y: 500, width: 500, height: 200 });
  page.style(frame, { overflowX: 'hidden', overflowY: 'hidden' });
  const background = page.add('DIV', 'transformed-background', { x: -200, y: 300, width: 2500, height: 1800 }, frame);
  page.style(background, { backgroundImage: 'url("cropped-promotion.jpg")', transform: 'scale(2)' });
  const decorative = page.add('DIV', 'uncropped-page-backdrop', { x: -200, y: 300, width: 2500, height: 1800 });
  page.style(decorative, { backgroundImage: 'url("page-backdrop.jpg")' });
  const wideFrame = page.add('DIV', 'still-oversized-frame', { x: 0, y: 0, width: 1600, height: 1200 });
  page.style(wideFrame, { overflowX: 'hidden', overflowY: 'hidden' });
  const stillOversized = page.add('DIV', 'oversized-clipped-backdrop', { x: -200, y: -200, width: 2500, height: 1800 }, wideFrame);
  page.style(stillOversized, { backgroundImage: 'url("large-backdrop.jpg")' });
  page.drain();
  const platform = page.live.find(candidate => surfaceMetadata(candidate)?.element === background);
  assert.ok(platform);
  assert.equal(platform.x, 80);
  assert.equal(platform.y, 500);
  assert.equal(platform.width, 500);
  assert.equal(surfaceMetadata(platform)?.text, false);
  assert.ok(!page.geometry.registryPlatforms.some(candidate => surfaceMetadata(candidate)?.element === decorative));
  assert.ok(!page.geometry.registryPlatforms.some(candidate => surfaceMetadata(candidate)?.element === stillOversized));
}));

test('a lazy responsive image gains its native surface when its initially empty layout loads', () => pageFixture(page => {
  const picture = page.add('PICTURE', 'responsive-picture', { x: 100, y: 500, width: 540, height: 260 });
  const rect = { x: 100, y: 500, width: 0, height: 0 };
  const image = page.add('IMG', 'responsive-promotion', rect, picture);
  image.setAttribute('alt', '');
  image.setAttribute('loading', 'lazy');
  image.setAttribute('srcset', 'promotion-small.jpg 540w, promotion-large.jpg 1080w');
  image.setAttribute('sizes', '(max-width: 600px) 100vw, 540px');
  page.drain();
  assert.ok(!page.geometry.registryPlatforms.some(platform => surfaceMetadata(platform)?.element === image));
  rect.width = 540;
  rect.height = 260;
  page.geometry.markChanged(image);
  page.drain();
  const platform = page.live.find(candidate => surfaceMetadata(candidate)?.element === image);
  assert.ok(platform);
  assert.equal(platform.x, 100);
  assert.equal(platform.y, 500);
  assert.equal(platform.width, 540);
  assert.equal(surfaceMetadata(platform)?.text, false);
}));
