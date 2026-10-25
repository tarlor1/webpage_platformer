import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, encounterForPlatform } from '../src/progression/encounters';
import { collectCoin, collectEquipment, createPlayerState, equipItem, readPlayerState } from '../src/progression/player-state';
import type { PlayerState } from '../src/progression/progression-types';

const PAGE = 'https://example.com/article';
function keyWithEquipment(present: boolean): string {
  for (let index = 0; index < 10000; index++) {
    const key = `content:${index}`;
    if (Boolean(encounterForPlatform(PAGE, key).equipment) === present) return key;
  }
  throw new Error(`No platform with equipment=${present} found.`);
}
const rareKey = keyWithEquipment(true);
const ordinaryKey = keyWithEquipment(false);
const rareEncounter = encounterForPlatform(PAGE, rareKey);
const ownership = { encounterId: rareEncounter.id, equipment: rareEncounter.equipment! };
function completePlatform(key: string, state = createPlayerState(), url = PAGE): PlayerState {
  const encounter = encounterForPlatform(url, key);
  for (let index = 0; index < encounter.coinCount; index++) state = collectCoin(state, url, key, index).state;
  return state;
}

test('new profiles use v2 and start without free currency or equipment', () => {
  const state = createPlayerState();
  assert.equal(state.version, 2);
  assert.equal(state.revision, 0);
  assert.equal(state.coins, 0);
  assert.equal(state.xp, 0);
  assert.equal(state.level, 1);
  assert.deepEqual(state.inventory, []);
  assert.deepEqual(state.collectedCoins, []);
  assert.deepEqual(readPlayerState(undefined), state);
  assert.notEqual(createPlayerState().inventory, state.inventory);
});

test('one coin awards five currency and twenty XP without mutating its input', () => {
  const initial = createPlayerState();
  const before = structuredClone(initial);
  const result = collectCoin(initial, PAGE, rareKey, 0);
  assert.equal(result.duplicate, false);
  assert.equal(result.reward, null);
  assert.equal(result.state.coins, 5);
  assert.equal(result.state.xp, 20);
  assert.equal(result.state.level, 1);
  assert.equal(result.state.revision, 1);
  assert.deepEqual(result.state.collectedCoins, [coinId(encounterForPlatform(PAGE, rareKey), 0)]);
  assert.deepEqual(initial, before);
});

test('completing even a rare platform coin set never unlocks its equipment', () => {
  const encounter = encounterForPlatform(PAGE, rareKey);
  let state = createPlayerState();
  for (let index = 0; index < encounter.coinCount; index++) {
    const result = collectCoin(state, PAGE, rareKey, index);
    state = result.state;
    assert.equal(result.reward, null);
    assert.deepEqual(state.inventory, []);
    assert.deepEqual(state.claimedRewards, []);
  }
  assert.deepEqual(state.completedEncounters, [encounter.id]);
  assert.equal(state.coins, encounter.coinCount * 5);
  assert.equal(state.xp, encounter.coinCount * 20);
  assert.equal(collectCoin(state, PAGE, rareKey, 0).state, state);
});

test('equipment can be picked up with zero coins and is claimed once independently', () => {
  const encounter = encounterForPlatform(PAGE, rareKey);
  const initial = createPlayerState();
  const result = collectEquipment(initial, ownership);
  assert.equal(result.duplicate, false);
  assert.deepEqual(result.reward, encounter.equipment);
  assert.deepEqual(result.state.inventory, [encounter.equipment]);
  assert.deepEqual(result.state.claimedRewards, [encounter.id]);
  assert.deepEqual(result.state.completedEncounters, []);
  assert.deepEqual(result.state.collectedCoins, []);
  assert.equal(result.state.coins, 0);
  assert.equal(result.state.xp, 0);
  assert.equal(result.state.equippedItemId, null);
  assert.deepEqual(initial.inventory, []);
  const duplicate = collectEquipment(result.state, structuredClone(ownership));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state, result.state);
  assert.equal(duplicate.reward, null);
  for (const invalid of [null, {}, { ...ownership, encounterId: '' }, { ...ownership, equipment: null },
    { ...ownership, encounterId: 'unrelated' }, { ...ownership, equipment: { ...ownership.equipment, jumpMultiplier: 99 } }]) {
    assert.throws(() => collectEquipment(initial, invalid));
  }
  const beforeCoins = completePlatform(rareKey, result.state);
  const afterCoins = collectEquipment(completePlatform(rareKey), ownership).state;
  assert.deepEqual(beforeCoins, afterCoins);
});

test('a new logical key and a new meaningful URL each permit distinct coin sets on old pages', () => {
  const original = completePlatform(rareKey);
  const otherKey = collectCoin(original, PAGE, ordinaryKey, 0).state;
  const otherPath = collectCoin(otherKey, `${PAGE}/chapter`, rareKey, 0).state;
  assert.equal(otherKey.coins, original.coins + 5);
  assert.equal(otherPath.coins, original.coins + 10);
  assert.equal(new Set(otherPath.collectedCoins).size, otherPath.collectedCoins.length);
});

test('ordinary platform completion creates no equipment and retains independent progression', () => {
  const encounter = encounterForPlatform(PAGE, ordinaryKey);
  const state = completePlatform(ordinaryKey);
  assert.equal(encounter.equipment, null);
  assert.deepEqual(state.completedEncounters, [encounter.id]);
  assert.deepEqual(state.claimedRewards, []);
  assert.deepEqual(state.inventory, []);
  assert.equal(state.coins, encounter.coinCount * 5);
  assert.equal(state.level, 1 + Math.floor(state.xp / 100));
});

test('levels advance every hundred XP without spending currency', () => {
  let state = createPlayerState();
  for (let count = 1; count <= 30; count++) {
    state = collectCoin(state, PAGE, `level:${count}`, 0).state;
    assert.equal(state.xp, count * 20);
    assert.equal(state.coins, count * 5);
    assert.equal(state.level, 1 + Math.floor(count / 5));
    assert.equal(state.revision, count);
  }
});

test('invalid indices, logical keys and URLs leave earned progression unchanged', () => {
  const state = createPlayerState();
  for (const index of [-1, encounterForPlatform(PAGE, rareKey).coinCount, 100, 0.5, NaN, Infinity]) {
    assert.throws(() => collectCoin(state, PAGE, rareKey, index), /index/);
  }
  assert.throws(() => collectCoin(state, PAGE, '', 0), /logical/);
  assert.throws(() => collectCoin(state, 'file:///article', rareKey, 0), /HTTP/);
  assert.deepEqual(state, createPlayerState());
});

test('owned gear equips and unequips idempotently, and an unearned deterministic ID is rejected', () => {
  assert.throws(() => equipItem(createPlayerState(), encounterForPlatform(PAGE, rareKey).equipment!.id), /not owned/);
  const earned = collectEquipment(createPlayerState(), ownership).state;
  const id = earned.inventory[0]!.id;
  const equipped = equipItem(earned, id).state;
  assert.equal(equipped.equippedItemId, id);
  assert.equal(equipped.revision, earned.revision + 1);
  assert.equal(equipped.coins, earned.coins);
  assert.equal(equipped.xp, earned.xp);
  assert.equal(equipped.inventory, earned.inventory);
  assert.equal(equipItem(equipped, id).state, equipped);
  const unequipped = equipItem(equipped, null).state;
  assert.equal(unequipped.equippedItemId, null);
  assert.equal(equipItem(unequipped, null).state, unequipped);
});

test('v1 migration is idempotent and preserves exact legacy inventory, equipment and claim history', () => {
  const boots = { id: 'encounter-v1:legacy:equipment:boots', name: 'Legacy Boots', slot: 'boots', rarity: 'rare',
    jumpMultiplier: 1.2, description: 'Earned on an older page.' };
  const legacy = { version: 1, revision: 19, coins: 75, xp: 300, level: 4, inventory: [boots], equippedItemId: boots.id,
    completedEncounters: ['encounter-v1:legacy'], claimedRewards: ['encounter-v1:legacy'],
    collectedCoins: ['encounter-v1:legacy:coin:0', 'encounter-v1:legacy:coin:1', 'encounter-v1:legacy:coin:2'] };
  const backup = structuredClone(legacy);
  const migrated = readPlayerState(legacy);
  assert.deepEqual(migrated, { ...legacy, version: 2 });
  assert.deepEqual(legacy, backup);
  assert.equal(readPlayerState(migrated), migrated);
  const claimed = collectCoin(migrated, PAGE, rareKey, 0).state;
  assert.equal(claimed.coins, legacy.coins + 5);
  assert.equal(claimed.xp, legacy.xp + 20);
  assert.equal(claimed.equippedItemId, boots.id);
  assert.deepEqual(claimed.inventory, legacy.inventory);
  assert.ok(claimed.collectedCoins.includes(legacy.collectedCoins[0]!));
  assert.ok(claimed.completedEncounters.includes('encounter-v1:legacy'));
});

test('serialized saves retain selection and duplicate protection across restart', () => {
  const earned = collectEquipment(completePlatform(rareKey), ownership).state;
  const equipped = equipItem(earned, earned.inventory[0]!.id).state;
  const saved: unknown = JSON.parse(JSON.stringify(equipped));
  const restored = readPlayerState(saved);
  assert.deepEqual(restored, equipped);
  assert.equal(restored, saved);
  assert.equal(collectCoin(restored, PAGE, rareKey, 0).state, restored);
  assert.equal(equipItem(restored, restored.equippedItemId).state, restored);
});

test('corrupt and unsupported saves fail visibly without resetting progression', () => {
  const valid = collectEquipment(completePlatform(rareKey), ownership).state;
  for (const saved of [null, {}, { ...valid, version: 3 }, { ...valid, revision: -1 }, { ...valid, coins: NaN },
    { ...valid, xp: 1.5 }, { ...valid, level: 99 }, { ...valid, inventory: [{}] },
    { ...valid, inventory: [valid.inventory[0], valid.inventory[0]] },
    { ...valid, inventory: [{ ...valid.inventory[0], jumpMultiplier: 99 }] },
    { ...valid, equippedItemId: 'unowned' }, { ...valid, collectedCoins: ['duplicate', 'duplicate'] },
    { ...valid, completedEncounters: [42] }, { ...valid, claimedRewards: null }]) {
    assert.throws(() => readPlayerState(saved), /Saved/);
  }
});

test('integer overflow cannot commit imprecise progression', () => {
  for (const field of ['coins', 'xp', 'revision'] as const) {
    const state = { ...createPlayerState(), [field]: Number.MAX_SAFE_INTEGER };
    if (field === 'xp') state.level = 1 + Math.floor(state.xp / 100);
    assert.throws(() => collectCoin(state, PAGE, rareKey, 0), /integer range/);
    assert.equal(state[field], Number.MAX_SAFE_INTEGER);
    assert.deepEqual(state.collectedCoins, []);
  }
});
