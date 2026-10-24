import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPickups, updatePickups } from '../src/collectibles';
import { encounterForUrl } from '../src/encounters';
import { createPlayer, stepBody } from '../src/physics';
import { MOTION, type Platform } from '../src/types';

const encounter = encounterForUrl('https://example.com/?q=native+platforms');

function standing(platform: Platform, x = platform.x + 4) {
  const body = createPlayer(x, platform.y - MOTION.height);
  body.grounded = true;
  body.platformId = platform.id;
  return body;
}

/** Exercise the real fixed-step physics with base jump and ordinary full-speed/release controls. */
function jumpTo(source: Platform, target: Platform, platforms: Platform[]): void {
  const half = MOTION.width / 2;
  const targetMiddle = target.x + target.width / 2;
  const launch = Math.max(source.x + half + 3, Math.min(targetMiddle, source.x + source.width - half - 3));
  const landing = Math.max(target.x + half + 3, Math.min(launch, target.x + target.width - half - 3));
  const body = standing(source, launch - half);
  body.vy = -MOTION.jump;
  for (let frame = 0; frame < 240; frame++) {
    const delta = landing - body.x - half;
    body.vx = Math.abs(delta) > MOTION.speed * MOTION.step ? Math.sign(delta) * MOTION.speed : 0;
    stepBody(body, platforms, MOTION.step);
    if (body.grounded) break;
  }
  assert.equal(body.platformId, target.id, `base jump must land on ${target.id}`);
}

test('three distinct coins stay physically collectable on one narrow native surface', () => {
  const platform: Platform = { id: 'native-text', x: 100, y: 500, width: 30 };
  const body = standing(platform);
  const pickups = planPickups(encounter, [platform], body);
  assert.equal(pickups.length, 3);
  assert.equal(new Set(pickups.map(pickup => `${pickup.x},${pickup.y}`)).size, 3);
  assert.ok(pickups.every(pickup => pickup.platformId === platform.id));
  const reached = new Set<string>();
  const collect = () => {
    for (const pickup of pickups) {
      if (pickup.x >= body.x && pickup.x <= body.x + body.width
        && pickup.y >= body.y && pickup.y <= body.y + body.height) reached.add(pickup.id);
    }
  };
  collect();
  assert.ok(reached.has(pickups[0]!.id), 'first coin is reachable without even leaving the spawn');
  body.vy = -MOTION.jump;
  for (let frame = 0; frame < 110; frame++) {
    stepBody(body, [platform], MOTION.step);
    collect();
  }
  assert.equal(reached.size, 3, 'a base jump collects every staggered coin without equipment');
  assert.equal(body.platformId, platform.id);
});

test('wide sparse terrain uses separated walkable positions without creating terrain', () => {
  const platform: Platform = { id: 'wide', x: 1000, y: 900, width: 500 };
  const original = { ...platform };
  const pickups = planPickups(encounter, [platform], standing(platform, 1230));
  assert.equal(pickups.length, 3);
  assert.equal(new Set(pickups.map(pickup => pickup.x)).size, 3);
  for (const pickup of pickups) {
    assert.ok(pickup.x >= platform.x + MOTION.width / 2);
    assert.ok(pickup.x <= platform.x + platform.width - MOTION.width / 2);
    assert.ok(pickup.y >= platform.y - MOTION.height, 'walking across the platform reaches these coins');
  }
  assert.deepEqual(platform, original);
});

test('a directed native jump chain supplies distinct reachable surfaces', () => {
  const platforms: Platform[] = [
    { id: 'spawn', x: 0, y: 500, width: 80 },
    { id: 'middle', x: 170, y: 450, width: 80 },
    { id: 'finish', x: 320, y: 400, width: 80 },
  ];
  const pickups = planPickups(encounter, platforms, standing(platforms[0]!));
  assert.deepEqual(pickups.map(pickup => pickup.platformId), ['spawn', 'middle', 'finish']);
  jumpTo(platforms[0]!, platforms[1]!, platforms);
  jumpTo(platforms[1]!, platforms[2]!, platforms);
  assert.deepEqual(planPickups(encounter, [...platforms].reverse(), standing(platforms[0]!)), pickups);
});

test('base jump height boundary rejects an unreachable top instead of requiring boots', () => {
  const spawn: Platform = { id: 'spawn', x: 0, y: 500, width: 120 };
  const unreachable: Platform = { id: 'above-base-apex', x: 0, y: 379, width: 120 };
  const pickups = planPickups(encounter, [spawn, unreachable], standing(spawn));
  assert.equal(pickups.length, 3);
  assert.ok(pickups.every(pickup => pickup.platformId === spawn.id));
  const reachable: Platform = { id: 'safe-rise', x: 0, y: 400, width: 120 };
  const safe = planPickups(encounter, [spawn, reachable], standing(spawn));
  assert.ok(safe.some(pickup => pickup.platformId === reachable.id));
  jumpTo(spawn, reachable, [spawn, reachable]);
});

test('same-height horizontal boundary reserves margin inside the real ballistic range', () => {
  const spawn: Platform = { id: 'spawn', x: 0, y: 500, width: 60 };
  const safe: Platform = { id: 'within-range', x: 205, y: 500, width: 60 };
  const tooFar: Platform = { id: 'outside-range', x: 220, y: 500, width: 60 };
  assert.ok(planPickups(encounter, [spawn, safe], standing(spawn)).some(pickup => pickup.platformId === safe.id));
  jumpTo(spawn, safe, [spawn, safe]);
  assert.ok(planPickups(encounter, [spawn, tooFar], standing(spawn)).every(pickup => pickup.platformId === spawn.id));
});

test('descending jump interception does not pretend a lower overlapping top is directly reachable', () => {
  const spawn: Platform = { id: 'upper', x: 0, y: 500, width: 120 };
  const lower: Platform = { id: 'underneath', x: 0, y: 650, width: 120 };
  const pickups = planPickups(encounter, [spawn, lower], standing(spawn));
  assert.ok(pickups.every(pickup => pickup.platformId === spawn.id), 'the launch surface catches every proposed descending arc');
});

test('coins retain stable fractional anchors through real platform movement and resize', () => {
  const platform: Platform = { id: 'moving-native', x: 100, y: 500, width: 300 };
  const pickups = planPickups(encounter, [platform], standing(platform));
  const originals = pickups.map(pickup => ({ ...pickup }));
  platform.x += 80;
  platform.y -= 35;
  updatePickups(pickups, [platform]);
  for (let index = 0; index < pickups.length; index++) {
    const pickup = pickups[index]!;
    const original = originals[index]!;
    assert.equal(pickup.x, original.x + 80);
    assert.equal(pickup.y, original.y - 35);
    assert.equal(pickup.id, original.id);
    assert.equal(pickup.fraction, original.fraction);
  }
  platform.width = 600;
  updatePickups(pickups, [platform]);
  for (const pickup of pickups) {
    const ratio = (pickup.x - platform.x - MOTION.width / 2 - 3) / (platform.width - MOTION.width - 6);
    assert.ok(Math.abs(ratio - pickup.fraction) < 1e-12);
    assert.equal(pickup.y, platform.y - pickup.lift);
  }
  const retained = pickups.map(pickup => ({ ...pickup }));
  updatePickups(pickups, []);
  assert.deepEqual(pickups, retained, 'temporary offscreen source absence must not erase or re-anchor the plan');
});

test('planning has a bounded local graph and keeps the actual supporting surface', () => {
  const spawn: Platform = { id: 'retained-spawn', x: 0, y: 1000, width: 30 };
  const distant = Array.from({ length: 500 }, (_, index): Platform => ({
    id: `unreachable-${index}`, x: 10000 + index * 500, y: 1000, width: 100,
  }));
  const pickups = planPickups(encounter, [...distant, spawn], standing(spawn));
  assert.equal(pickups.length, 3);
  assert.ok(pickups.every(pickup => pickup.platformId === spawn.id));
  assert.deepEqual(planPickups(encounter, distant, standing(spawn)), []);
  assert.deepEqual(planPickups(encounter, [], standing(spawn)), []);
});
