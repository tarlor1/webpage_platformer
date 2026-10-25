import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeScenery, updateScenery } from '../src/rendering/scenery';
import type { SceneryDesign } from '../src/rendering/scenery-types';
import type { Platform } from '../src/engine/types';
import { drawWorld } from '../src/rendering/render';
import { isDecorativeCanvas } from '../src/rendering/text-clearance';

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

test('larger material fits native surface widths without changing their collision geometry', () => {
  for (const width of [112, 160, 300, 840]) {
    const surface = { ...platform, width };
    const original = { ...surface };
    const placed = placeScenery([design], [surface])[0];
    assert.ok(placed.width >= 104 && placed.width <= width - 8);
    assert.ok(placed.height > 0 && placed.height <= 12);
    assert.ok(placed.x >= surface.x && placed.x + placed.width <= surface.x + surface.width);
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
  assert.equal(placed[0].fraction, before.fraction);
});

test('resizing a source preserves its anchor fraction and stays within its new width', () => {
  const resizing = { ...platform, width: 600 };
  const placed = placeScenery([design], [resizing]);
  const fraction = placed[0].fraction;
  resizing.width = 160;
  updateScenery(placed, [resizing]);
  assert.equal(placed[0].fraction, fraction);
  assert.ok(placed[0].x >= resizing.x && placed[0].x + placed[0].width <= resizing.x + resizing.width);
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

test('empty or too-narrow original terrain never receives an invented material platform', () => {
  assert.deepEqual(placeScenery([design], []), []);
  assert.deepEqual(placeScenery([], [platform]), []);
  assert.deepEqual(placeScenery([design], [{ ...platform, width: 111 }]), []);
});

test('membership and object identity survive discovery gaps and temporary narrow widths', () => {
  const placed = placeScenery([design], [platform]);
  const material = placed[0];
  const anchor = { ...material };
  const absent = placeScenery([design], [], placed);
  assert.equal(absent[0], material);
  assert.equal(material.visible, false);
  const narrow = placeScenery([design], [{ ...platform, width: 70 }], absent);
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

test('debug strokes stop at strips, labels/collider remain, and unavailable coins stay hidden', () => {
  withViewport(() => {
    const segments: number[][] = [];
    let start: number[] = [];
    let labels = 0, colliders = 0, images = 0, coins = 0;
    const paint = { fillRect() {}, fillStyle: '' };
    const ctx = {
      canvas: { ownerDocument: { createElement: () => ({ width: 0, height: 0, getContext: () => paint }) } },
      clearRect() {}, save() {}, restore() {}, translate() {}, fillRect() {}, beginPath() {}, stroke() {},
      arc() { coins++; }, fill() {},
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
    const strip = placements[0];
    assert.deepEqual(segments, [
      [platform.x, platform.y, strip.x, platform.y],
      [strip.x + strip.width, platform.y, platform.x + platform.width, platform.y],
    ]);
    assert.equal(images, 1);
    assert.equal(labels, 1);
    assert.equal(colliders, 1);
    assert.equal(coins, 0);
  });
});
