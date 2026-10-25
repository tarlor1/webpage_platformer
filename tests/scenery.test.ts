import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeScenery, updateScenery } from '../src/rendering/scenery';
import type { SceneryDesign } from '../src/rendering/scenery-types';
import type { Platform } from '../src/engine/types';
import { drawWorld } from '../src/rendering/render';
import { isDecorativeCanvas } from '../src/rendering/text-clearance';
import { setSurfaceMetadata } from '../src/page/surface-metadata';
import { beginMeasurements } from '../src/page/frame-measurement';
import type { Rect } from '../src/rendering/scenery-types';

const design: SceneryDesign = { id: 'surface-track', kind: 'rail', width: 480, height: 10, palette: 0, variant: 1, rank: 42 };
const platform: Platform = { id: 'original-heading', x: 20, y: 100, width: 300 };

test('material stays attached when scrolling changes the nearby candidate set', () => {
  const other: Platform = { id: 'another-heading', x: 360, y: 220, width: 420 };
  const first = placeScenery([design], [platform]);
  const anchor = { ...first[0] };
  const next = placeScenery([design], [other, platform], first);
  assert.deepEqual(next.find(placement => placement.platformId === platform.id), anchor);
  assert.deepEqual(placeScenery([design], [platform], next)[0], anchor);
});

test('material selection does not depend on which neighboring platforms were inspected first', () => {
  const styles = [design, { ...design, id: 'second-track', kind: 'road' as const, rank: 220 }];
  const surfaces = [platform, { id: 'original-image', x: 360, y: 240, width: 520 }];
  const forward = placeScenery(styles, surfaces);
  const reversed = placeScenery(styles, [...surfaces].reverse());
  for (const placement of forward) {
    assert.deepEqual(reversed.find(other => other.platformId === placement.platformId), placement);
  }
});

test('a partly offscreen material remains centered on its original collision edge', () => {
  const placed = placeScenery([design], [{ ...platform, y: 2 }]);
  assert.ok(placed[0].y < 0);
  assert.equal(placed[0].visible, true);
  assert.equal(placed[0].y + placed[0].height / 2, 2);
});

test('small and large native edges receive full-width material without changing collision geometry', () => {
  for (const width of [1, 12, 29, 70, 107, 160, 300, 840]) {
    const surface = { ...platform, width };
    const original = { ...surface };
    const placed = placeScenery([design], [surface])[0];
    assert.equal(placed.width, width);
    assert.equal(placed.height, design.height);
    assert.equal(placed.x, surface.x);
    assert.equal(placed.y + placed.height / 2, surface.y);
    assert.deepEqual(surface, original);
  }
});

test('moving native surfaces carry material in both axes', () => {
  const moving = { ...platform };
  const placed = placeScenery([design], [moving]);
  const before = { ...placed[0] };
  moving.x += 80; moving.y += 20;
  updateScenery(placed, [moving]);
  assert.equal(placed[0].visible, true);
  assert.equal(placed[0].x, before.x + 80);
  assert.equal(placed[0].y, before.y + 20);
});

test('resizing a source keeps a full-width strip without changing its material', () => {
  const resizing = { ...platform, width: 600 };
  const placed = placeScenery([design], [resizing]);
  const material = placed[0].design;
  resizing.width = 160;
  updateScenery(placed, [resizing]);
  assert.equal(placed[0].design, material);
  assert.equal(placed[0].x, resizing.x);
  assert.equal(placed[0].width, resizing.width);
  assert.equal(placed[0].y + placed[0].height / 2, resizing.y);
});

test('a missing surface hides its material without teleporting it to another surface', () => {
  const placed = placeScenery([design], [platform]);
  const before = { ...placed[0] };
  updateScenery(placed, [{ ...platform, id: 'different-source' }]);
  assert.equal(placed[0].visible, false);
  assert.equal(placed[0].x, before.x);
  assert.equal(placed[0].y, before.y);
  updateScenery(placed, [platform]);
  assert.deepEqual(placed[0], before);
});

test('empty or invalid original terrain never receives an invented material platform', () => {
  assert.deepEqual(placeScenery([design], []), []);
  assert.deepEqual(placeScenery([], [platform]), []);
  for (const invalid of [{ width: 0 }, { width: -1 }, { width: Infinity }, { width: NaN }, { x: Infinity }, { y: NaN }]) {
    assert.deepEqual(placeScenery([design], [{ ...platform, ...invalid }]), []);
  }
});

test('membership and object identity survive discovery gaps and temporarily invalid widths', () => {
  const placed = placeScenery([design], [platform]);
  const material = placed[0];
  const anchor = { ...material };
  const absent = placeScenery([design], [], placed);
  assert.equal(absent[0], material);
  assert.equal(material.visible, false);
  const narrow = placeScenery([design], [{ ...platform, width: 0 }], absent);
  assert.equal(narrow[0], material);
  assert.equal(material.visible, false);
  const restored = placeScenery([design], [platform], narrow);
  assert.equal(restored[0], material);
  assert.deepEqual(material, anchor);
});

function withViewport(run: () => void): void {
  const values = { scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 700 };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  try { run(); } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('full viewport GL/Rive canvases do not mask content while named native media stays protected', () => {
  withViewport(() => {
    const attributes: Record<string, string> = { class: 'gl-wrap w-embed' };
    const canvas = {
      tagName: 'CANVAS', id: '', parentElement: null,
      getAttribute: (name: string) => attributes[name] ?? null,
      hasAttribute: (name: string) => Object.hasOwn(attributes, name),
    } as unknown as Element;
    const style = { pointerEvents: 'auto', position: 'static' } as CSSStyleDeclaration;
    assert.equal(isDecorativeCanvas(canvas, style, { width: 1000, height: 700 }), true);
    assert.equal(isDecorativeCanvas(canvas, style, { width: 200, height: 100 }), false);
    attributes['aria-label'] = 'Native chart with readable data';
    assert.equal(isDecorativeCanvas(canvas, style, { width: 1000, height: 700 }), false);
    const image = { tagName: 'IMG' } as Element;
    assert.equal(isDecorativeCanvas(image, style, { width: 1000, height: 700 }), false);
    const video = { tagName: 'VIDEO' } as Element;
    assert.equal(isDecorativeCanvas(video, style, { width: 1000, height: 700 }), false);
  });
});

test('decoration replaces debug strokes, labels/collider remain, and unavailable coins stay hidden', () => {
  withViewport(() => {
    const segments: number[][] = [];
    let start: number[] = [];
    let labels = 0, colliders = 0, images = 0, coins = 0;
    const paint = { fillRect() {}, fillStyle: '' };
    const ctx = {
      canvas: { ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => paint }) } },
      clearRect() {}, save() {}, restore() {}, translate() {}, fillRect() {}, beginPath() {}, stroke() {},
      set globalCompositeOperation(value: string) { assert.notEqual(value, 'destination-out'); },
      arc() { coins++; }, fill() {}, closePath() {},
      moveTo(x: number, y: number) { start = [x, y]; },
      lineTo(x: number, y: number) { segments.push([...start, x, y]); },
      drawImage() { images++; },
      measureText: () => ({ width: 30 }),
      fillText() { labels++; },
      strokeRect() { colliders++; },
    } as unknown as CanvasRenderingContext2D;
    const placements = placeScenery([design], [platform]);
    drawWorld(ctx, { platforms: [platform] }, { x: 0, y: 0, width: 20, height: 30, vx: 0, vy: 0, grounded: false }, true, 1,
      { placements, protectedRects: [], ready: true },
      [{ kind: 'coin', id: 'unavailable', index: 0, logicalKey: 'original-heading', platformId: platform.id, fraction: 0.5, lift: 22, x: 100, y: 78, available: false }], new Set(), false);
    assert.ok(segments.length > 0, 'player silhouette is traced');
    assert.ok(segments.every(segment => segment[1] < platform.y && segment[3] < platform.y),
      'decoration replaces platform debug strokes while the player outline remains');
    assert.equal(images, 1);
    assert.equal(labels, 1);
    assert.equal(colliders, 1);
    assert.equal(coins, 0);
    const material = placements[0].design;
    const visibleCoins = Array.from({ length: 40 }, (_, index) => ({
      kind: 'coin' as const, id: `visible-${index}`, index, logicalKey: platform.id, platformId: platform.id,
      fraction: 0.5, lift: 22, x: 20 + index * 20, y: 78, available: true,
    }));
    for (const x of [0, 800]) {
      coins = 0;
      drawWorld(ctx, { platforms: [platform] }, { x, y: 0, width: 20, height: 30, vx: 0, vy: 0, grounded: false }, false, 1,
        { placements, protectedRects: [{ x: 800, y: 500, width: 30, height: 30 }], ready: true }, visibleCoins, new Set(), false);
      assert.equal(coins, visibleCoins.length);
      assert.equal(placements[0].design, material);
    }
  });
});

test('overlapping numeric edges choose one complete strip, independent of discovery order', () => {
  const wide = { ...platform, width: 840 };
  const extra = { ...platform, id: 'extra-div', x: 180, y: 102, width: 240 };
  const separate = { ...platform, id: 'separate-edge', x: 1000, width: 180 };
  for (const surfaces of [[wide, extra, separate], [separate, extra, wide]]) {
    const placed = placeScenery([design], surfaces);
    assert.deepEqual(placed.filter(item => item.visible).map(item => item.platformId).sort(), [wide.id, separate.id].sort());
    const winner = placed.find(item => item.platformId === wide.id)!;
    assert.equal(winner.x, wide.x);
    assert.equal(winner.width, wide.width);
  }
});

test('logical clones and fragments retain one material through reordering, camera changes and resizing', () => {
  withViewport(() => {
    const styles = [design, { ...design, id: 'road', kind: 'road' as const }];
    const surfaces = [
      { ...platform, logicalKey: 'same-logical-owner', width: 840 },
      { ...platform, id: 'clone-fragment', logicalKey: 'same-logical-owner', x: 80, width: 180 },
    ];
    const placed = placeScenery(styles, surfaces);
    const material = placed[0].design;
    assert.equal(placed[1].design, material);
    const replacement = placeScenery(styles, [{ ...surfaces[1], id: 'new-clone' }]);
    assert.equal(replacement[0].design, material);
    Object.defineProperty(globalThis, 'scrollX', { value: 400, configurable: true });
    surfaces[0].width = 1000;
    updateScenery(placed, [...surfaces].reverse());
    assert.equal(placed[0].visible, true);
    assert.equal(placed[0].design, material);
    assert.equal(placed[1].design, material);
    assert.equal(placed[0].width, 1000);
    Object.defineProperty(globalThis, 'scrollX', { value: 2000, configurable: true });
    updateScenery(placed, surfaces);
    assert.ok(placed.every(item => !item.visible));
    Object.defineProperty(globalThis, 'scrollX', { value: 0, configurable: true });
    updateScenery(placed, surfaces);
    assert.equal(placed[0].design, material);
    assert.equal(placed[0].visible, true);
  });
});

test('any text, control, pending region, unrelated media, unknown content or HUD rejects the whole strip', () => {
  const placed = placeScenery([design], [{ ...platform, width: 1200 }]);
  const blocker = { x: 600, y: 98, width: 15, height: 20 };
  for (const kind of [undefined, 'text', 'control', 'pending', 'media'] as const) {
    updateScenery(placed, [{ ...platform, width: 1200 }], [{ ...blocker, kind }]);
    assert.equal(placed[0].visible, false, `${kind ?? 'unknown'} must reject the entire strip`);
    assert.equal(placed[0].x, platform.x);
    assert.equal(placed[0].width, 1200);
  }
  updateScenery(placed, [{ ...platform, width: 1200 }], [], blocker);
  assert.equal(placed[0].visible, false);
  updateScenery(placed, [{ ...platform, width: 1200 }], [{ ...blocker, y: 110 }]);
  assert.equal(placed[0].visible, true);
});

class NativeOwner {
  assignedSlot = null;
  tagName = 'DIV';
  isConnected = true;
  style = {
    position: 'static', display: 'block', zIndex: 'auto', opacity: '1', transform: 'none', filter: 'none', perspective: 'none', contain: '', willChange: '', isolation: 'auto',
    visibility: 'visible', contentVisibility: 'visible',
    backgroundColor: 'rgb(220, 230, 240)', backgroundImage: 'none',
  };
  bounds = { left: 20, top: 100, right: 320, bottom: 200, width: 300, height: 100 };
  constructor(readonly order: number, readonly parentElement: NativeOwner | null = null) {}
  getRootNode(): object { return {}; }
  getBoundingClientRect(): DOMRect { return this.bounds as DOMRect; }
  compareDocumentPosition(other: NativeOwner): number { return this.order < other.order ? 4 : 2; }
}

function withNativeOwners(run: (reads: NativeOwner[]) => void): void {
  const reads: NativeOwner[] = [];
  const values = {
    Element: NativeOwner,
    Text: class {},
    ShadowRoot: class {},
    getComputedStyle: (element: NativeOwner) => { reads.push(element); return element.style; },
  };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  beginMeasurements();
  try { run(reads); } finally {
    beginMeasurements();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('nested wrappers and clone fragments leave only their topmost native owner decorated', () => {
  withNativeOwners(() => {
    const wrapper = new NativeOwner(0);
    const child = new NativeOwner(1, wrapper);
    const wrapperSurface = { ...platform, id: 'wrapper', width: 840 };
    const childSurface = { ...platform, id: 'child', logicalKey: 'child-owner' };
    const cloneSurface = { ...childSurface, id: 'clone' };
    setSurfaceMetadata(wrapperSurface, wrapper as unknown as Element, false);
    setSurfaceMetadata(childSurface, child as unknown as Element, false);
    setSurfaceMetadata(cloneSurface, child as unknown as Element, false);
    for (const surfaces of [[wrapperSurface, childSurface, cloneSurface], [cloneSurface, childSurface, wrapperSurface]]) {
      const placed = placeScenery([design], surfaces);
      const visible = placed.filter(item => item.visible);
      assert.equal(visible.length, 1);
      assert.notEqual(visible[0].platformId, wrapperSurface.id);
      assert.equal(visible[0].width, childSurface.width);
    }
  });
});

test('native stacking order wins over discovery order and a blocked front owner does not expose a lower strip', () => {
  withNativeOwners(() => {
    const root = new NativeOwner(0);
    const front = new NativeOwner(1, root);
    front.style.position = 'relative'; front.style.zIndex = '5';
    const back = new NativeOwner(2, root);
    const frontSurface = { ...platform, id: 'front' };
    const backSurface = { ...platform, id: 'back', width: 840 };
    setSurfaceMetadata(frontSurface, front as unknown as Element, false);
    setSurfaceMetadata(backSurface, back as unknown as Element, false);
    const placed = placeScenery([design], [backSurface, frontSurface]);
    assert.deepEqual(placed.filter(item => item.visible).map(item => item.platformId), ['front']);
    updateScenery(placed, [frontSurface, backSurface], [{ x: 100, y: 98, width: 10, height: 10, kind: 'text' }]);
    assert.ok(placed.every(item => !item.visible));
  });
});

test('only the same owners actual media border is exempt; media interiors and related text or controls still block', () => {
  withNativeOwners(() => {
    const wrapper = new NativeOwner(0);
    const media = new NativeOwner(1, wrapper);
    const otherMedia = new NativeOwner(2);
    const surface = { ...platform };
    setSurfaceMetadata(surface, wrapper as unknown as Element, false);
    const placed = placeScenery([design], [surface]);
    const rect: Rect = { x: 16, y: 96, width: 308, height: 108, kind: 'media', element: media as unknown as Element };
    updateScenery(placed, [surface], [rect]);
    assert.equal(placed[0].visible, true);
    for (const kind of ['text', 'control', 'pending'] as const) {
      updateScenery(placed, [surface], [{ ...rect, kind }]);
      assert.equal(placed[0].visible, false);
    }
    updateScenery(placed, [surface], [{ ...rect, element: otherMedia as unknown as Element }]);
    assert.equal(placed[0].visible, false);
    surface.y = 130;
    updateScenery(placed, [surface], [rect]);
    assert.equal(placed[0].visible, false);
  });
});

test('offscreen div candidates are culled before native ownership/style work', () => {
  withViewport(() => withNativeOwners(reads => {
    const root = new NativeOwner(0);
    const first = new NativeOwner(1, root), second = new NativeOwner(2, root), distant = new NativeOwner(3, root);
    const surfaces = [platform, { ...platform, id: 'visible-overlap' }, { ...platform, id: 'distant', y: 100000 }];
    for (const [index, element] of [first, second, distant].entries()) setSurfaceMetadata(surfaces[index], element as unknown as Element, false);
    const placed = placeScenery([design], surfaces);
    assert.equal(placed.find(item => item.platformId === 'distant')!.visible, false);
    assert.ok(reads.includes(first) && reads.includes(second));
    assert.ok(!reads.includes(distant));
  }));
});

test('overlapping native edges follow the visible paint stack using viewport-local probes only', () => {
  withViewport(() => withNativeOwners(() => {
    const root = new NativeOwner(0), front = new NativeOwner(1, root), back = new NativeOwner(2, root), distant = new NativeOwner(3, root);
    const surfaces = [{ ...platform, id: 'paint-front' }, { ...platform, id: 'paint-back' }, { ...platform, id: 'offscreen', y: 100000 }];
    for (const [index, element] of [front, back, distant].entries()) setSurfaceMetadata(surfaces[index], element as unknown as Element, false);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const probes: number[][] = [];
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { elementsFromPoint(x: number, y: number) { probes.push([x, y]); return [front, back, root]; } },
    });
    try {
      const placed = placeScenery([design], surfaces);
      assert.deepEqual(placed.filter(item => item.visible).map(item => item.platformId), ['paint-front']);
      assert.ok(probes.length > 0);
      assert.ok(probes.every(([x, y]) => x >= 0 && x < 1000 && y >= 0 && y < 700));
      updateScenery(placed, [...surfaces].reverse());
      assert.deepEqual(placed.filter(item => item.visible).map(item => item.platformId), ['paint-front']);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  }));
});

test('a standalone detected transparent nontext div receives its complete native edge', () => {
  withNativeOwners(() => {
    const element = new NativeOwner(0);
    element.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    const surface = { ...platform, width: 12 };
    setSurfaceMetadata(surface, element as unknown as Element, false);
    const placed = placeScenery([design], [surface]);
    assert.equal(placed.length, 1);
    assert.equal(placed[0].visible, true);
    assert.equal(placed[0].x, surface.x);
    assert.equal(placed[0].width, surface.width);
    assert.equal(placed[0].height, design.height);
  });
});

test('nested transparent detected owners still yield exactly one complete decorated edge', () => {
  withNativeOwners(() => {
    const wrapper = new NativeOwner(0);
    const section = new NativeOwner(1, wrapper);
    section.tagName = 'SECTION';
    const child = new NativeOwner(2, section);
    for (const element of [wrapper, section, child]) element.style.backgroundColor = 'transparent';
    const surfaces = [
      { ...platform, id: 'transparent-wrapper', width: 840 },
      { ...platform, id: 'transparent-section', width: 600 },
      { ...platform, id: 'transparent-child' },
    ];
    for (const [index, element] of [wrapper, section, child].entries()) setSurfaceMetadata(surfaces[index], element as unknown as Element, false);
    const wrappersOnly = placeScenery([design], surfaces.slice(0, 2));
    assert.deepEqual(wrappersOnly.filter(item => item.visible).map(item => item.platformId), ['transparent-section']);
    const placed = placeScenery([design], surfaces);
    assert.deepEqual(placed.filter(item => item.visible).map(item => item.platformId), ['transparent-child']);
    assert.equal(placed.find(item => item.visible)!.width, surfaces[2].width);
    updateScenery(placed, surfaces.slice(0, 2));
    assert.deepEqual(placed.filter(item => item.visible).map(item => item.platformId), ['transparent-section']);
  });
});

test('native visibility hides disconnected and non-rendered subtrees but honors a childs visibility override', () => {
  withNativeOwners(() => {
    const parent = new NativeOwner(0), element = new NativeOwner(1, parent);
    const surface = { ...platform };
    setSurfaceMetadata(surface, element as unknown as Element, false);
    const placed = placeScenery([design], [surface]);
    for (const visibility of ['hidden', 'collapse']) {
      element.style.visibility = visibility;
      beginMeasurements();
      updateScenery(placed, [surface]);
      assert.equal(placed[0].visible, false);
    }
    element.style.visibility = 'visible';
    parent.style.visibility = 'hidden';
    beginMeasurements();
    updateScenery(placed, [surface]);
    assert.equal(placed[0].visible, true);
    for (const hidden of [{ display: 'none' }, { contentVisibility: 'hidden' }, { opacity: '0' }]) {
      Object.assign(parent.style, hidden);
      beginMeasurements();
      updateScenery(placed, [surface]);
      assert.equal(placed[0].visible, false);
      parent.style.display = 'block'; parent.style.contentVisibility = 'visible'; parent.style.opacity = '1';
    }
    element.isConnected = false;
    beginMeasurements();
    updateScenery(placed, [surface]);
    assert.equal(placed[0].visible, false);
  });
});

test('multiple fragments share visible native classification without requiring background paint', () => {
  withNativeOwners(reads => {
    const element = new NativeOwner(0);
    element.style.backgroundColor = 'transparent';
    const surface = { ...platform };
    const fragment = { ...platform, id: 'same-owner-fragment' };
    setSurfaceMetadata(surface, element as unknown as Element, false);
    setSurfaceMetadata(fragment, element as unknown as Element, false);
    const placed = placeScenery([design], [surface, fragment]);
    assert.equal(placed.filter(item => item.visible).length, 1);
    assert.equal(reads.filter(owner => owner === element).length, 1);
    element.style.opacity = '0';
    beginMeasurements();
    updateScenery(placed, [surface, fragment]);
    assert.ok(placed.every(item => !item.visible));
  });
});

test('a clipped own media border remains eligible while interior strips and unrelated media stay protected', () => {
  withNativeOwners(() => {
    const media = new NativeOwner(0), unrelated = new NativeOwner(1);
    media.tagName = 'IMG'; unrelated.tagName = 'IMG';
    media.bounds = { left: 0, top: 870, right: 420, bottom: 1170, width: 420, height: 300 };
    unrelated.bounds = { ...media.bounds };
    const surface = { ...platform, x: 40, y: 900, width: 300 };
    setSurfaceMetadata(surface, media as unknown as Element, false);
    const placed = placeScenery([design], [surface]);
    const clipped: Rect = { x: 40, y: 900, width: 300, height: 200, kind: 'media', element: media as unknown as Element };
    updateScenery(placed, [surface], [clipped]);
    assert.equal(placed[0].visible, true);
    assert.equal(placed[0].x, surface.x);
    assert.equal(placed[0].width, surface.width);
    updateScenery(placed, [surface], [{ ...clipped, element: unrelated as unknown as Element }]);
    assert.equal(placed[0].visible, false);
    surface.y = 930;
    updateScenery(placed, [surface], [clipped]);
    assert.equal(placed[0].visible, false);
    surface.y = 900; surface.x = 20;
    updateScenery(placed, [surface], [clipped]);
    assert.equal(placed[0].visible, false);
  });
});

test('a full edge keeps its off-camera text blockers when the viewport moves', () => {
  withViewport(() => {
    const surface = { ...platform, x: 10, width: 1800 };
    const text: Rect = { x: 1400, y: 96, width: 40, height: 10, kind: 'text' };
    const placed = placeScenery([design], [surface]);
    updateScenery(placed, [surface], [text]);
    assert.equal(placed[0].visible, false);
    Object.defineProperty(globalThis, 'scrollX', { value: 1000, configurable: true });
    updateScenery(placed, [surface], [text]);
    assert.equal(placed[0].visible, false);
    updateScenery(placed, [surface], [{ ...text, y: 300 }]);
    assert.equal(placed[0].visible, true);
    assert.equal(placed[0].width, surface.width);
  });
});

test('padded own-media protection admits the visible clipped border but not its padding or interior', () => {
  withNativeOwners(() => {
    const media = new NativeOwner(0), unrelated = new NativeOwner(1);
    media.tagName = 'IMG'; unrelated.tagName = 'IMG';
    media.bounds = { left: 359, top: 870, right: 739, bottom: 1130, width: 380, height: 260 };
    unrelated.bounds = { ...media.bounds };
    const surface = { ...platform, x: 399, y: 900, width: 300 };
    setSurfaceMetadata(surface, media as unknown as Element, false);
    const placed = placeScenery([design], [surface]);
    const padded: Rect = { x: 395, y: 896, width: 308, height: 198, padding: 4, kind: 'media', element: media as unknown as Element };
    updateScenery(placed, [surface], [padded]);
    assert.equal(placed[0].visible, true);
    assert.equal(placed[0].width, 300);
    updateScenery(placed, [surface], [{ ...padded, element: unrelated as unknown as Element }]);
    assert.equal(placed[0].visible, false);
    surface.y = 904;
    updateScenery(placed, [surface], [padded]);
    assert.equal(placed[0].visible, false);
    surface.y = 896;
    updateScenery(placed, [surface], [padded]);
    assert.equal(placed[0].visible, false);
    surface.y = 900; surface.x = 395;
    updateScenery(placed, [surface], [padded]);
    assert.equal(placed[0].visible, false);
    surface.x = 359; surface.y = 870; surface.width = 380;
    updateScenery(placed, [surface], [{ ...padded, x: 355, y: 866, width: 388, height: 268 }]);
    assert.equal(placed[0].visible, true);
  });
});


test('a previously decorated surface becoming text-derived hides without changing its collision', () => {
  withNativeOwners(() => {
    const owner = new NativeOwner(0);
    const surface = { ...platform };
    const original = { ...surface };
    setSurfaceMetadata(surface, owner as unknown as Element, false);
    const placed = placeScenery([design], [surface]);
    assert.equal(placed[0].visible, true);
    setSurfaceMetadata(surface, owner as unknown as Element, true);
    updateScenery(placed, [surface]);
    assert.equal(placed[0].visible, false);
    assert.deepEqual(surface, original);
  });
});
