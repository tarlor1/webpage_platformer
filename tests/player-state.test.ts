import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, encounterForPlatform } from '../src/progression/encounters';
import { collectCoin, collectEquipment, createPlayerState, equipItem, readPlayerState } from '../src/progression/player-state';
import type { PlayerState } from '../src/progression/progression-types';

const PAGE = 'https://example.com/article';
function encounterKey(kind: 'coins' | 'equipment' | 'both' | 'empty', url = PAGE, prefix: string = kind): string {
  const wantsCoins = kind === 'coins' || kind === 'both';
  const wantsEquipment = kind === 'equipment' || kind === 'both';
  for (let index = 0; index < 100000; index++) {
    const key = `${prefix}:${index}`;
    const encounter = encounterForPlatform(url, key);
    if ((encounter.coinCount > 0) === wantsCoins && (encounter.equipment !== null) === wantsEquipment) return key;
  }
  throw new Error(`No ${kind} platform found.`);
}
const rareKey = encounterKey('equipment');
const ordinaryKey = encounterKey('coins');
const emptyKey = encounterKey('empty');
const rareEncounter = encounterForPlatform(PAGE, rareKey);
const ownership = { encounterId: rareEncounter.id, equipment: rareEncounter.equipment! };
function completePlatform(key: string, state = createPlayerState(), url = PAGE): PlayerState {
  const encounter = encounterForPlatform(url, key);
  for (let index = 0; index < encounter.coinCount; index++) state = collectCoin(state, url, key, index).state;
  return state;
}

test('one coin awards one currency and twenty XP without mutating its input', () => {
  const initial = createPlayerState();
  const before = structuredClone(initial);
  const result = collectCoin(initial, PAGE, ordinaryKey, 0);
  assert.equal(result.duplicate, false);
  assert.equal(result.reward, null);
  assert.equal(result.state.coins, 1);
  assert.equal(result.state.xp, 20);
  assert.equal(result.state.level, 1);
  assert.equal(result.state.revision, 1);
  assert.deepEqual(result.state.collectedCoins, [coinId(encounterForPlatform(PAGE, ordinaryKey), 0)]);
  assert.deepEqual(initial, before);
});

test('equipment-only and empty encounters reject coin claims without changing progression', () => {
  const state = createPlayerState();
  for (const key of [rareKey, emptyKey]) {
    assert.equal(encounterForPlatform(PAGE, key).coinCount, 0);
    assert.throws(() => collectCoin(state, PAGE, key, 0), /index/);
  }
  assert.deepEqual(state, createPlayerState());
});

test('equipment pickup awards only its item and is claimed once', () => {
  const encounter = encounterForPlatform(PAGE, rareKey);
  const initial = createPlayerState();
  const result = collectEquipment(initial, ownership);
  assert.equal(result.duplicate, false);
  assert.deepEqual(result.reward, encounter.equipment);
  assert.deepEqual(result.state.inventory, [encounter.equipment]);
  assert.deepEqual(result.state.claimedRewards, [encounter.id]);
  assert.deepEqual(result.state.completedEncounters, [encounter.id]);
  assert.deepEqual(result.state.collectedCoins, []);
  assert.equal(result.state.coins, 0);
  assert.equal(result.state.xp, 0);
  assert.equal(result.state.equippedItemId, null);
  assert.deepEqual(initial.inventory, []);
  const duplicate = collectEquipment(result.state, structuredClone(ownership));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state, result.state);
  assert.equal(duplicate.reward, null);
  assert.equal(duplicate.state.revision, result.state.revision);
  assert.deepEqual(duplicate.state.completedEncounters, [encounter.id]);
  for (const invalid of [null, {}, { ...ownership, encounterId: '' }, { ...ownership, equipment: null },
    { ...ownership, encounterId: 'unrelated' }, { ...ownership, equipment: { ...ownership.equipment, jumpMultiplier: 99 } }]) {
    assert.throws(() => collectEquipment(initial, invalid));
  }
});

test('a new logical key and a new meaningful URL each permit distinct coin sets on old pages', () => {
  const original = completePlatform(ordinaryKey);
  const otherKey = collectCoin(original, PAGE, encounterKey('coins', PAGE, 'other'), 0).state;
  const otherPath = collectCoin(otherKey, `${PAGE}/chapter`, encounterKey('coins', `${PAGE}/chapter`), 0).state;
  assert.equal(otherKey.coins, original.coins + 1);
  assert.equal(otherPath.coins, original.coins + 2);
  assert.equal(new Set(otherPath.collectedCoins).size, otherPath.collectedCoins.length);
});

test('ordinary platform completion creates no equipment and retains independent progression', () => {
  const encounter = encounterForPlatform(PAGE, ordinaryKey);
  const state = completePlatform(ordinaryKey);
  assert.equal(encounter.equipment, null);
  assert.deepEqual(state.completedEncounters, [encounter.id]);
  assert.deepEqual(state.claimedRewards, []);
  assert.deepEqual(state.inventory, []);
  assert.equal(state.coins, encounter.coinCount);
  assert.equal(state.level, 1 + Math.floor(state.xp / 100));
});

test('both-winning encounters keep coin and equipment claims independent and idempotent in either order', () => {
  const key = encounterKey('both');
  const encounter = encounterForPlatform(PAGE, key);
  assert.ok(encounter.coinCount > 0 && encounter.equipment);
  const equipmentOwnership = { encounterId: encounter.id, equipment: encounter.equipment };
  const finished: PlayerState[] = [];
  for (const equipmentFirst of [true, false]) {
    let state = createPlayerState();
    if (equipmentFirst) {
      const equipment = collectEquipment(state, equipmentOwnership);
      assert.equal(equipment.duplicate, false);
      state = equipment.state;
      assert.equal(state.coins, 0);
      assert.equal(state.xp, 0);
      assert.deepEqual(state.collectedCoins, []);
    }
    for (let index = 0; index < encounter.coinCount; index++) {
      const coin = collectCoin(state, PAGE, key, index);
      assert.equal(coin.duplicate, false);
      assert.equal(coin.reward, null);
      state = coin.state;
      if (!equipmentFirst) {
        assert.deepEqual(state.inventory, []);
        assert.deepEqual(state.claimedRewards, []);
      }
    }
    if (!equipmentFirst) {
      const equipment = collectEquipment(state, equipmentOwnership);
      assert.equal(equipment.duplicate, false);
      assert.deepEqual(equipment.reward, encounter.equipment);
      state = equipment.state;
    }
    assert.equal(state.coins, encounter.coinCount);
    assert.equal(state.xp, encounter.coinCount * 20);
    assert.equal(state.revision, encounter.coinCount + 1);
    assert.deepEqual(state.inventory, [encounter.equipment]);
    assert.equal(state.equippedItemId, null);
    assert.deepEqual(state.claimedRewards, [encounter.id]);
    assert.deepEqual(state.completedEncounters, [encounter.id]);
    const restored = readPlayerState(JSON.parse(JSON.stringify(state)));
    for (let index = 0; index < encounter.coinCount; index++) {
      const duplicate = collectCoin(restored, PAGE, key, index);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.state, restored);
      assert.equal(duplicate.reward, null);
    }
    const duplicateEquipment = collectEquipment(restored, equipmentOwnership);
    assert.equal(duplicateEquipment.duplicate, true);
    assert.equal(duplicateEquipment.state, restored);
    assert.equal(duplicateEquipment.reward, null);
    finished.push(restored);
  }
  assert.deepEqual(finished[0], finished[1]);
});

test('levels advance every hundred XP without spending currency', () => {
  let state = createPlayerState();
  for (let count = 1; count <= 30; count++) {
    state = collectCoin(state, PAGE, encounterKey('coins', PAGE, `level:${count}`), 0).state;
    assert.equal(state.xp, count * 20);
    assert.equal(state.coins, count);
    assert.equal(state.level, 1 + Math.floor(count / 5));
    assert.equal(state.revision, count);
  }
});

test('invalid indices, logical keys and URLs leave earned progression unchanged', () => {
  const state = createPlayerState();
  for (const index of [-1, encounterForPlatform(PAGE, ordinaryKey).coinCount, 100, 0.5, NaN, Infinity]) {
    assert.throws(() => collectCoin(state, PAGE, ordinaryKey, index), /index/);
  }
  assert.throws(() => collectCoin(state, PAGE, '', 0), /logical/);
  assert.throws(() => collectCoin(state, 'file:///article', ordinaryKey, 0), /HTTP/);
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
  const claimed = collectCoin(migrated, PAGE, ordinaryKey, 0).state;
  assert.equal(claimed.coins, legacy.coins + 1);
  assert.equal(claimed.xp, legacy.xp + 20);
  assert.equal(claimed.equippedItemId, boots.id);
  assert.deepEqual(claimed.inventory, legacy.inventory);
  assert.ok(claimed.collectedCoins.includes(legacy.collectedCoins[0]!));
  assert.ok(claimed.completedEncounters.includes('encounter-v1:legacy'));
});

test('v2 saves preserve old rewards while v3 encounters permit fresh claims', () => {
  const encounter = encounterForPlatform(PAGE, ordinaryKey);
  const oldId = encounter.id.replace('encounter-v3:', 'encounter-v2:');
  const oldBoots = {
    ...ownership.equipment,
    id: ownership.equipment.id.replace('encounter-v3:', 'encounter-v2:'),
  };
  const oldEquipmentEncounter = ownership.encounterId.replace('encounter-v3:', 'encounter-v2:');
  const saved = {
    ...createPlayerState(), revision: 12, coins: 35, xp: 140, level: 2,
    inventory: [oldBoots], equippedItemId: oldBoots.id,
    completedEncounters: [oldId], claimedRewards: [oldEquipmentEncounter],
    collectedCoins: [`${oldId}:coin:0`],
  };
  const restored = readPlayerState(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored, saved);
  const freshCoin = collectCoin(restored, PAGE, ordinaryKey, 0).state;
  const freshGear = collectEquipment(freshCoin, ownership).state;
  assert.equal(freshGear.version, 2);
  assert.equal(freshGear.coins, saved.coins + 1);
  assert.equal(freshGear.xp, saved.xp + 20);
  assert.equal(freshGear.equippedItemId, oldBoots.id);
  assert.deepEqual(freshGear.inventory, [oldBoots, ownership.equipment]);
  assert.deepEqual(freshGear.collectedCoins, [...saved.collectedCoins, coinId(encounter, 0)]);
  assert.deepEqual(freshGear.completedEncounters, [oldId, ownership.encounterId]);
  assert.deepEqual(freshGear.claimedRewards, [oldEquipmentEncounter, ownership.encounterId]);
});

test('serialized saves retain selection and duplicate protection across restart', () => {
  const earned = collectEquipment(completePlatform(ordinaryKey), ownership).state;
  const equipped = equipItem(earned, earned.inventory[0]!.id).state;
  const saved: unknown = JSON.parse(JSON.stringify(equipped));
  const restored = readPlayerState(saved);
  assert.deepEqual(restored, equipped);
  assert.equal(restored, saved);
  assert.equal(collectCoin(restored, PAGE, ordinaryKey, 0).state, restored);
  assert.equal(collectEquipment(restored, ownership).state, restored);
  assert.equal(equipItem(restored, restored.equippedItemId).state, restored);
});

test('corrupt and unsupported saves fail visibly without resetting progression', () => {
  const valid = collectEquipment(completePlatform(ordinaryKey), ownership).state;
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
    assert.throws(() => collectCoin(state, PAGE, ordinaryKey, 0), /integer range/);
    assert.equal(state[field], Number.MAX_SAFE_INTEGER);
    assert.deepEqual(state.collectedCoins, []);
  }
});
