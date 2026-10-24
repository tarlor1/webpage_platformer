import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, dropThrough, stepBody } from '../src/physics';
import { MOTION, type Platform } from '../src/types';

const ledges: Platform[] = [
  { id: 'upper', x: 0, y: 100, width: 200, kind: 'dom' },
  { id: 'lower', x: 0, y: 180, width: 200, kind: 'dom' },
];
test('fast fall lands on first crossed top, then rests without sinking', () => {
  const body = createPlayer(20, 0);
  body.vy = 2000;
  stepBody(body, ledges, 0.1);
  assert.equal(body.y, 100 - MOTION.height);
  assert.equal(body.platformId, 'upper');
  for (let i = 0; i < 1200; i++) stepBody(body, ledges, MOTION.step);
  assert.equal(body.y, 70);
  assert.equal(body.vy, 0);
  assert.equal(body.grounded, true);
});
test('one-way tops allow ascent from below and catch subsequent descent', () => {
  const body = createPlayer(20, 110);
  body.vy = -MOTION.jump;
  let passedAbove = false;
  for (let i = 0; i < 100; i++) {
    stepBody(body, ledges, MOTION.step);
    if (body.y + body.height < 100) passedAbove = true;
  }
  assert.equal(passedAbove, true);
  assert.equal(body.y, 70);
  assert.equal(body.platformId, 'upper');
});
test('horizontal misses cannot land on a ledge', () => {
  const body = createPlayer(220, 0);
  body.vy = 2000;
  stepBody(body, ledges, 0.1);
  assert.equal(body.grounded, false);
  assert.ok(body.y > 180);
});
test('swept crossing catches a ledge crossed before leaving its horizontal span', () => {
  const body = createPlayer(130, 0);
  body.vy = 2000; body.vx = 1000;
  stepBody(body, ledges, 0.1);
  assert.equal(body.platformId, 'upper');
  assert.equal(body.y, 70);
});

test('dropping skips the supporting top and lands on the next lower top', () => {
  const body = createPlayer(20, 70);
  stepBody(body, ledges, MOTION.step);
  assert.equal(dropThrough(body), true);
  for (let i = 0; i < 120; i++) stepBody(body, ledges, MOTION.step);
  assert.equal(body.platformId, 'lower');
  assert.equal(body.y, 150);
  assert.equal(body.grounded, true);
});

test('drop input in midair cannot add downward speed or cancel a jump', () => {
  const body = createPlayer(20, 30);
  body.vy = -500;
  assert.equal(dropThrough(body), false);
  assert.equal(body.y, 30);
  assert.equal(body.vy, -500);
});
