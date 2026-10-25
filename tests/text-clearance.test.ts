import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextClearance } from '../src/rendering/text-clearance';
import { beginMeasurements } from '../src/page/frame-measurement';
import type { Rect } from '../src/rendering/scenery-types';

const box = (x: number, y: number, width = 100, height = 20): DOMRect => ({
  x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() { return {}; },
});

class InlineStyle {
  private properties = new Map<string, string>();
  get cssText(): string { return [...this.properties].map(([name, value]) => `${name}:${value}`).join(';'); }
  set cssText(value: string) {
    this.properties.clear();
    for (const entry of value.split(';')) {
      const colon = entry.indexOf(':');
      if (colon >= 0) this.properties.set(entry.slice(0, colon).trim(), entry.slice(colon + 1).trim());
    }
  }
  get length(): number { return this.properties.size; }
  item(index: number): string { return [...this.properties.keys()][index] ?? ''; }
  getPropertyValue(name: string): string { return this.properties.get(name) ?? ''; }
  getPropertyPriority(): string { return ''; }
}

class FakeNode {
  parent: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  previousSibling: FakeNode | null = null;
  nextSibling: FakeNode | null = null;
  assignedSlot: FakeElement | null = null;
  get parentNode(): FakeNode | null { return this.parent; }
  get parentElement(): FakeElement | null { return this.parent instanceof FakeElement ? this.parent : null; }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null; }
  get isConnected(): boolean { return this.parent?.isConnected ?? false; }
  getRootNode(): FakeNode { return this.parent?.getRootNode() ?? this; }
  append<T extends FakeNode>(child: T): T {
    child.parent = this;
    child.previousSibling = this.lastChild;
    if (this.lastChild) this.lastChild.nextSibling = child;
    this.childNodes.push(child);
    return child;
  }
  remove(child: FakeNode): void {
    const index = this.childNodes.indexOf(child);
    if (index < 0) return;
    if (this.childNodes[index + 1]) this.childNodes[index + 1].previousSibling = child.previousSibling;
    if (child.previousSibling) child.previousSibling.nextSibling = child.nextSibling;
    this.childNodes.splice(index, 1);
    child.parent = child.previousSibling = child.nextSibling = null;
  }
}
class FakeText extends FakeNode {
  constructor(public data: string, public bounds?: DOMRect) { super(); }
}
class FakeElement extends FakeNode {
  id = '';
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  shadowRoot: FakeShadowRoot | null = null;
  isContentEditable = false;
  style = new InlineStyle();
  computed: Record<string, string> = {};
  attributes = new Map<string, string>();
  rangeReads = 0;
  failMeasurement = false;
  constructor(public tagName: string, public bounds = box(0, 0)) { super(); }
  get localName(): string { return this.tagName.toLowerCase(); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parentElement) if (`#${node.id}` === selector) return node;
    return null;
  }
  getBoundingClientRect(): DOMRect { return this.bounds; }
  getClientRects(): DOMRect[] {
    if (this.failMeasurement) throw new Error('Temporary detached layout');
    return [this.bounds];
  }
}
class FakeShadowRoot extends FakeNode {
  animations: object[] = [];
  constructor(public host: FakeElement) { super(); }
  override get isConnected(): boolean { return this.host.isConnected; }
  getAnimations(): object[] { return this.animations; }
}
class FakeDocument extends FakeNode {
  documentElement = this.append(new FakeElement('HTML', box(0, 0, 1000, 200000)));
  body = this.documentElement.append(new FakeElement('BODY', box(0, 0, 1000, 200000)));
  scrollingElement = this.documentElement;
  animations: object[] = [];
  override get isConnected(): boolean { return true; }
  createElement(tag: string): FakeElement { return new FakeElement(tag.toUpperCase()); }
  createRange(): object {
    let node: FakeText;
    return {
      selectNodeContents(value: FakeText) { node = value; },
      getClientRects() {
        const element = node.parentElement!;
        element.rangeReads++;
        if (element.failMeasurement) throw new Error('Temporary detached layout');
        return [node.bounds ?? element.bounds];
      },
      detach() {},
    };
  }
  getAnimations(): object[] { return this.animations; }
  elementsFromPoint(): FakeElement[] { return []; }
}
class FakeKeyframeEffect {
  reads = 0;
  constructor(public target: FakeElement, private frames: object[] = [{ transform: 'translateX(0px)' }, { transform: 'translateX(20px)' }]) {}
  getKeyframes(): object[] { this.reads++; return this.frames; }
}

function withPage(run: (page: FakeDocument, tick: (clearance: TextClearance) => void) => void): void {
  const page = new FakeDocument();
  let clock = 0;
  const defaults = {
    display: 'block', contentVisibility: 'visible', opacity: '1', visibility: 'visible', position: 'static',
    transform: 'none', perspective: 'none', filter: 'none', backdropFilter: 'none', contain: 'none', willChange: 'auto',
    overflowX: 'visible', overflowY: 'visible', clipPath: 'none', fontSize: '16px', textShadow: 'none',
  };
  const globals: Record<string, unknown> = {
    Node: FakeNode, Element: FakeElement, HTMLElement: FakeElement, SVGElement: FakeElement, Text: FakeText,
    ShadowRoot: FakeShadowRoot, KeyframeEffect: FakeKeyframeEffect, document: page,
    scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 800,
    performance: { now: () => clock += 0.02 },
    getComputedStyle: (element: FakeElement) => {
      const style: Record<string, unknown> = { ...defaults, ...element.computed };
      for (let index = 0; index < element.style.length; index++) {
        const name = element.style.item(index);
        style[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = element.style.getPropertyValue(name);
      }
      style.getPropertyValue = (name: string) => element.computed[name] ?? element.style.getPropertyValue(name);
      return style;
    },
  };
  globals.window = globalThis;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  try {
    run(page, clearance => { beginMeasurements(); clearance.sampleMotion(); });
  } finally {
    beginMeasurements();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}
const node = (value: FakeNode): Node => value as unknown as Node;
const element = (value: FakeElement): Element => value as unknown as Element;
function finish(clearance: TextClearance, tick: (clearance: TextClearance) => void): void {
  for (let frame = 0; frame < 10000 && clearance.inspecting; frame++) tick(clearance);
  assert.equal(clearance.inspecting, false, 'queued coverage eventually completes');
}
function covers(rect: Rect, x: number, y: number): boolean {
  return rect.x <= x && rect.x + rect.width >= x && rect.y <= y && rect.y + rect.height >= y;
}
function paragraph(parent: FakeNode, x: number, y: number): FakeElement {
  const item = parent.append(new FakeElement('P', box(x, y, 180, 20)));
  item.append(new FakeText('Native readable text'));
  return item;
}

test('large native pages continue past former node and source caps with local pending coverage', () => withPage((page, tick) => {
  const readingColumn = page.body.append(new FakeElement('SECTION', box(0, 0, 200, 200000)));
  const count = 6500;
  for (let index = 0; index < count; index++) paragraph(readingColumn, 10, index * 25);
  const clearance = new TextClearance();
  clearance.rebuild();
  assert.equal(clearance.rectangles.length, 0, 'rebuild only queues work');
  assert.equal(clearance.inspecting, true);
  tick(clearance);
  assert.equal(clearance.complete, true, 'pending coverage is safe to consume');
  assert.equal(clearance.inspecting, true);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'pending'));
  assert.ok(!clearance.rectangles.some(rect => covers(rect, 700, 100)), 'a separate safe strip is not blacked out');
  finish(clearance, tick);
  assert.equal(clearance.rectangles.filter(rect => rect.kind === 'text').length, count);
  assert.ok(clearance.rectangles.every(rect => rect.kind !== 'pending'));
  assert.equal(clearance.needsRebuild, false);
}));

test('added and moved text blocks its new location while unrelated inspected masks survive', () => withPage((page, tick) => {
  const stationary = paragraph(page.body, 700, 50);
  const local = page.body.append(new FakeElement('SECTION', box(20, 100, 220, 600)));
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  const previous = clearance.rectangles.find(rect => rect.element === element(stationary));
  const added = local.append(new FakeElement('DIV', box(20, 100, 220, 600)));
  for (let index = 0; index < 300; index++) paragraph(added, 30, 110 + index * 25);
  clearance.markChanged(node(local), false);
  clearance.markChanged(node(added));
  tick(clearance);
  assert.equal(clearance.complete, true);
  assert.deepEqual(clearance.rectangles.find(rect => rect.element === element(stationary)), previous);
  assert.ok(clearance.rectangles.some(rect => covers(rect, 40, 120)), 'new text has accurate or pending protection');
  added.bounds = box(350, 100, 220, 600);
  added.style.cssText = 'transform:translateX(330px)';
  assert.equal(clearance.markStyleMotion(element(added), null), true, 'classification is independent of pending discovery');
  tick(clearance);
  assert.ok(clearance.rectangles.some(rect => covers(rect, 360, 120)), 'motion cannot expose an unmeasured region');
  finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.element === element(stationary)));
}));

test('child-list layout invalidation refreshes moved text without rediscovering an unchanged page', () => withPage((page, tick) => {
  const item = paragraph(page.body, 20, 50);
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  item.bounds = box(20, 300, 180, 20);
  const reads = item.rangeReads;
  clearance.markChanged(node(page.body), false);
  assert.equal(item.rangeReads, reads, 'mutation callback does not measure');
  finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && covers(rect, 30, 310)));
  assert.equal(item.rangeReads, reads + 1, 'known handles are refreshed once without a second discovery pass');
}));

test('local player animations keep text protection current without restarting discovery', () => withPage((page, tick) => {
  const player = page.body.append(new FakeElement('DIV', box(10, 100, 300, 100)));
  const caption = paragraph(player, 20, 120);
  const unrelated = paragraph(page.body, 700, 120);
  const effect = new FakeKeyframeEffect(caption);
  page.animations.push({ effect });
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  const oldUnrelated = clearance.rectangles.find(rect => rect.element === element(unrelated));
  for (let frame = 0; frame < 12; frame++) {
    caption.bounds = box(20 + frame * 2, 120, 180, 20);
    tick(clearance);
    assert.ok(clearance.rectangles.some(rect => rect.element === element(caption) && covers(rect, 30 + frame * 2, 130)));
    assert.ok(clearance.rectangles.includes(oldUnrelated!));
    assert.equal(clearance.needsRebuild, false);
  }
  assert.equal(effect.reads, 1, 'stable animation metadata is classified once');
  page.animations.length = 0;
  tick(clearance);
  finish(clearance, tick);
}));

test('open shadows, native controls/media, clipping and scroll-dependent text retain typed protection', () => withPage((page, tick) => {
  const scroller = page.body.append(new FakeElement('DIV', box(10, 100, 220, 100)));
  scroller.computed.overflowY = 'auto';
  const clipped = paragraph(scroller, 20, 190);
  const host = page.body.append(new FakeElement('READING-CARD', box(300, 100, 200, 100)));
  host.shadowRoot = new FakeShadowRoot(host);
  const shadowText = paragraph(host.shadowRoot, 310, 120);
  const media = page.body.append(new FakeElement('VIDEO', box(550, 100, 200, 100)));
  const control = page.body.append(new FakeElement('INPUT', box(550, 250, 200, 20)));
  const fixed = paragraph(page.body, 20, 20);
  fixed.computed.position = 'fixed';
  const sticky = paragraph(page.body, 300, 20);
  sticky.computed.position = 'sticky';
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'media' && rect.element === element(media)));
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'control' && rect.element === element(control)));
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && rect.element === element(shadowText)));
  assert.ok(clearance.rectangles.some(rect => rect.element === element(clipped) && rect.kind === 'text' && rect.y + rect.height <= 204), 'clipping preserves source ownership and kind');
  clipped.bounds = box(20, 120, 180, 20);
  clearance.markScrolled(scroller as unknown as EventTarget); finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.element === element(clipped) && covers(rect, 30, 130)));
  Object.defineProperty(globalThis, 'scrollY', { value: 500, configurable: true, writable: true });
  clearance.markScrolled(document); finish(clearance, tick);
  for (const source of [fixed, sticky]) assert.ok(clearance.rectangles.some(rect => rect.element === element(source) && covers(rect, source.bounds.left + 10, 530)));
}));

test('text shadows and stroke remain protected and transient measurement failures recover locally', () => withPage((page, tick) => {
  const item = paragraph(page.body, 100, 100);
  item.computed.textShadow = 'rgba(0,0,0,.8) 12px -8px 5px';
  item.computed['-webkit-text-stroke-width'] = '3px';
  const other = paragraph(page.body, 700, 100);
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.element === element(item) && covers(rect, 60, 100)));
  const previous = clearance.rectangles.find(rect => rect.element === element(other));
  item.failMeasurement = true;
  item.bounds = box(300, 100, 180, 20);
  clearance.markChanged(node(item)); tick(clearance);
  assert.equal(clearance.complete, true);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'pending' && covers(rect, 310, 110)));
  assert.deepEqual(clearance.rectangles.find(rect => rect.element === element(other)), previous);
  item.failMeasurement = false;
  finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && rect.element === element(item) && covers(rect, 310, 110)));
  assert.ok(clearance.rectangles.every(rect => rect.kind !== 'pending'));
}));

test('motion classification works before completion and revealed uninspected branches acquire local coverage', () => withPage((page, tick) => {
  const hidden = page.body.append(new FakeElement('SECTION', box(20, 100, 220, 1000)));
  hidden.computed.display = 'none';
  for (let index = 0; index < 300; index++) paragraph(hidden, 30, 110 + index * 25);
  const clearance = new TextClearance();
  clearance.rebuild();
  hidden.style.cssText = 'opacity:0.5';
  assert.equal(clearance.complete, false);
  assert.equal(clearance.markStyleMotion(element(hidden), 'opacity:0'), true);
  finish(clearance, tick);
  assert.ok(clearance.rectangles.every(rect => rect.kind !== 'text'), 'unpainted subtrees are pruned');
  hidden.computed.display = 'block';
  hidden.style.cssText = 'opacity:1';
  assert.equal(clearance.markStyleMotion(element(hidden), 'opacity:0.5'), true);
  tick(clearance);
  assert.equal(clearance.complete, true);
  assert.ok(clearance.rectangles.some(rect => covers(rect, 40, 120)), 'a cache-miss reveal is protected immediately');
  assert.ok(!clearance.rectangles.some(rect => covers(rect, 700, 120)), 'reveal remains local');
  finish(clearance, tick);
  assert.equal(clearance.rectangles.filter(rect => rect.kind === 'text').length, 300);
}));

test('edits behind a continuing ancestor cursor are not lost to root coalescing', () => withPage((page, tick) => {
  const column = page.body.append(new FakeElement('SECTION', box(0, 0, 220, 200000)));
  const first = paragraph(column, 10, 20);
  for (let index = 0; index < 300; index++) paragraph(column, 10, 100 + index * 25);
  const clearance = new TextClearance();
  clearance.rebuild();
  for (let frame = 0; frame < 20 && !clearance.rectangles.some(rect => rect.element === element(first) && rect.kind === 'text'); frame++) tick(clearance);
  assert.equal(clearance.inspecting, true);
  const added = first.append(new FakeText('Text added after this branch was inspected', box(300, 20, 100, 20)));
  clearance.markChanged(node(added));
  tick(clearance);
  assert.ok(clearance.rectangles.some(rect => covers(rect, 310, 30)));
  finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && covers(rect, 310, 30)));
}));

test('removing queued siblings cannot strand the rest of a continuing inspection', () => withPage((page, tick) => {
  const column = page.body.append(new FakeElement('SECTION', box(0, 0, 220, 200000)));
  const items = Array.from({ length: 300 }, (_, index) => paragraph(column, 10, index * 25));
  const clearance = new TextClearance();
  clearance.rebuild(); tick(clearance);
  const next = items.findIndex(item => item.rangeReads === 0);
  assert.ok(next >= 0 && next < items.length - 3);
  for (const item of items.slice(next, next + 3)) column.remove(item);
  clearance.markChanged(node(column), false);
  finish(clearance, tick);
  assert.equal(clearance.rectangles.filter(rect => rect.kind === 'text').length, items.length - 3);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && rect.element === element(items.at(-1)!)));
}));

test('inspectable custom containers protect their contents instead of blacking out the component box', () => withPage((page, tick) => {
  const app = page.body.append(new FakeElement('YTD-APP', box(0, 0, 1000, 1000)));
  app.append(new FakeText('\n  '));
  const thumbnail = app.append(new FakeElement('YTD-THUMBNAIL', box(0, 80, 900, 100)));
  const title = paragraph(thumbnail, 10, 100);
  const opaque = app.append(new FakeElement('NATIVE-WIDGET', box(500, 300, 300, 100)));
  opaque.append(new FakeText('\n'));
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && rect.element === element(title)));
  assert.ok(clearance.rectangles.every(rect => rect.element !== element(app) && rect.element !== element(thumbnail)));
  assert.ok(!clearance.rectangles.some(rect => covers(rect, 750, 110)), 'safe native edges inside light-DOM components remain usable');
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'control' && rect.element === element(opaque)), 'genuinely opaque widgets stay protected');
  const revealed = paragraph(opaque, 510, 320);
  clearance.markChanged(node(opaque), false);
  clearance.markChanged(node(revealed));
  finish(clearance, tick);
  assert.ok(clearance.rectangles.every(rect => rect.element !== element(opaque)), 'adding inspectable content retires the old whole-widget mask');
  assert.ok(!clearance.rectangles.some(rect => covers(rect, 750, 330)));
}));

test('padded native buttons protect readable content while value inputs and editables protect their whole boxes', () => withPage((page, tick) => {
  const button = page.body.append(new FakeElement('BUTTON', box(100, 100, 600, 80)));
  button.append(new FakeText('A readable native button label', box(300, 135, 180, 20)));
  const roleButton = page.body.append(new FakeElement('DIV', box(100, 200, 600, 80)));
  roleButton.attributes.set('role', 'button');
  roleButton.append(new FakeText('A readable ARIA button label', box(300, 235, 180, 20)));
  const input = page.body.append(new FakeElement('INPUT', box(100, 320, 300, 60)));
  input.attributes.set('value', 'A native input value without a text node');
  const editable = page.body.append(new FakeElement('DIV', box(500, 320, 300, 60)));
  editable.isContentEditable = true;
  editable.append(new FakeText('Editable native text', box(520, 340, 180, 20)));
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  for (const [source, textY, edgeY] of [[button, 145, 100], [roleButton, 245, 200]] as const) {
    assert.ok(clearance.rectangles.some(rect => rect.element === element(source) && rect.kind === 'text' && covers(rect, 310, textY)), 'button text keeps its padded clearance');
    assert.ok(!clearance.rectangles.some(rect => covers(rect, 110, edgeY)), 'the clean padded top edge remains available for decoration');
    assert.ok(clearance.rectangles.every(rect => rect.element !== element(source) || rect.kind === 'text'), 'ordinary buttons do not acquire whole-box control masks');
  }
  assert.ok(clearance.rectangles.some(rect => rect.element === element(input) && rect.kind === 'control' && covers(rect, 110, 325)), 'input values remain protected without inspectable text nodes');
  assert.ok(clearance.rectangles.some(rect => rect.element === element(editable) && rect.kind === 'control' && covers(rect, 510, 325)), 'editable padding and native editing affordances remain protected');
}));

test('fresh sibling masks stay precise while a distant large refresh continues, without exposing unprocessed moved text', () => withPage((page, tick) => {
  const main = page.body.append(new FakeElement('MAIN', box(0, 0, 1000, 200000)));
  const known = main.append(new FakeElement('DIV', box(20, 100, 900, 80)));
  known.append(new FakeText('An already inspected label below a clean native edge', box(200, 140, 300, 20)));
  const archive = main.append(new FakeElement('SECTION', box(20, 1000, 900, 20000)));
  const distant = Array.from({ length: 400 }, (_, index) => paragraph(archive, 30, 1010 + index * 25));
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  assert.ok(!clearance.rectangles.some(rect => covers(rect, 30, 100)));
  // This existing handle is late in the continuing scope pass. Its new location
  // must stay conservatively protected until it receives an accurate sample.
  distant[0].bounds = box(500, 400, 180, 20);
  const added = archive.append(new FakeElement('DIV', box(20, 13000, 900, 10000)));
  for (let index = 0; index < 300; index++) paragraph(added, 30, 13010 + index * 25);
  clearance.markChanged(node(archive), false);
  clearance.markChanged(node(added));
  tick(clearance);
  assert.equal(clearance.inspecting, true, 'large distant work continues over frames');
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && rect.element === element(known) && covers(rect, 210, 150)));
  assert.ok(!clearance.rectangles.some(rect => covers(rect, 30, 100)), 'a freshly validated sibling never falls back to its whole element box');
  assert.ok(clearance.rectangles.some(rect => covers(rect, 510, 410)), 'unprocessed moved text still blocks its current location');
  finish(clearance, tick);
  assert.ok(clearance.rectangles.some(rect => rect.kind === 'text' && rect.element === element(distant[0]) && covers(rect, 510, 410)));
  assert.ok(clearance.rectangles.every(rect => rect.kind !== 'pending'));
}));

test('cropped media retains its protective mask and padding metadata through clipping', () => withPage((page, tick) => {
  const crop = page.body.append(new FakeElement('DIV', box(100, 200, 300, 190)));
  crop.computed.overflowX = crop.computed.overflowY = 'hidden';
  const image = crop.append(new FakeElement('IMG', box(80, 180, 500, 260)));
  const clearance = new TextClearance();
  clearance.rebuild(); finish(clearance, tick);
  const mask = clearance.rectangles.find(rect => rect.element === element(image) && rect.kind === 'media');
  assert.ok(mask && mask.padding !== undefined);
  assert.equal(mask.padding, 4);
  assert.deepEqual({ x: mask.x, y: mask.y, width: mask.width, height: mask.height }, { x: 96, y: 196, width: 308, height: 198 }, 'metadata never shrinks the conservative media mask');
  assert.deepEqual({
    x: mask.x + mask.padding,
    y: mask.y + mask.padding,
    width: mask.width - mask.padding * 2,
    height: mask.height - mask.padding * 2,
  }, { x: 100, y: 200, width: 300, height: 190 }, 'consumers can recover the visible media border separately');
}));
