import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, encounterForUrl } from '../src/encounters';
import { collectCoin, createPlayerState, equipItem, readPlayerState } from '../src/player-state';
import type { PlayerState } from '../src/progression-types';

function pageWithEquipment(present: boolean): string {
  for (let seed = 0; seed < 10000; seed++) {
    const url = `https://player-state-${seed}.test/`;
    if (Boolean(encounterForUrl(url).equipment) === present) return url;
  }
  throw new Error(`No deterministic page with equipment=${present} found.`);
}

const rarePage = pageWithEquipment(true);
const ordinaryPage = pageWithEquipment(false);

function completePage(url: string, state = createPlayerState()): PlayerState {
  for (let index = 0; index < encounterForUrl(url).coinCount; index++) state = collectCoin(state, url, index).state;
  return state;
}

test('new profiles have explicit schema and no free currency or equipment', () => {
  assert.deepEqual(createPlayerState(), {
    version: 1,
    revision: 0,
    coins: 0,
    xp: 0,
    level: 1,
    inventory: [],
    equippedItemId: null,
    completedEncounters: [],
    claimedRewards: [],
    collectedCoins: [],
  });
  assert.deepEqual(readPlayerState(undefined), createPlayerState());
  const first = createPlayerState();
  const second = createPlayerState();
  assert.notEqual(first.inventory, second.inventory);
  assert.notEqual(first.collectedCoins, second.collectedCoins);
});

test('one coin grants exactly five currency and twenty XP without mutating input', () => {
  const initial = createPlayerState();
  const before = structuredClone(initial);
  const result = collectCoin(initial, rarePage, 0);
  assert.equal(result.duplicate, false);
  assert.equal(result.reward, null);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.coins, 5);
  assert.equal(result.state.xp, 20);
  assert.equal(result.state.level, 1);
  assert.deepEqual(result.state.inventory, []);
  assert.deepEqual(result.state.completedEncounters, []);
  assert.deepEqual(result.state.claimedRewards, []);
  assert.deepEqual(result.state.collectedCoins, [coinId(encounterForUrl(rarePage), 0)]);
  assert.deepEqual(initial, before);
});

test('repeated coin claims preserve the same state and revision', () => {
  const first = collectCoin(createPlayerState(), rarePage, 0).state;
  for (let repeat = 0; repeat < 20; repeat++) {
    const result = collectCoin(first, rarePage, 0);
    assert.equal(result.state, first);
    assert.equal(result.duplicate, true);
    assert.equal(result.reward, null);
  }
});

test('third distinct coin completes and claims deterministic equipment once regardless of order', () => {
  const encounter = encounterForUrl(rarePage);
  const initial = createPlayerState();
  const first = collectCoin(initial, rarePage, 2);
  const second = collectCoin(first.state, rarePage, 0);
  assert.deepEqual(second.state.completedEncounters, []);
  assert.deepEqual(second.state.claimedRewards, []);
  assert.deepEqual(second.state.inventory, []);
  const third = collectCoin(second.state, rarePage, 1);
  assert.deepEqual(third.reward, encounter.equipment);
  assert.deepEqual(third.state.inventory, [encounter.equipment]);
  assert.deepEqual(third.state.completedEncounters, [encounter.id]);
  assert.deepEqual(third.state.claimedRewards, [encounter.id]);
  assert.equal(third.state.equippedItemId, null);
  assert.equal(third.state.revision, 3);
  assert.equal(third.state.coins, 15);
  assert.equal(third.state.xp, 60);
  for (const index of [0, 1, 2]) {
    const duplicate = collectCoin(third.state, rarePage, index);
    assert.equal(duplicate.state, third.state);
    assert.equal(duplicate.reward, null);
    assert.equal(duplicate.duplicate, true);
  }
  assert.deepEqual(initial, createPlayerState());
});

test('ordinary encounters record completion and claimed reward without creating equipment', () => {
  const encounter = encounterForUrl(ordinaryPage);
  assert.equal(encounter.equipment, null);
  const state = completePage(ordinaryPage);
  assert.deepEqual(state.completedEncounters, [encounter.id]);
  assert.deepEqual(state.claimedRewards, [encounter.id]);
  assert.deepEqual(state.inventory, []);
  assert.equal(state.coins, 15);
  assert.equal(state.xp, 60);
});

test('equipment belongs once to each player rather than disappearing globally', () => {
  const first = completePage(rarePage);
  const second = completePage(rarePage);
  assert.deepEqual(first.inventory, [encounterForUrl(rarePage).equipment]);
  assert.deepEqual(second.inventory, first.inventory);
  assert.notEqual(first.inventory, second.inventory);
  assert.equal(first.coins, 15);
  assert.equal(second.coins, 15);
});

test('normalized page aliases cannot collect the same coin or reward again', () => {
  const state = completePage(rarePage);
  const alias = rarePage.replace('https:', 'http:') + 'another/path?utm_source=duplicate';
  assert.equal(encounterForUrl(alias).id, encounterForUrl(rarePage).id);
  for (const index of [0, 1, 2]) assert.equal(collectCoin(state, alias, index).state, state);
});

test('levels advance exactly at every hundred XP without spending currency', () => {
  let state = createPlayerState();
  let count = 0;
  for (let page = 0; page < 4; page++) {
    const url = `https://level-boundary-${page}.test/`;
    for (let index = 0; index < 3; index++) {
      state = collectCoin(state, url, index).state;
      count++;
      assert.equal(state.xp, count * 20);
      assert.equal(state.coins, count * 5);
      assert.equal(state.level, 1 + Math.floor(count / 5));
      assert.equal(state.revision, count);
    }
  }
});

test('invalid coin indices grant nothing and leave the original profile untouched', () => {
  const state = createPlayerState();
  for (const index of [-1, 3, 100, 0.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => collectCoin(state, rarePage, index), /index/);
  }
  assert.deepEqual(state, createPlayerState());
});

test('equipping requires an actually owned ID, including deterministic but unearned boots', () => {
  const state = createPlayerState();
  assert.throws(() => equipItem(state, 'invented-boots'), /not owned/);
  assert.throws(() => equipItem(state, encounterForUrl(rarePage).equipment!.id), /not owned/);
  assert.deepEqual(state, createPlayerState());
  assert.equal(equipItem(state, null).state, state);
});

test('equip and unequip only change selected equipment and revision', () => {
  const earned = completePage(rarePage);
  const id = earned.inventory[0].id;
  const equipped = equipItem(earned, id);
  assert.equal(equipped.state.equippedItemId, id);
  assert.equal(equipped.state.revision, earned.revision + 1);
  assert.equal(equipped.reward, null);
  assert.equal(equipped.duplicate, false);
  assert.equal(equipped.state.inventory, earned.inventory);
  assert.equal(equipped.state.coins, earned.coins);
  assert.equal(equipped.state.xp, earned.xp);
  assert.equal(equipped.state.level, earned.level);
  assert.equal(equipped.state.claimedRewards, earned.claimedRewards);
  const repeated = equipItem(equipped.state, id);
  assert.equal(repeated.state, equipped.state);
  assert.equal(repeated.duplicate, true);
  const unequipped = equipItem(equipped.state, null);
  assert.equal(unequipped.state.equippedItemId, null);
  assert.equal(unequipped.state.revision, equipped.state.revision + 1);
  assert.equal(unequipped.state.inventory, earned.inventory);
  assert.equal(unequipped.state.coins, earned.coins);
  assert.equal(unequipped.state.xp, earned.xp);
  assert.equal(equipItem(unequipped.state, null).state, unequipped.state);
  assert.equal(earned.equippedItemId, null);
});

test('serialized saves preserve progression, ownership, selection and idempotency', () => {
  const earned = completePage(rarePage);
  const equipped = equipItem(earned, earned.inventory[0].id).state;
  const saved = JSON.parse(JSON.stringify(equipped)) as unknown;
  const restored = readPlayerState(saved);
  assert.deepEqual(restored, equipped);
  assert.equal(restored, saved);
  for (const index of [0, 1, 2]) assert.equal(collectCoin(restored, rarePage, index).state, restored);
  assert.equal(equipItem(restored, restored.equippedItemId).state, restored);
});

test('unsupported and malformed saves fail visibly instead of resetting earned progress', () => {
  const valid = completePage(rarePage);
  const invalid: unknown[] = [
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, revision: -1 },
    { ...valid, coins: NaN },
    { ...valid, xp: 1.5 },
    { ...valid, level: 99 },
    { ...valid, inventory: [{}] },
    { ...valid, inventory: [valid.inventory[0], valid.inventory[0]] },
    { ...valid, inventory: [{ ...valid.inventory[0], jumpMultiplier: 99 }] },
    { ...valid, equippedItemId: 'unowned' },
    { ...valid, collectedCoins: [valid.collectedCoins[0], valid.collectedCoins[0]] },
    { ...valid, completedEncounters: [42] },
    { ...valid, claimedRewards: null },
  ];
  for (const saved of invalid) assert.throws(() => readPlayerState(saved), /Saved/);
  assert.deepEqual(readPlayerState(valid), valid);
});

test('integer overflow cannot commit imprecise currency, XP or revisions', () => {
  for (const field of ['coins', 'xp', 'revision'] as const) {
    const state = { ...createPlayerState(), [field]: Number.MAX_SAFE_INTEGER };
    if (field === 'xp') state.level = 1 + Math.floor(state.xp / 100);
    assert.throws(() => collectCoin(state, rarePage, 0), /integer range/);
    assert.equal(state[field], Number.MAX_SAFE_INTEGER);
    assert.deepEqual(state.collectedCoins, []);
  }
  const earned = completePage(rarePage);
  assert.throws(() => equipItem({ ...earned, revision: Number.MAX_SAFE_INTEGER }, earned.inventory[0].id), /integer range/);
});
