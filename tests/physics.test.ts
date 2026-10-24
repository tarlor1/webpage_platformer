import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryBody, createPlayer, dropThrough, respawnOnPlatform, stepBody } from '../src/physics';
import { MOTION, type Platform } from '../src/types';

const ledges: Platform[] = [
  { id: 'upper', x: 0, y: 100, width: 200 },
  { id: 'lower', x: 0, y: 180, width: 200 },
];

function standing(platform: Platform, x = 20) {
  const body = createPlayer(x, (platform.previousY ?? platform.y) - MOTION.height);
  body.grounded = true;
  body.platformId = platform.id;
  return body;
}

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
  body.vy = 2000;
  body.vx = 1000;
  stepBody(body, ledges, 0.1);
  assert.equal(body.platformId, 'upper');
  assert.equal(body.y, 70);
});

test('dropping skips the supporting top and lands on the next lower top', () => {
  const body = standing(ledges[0]);
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

test('standing riders retain their horizontal offset while moving independently', () => {
  const platform: Platform = { id: 'belt', previousX: 0, x: 80, y: 100, width: 200 };
  const body = standing(platform);
  body.vx = 40;
  stepBody(body, [platform], 0.1);
  assert.equal(body.x, 104);
  assert.equal(body.y, 70);
  assert.equal(body.platformId, platform.id);
  assert.equal(body.vy, 0);
});

for (const destination of [20, 180]) {
  test(`vertical rider follows a top moving from 100 to ${destination}`, () => {
    const platform: Platform = { id: 'lift', x: 0, previousY: 100, y: destination, width: 200 };
    const body = standing(platform);
    stepBody(body, [platform], 0.1);
    assert.equal(body.y + body.height, destination);
    assert.equal(body.grounded, true);
    assert.equal(body.platformId, platform.id);
  });
}

for (const destinationMotion of [0, -40]) {
  test(`a descending carrier hands off to a ${destinationMotion ? 'moving' : 'stationary'} lower ledge at impact`, () => {
    const carrier: Platform = { id: 'carrier', previousX: 0, x: 80, previousY: 100, y: 180, width: 200 };
    const lower: Platform = { id: 'lower', previousX: 0, x: destinationMotion, y: 140, width: 200 };
    const body = standing(carrier);
    body.vx = 24;
    stepBody(body, [carrier, lower], MOTION.step);
    // Supported feet move from 100 to 180, meeting the lower top halfway through the step.
    const expectedX = 20 + body.vx * MOTION.step + 80 / 2 + destinationMotion / 2;
    assert.ok(Math.abs(body.x - expectedX) < 1e-10);
    assert.equal(body.y + body.height, lower.y);
    assert.equal(body.platformId, lower.id);
    assert.equal(body.grounded, true);
    assert.equal(body.vy, 0);

    carrier.previousX = carrier.x;
    carrier.x += 80;
    carrier.previousY = carrier.y;
    carrier.y += 80;
    lower.previousX = lower.x;
    lower.x += destinationMotion;
    const handoffX = body.x;
    stepBody(body, [carrier, lower], MOTION.step);
    assert.ok(Math.abs(body.x - (handoffX + body.vx * MOTION.step + destinationMotion)) < 1e-10);
    assert.equal(body.y + body.height, lower.y);
    assert.equal(body.platformId, lower.id);
  });
}

test('a rising top lifts a rider off stationary support within fractional geometry bounds', () => {
  const support: Platform = { id: 'support', x: 0, y: 100, width: 200 };
  const lift: Platform = { id: 'lift', previousX: -40, x: 40, previousY: 180, y: 20, width: 200 };
  const body = standing(support);
  stepBody(body, [support, lift], MOTION.step, 0.25, 0.75);
  // This interval moves the lift from y=140 to y=60; it reaches supported feet at t=1/2.
  assert.equal(body.x, 40);
  assert.equal(body.y + body.height, 60);
  assert.equal(body.platformId, lift.id);
  assert.equal(body.grounded, true);
  assert.equal(body.vy, 0);
});

test('an upward moving top sweeps into feet without tunneling', () => {
  const platform: Platform = { id: 'rise', x: 0, previousY: 200, y: 20, width: 200 };
  const body = createPlayer(20, 70);
  stepBody(body, [platform], 0.1);
  assert.equal(body.y, -10);
  assert.equal(body.platformId, 'rise');
});

test('relative crossing can catch an ascending airborne body above a faster rising top', () => {
  const platform: Platform = { id: 'rise', x: 0, previousY: 200, y: 20, width: 200 };
  const body = createPlayer(20, 70);
  body.vy = -300;
  stepBody(body, [platform], 0.1);
  assert.equal(body.y, -10);
  assert.equal(body.platformId, 'rise');
});

test('a falling body catches a downward moving top using relative travel', () => {
  const platform: Platform = { id: 'descend', x: 0, previousY: 100, y: 160, width: 200 };
  const body = createPlayer(20, 0);
  body.vy = 2000;
  stepBody(body, [platform], 0.1);
  assert.equal(body.y, 130);
  assert.equal(body.platformId, 'descend');
});

test('a top descending faster than falling feet does not create a landing', () => {
  const platform: Platform = { id: 'descend', x: 0, previousY: 100, y: 300, width: 200 };
  const body = createPlayer(20, 0);
  body.vy = 100;
  stepBody(body, [platform], 0.1);
  assert.equal(body.grounded, false);
  assert.equal(body.platformId, undefined);
});

test('ascending through the underside remains one-way even when the top moves', () => {
  const platform: Platform = { id: 'lift', x: 0, previousY: 100, y: 80, width: 200 };
  const body = createPlayer(20, 110);
  body.vy = -MOTION.jump;
  stepBody(body, [platform], 0.1);
  assert.equal(body.grounded, false);
  assert.equal(body.platformId, undefined);
  assert.equal(body.y, 64);
});

test('earliest relative crossing wins even if its final top is lower', () => {
  const platforms: Platform[] = [
    { id: 'later', x: 0, previousY: 120, y: 100, width: 200 },
    { id: 'first', x: 0, previousY: 40, y: 140, width: 200 },
  ];
  const body = createPlayer(20, 0);
  body.vy = 1000;
  stepBody(body, platforms, 0.1);
  assert.equal(body.platformId, 'first');
  assert.equal(body.y, 110);
});

test('horizontal overlap is measured at impact, then remaining motion carries the landing', () => {
  const platform: Platform = { id: 'slide', previousX: 100, x: 0, y: 100, width: 100 };
  const body = createPlayer(50, 0);
  body.vy = 1000;
  stepBody(body, [platform], 0.1);
  const impact = 70 / 116;
  assert.equal(body.platformId, 'slide');
  assert.ok(Math.abs(body.x - (50 - 100 * (1 - impact))) < 1e-10);
  assert.equal(body.y, 70);
});

test('interpolated width rejects overlap that appears only after the top crossing', () => {
  const platform: Platform = { id: 'grow', x: 100, y: 100, previousWidth: 10, width: 200 };
  const body = createPlayer(260, 0);
  body.vy = 1000;
  stepBody(body, [platform], 0.1);
  assert.equal(body.grounded, false);
});

test('jumping detaches from horizontal motion and a faster rising former support', () => {
  const platform: Platform = { id: 'lift', previousX: 0, x: 80, previousY: 100, y: 0, width: 200 };
  const body = standing(platform);
  body.vy = -MOTION.jump;
  body.grounded = false; // The input handler clears contact before the physics tick.
  stepBody(body, [platform], 0.1);
  assert.equal(body.x, 20);
  assert.equal(body.y, 24);
  assert.equal(body.grounded, false);
  assert.equal(body.platformId, undefined);
  assert.equal(body.vy, -460);
});

test('drop detaches from a rising support while lower one-way tops remain active', () => {
  const rising: Platform = { id: 'lift', previousX: 0, x: 80, previousY: 100, y: 0, width: 200 };
  const lower: Platform = { id: 'lower', x: 0, y: 180, width: 200 };
  const body = standing(rising);
  assert.equal(dropThrough(body), true);
  stepBody(body, [rising, lower], 0.1);
  assert.equal(body.x, 20);
  assert.equal(body.y, 95);
  assert.equal(body.grounded, false);
  // The next geometry frame has committed the lift's previous bounds.
  rising.previousX = rising.x;
  rising.previousY = rising.y;
  for (let i = 0; i < 120; i++) stepBody(body, [rising, lower], MOTION.step);
  assert.equal(body.platformId, 'lower');
  assert.equal(body.y, 150);
});

test('a detached jump can land on its former support after ascent ends', () => {
  const body = standing(ledges[0]);
  body.vy = -MOTION.jump;
  body.grounded = false;
  let rose = false;
  for (let i = 0; i < 120; i++) {
    stepBody(body, ledges, MOTION.step);
    if (body.y < 70) rose = true;
  }
  assert.equal(rose, true);
  assert.equal(body.platformId, 'upper');
  assert.equal(body.y, 70);
});

test('fractional fixed substeps carry exactly one geometry-frame delta', () => {
  const platform: Platform = { id: 'diagonal', previousX: 0, x: 120, previousY: 100, y: 40, width: 200 };
  const whole = standing(platform);
  const split = standing(platform);
  whole.vx = split.vx = 24;
  stepBody(whole, [platform], 0.1);
  for (let i = 0; i < 4; i++) stepBody(split, [platform], 0.025, i / 4, (i + 1) / 4);
  assert.ok(Math.abs(split.x - whole.x) < 1e-10);
  assert.equal(split.y, whole.y);
  assert.equal(split.vy, whole.vy);
  assert.equal(split.platformId, whole.platformId);
  assert.equal(platform.previousX, 0);
  assert.equal(platform.previousY, 100);
  platform.previousX = platform.x;
  platform.previousY = platform.y;
  split.vx = 0;
  const settledX = split.x;
  stepBody(split, [platform], 0.1);
  assert.equal(split.x, settledX);
  assert.equal(split.y, 10);
  assert.equal(split.grounded, true);
});

test('paused rider transport follows both axes without gravity or velocity integration', () => {
  const platform: Platform = { id: 'paused', previousX: 0, x: 60, previousY: 100, y: 30, width: 200 };
  const body = standing(platform);
  body.vx = 100;
  assert.equal(carryBody(body, [platform], 0, 0.5), true);
  assert.equal(carryBody(body, [platform], 0.5, 1), true);
  assert.equal(body.x, 80);
  assert.equal(body.y, 0);
  assert.equal(body.vx, 100);
  assert.equal(body.vy, 0);
  assert.equal(body.grounded, true);
  platform.previousX = platform.x;
  platform.previousY = platform.y;
  assert.equal(carryBody(body, [platform]), true);
  assert.equal(body.x, 80);
  assert.equal(body.y, 0);
});

test('paused transport cannot land an airborne body or restore a missing support', () => {
  const platform: Platform = { id: 'paused', previousX: 0, x: 60, y: 100, width: 200 };
  const airborne = createPlayer(20, 70);
  assert.equal(carryBody(airborne, [platform]), false);
  assert.equal(airborne.x, 20);
  assert.equal(airborne.y, 70);
  const removed = standing(platform);
  assert.equal(carryBody(removed, []), false);
  assert.equal(removed.grounded, false);
  assert.equal(removed.platformId, undefined);
});

test('paused jump and drop stay detached instead of receiving rider motion', () => {
  const platform: Platform = { id: 'paused', previousX: 0, x: 60, previousY: 100, y: 0, width: 200 };
  const jumping = standing(platform);
  jumping.vy = -MOTION.jump;
  assert.equal(carryBody(jumping, [platform]), false);
  assert.equal(jumping.x, 20);
  assert.equal(jumping.y, 70);
  const dropping = standing(platform);
  dropThrough(dropping);
  assert.equal(carryBody(dropping, [platform]), false);
  assert.equal(dropping.x, 20);
  assert.equal(dropping.y, 73);
});

test('page recovery uses the last surface current position and clears drop detachment', () => {
  const platform: Platform = { id: 'last-image', x: 0, y: 100, width: 200 };
  const body = standing(platform);
  dropThrough(body);
  body.y = 3000;
  body.vx = 100;
  body.vy = 2000;
  platform.x = 200;
  platform.y = 300;
  respawnOnPlatform(body, platform, 40);
  assert.equal(body.x, 240);
  assert.equal(body.y, 270);
  assert.equal(body.vx, 0);
  assert.equal(body.vy, 0);
  stepBody(body, [platform], MOTION.step);
  assert.equal(body.grounded, true);
  assert.equal(body.platformId, 'last-image');
  assert.equal(body.y, 270);
});

test('recovery stays within a previous platform that has become narrower', () => {
  const body = createPlayer(500, 3000);
  const platform: Platform = { id: 'resized', x: 200, y: 300, width: 80 };
  respawnOnPlatform(body, platform, 180);
  assert.ok(body.x >= platform.x && body.x + body.width <= platform.x + platform.width);
  assert.equal(body.y + body.height, platform.y);
});
