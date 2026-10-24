import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeScenery, updateScenery } from '../src/scenery';
import type { SceneryDesign } from '../src/scenery-types';
import type { Platform } from '../src/types';

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

test('a partly offscreen material remains attached above its original edge', () => {
  const placed = placeScenery([design], [{ ...platform, y: 5 }]);
  assert.ok(placed[0].y < 0);
  assert.equal(placed[0].visible, true);
  assert.ok(placed[0].y + placed[0].height <= 5);
});

test('larger material fits native surface widths without changing their collision geometry', () => {
  for (const width of [112, 160, 300, 840]) {
    const surface = { ...platform, width };
    const original = { ...surface };
    const placed = placeScenery([design], [surface])[0];
    assert.ok(placed.width >= 104 && placed.width <= width - 8);
    assert.ok(placed.height > 0 && placed.height <= 12);
    assert.ok(placed.x >= surface.x && placed.x + placed.width <= surface.x + surface.width);
    assert.ok(placed.y + placed.height <= surface.y);
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
  assert.ok(placed[0].y + placed[0].height <= resizing.y);
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
