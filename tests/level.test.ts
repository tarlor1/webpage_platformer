import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, fellBelowViewport, outsidePage } from '../src/engine/level';
import { MOTION, type Platform } from '../src/engine/types';
import { createPlayer, respawnOnPlatform, stepBody } from '../src/engine/physics';

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

test('a descending airborne character recovers once its top passes below the viewport', () => {
  const body = createPlayer(20, 901);
  body.vy = 120;
  assert.equal(fellBelowViewport(body, 899, 900), true);
  body.y = 900;
  assert.equal(fellBelowViewport(body, 899, 900), false);
  body.y = 890;
  assert.equal(fellBelowViewport(body, 880, 900), false);
});

test('scrolling above a stationary offscreen character is not a falling exit', () => {
  const body = createPlayer(20, 1800);
  assert.equal(fellBelowViewport(body, 1800, 900), false);
  // Even a stale downward velocity cannot turn a scroll-only update into a fall.
  body.vy = 100;
  assert.equal(fellBelowViewport(body, 1800, 800), false);
});

test('ascending and motionless airborne characters below the viewport do not recover', () => {
  const body = createPlayer(20, 1800);
  body.vy = -100;
  assert.equal(fellBelowViewport(body, 1801, 900), false);
  body.vy = 0;
  assert.equal(fellBelowViewport(body, 1799, 900), false);
});

test('a grounded character remains attached outside both viewport and document', () => {
  const body = createPlayer(20, 1800);
  body.grounded = true;
  body.platformId = 'offscreen-image';
  body.vy = 100;
  assert.equal(fellBelowViewport(body, 1700, 900), false);
  assert.equal(outsidePage(body, 1000), false);
});

test('viewport recovery follows scrolled world-space bounds without a horizontal exit rule', () => {
  const body = createPlayer(5000, 1901);
  body.vy = 100;
  assert.equal(fellBelowViewport(body, 1900, 1900), true);
  assert.equal(fellBelowViewport(body, 1900, 2000), false);
});

test('viewport fall recovery returns to the retained checkpoint without centering it onscreen', () => {
  const platform: Platform = { id: 'checkpoint', x: 300, y: 1400, width: 200 };
  const body = createPlayer(50, 899);
  body.vy = 500;
  const previousY = body.y;
  stepBody(body, [], MOTION.step);
  assert.equal(fellBelowViewport(body, previousY, 900), true);
  respawnOnPlatform(body, platform, 40);
  assert.equal(body.x, 340);
  assert.equal(body.y, 1400 - MOTION.height);
  assert.equal(body.platformId, platform.id);
  const checkpointY = body.y;
  stepBody(body, [platform], MOTION.step);
  assert.equal(body.grounded, true);
  assert.equal(fellBelowViewport(body, checkpointY, 900), false);
  assert.equal(outsidePage(body, 1000), false);
});
