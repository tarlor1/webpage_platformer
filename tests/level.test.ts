import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, outsidePage } from '../src/level';
import { MOTION, type Platform } from '../src/types';
import { createPlayer } from '../src/physics';

Object.assign(globalThis, { scrollX: 0, scrollY: 0, innerWidth: 1440, innerHeight: 900 });

test('an empty webpage receives no fabricated terrain or spawn surface', () => {
  const level = buildLevel([]);
  assert.deepEqual(level.platforms, []);
  assert.equal(level.spawn, undefined);
});

test('disconnected original surfaces do not receive connecting bridges', () => {
  const surfaces: Platform[] = [
    { id: 'image', x: 50, y: 650, width: 150 },
    { id: 'heading', x: 1100, y: 150, width: 200 },
  ];
  const level = buildLevel(surfaces);
  assert.deepEqual(level.platforms.map(p => p.id).sort(), ['heading', 'image']);
  assert.ok(level.spawn);
  assert.ok(surfaces.some(p => level.spawn!.y + MOTION.height === p.y
    && level.spawn!.x >= p.x && level.spawn!.x + MOTION.width <= p.x + p.width));
});

test('full-width image edges provide an original visible spawn', () => {
  const level = buildLevel([{ id: 'hero', x: 0, y: 322, width: 1440 }]);
  assert.ok(level.spawn);
  assert.equal(level.spawn.y + MOTION.height, 322);
  assert.ok(level.spawn.x >= 0 && level.spawn.x + MOTION.width <= 1440);
});

test('offscreen terrain is retained without offering an offscreen manual spawn', () => {
  const level = buildLevel([{ id: 'retained-rider-surface', x: 50, y: 2000, width: 300 }]);
  assert.equal(level.spawn, undefined);
  assert.deepEqual(level.platforms.map(p => p.id), ['retained-rider-surface']);
});

test('leaving the viewport within a long or wide document is not a page exit', () => {
  const body = createPlayer(1800, 2000);
  assert.equal(outsidePage(body, 5000), false);
  body.y = -100;
  assert.equal(outsidePage(body, 5000), false);
});

test('only falling below the document bottom triggers recovery', () => {
  const body = createPlayer(20, 5064);
  assert.equal(outsidePage(body, 5000), false);
  body.y = 5065;
  assert.equal(outsidePage(body, 5000), true);
  body.y = 100;
  body.x = 5000;
  assert.equal(outsidePage(body, 5000), false);
});
