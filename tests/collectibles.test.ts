import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ACTIVE_PICKUPS, planPickups, selectActivePickups, updatePickups } from '../src/progression/collectibles';
import { encounterForPlatform } from '../src/progression/encounters';
import { createPlayer, stepBody } from '../src/engine/physics';
import { MOTION, type Platform } from '../src/engine/types';

const URL = 'https://example.com/native-surfaces';

function sevenCoinKey(): string {
  for (let index = 0; index < 100; index++) {
    const key = `seven:${index}`;
    if (encounterForPlatform(URL, key).coinCount === 7) return key;
  }
  throw new Error('Expected a seven-coin platform seed.');
}

/** Witness every pickup using real base-jump integration from its own assigned native surface. */
function collectFromSurface(platform: Platform): void {
  const encounter = encounterForPlatform(URL, platform.logicalKey!);
  const pickups = planPickups([encounter], [platform]).filter(pickup => pickup.kind === 'coin');
  assert.equal(pickups.length, encounter.coinCount);
  assert.equal(new Set(pickups.map(pickup => `${pickup.x},${pickup.y}`)).size, encounter.coinCount);
  for (const pickup of pickups) {
    const body = createPlayer(pickup.x - MOTION.width / 2, platform.y - MOTION.height);
    body.grounded = true;
    body.platformId = platform.id;
    let collected = false;
    const collect = () => {
      if (pickup.x >= body.x && pickup.x <= body.x + body.width
        && pickup.y >= body.y && pickup.y <= body.y + body.height) collected = true;
    };
    collect();
    body.vy = -MOTION.jump;
    body.grounded = false;
    for (let frame = 0; frame < 110; frame++) {
      stepBody(body, [platform], MOTION.step);
      collect();
    }
    assert.ok(collected, `base jump must reach coin ${pickup.index} on width ${platform.width}`);
    assert.equal(body.platformId, platform.id);
  }
}

test('all seven distinct coins are reachable on even the narrowest eligible native top', () => {
  const key = sevenCoinKey();
  for (const width of [6, 12, 22, 30, 80, 500]) {
    collectFromSurface({ id: 'native', logicalKey: key, x: 100, y: 500, width });
  }
});

test('each logical platform has its own complete reward set without spawn or position dependence', () => {
  const platforms: Platform[] = [
    { id: 'lower', logicalKey: 'lower-content', x: 0, y: 900, width: 60 },
    { id: 'upper', logicalKey: 'upper-content', x: 9000, y: 100, width: 300 },
  ];
  const encounters = platforms.map(platform => encounterForPlatform(URL, platform.logicalKey!));
  const pickups = planPickups(encounters, platforms);
  assert.equal(pickups.filter(pickup => pickup.kind === 'coin').length,
    encounters.reduce((total, encounter) => total + encounter.coinCount, 0));
  assert.deepEqual(planPickups(encounters, [...platforms].reverse()), pickups);
  for (const platform of platforms) collectFromSurface(platform);
});

test('clones and wrapped segments share one claim set with deterministic representative selection', () => {
  const platforms: Platform[] = [
    { id: 'text-wide', logicalKey: 'paragraph', x: 10, y: 200, width: 180 },
    { id: 'text-wrap', logicalKey: 'paragraph', x: 10, y: 240, width: 60 },
    { id: 'clone', logicalKey: 'paragraph', x: 600, y: 200, width: 180 },
  ];
  const encounters = [encounterForPlatform(URL, 'paragraph')];
  const pickups = planPickups(encounters, platforms);
  assert.equal(encounters.length, 1);
  assert.equal(pickups.filter(pickup => pickup.kind === 'coin').length, encounters[0]!.coinCount);
  assert.deepEqual(planPickups(encounters, [...platforms].reverse()), pickups);
  const ids = pickups.map(pickup => pickup.id);
  updatePickups(pickups, [platforms[1]!]);
  assert.deepEqual(pickups.map(pickup => pickup.id), ids);
  assert.ok(pickups.every(pickup => pickup.platformId === 'text-wrap'));
});

test('runtime materialization retains claim identities while retiring absent and collected coins', () => {
  const first: Platform = { id: 'first', logicalKey: 'first-content', x: 0, y: 500, width: 80 };
  const second: Platform = { id: 'second', logicalKey: 'second-content', x: 300, y: 600, width: 30 };
  const encounters = [encounterForPlatform(URL, first.logicalKey!), encounterForPlatform(URL, second.logicalKey!)];
  const original = planPickups(encounters, [first]);
  const originalIds = original.map(pickup => pickup.id);
  const merged = planPickups(encounters, [first, second], original);
  assert.equal(merged.filter(pickup => pickup.kind === 'coin').length,
    encounters.reduce((count, encounter) => count + encounter.coinCount, 0));
  assert.ok(originalIds.every(id => merged.some(pickup => pickup.id === id)));
  assert.equal(new Set(merged.map(pickup => pickup.id)).size, merged.length);
  const absent = planPickups(encounters, [second], merged);
  assert.ok(absent.every(pickup => pickup.platformId === second.id));
  const collected = new Set([originalIds[0]!]);
  const returned = planPickups(encounters, [first], absent, collected);
  assert.deepEqual(returned.map(pickup => pickup.id), originalIds.slice(1));
  assert.deepEqual(planPickups(encounters, [], returned, collected), []);
});

test('movement, resize, disappearance, and runtime replacement change anchors without changing claims', () => {
  const platform: Platform = { id: 'moving', logicalKey: 'moving-content', x: 100, y: 500, width: 300 };
  const pickups = planPickups([encounterForPlatform(URL, platform.logicalKey!)], [platform]);
  const original = pickups.map(pickup => ({ ...pickup }));
  platform.x += 80;
  platform.y -= 35;
  updatePickups(pickups, [platform]);
  for (let index = 0; index < pickups.length; index++) {
    assert.equal(pickups[index]!.id, original[index]!.id);
    assert.equal(pickups[index]!.x, original[index]!.x + 80);
    assert.equal(pickups[index]!.y, original[index]!.y - 35);
  }
  platform.width = 6;
  updatePickups(pickups, [platform]);
  assert.equal(new Set(pickups.map(pickup => pickup.y)).size, pickups.length);
  const beforeAbsence = pickups.map(pickup => ({ ...pickup }));
  updatePickups(pickups, []);
  assert.ok(pickups.every(pickup => !pickup.available));
  assert.deepEqual(pickups.map(pickup => pickup.id), beforeAbsence.map(pickup => pickup.id));
  updatePickups(pickups, [{ ...platform, id: 'replacement' }]);
  assert.ok(pickups.every(pickup => pickup.available && pickup.platformId === 'replacement'));
  assert.deepEqual(pickups.map(pickup => pickup.id), original.map(pickup => pickup.id));
});

test('active coin work stays bounded and replenishes without rerolling rewards', () => {
  const platforms: Platform[] = Array.from({ length: 200 }, (_, index) => ({
    id: `surface:${index}`, logicalKey: `content:${index}`, x: index * 120, y: 500, width: 100,
  }));
  const encounters = platforms.map(platform => encounterForPlatform(URL, platform.logicalKey!));
  const pickups = planPickups(encounters, platforms);
  const player = { x: 0, y: 470, platformId: platforms.at(-1)!.id };
  const active = selectActivePickups(pickups, player);
  assert.equal(active.length, MAX_ACTIVE_PICKUPS);
  assert.equal(active.filter(pickup => pickup.kind === 'coin' && pickup.platformId === player.platformId).length,
    encounters.at(-1)!.coinCount);
  const originalIds = active.map(pickup => pickup.id);
  assert.deepEqual(selectActivePickups([...pickups].reverse(), player).map(pickup => pickup.id), originalIds);
  const claimed = new Set([active.find(pickup => pickup.kind === 'coin')!.id]);
  const remaining = planPickups(encounters, platforms, pickups, claimed);
  const replenished = selectActivePickups(remaining, player);
  assert.equal(replenished.length, MAX_ACTIVE_PICKUPS);
  assert.ok(replenished.every(pickup => !claimed.has(pickup.id)));
  assert.ok(replenished.some(pickup => !originalIds.includes(pickup.id)));
  const moved = selectActivePickups(remaining, { x: 5000, y: 470 });
  assert.equal(moved.length, MAX_ACTIVE_PICKUPS);
  assert.ok(moved.some(pickup => !replenished.some(previous => previous.id === pickup.id)));
  assert.deepEqual(selectActivePickups(remaining, player).map(pickup => pickup.id), replenished.map(pickup => pickup.id));
});

test('equipment is a separate ground-level pickup before any coin completion', () => {
  let encounter;
  for (let index = 0; index < 10000; index++) {
    const candidate = encounterForPlatform(URL, `physical-gear:${index}`);
    if (candidate.equipment) { encounter = candidate; break; }
  }
  assert.ok(encounter?.equipment);
  const platform: Platform = { id: 'gear-edge', logicalKey: encounter.logicalKey, x: 100, y: 500, width: 300 };
  const initial = planPickups([encounter, encounter], [platform]);
  const gear = initial.filter(pickup => pickup.kind === 'equipment');
  assert.equal(gear.length, 1);
  assert.equal(gear[0]!.id, encounter.equipment.id);
  assert.equal(gear[0]!.platformId, platform.id);
  assert.ok(gear[0]!.y >= platform.y - MOTION.height && gear[0]!.y < platform.y);
  const coins = initial.filter(pickup => pickup.kind === 'coin');
  const claimedCoins = new Set(coins.map(pickup => pickup.id));
  assert.deepEqual(planPickups([encounter], [platform], initial, claimedCoins).map(pickup => pickup.id), [gear[0]!.id]);
  const claimedGear = new Set([encounter.id]);
  assert.deepEqual(planPickups([encounter], [platform], initial, claimedCoins, claimedGear), []);
  assert.ok(planPickups([encounter], [platform], initial, undefined, claimedGear).every(pickup => pickup.kind === 'coin'));
});
