import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinId, encounterForPlatform } from '../src/progression/encounters';
import { buyItem, collectCoin, collectEquipment, createPlayerState, equipItem, readPlayerState, sellItem } from '../src/progression/player-state';
import type { PlayerState } from '../src/progression/progression-types';
import { inventoryItemId, worldEquipmentId } from '../src/progression/equipment-id';

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

test('one coin awards one currency and twenty XP without mutating its input', () => {
  const initial = createPlayerState();
  const before = structuredClone(initial);
  const result = collectCoin(initial, PAGE, rareKey, 0);
  assert.equal(result.duplicate, false);
  assert.equal(result.reward, null);
  assert.equal(result.state.coins, 1);
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
  assert.equal(state.coins, encounter.coinCount);
  assert.equal(state.xp, encounter.coinCount * 20);
  assert.equal(collectCoin(state, PAGE, rareKey, 0).state, state);
});

test('equipment can be picked up with zero coins and is claimed once independently', () => {
  const encounter = encounterForPlatform(PAGE, rareKey);
  const initial = createPlayerState();
  const result = collectEquipment(initial, ownership);
  assert.equal(result.duplicate, false);
  const owned = { ...encounter.equipment!, instanceId: worldEquipmentId(encounter.id) };
  assert.deepEqual(result.reward, owned);
  assert.deepEqual(result.state.inventory, [owned]);
  assert.deepEqual(result.state.claimedRewards, [encounter.id]);
  assert.deepEqual(result.state.completedEncounters, []);
  assert.deepEqual(result.state.collectedCoins, []);
  assert.equal(result.state.coins, 0);
  assert.equal(result.state.xp, 0);
  assert.equal(result.state.equippedItems.boots, null);
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

test('shop sells a glider, equips the first purchase, and resells it for less', () => {
  const purchased = buyItem({ ...createPlayerState(), coins: 25 }, 'pocket-glider:common:glider').state;
  assert.equal(purchased.coins, 5);
  assert.equal(purchased.inventory[0]!.ability, 'glide');
  assert.equal(purchased.equippedItems.glider, inventoryItemId(purchased.inventory[0]!));
  assert.deepEqual(readPlayerState(purchased), purchased);
  const sold = sellItem(purchased, inventoryItemId(purchased.inventory[0]!)).state;
  assert.equal(sold.coins, 15);
  assert.deepEqual(sold.inventory, []);
  assert.equal(sold.equippedItems.glider, null);
});

test('shop boots can be bought when a different pair is already owned', () => {
  const existing = {
    id: 'skybound-boots:rare:boots', instanceId: 'test:skybound', name: 'Skybound Boots', slot: 'boots' as const, rarity: 'rare' as const,
    jumpMultiplier: 1.15, description: 'A different pair.',
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
  const original = completePlatform(rareKey);
  const otherKey = collectCoin(original, PAGE, ordinaryKey, 0).state;
  const otherPath = collectCoin(otherKey, `${PAGE}/chapter`, rareKey, 0).state;
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

test('levels advance every hundred XP without spending currency', () => {
  let state = createPlayerState();
  for (let count = 1; count <= 30; count++) {
    state = collectCoin(state, PAGE, `level:${count}`, 0).state;
    assert.equal(state.xp, count * 20);
    assert.equal(state.coins, count);
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

test('v1 migration normalizes equipment IDs and preserves stats, selection and claim history', () => {
  const boots = { id: 'encounter-v1:legacy:equipment:boots', name: 'Legacy Boots', slot: 'boots', rarity: 'rare',
    jumpMultiplier: 1.2, description: 'Earned on an older page.' };
  const legacy = { version: 1, revision: 19, coins: 75, xp: 300, level: 4, inventory: [boots], equippedItemId: boots.id,
    completedEncounters: ['encounter-v1:legacy'], claimedRewards: ['encounter-v1:legacy'],
    collectedCoins: ['encounter-v1:legacy:coin:0', 'encounter-v1:legacy:coin:1', 'encounter-v1:legacy:coin:2'] };
  const backup = structuredClone(legacy);
  const migrated = readPlayerState(legacy);
  const { equippedItemId: _oldSelection, ...legacyFields } = legacy;
  assert.deepEqual(migrated, { ...legacyFields, version: 2,
    inventory: [{ ...boots, id: 'legacy-boots:rare:boots', instanceId: `legacy:${boots.id}` }],
    equippedItems: { boots: `legacy:${boots.id}`, glider: null } });
  assert.deepEqual(legacy, backup);
  assert.equal(readPlayerState(migrated), migrated);
  const claimed = collectCoin(migrated, PAGE, rareKey, 0).state;
  assert.equal(claimed.coins, legacy.coins + 1);
  assert.equal(claimed.xp, legacy.xp + 20);
  assert.equal(claimed.equippedItems.boots, `legacy:${boots.id}`);
  assert.deepEqual(claimed.inventory, migrated.inventory);
  assert.ok(claimed.collectedCoins.includes(legacy.collectedCoins[0]!));
  assert.ok(claimed.completedEncounters.includes('encounter-v1:legacy'));
});

test('equipment ID migration preserves all old copies, individual stats, selection and currency', () => {
  const first = { ...ownership.equipment, id: 'encounter-v2:first:equipment:boots' };
  const equipped = { ...first, id: 'encounter-v2:second:equipment:boots', jumpMultiplier: 1.25 };
  const { equippedItems: _slots, ...oldState } = createPlayerState();
  const original = { ...oldState, coins: 50, inventory: [first, equipped], equippedItemId: equipped.id };
  const before = structuredClone(original);
  const migrated = readPlayerState(original);
  assert.equal(migrated.inventory.length, 2);
  assert.equal(migrated.inventory[0]!.jumpMultiplier, first.jumpMultiplier);
  assert.equal(migrated.inventory[1]!.jumpMultiplier, 1.25);
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
  assert.equal(sold.coins, equipped.coins + 6);
  assert.equal(sold.inventory.length, 1);
  assert.equal(sold.inventory[0]!.instanceId, worldEquipmentId(otherSource.encounterId));
  assert.equal(sold.equippedItems.boots, worldEquipmentId(otherSource.encounterId));
  assert.deepEqual(readPlayerState(second.state), second.state);
  assert.throws(() => sellItem(sold, worldEquipmentId(ownership.encounterId)), /not own/);
  assert.equal(collectEquipment(sold, legacy).state, sold);
  assert.equal(collectEquipment(sold, otherSource).state, sold);
  const empty = sellItem(sold, worldEquipmentId(otherSource.encounterId)).state;
  assert.equal(empty.coins, equipped.coins + 12);
  assert.equal(empty.inventory.length, 0);
  assert.equal(empty.equippedItems.boots, null);
});

test('serialized saves retain selection and duplicate protection across restart', () => {
  const earned = collectEquipment(completePlatform(rareKey), ownership).state;
  const equipped = equipItem(earned, inventoryItemId(earned.inventory[0]!)).state;
  const saved: unknown = JSON.parse(JSON.stringify(equipped));
  const restored = readPlayerState(saved);
  assert.deepEqual(restored, equipped);
  assert.equal(restored, saved);
  assert.equal(collectCoin(restored, PAGE, rareKey, 0).state, restored);
  assert.equal(equipItem(restored, restored.equippedItems.boots).state, restored);
});

test('corrupt and unsupported saves fail visibly without resetting progression', () => {
  const valid = collectEquipment(completePlatform(rareKey), ownership).state;
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
  const boots = buyItem({ ...createPlayerState(), coins: 100 }, 'springheel-boots:common:boots').state;
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
  const glider = buyItem({ ...createPlayerState(), coins: 100 }, 'pocket-glider:common:glider').state;
  const selected = equipItem(collectEquipment(glider, ownership).state, worldEquipmentId(ownership.encounterId)).state;
  const purchased = buyItem(selected, 'springheel-boots:common:boots').state;
  assert.deepEqual(purchased.equippedItems, selected.equippedItems);
  const emptyBoots = buyItem(glider, 'springheel-boots:common:boots').state;
  assert.equal(emptyBoots.equippedItems.glider, glider.equippedItems.glider);
  assert.equal(emptyBoots.equippedItems.boots, inventoryItemId(emptyBoots.inventory[1]!));
});

test('old single-slot glider saves migrate into the glider slot without auto-equipping boots', () => {
  const purchased = buyItem({ ...createPlayerState(), coins: 100 }, 'pocket-glider:common:glider').state;
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
    assert.throws(() => collectCoin(state, PAGE, rareKey, 0), /integer range/);
    assert.equal(state[field], Number.MAX_SAFE_INTEGER);
    assert.deepEqual(state.collectedCoins, []);
  }
});
