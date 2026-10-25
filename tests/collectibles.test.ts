import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PickupIndex, planPickups, updatePickups } from '../src/progression/collectibles';
import { eligibleLootPlatform, encounterForPlatform } from '../src/progression/encounters';
import { createPlayer, stepBody } from '../src/engine/physics';
import { MOTION, type Platform } from '../src/engine/types';
import type { CoinPickup, EquipmentPickup, PagePickup } from '../src/progression/progression-types';
import { setSurfaceMetadata } from '../src/page/surface-metadata';
import { worldEquipmentId } from '../src/progression/equipment-id';

const URL = 'https://example.com/native-surfaces';

test('video sources never receive coins or equipment', () => {
  const video = { tagName: 'VIDEO', querySelector: () => null } as unknown as Element;
  const videoPlatform: Platform = { id: 'video', logicalKey: 'video-content', x: 0, y: 500, width: 640 };
  setSurfaceMetadata(videoPlatform, video, false);
  const encounter = {
    ...encounterForPlatform(URL, videoPlatform.logicalKey!),
    equipment: {
      id: 'video-equipment', name: 'Video boots', slot: 'boots' as const, rarity: 'rare' as const,
      jumpMultiplier: 1.2, description: 'Should never appear inside a video.',
    },
  };
  assert.equal(eligibleLootPlatform(videoPlatform), false);
  assert.deepEqual(planPickups([encounter], [videoPlatform]), []);

  const wrapper = { tagName: 'DIV', querySelector: (selector: string) => selector === 'video' ? video : null } as unknown as Element;
  const wrappedPlatform: Platform = { ...videoPlatform, id: 'video-wrapper', logicalKey: 'wrapped-video' };
  setSurfaceMetadata(wrappedPlatform, wrapper, false);
  assert.equal(eligibleLootPlatform(wrappedPlatform), false);
  assert.deepEqual(planPickups([encounter], [wrappedPlatform]), []);
});

function sevenCoinKey(): string {
  for (let index = 0; index < 100; index++) {
    const key = `seven:${index}`;
    if (encounterForPlatform(URL, key).coinCount === 7) return key;
  }
  throw new Error('Expected a seven-coin platform seed.');
}

function coinAt(id: string, x: number, y: number): CoinPickup {
  return {
    kind: 'coin', id, index: 0, logicalKey: id, platformId: id,
    fraction: 0.5, lift: 18, x, y, available: true,
  };
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
  const anchors = pickups.map(pickup => [pickup.id, pickup.platformId, pickup.x, pickup.y]);
  const index = new PickupIndex();
  const output: PagePickup[] = [];
  index.update(pickups);
  const selected = platforms.find(platform => platform.id === pickups[0]!.platformId)!;
  const anchorView = { x: selected.x, y: 0, width: selected.width, height: 300 };
  index.query(anchorView, output);
  assert.deepEqual(new Set(output), new Set(pickups));
  index.query({ x: 2000, y: 0, width: 100, height: 300 }, output);
  assert.deepEqual(output, []);
  updatePickups(pickups, [...platforms].reverse());
  index.update(pickups);
  index.query(anchorView, output);
  assert.deepEqual(new Set(output), new Set(pickups));
  assert.deepEqual(pickups.map(pickup => [pickup.id, pickup.platformId, pickup.x, pickup.y]), anchors);
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

test('viewport queries return every visible reward without a character-dependent cap', () => {
  const platforms: Platform[] = Array.from({ length: 24 }, (_, index) => ({
    id: `surface:${index}`, logicalKey: `content:${index}`,
    x: index % 6 * 140 + (index >= 12 ? 10000 : 0),
    y: 180 + Math.floor(index % 12 / 6) * 160, width: 100,
  }));
  const encounters = platforms.map(platform => encounterForPlatform(URL, platform.logicalKey!));
  const pickups = planPickups(encounters, platforms);
  const index = new PickupIndex();
  const output: PagePickup[] = [];
  index.update(pickups);
  const viewport = { x: 0, y: 0, width: 900, height: 600 };
  const visible = pickups.filter(pickup => pickup.x < 900);
  const offscreen = pickups.filter(pickup => pickup.x > 10000);
  assert.ok(visible.filter(pickup => pickup.kind === 'coin').length > 24);
  index.query(viewport, output);
  assert.deepEqual(new Set(output), new Set(visible));
  const anchors = new Map(output.map(pickup => [pickup.id, [pickup.x, pickup.y]]));
  index.query({ ...viewport, x: 10000 }, output);
  assert.deepEqual(new Set(output), new Set(offscreen));
  assert.ok(pickups.every(pickup => pickup.available));
  // Neither a different query nor an unchanged frame rematerializes the rewards.
  index.update(pickups);
  index.query(viewport, output);
  assert.deepEqual(new Set(output), new Set(visible));
  assert.deepEqual(new Map(output.map(pickup => [pickup.id, [pickup.x, pickup.y]])), anchors);
  index.query({ ...viewport, x: -10000 }, output);
  assert.deepEqual(output, []);
});

test('spatial queries include touching sprite edges across positive and negative cell boundaries', () => {
  const gear: EquipmentPickup = {
    kind: 'equipment', id: 'gear', encounterId: 'gear-encounter', logicalKey: 'gear',
    platformId: 'gear', fraction: 0.5, lift: 14, x: 245, y: 256, available: true,
    equipment: {
      id: 'gear', name: 'Boots', slot: 'boots', rarity: 'rare',
      jumpMultiplier: 1.2, description: 'Jump boots',
    },
  };
  const touching = [
    coinAt('left', 248, 270), coinAt('right', 296, 270),
    coinAt('top', 270, 248), coinAt('bottom', 270, 296),
    coinAt('corner', 248, 248), gear,
  ];
  const outside = [
    coinAt('past-left', 247.99, 270), coinAt('past-right', 296.01, 270),
    coinAt('past-top', 270, 247.99), coinAt('past-bottom', 270, 296.01),
    coinAt('coin-not-gear', 245, 256), { ...gear, id: 'past-gear', x: 244.99 },
  ];
  const negative = [coinAt('negative-left', -264, -256), coinAt('negative-right', -248, -256)];
  const index = new PickupIndex();
  const output: PagePickup[] = [];
  index.update([...touching, ...outside, ...negative]);
  index.query({ x: 256, y: 256, width: 32, height: 32 }, output);
  assert.deepEqual(new Set(output), new Set(touching));
  index.query({ x: -256, y: -256, width: 0, height: 0 }, output);
  assert.deepEqual(new Set(output), new Set(negative));
  index.query({ x: -300, y: -300, width: 1000, height: 1000 }, output);
  assert.equal(output.length, touching.length + outside.length + negative.length);
  assert.equal(new Set(output).size, output.length);
});

test('spatial memberships follow movement, availability, replacement, and removal', () => {
  const pickup = coinAt('moving', 255, 255);
  const index = new PickupIndex();
  const output: PagePickup[] = [];
  const oldLocation = { x: 240, y: 240, width: 20, height: 20 };
  index.update([pickup]);
  index.query(oldLocation, output);
  assert.deepEqual(output, [pickup]);
  pickup.x = 257;
  pickup.y = 257;
  index.update([pickup]);
  index.query(oldLocation, output);
  assert.deepEqual(output, [pickup]);
  pickup.x = 310;
  pickup.y = 310;
  index.update([pickup]);
  index.query(oldLocation, output);
  assert.deepEqual(output, []);
  index.query({ x: 310, y: 310, width: 1, height: 1 }, output);
  assert.deepEqual(output, [pickup]);
  pickup.x = -300;
  pickup.y = -300;
  index.update([pickup]);
  index.query({ x: 310, y: 310, width: 1, height: 1 }, output);
  assert.deepEqual(output, []);
  const newLocation = { x: -300, y: -300, width: 1, height: 1 };
  index.query(newLocation, output);
  assert.deepEqual(output, [pickup]);
  pickup.available = false;
  index.query(newLocation, output);
  assert.deepEqual(output, []);
  index.update([pickup]);
  index.query(newLocation, output);
  assert.deepEqual(output, []);
  const replacement = { ...pickup, available: true };
  index.update([replacement]);
  index.query(newLocation, output);
  assert.deepEqual(output, [replacement]);
  assert.equal(output[0], replacement);
  index.update([]);
  index.query(newLocation, output);
  assert.deepEqual(output, []);
});

test('source retirement and collected rewards leave queries while surviving anchors stay stable', () => {
  const platform: Platform = { id: 'original', logicalKey: 'retiring-content', x: 100, y: 400, width: 200 };
  const encounter = encounterForPlatform(URL, platform.logicalKey!);
  const pickups = planPickups([encounter], [platform]);
  const anchors = pickups.map(pickup => [pickup.id, pickup.x, pickup.y]);
  const index = new PickupIndex();
  const output: PagePickup[] = [];
  const viewport = { x: 0, y: 0, width: 1000, height: 600 };
  index.update(pickups);
  index.query(viewport, output);
  assert.deepEqual(new Set(output), new Set(pickups));
  updatePickups(pickups, []);
  index.update(pickups);
  index.query(viewport, output);
  assert.equal(output.length, 0);
  updatePickups(pickups, [{ ...platform, id: 'replacement' }]);
  index.update(pickups);
  index.query(viewport, output);
  assert.deepEqual(new Set(output), new Set(pickups));
  assert.deepEqual(pickups.map(pickup => [pickup.id, pickup.x, pickup.y]), anchors);
  const collected = new Set([pickups.find(pickup => pickup.kind === 'coin')!.id]);
  const remaining = planPickups([encounter], [platform], pickups, collected);
  index.update(remaining);
  index.query(viewport, output);
  assert.deepEqual(new Set(output), new Set(remaining));
  assert.ok(output.every(pickup => !collected.has(pickup.id)));
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
  assert.equal(gear[0]!.id, worldEquipmentId(encounter.id));
  assert.equal(gear[0]!.platformId, platform.id);
  assert.ok(gear[0]!.y >= platform.y - MOTION.height && gear[0]!.y < platform.y);
  const coins = initial.filter(pickup => pickup.kind === 'coin');
  const claimedCoins = new Set(coins.map(pickup => pickup.id));
  assert.deepEqual(planPickups([encounter], [platform], initial, claimedCoins).map(pickup => pickup.id), [gear[0]!.id]);
  const claimedGear = new Set([encounter.id]);
  assert.deepEqual(planPickups([encounter], [platform], initial, claimedCoins, claimedGear), []);
  assert.ok(planPickups([encounter], [platform], initial, undefined, claimedGear).every(pickup => pickup.kind === 'coin'));
});

test('identical boots from different floor drops remain separate pickups even if already owned', () => {
  let encounter;
  for (let i = 0; i < 10000; i++) {
    const candidate = encounterForPlatform(URL, `duplicate-gear:${i}`);
    if (candidate.equipment) { encounter = candidate; break; }
  }
  assert.ok(encounter?.equipment);
  const other = { ...encounter, id: 'encounter-v2:second-drop', logicalKey: 'second-drop' };
  const platforms: Platform[] = [encounter, other].map((source, i) => ({
    id: `floor:${i}`, logicalKey: source.logicalKey, x: i * 300, y: 500, width: 200,
  }));
  const planned = planPickups([encounter, other], platforms, [], undefined, new Set([encounter.equipment.id]));
  const gear = planned.filter(pickup => pickup.kind === 'equipment');
  assert.equal(gear.length, 2);
  assert.notEqual(gear[0]!.id, gear[1]!.id);
  assert.equal(gear[0]!.equipment.id, gear[1]!.equipment.id);
  const remaining = planPickups([encounter, other], platforms, planned, undefined, new Set([encounter.id]));
  assert.deepEqual(remaining.filter(pickup => pickup.kind === 'equipment').map(pickup => pickup.id),
    [worldEquipmentId(other.id)]);
});
