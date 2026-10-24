import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locatorPose, LOCATOR_DURATION } from '../src/rendering/player-locator';
import { createPlayer } from '../src/engine/physics';

test('locator approaches the player, shrinks, then fades and expires', () => {
  const player = createPlayer(400, 400);
  const start = locatorPose(player, 0, 0, 1000, 800, 0)!;
  const middle = locatorPose(player, 0, 0, 1000, 800, 450)!;
  const arrived = locatorPose(player, 0, 0, 1000, 800, 900)!;
  assert.ok(start.scale > middle.scale && middle.scale > arrived.scale);
  const distance = (pose: typeof start) => Math.hypot(player.x + player.width / 2 - pose.x, player.y + player.height / 2 - pose.y);
  assert.ok(distance(start) > distance(middle) && distance(middle) > distance(arrived));
  assert.ok(Math.abs(distance(arrived) - (Math.hypot(player.width, player.height) / 2 + 24)) < 1e-8);
  assert.equal(arrived.scale, 1);
  assert.equal(arrived.opacity, 1);
  assert.ok(locatorPose(player, 0, 0, 1000, 800, 2200)!.opacity < 1);
  assert.equal(locatorPose(player, 0, 0, 1000, 800, LOCATOR_DURATION), null);
  assert.equal(locatorPose(player, 0, 0, 1000, 800, Infinity), null);
});

test('locator follows player and scroll changes and points toward offscreen targets', () => {
  for (const [x, y] of [[-500, 300], [2000, 300], [400, -500], [400, 2000]]) {
    const player = createPlayer(x, y);
    const pose = locatorPose(player, 100, 50, 1000, 800, 900)!;
    assert.ok(pose.x >= 40 && pose.x <= 960);
    assert.ok(pose.y >= 40 && pose.y <= 760);
    const direction = pose.angle + Math.PI / 2;
    const dx = player.x + player.width / 2 - 100 - pose.x;
    const dy = player.y + player.height / 2 - 50 - pose.y;
    assert.ok(Math.abs(Math.cos(direction) * dy - Math.sin(direction) * dx) < 1e-8);
    assert.ok(Math.cos(direction) * dx + Math.sin(direction) * dy > 0);
  }
});

test('arrow moves around the sprite as scrolling changes its direction from screen center', () => {
  const player = createPlayer(800, 700);
  for (const [sx, sy] of [[0, 0], [600, 0], [600, 600], [0, 600]]) {
    const pose = locatorPose(player, sx, sy, 1000, 800, 900)!;
    const px = player.x + player.width / 2 - sx;
    const py = player.y + player.height / 2 - sy;
    const targetAngle = Math.atan2(py - 400, px - 500);
    assert.ok(Math.abs(pose.angle + Math.PI / 2 - targetAngle) < 1e-8);
    assert.equal(Math.sign(pose.x - px), -Math.sign(px - 500));
    assert.equal(Math.sign(pose.y - py), -Math.sign(py - 400));
  }
});

test('player at screen center has a finite visible marker', () => {
  const player = createPlayer(489, 385);
  const pose = locatorPose(player, 0, 0, 1000, 800, 900)!;
  assert.equal(pose.x, 500);
  assert.ok(pose.y < 385);
  assert.equal(pose.angle, 0);
});
