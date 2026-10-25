import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, encounterForPlatform } from '../src/progression/encounters';
import { buyItem, collectCoin, collectEquipment, createPlayerState, equipItem, readPlayerState, sellItem } from '../src/progression/player-state';
import type { PlayerState } from '../src/progression/progression-types';
import { inventoryItemId, worldEquipmentId } from '../src/progression/equipment-id';
import { createBoot } from '../src/progression/boots';
import { sellValue } from '../src/progression/shop';

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
  const owned = { ...encounter.equipment!, instanceId: worldEquipmentId(encounter.id) };
  assert.deepEqual(result.reward, owned);
  assert.deepEqual(result.state.inventory, [owned]);
  assert.deepEqual(result.state.claimedRewards, [encounter.id]);
  assert.deepEqual(result.state.completedEncounters, [encounter.id]);
  assert.deepEqual(result.state.collectedCoins, []);
  assert.equal(result.state.coins, 0);
  assert.equal(result.state.xp, 0);
  assert.equal(result.state.equippedItems.boots, null);
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

test('shop sells a glider, equips the first purchase, and resells it for less', () => {
  const purchased = buyItem({ ...createPlayerState(), coins: 205 }, 'pocket-glider:common:glider').state;
  assert.equal(purchased.coins, 5);
  assert.equal(purchased.inventory[0]!.ability, 'glide');
  assert.equal(purchased.equippedItems.glider, inventoryItemId(purchased.inventory[0]!));
  assert.deepEqual(readPlayerState(purchased), purchased);
  const sold = sellItem(purchased, inventoryItemId(purchased.inventory[0]!)).state;
  assert.equal(sold.coins, 105);
  assert.deepEqual(sold.inventory, []);
  assert.equal(sold.equippedItems.glider, null);
});

test('shop boots can be bought when a different pair is already owned', () => {
  const existing = {
    ...createBoot('rare'), instanceId: 'test:skybound',
  };
  const state = { ...createPlayerState(), coins: 20, inventory: [existing] };
  const purchased = buyItem(state, 'springheel-boots:common:boots').state;
  assert.equal(purchased.coins, 8);
  assert.deepEqual(purchased.inventory.map(item => item.id), ['skybound-boots:rare:boots', 'springheel-boots:common:boots']);
  assert.deepEqual(readPlayerState(purchased), purchased);
  assert.throws(() => buyItem({ ...purchased, coins: 100 }, 'springheel-boots:common:boots'), /already own that item/);
});

test('shop blocks matching name/rarity/type regardless of stats, and permits rebuying after sale', () => {
  const item = { ...ownership.equipment, name: 'Springheel Boots', rarity: 'common' as const,
    id: 'springheel-boots:common:boots', instanceId: 'world:test-shop-match', jumpMultiplier: 1.25 };
  const otherCopy = { ...item, instanceId: 'world:another-shop-match' };
  const state = { ...createPlayerState(), coins: 100, inventory: [item, otherCopy] };
  assert.throws(() => buyItem(state, item.id), /already own/);
  const oneSold = sellItem(state, item.instanceId).state;
  assert.throws(() => buyItem(oneSold, item.id), /already own/);
  const sold = sellItem(oneSold, otherCopy.instanceId).state;
  const repurchased = buyItem(sold, item.id).state;
  assert.equal(repurchased.inventory.length, 1);
  assert.notEqual(repurchased.inventory[0]!.instanceId, item.instanceId);
  const soldAgain = sellItem(repurchased, inventoryItemId(repurchased.inventory[0]!)).state;
  const boughtAgain = buyItem(soldAgain, item.id).state;
  assert.notEqual(boughtAgain.inventory[0]!.instanceId, repurchased.inventory[0]!.instanceId);
  assert.ok(boughtAgain.coins < state.coins, 'buy/sell cycles cost coins');
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
  const owned = { ...encounter.equipment, instanceId: worldEquipmentId(encounter.id) };
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
      assert.deepEqual(equipment.reward, owned);
      state = equipment.state;
    }
    assert.equal(state.coins, encounter.coinCount);
    assert.equal(state.xp, encounter.coinCount * 20);
    assert.equal(state.revision, encounter.coinCount + 1);
    assert.deepEqual(state.inventory, [owned]);
    assert.deepEqual(state.equippedItems, { boots: null, glider: null });
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
  const id = inventoryItemId(earned.inventory[0]!);
  const equipped = equipItem(earned, id).state;
  assert.equal(equipped.equippedItems.boots, id);
  assert.equal(equipped.revision, earned.revision + 1);
  assert.equal(equipped.coins, earned.coins);
  assert.equal(equipped.xp, earned.xp);
  assert.equal(equipped.inventory, earned.inventory);
  assert.equal(equipItem(equipped, id).state, equipped);
  const unequipped = equipItem(equipped, null).state;
  assert.equal(unequipped.equippedItems.boots, null);
  assert.equal(equipItem(unequipped, null).state, unequipped);
});

test('v1 migration applies rarity stats and preserves selection and claim history', () => {
  const boots = { id: 'encounter-v1:legacy:equipment:boots', name: 'Legacy Boots', slot: 'boots', rarity: 'rare',
    jumpMultiplier: 1.2, description: 'Earned on an older page.' };
  const legacy = { version: 1, revision: 19, coins: 75, xp: 300, level: 4, inventory: [boots], equippedItemId: boots.id,
    completedEncounters: ['encounter-v1:legacy'], claimedRewards: ['encounter-v1:legacy'],
    collectedCoins: ['encounter-v1:legacy:coin:0', 'encounter-v1:legacy:coin:1', 'encounter-v1:legacy:coin:2'] };
  const backup = structuredClone(legacy);
  const migrated = readPlayerState(legacy);
  const { equippedItemId: _oldSelection, ...legacyFields } = legacy;
  assert.deepEqual(migrated, { ...legacyFields, version: 2,
    inventory: [{ ...createBoot('rare'), instanceId: `legacy:${boots.id}` }],
    equippedItems: { boots: `legacy:${boots.id}`, glider: null } });
  assert.deepEqual(legacy, backup);
  assert.equal(readPlayerState(migrated), migrated);
  const claimed = collectCoin(migrated, PAGE, ordinaryKey, 0).state;
  assert.equal(claimed.coins, legacy.coins + 1);
  assert.equal(claimed.xp, legacy.xp + 20);
  assert.equal(claimed.equippedItems.boots, `legacy:${boots.id}`);
  assert.deepEqual(claimed.inventory, migrated.inventory);
  assert.ok(claimed.collectedCoins.includes(legacy.collectedCoins[0]!));
  assert.ok(claimed.completedEncounters.includes('encounter-v1:legacy'));
});

test('v2 saves preserve old rewards while v3 encounters permit fresh claims', () => {
  const encounter = encounterForPlatform(PAGE, ordinaryKey);
  const oldId = encounter.id.replace('encounter-v3:', 'encounter-v2:');
  const oldEquipmentEncounter = ownership.encounterId.replace('encounter-v3:', 'encounter-v2:');
  const oldBoots = { ...ownership.equipment, instanceId: worldEquipmentId(oldEquipmentEncounter) };
  const saved = {
    ...createPlayerState(), revision: 12, coins: 35, xp: 140, level: 2,
    inventory: [oldBoots], equippedItems: { boots: oldBoots.instanceId, glider: null },
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
  assert.deepEqual(freshGear.equippedItems, saved.equippedItems);
  assert.deepEqual(freshGear.inventory, [oldBoots,
    { ...ownership.equipment, instanceId: worldEquipmentId(ownership.encounterId) }]);
  assert.deepEqual(freshGear.collectedCoins, [...saved.collectedCoins, coinId(encounter, 0)]);
  assert.deepEqual(freshGear.completedEncounters, [oldId, ownership.encounterId]);
  assert.deepEqual(freshGear.claimedRewards, [oldEquipmentEncounter, ownership.encounterId]);
});

test('equipment migration preserves all copies, selection and currency while normalizing tier stats', () => {
  const first = { ...ownership.equipment, id: 'encounter-v2:first:equipment:boots' };
  const equipped = { ...first, id: 'encounter-v2:second:equipment:boots', jumpMultiplier: 1.25 };
  const { equippedItems: _slots, ...oldState } = createPlayerState();
  const original = { ...oldState, coins: 50, inventory: [first, equipped], equippedItemId: equipped.id };
  const before = structuredClone(original);
  const migrated = readPlayerState(original);
  assert.equal(migrated.inventory.length, 2);
  assert.equal(migrated.inventory[0]!.jumpMultiplier, first.jumpMultiplier);
  assert.equal(migrated.inventory[1]!.jumpMultiplier, createBoot(first.rarity).jumpMultiplier);
  assert.equal(migrated.inventory[0]!.id, ownership.equipment.id);
  assert.equal(migrated.inventory[1]!.id, ownership.equipment.id);
  assert.equal(migrated.equippedItems.boots, `legacy:${equipped.id}`);
  assert.notEqual(inventoryItemId(migrated.inventory[0]!), inventoryItemId(migrated.inventory[1]!));
  assert.equal(migrated.coins, 50);
  assert.equal(readPlayerState(migrated), migrated);
  assert.deepEqual(original, before);
});

test('old shop IDs migrate and rarity distinguishes otherwise identical boots', () => {
  const old = { ...ownership.equipment, id: 'shop:boots', name: 'Springheel Boots', rarity: 'common' as const };
  const migrated = readPlayerState({ ...createPlayerState(), equippedItems: undefined, coins: 50, inventory: [old], equippedItemId: old.id });
  assert.equal(migrated.inventory[0]!.id, 'springheel-boots:common:boots');
  assert.equal(migrated.equippedItems.boots, 'legacy:shop:boots');
  assert.throws(() => buyItem(migrated, 'springheel-boots:common:boots'), /already own/);
  const rare = { ...old, id: 'springheel-boots:rare:boots', rarity: 'rare' as const };
  const purchased = buyItem({ ...createPlayerState(), coins: 50, inventory: [rare] }, 'springheel-boots:common:boots').state;
  assert.equal(purchased.inventory.length, 2);
});

test('identical world items coexist, sell individually, and each source remains claimed after selling', () => {
  const legacy = { ...ownership, equipment: { ...ownership.equipment, id: `${ownership.encounterId}:equipment:boots` } };
  const first = collectEquipment(createPlayerState(), legacy).state;
  assert.equal(first.inventory[0]!.id, ownership.equipment.id);
  const otherSource = { ...ownership, encounterId: 'encounter-v2:other-source' };
  const second = collectEquipment(first, otherSource);
  assert.equal(second.duplicate, false);
  assert.equal(second.state.inventory.length, 2);
  assert.ok(second.state.claimedRewards.includes(otherSource.encounterId));
  const equipped = equipItem(second.state, worldEquipmentId(otherSource.encounterId)).state;
  const sold = sellItem(equipped, worldEquipmentId(ownership.encounterId)).state;
  assert.equal(sold.coins, equipped.coins + sellValue(ownership.equipment));
  assert.equal(sold.inventory.length, 1);
  assert.equal(sold.inventory[0]!.instanceId, worldEquipmentId(otherSource.encounterId));
  assert.equal(sold.equippedItems.boots, worldEquipmentId(otherSource.encounterId));
  assert.deepEqual(readPlayerState(second.state), second.state);
  assert.throws(() => sellItem(sold, worldEquipmentId(ownership.encounterId)), /not own/);
  assert.equal(collectEquipment(sold, legacy).state, sold);
  assert.equal(collectEquipment(sold, otherSource).state, sold);
  const empty = sellItem(sold, worldEquipmentId(otherSource.encounterId)).state;
  assert.equal(empty.coins, equipped.coins + sellValue(ownership.equipment) * 2);
  assert.equal(empty.inventory.length, 0);
  assert.equal(empty.equippedItems.boots, null);
});

test('serialized saves retain selection and duplicate protection across restart', () => {
  const earned = collectEquipment(completePlatform(ordinaryKey), ownership).state;
  const equipped = equipItem(earned, inventoryItemId(earned.inventory[0]!)).state;
  const saved: unknown = JSON.parse(JSON.stringify(equipped));
  const restored = readPlayerState(saved);
  assert.deepEqual(restored, equipped);
  assert.equal(restored, saved);
  assert.equal(collectCoin(restored, PAGE, ordinaryKey, 0).state, restored);
  assert.equal(collectEquipment(restored, ownership).state, restored);
  assert.equal(equipItem(restored, restored.equippedItems.boots).state, restored);
});

test('corrupt and unsupported saves fail visibly without resetting progression', () => {
  const valid = collectEquipment(completePlatform(ordinaryKey), ownership).state;
  for (const saved of [null, {}, { ...valid, version: 3 }, { ...valid, revision: -1 }, { ...valid, coins: NaN },
    { ...valid, xp: 1.5 }, { ...valid, level: 99 }, { ...valid, inventory: [{}] },
    { ...valid, inventory: [valid.inventory[0], valid.inventory[0]] },
    { ...valid, inventory: [{ ...valid.inventory[0], jumpMultiplier: 99 }] },
    { ...valid, equippedItems: { boots: 'unowned', glider: null } }, { ...valid, collectedCoins: ['duplicate', 'duplicate'] },
    { ...valid, completedEncounters: [42] }, { ...valid, claimedRewards: null }]) {
    assert.throws(() => readPlayerState(saved), /Saved/);
  }
});

test('boots and glider equip independently, replace only their slot, and survive restart', () => {
  const boots = buyItem({ ...createPlayerState(), coins: 300 }, 'springheel-boots:common:boots').state;
  const both = buyItem(boots, 'pocket-glider:common:glider').state;
  const bootId = inventoryItemId(both.inventory[0]!);
  const gliderId = inventoryItemId(both.inventory[1]!);
  assert.deepEqual(both.equippedItems, { boots: bootId, glider: gliderId });
  assert.equal(both.inventory[0]!.jumpMultiplier > 1, true);
  assert.equal(both.inventory[1]!.ability, 'glide');
  const restored = readPlayerState(JSON.parse(JSON.stringify(both)));
  assert.deepEqual(restored, both);
  const withoutBoots = equipItem(restored, null, 'boots').state;
  assert.deepEqual(withoutBoots.equippedItems, { boots: null, glider: gliderId });
  const withoutGlider = equipItem(restored, null, 'glider').state;
  assert.deepEqual(withoutGlider.equippedItems, { boots: bootId, glider: null });
  assert.deepEqual(equipItem(withoutBoots, bootId).state.equippedItems, both.equippedItems);
  const earned = collectEquipment(both, ownership).state;
  const replacement = equipItem(earned, inventoryItemId(earned.inventory[2]!)).state;
  assert.deepEqual(replacement.equippedItems, { boots: inventoryItemId(earned.inventory[2]!), glider: gliderId });
  assert.deepEqual(sellItem(replacement, bootId).state.equippedItems, replacement.equippedItems);
  assert.deepEqual(sellItem(both, bootId).state.equippedItems, { boots: null, glider: gliderId });
  assert.deepEqual(sellItem(both, gliderId).state.equippedItems, { boots: bootId, glider: null });
  assert.throws(() => equipItem(both, bootId, 'glider'), /slot/);
  assert.throws(() => readPlayerState({ ...both, equippedItems: { boots: gliderId, glider: bootId } }), /slot/);
});

test('buying boots preserves an equipped glider and buying other boots preserves selected boots', () => {
  const glider = buyItem({ ...createPlayerState(), coins: 300 }, 'pocket-glider:common:glider').state;
  const selected = equipItem(collectEquipment(glider, ownership).state, worldEquipmentId(ownership.encounterId)).state;
  const purchased = buyItem(selected, 'springheel-boots:common:boots').state;
  assert.deepEqual(purchased.equippedItems, selected.equippedItems);
  const emptyBoots = buyItem(glider, 'springheel-boots:common:boots').state;
  assert.equal(emptyBoots.equippedItems.glider, glider.equippedItems.glider);
  assert.equal(emptyBoots.equippedItems.boots, inventoryItemId(emptyBoots.inventory[1]!));
});

test('old single-slot glider saves migrate into the glider slot without auto-equipping boots', () => {
  const purchased = buyItem({ ...createPlayerState(), coins: 300 }, 'pocket-glider:common:glider').state;
  const { equippedItems, ...old } = collectEquipment(purchased, ownership).state;
  const migrated = readPlayerState({ ...old, equippedItemId: equippedItems.glider });
  assert.deepEqual(migrated.equippedItems, { boots: null, glider: equippedItems.glider });
  assert.equal('equippedItemId' in migrated, false);
  assert.equal(readPlayerState(migrated), migrated);
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
