import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_TIERS, createBoot, normalizeBoot, worldBoot } from '../src/progression/boots';
import { SHOP_OFFERS, sellValue } from '../src/progression/shop';
import { buyItem, collectEquipment, createPlayerState, readPlayerState, sellItem } from '../src/progression/player-state';
import { inventoryItemId } from '../src/progression/equipment-id';
import { encounterForPlatform } from '../src/progression/encounters';

test('five ordered boot tiers have strictly increasing strength and monetary value', () => {
  assert.deepEqual(BOOT_TIERS.map(tier => tier.rarity), ['common', 'uncommon', 'rare', 'epic', 'legendary']);
  for (const [index, tier] of BOOT_TIERS.entries()) {
    const item = createBoot(tier.rarity);
    assert.equal(item.jumpMultiplier, tier.jumpMultiplier);
    assert.equal(sellValue(item), tier.sellPrice);
    assert.ok(tier.sellPrice < tier.price);
    if (index) {
      const previous = BOOT_TIERS[index - 1]!;
      assert.ok(tier.jumpMultiplier > previous.jumpMultiplier);
      assert.ok(tier.price > previous.price);
      assert.ok(tier.sellPrice > previous.sellPrice);
      assert.ok(tier.weight < previous.weight);
    }
  }
});

test('world and shop together contain exactly two common boots and one unique boot for every higher rarity', () => {
  const boots = new Map([...BOOT_TIERS.map(tier => createBoot(tier.rarity)),
    ...SHOP_OFFERS.filter(offer => offer.item.slot === 'boots').map(offer => offer.item)].map(item => [item.id, item]));
  assert.equal(boots.size, 6);
  assert.equal(new Set([...boots.values()].map(item => item.name)).size, 6);
  for (const tier of BOOT_TIERS) {
    assert.equal([...boots.values()].filter(item => item.rarity === tier.rarity).length, tier.rarity === 'common' ? 2 : 1);
  }
  assert.equal(createBoot('common').name, 'Coppercoil Boots');
  assert.equal(createBoot('common', true).name, 'Springheel Boots');
  assert.equal(SHOP_OFFERS.some(offer => offer.item.id === createBoot('common').id), false);
  const gliders = SHOP_OFFERS.filter(offer => offer.item.slot === 'glider');
  assert.equal(gliders.length, 1);
  assert.equal(gliders[0]!.item.rarity, 'common');
});

test('world rarity weights cover all rolls and strictly decrease', () => {
  const counts = new Map<string, number>();
  for (let roll = 0; roll < 100; roll++) {
    const item = worldBoot(roll);
    assert.notEqual(item.name, 'Springheel Boots');
    counts.set(item.rarity, (counts.get(item.rarity) ?? 0) + 1);
  }
  for (const tier of BOOT_TIERS) assert.equal(counts.get(tier.rarity), tier.weight);
  for (const roll of [-1, 100, 0.5, NaN]) assert.throws(() => worldBoot(roll));
});

test('Springheel is buyable while every world boot is only collectible and sellable', () => {
  assert.deepEqual(SHOP_OFFERS.filter(offer => offer.item.slot === 'boots').map(offer => offer.item.id),
    ['springheel-boots:common:boots']);
  for (const offer of SHOP_OFFERS.filter(offer => offer.item.slot === 'boots')) {
    const bought = buyItem({ ...createPlayerState(), coins: 1000 }, offer.item.id).state;
    assert.equal(bought.coins, 1000 - offer.price);
    assert.equal(readPlayerState(bought), bought);
    const sold = sellItem(bought, inventoryItemId(bought.inventory[0]!)).state;
    assert.equal(sold.coins, bought.coins + offer.sellPrice);
  }
  for (const tier of BOOT_TIERS) {
    const equipment = createBoot(tier.rarity);
    assert.throws(() => buyItem({ ...createPlayerState(), coins: 1000 }, equipment.id), /unavailable/);
    const world = collectEquipment(createPlayerState(), { encounterId: 'encounter-v2:rarity-test', equipment }).state;
    assert.equal(sellItem(world, inventoryItemId(world.inventory[0]!)).state.coins, tier.sellPrice);
  }
});

test('legacy boot names and stats normalize without affecting gliders or collapsing copies', () => {
  for (const tier of BOOT_TIERS) {
    const legacy = { ...createBoot(tier.rarity), id: 'old', name: 'Old Boots', jumpMultiplier: 1.25, instanceId: 'copy:1' };
    const state = readPlayerState({ ...createPlayerState(), inventory: [legacy, { ...legacy, instanceId: 'copy:2' }],
      equippedItems: { boots: 'copy:2', glider: null } });
    assert.equal(state.inventory.length, 2);
    assert.equal(state.equippedItems.boots, 'copy:2');
    assert.ok(state.inventory.every(item => item.id === createBoot(tier.rarity).id && item.jumpMultiplier === tier.jumpMultiplier));
    assert.equal(readPlayerState(state), state);
  }
  const glider = SHOP_OFFERS.find(offer => offer.item.slot === 'glider')!.item;
  assert.equal(normalizeBoot(glider), glider);
});

test('equipment fixture seeds common world boots at the authored lower control', () => {
  const encounter = encounterForPlatform('http://127.0.0.1:8080/fixtures/progression.html',
    JSON.stringify(['button', 'foundry-workshop-234', '', 'ground']));
  assert.deepEqual(encounter.equipment, createBoot('common'));
});
