import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountMovablePanel } from '../src/ui/movable-panel';

// Minimal DOM fixture: count measurements and writes without relying on wall-clock timing.
function panelFixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0, layoutReads = 0, transformWrites = 0, focusCount = 0;
  let resizePanel = () => {};
  let disconnected = false;

  class Element extends EventTarget {
    childNodes: Element[] = [];
    parent?: Element;
    hidden = false;
    id = '';
    className = '';
    title = '';
    type = '';
    textContent = '';
    attributes = new Map<string, string>();
    classes = new Set<string>();
    captured = new Set<number>();
    classList = {
      add: (name: string) => { this.classes.add(name); },
      remove: (name: string) => { this.classes.delete(name); },
      toggle: (name: string, enabled: boolean) => { enabled ? this.classes.add(name) : this.classes.delete(name); },
    };
    style = new Proxy({} as Record<string, string>, {
      set(target, key: string, value: string) {
        if (key === 'transform') transformWrites++;
        target[key] = value;
        return true;
      },
    });
    ownerDocument = { createElement: () => new Element() };
    append(...children: Element[]) {
      for (const child of children) { child.remove(); child.parent = this; this.childNodes.push(child); }
    }
    remove() {
      if (this.parent) this.parent.childNodes = this.parent.childNodes.filter(child => child !== this);
      this.parent = undefined;
    }
    querySelector() { return this.childNodes[0]; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getBoundingClientRect() { layoutReads++; return { left: 500, top: 300, width: 300, height: 200 }; }
    setPointerCapture(id: number) { this.captured.add(id); }
    hasPointerCapture(id: number) { return this.captured.has(id); }
    releasePointerCapture(id: number) { this.captured.delete(id); }
    focus() {}
  }

  const globals = {
    window: new EventTarget(), innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    ResizeObserver: class {
      constructor(callback: () => void) { resizePanel = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  };
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const controller = new AbortController();
  const panel = new Element();
  panel.append(new Element(), new Element());
  mountMovablePanel(panel as unknown as HTMLElement, controller.signal, () => { focusCount++; });
  const [header, content] = panel.childNodes;
  const [handle, toggle] = header.childNodes;

  return {
    panel, content, handle, toggle, controller, resizePanel,
    stats: () => ({ layoutReads, transformWrites, focusCount, disconnected, pendingFrames: frames.size }),
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
    send(target: Element, type: string, properties: Record<string, number | boolean | string> = {}) {
      target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), properties));
    },
    restore() {
      controller.abort();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('a burst of drag events does no layout reads and writes only the latest position once per frame', () => {
  const fixture = panelFixture();
  try {
    fixture.flush();
    const before = fixture.stats();
    fixture.send(fixture.handle, 'pointerdown', { button: 0, isPrimary: true, pointerId: 1, clientX: 600, clientY: 400 });
    for (let i = 1; i <= 200; i++) {
      fixture.send(fixture.handle, 'pointermove', { pointerId: 1, clientX: 600 - i, clientY: 400 - i });
    }
    assert.equal(fixture.stats().layoutReads, before.layoutReads);
    assert.equal(fixture.stats().transformWrites, before.transformWrites);
    assert.equal(fixture.stats().pendingFrames, 1);
    fixture.flush();
    assert.equal(fixture.stats().transformWrites, before.transformWrites + 1);
    assert.equal(fixture.panel.style.transform, 'translate3d(300px, 100px, 0)');
    fixture.send(fixture.handle, 'pointerup', { pointerId: 1 });
    fixture.send(fixture.handle, 'pointermove', { pointerId: 1, clientX: 0, clientY: 0 });
    assert.equal(fixture.stats().pendingFrames, 0);
    assert.equal(fixture.handle.captured.size, 0);
  } finally { fixture.restore(); }
});

test('minimize, keyboard bounds, resize and cleanup still work', () => {
  const fixture = panelFixture();
  try {
    fixture.flush();
    fixture.send(fixture.toggle, 'click');
    assert.equal(fixture.content.hidden, true);
    assert.equal(fixture.toggle.attributes.get('aria-expanded'), 'false');
    assert.equal(fixture.stats().focusCount, 1);
    fixture.send(fixture.toggle, 'click');
    assert.equal(fixture.content.hidden, false);
    assert.equal(fixture.toggle.attributes.get('aria-expanded'), 'true');
    for (let i = 0; i < 30; i++) fixture.send(fixture.handle, 'keydown', { key: 'ArrowRight', shiftKey: true });
    fixture.flush();
    assert.equal(fixture.panel.style.transform, 'translate3d(700px, 300px, 0)');
    Object.defineProperty(globalThis, 'innerWidth', { value: 600, configurable: true });
    fixture.resizePanel();
    fixture.flush();
    assert.equal(fixture.panel.style.transform, 'translate3d(300px, 300px, 0)');
    fixture.send(fixture.handle, 'keydown', { key: 'ArrowLeft' });
    fixture.controller.abort();
    assert.equal(fixture.stats().pendingFrames, 0);
    assert.equal(fixture.stats().disconnected, true);
    fixture.send(fixture.toggle, 'click');
    assert.equal(fixture.content.hidden, false);
  } finally { fixture.restore(); }
});
