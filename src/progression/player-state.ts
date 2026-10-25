import { coinId, encounterForPlatform } from './encounters';
import type { Equipment, EquipmentOwnership, PlayerState } from './progression-types';
import { shopOffer, sellValue } from './shop';
import { equipmentId, inventoryItemId, worldEquipmentId } from './equipment-id';

export interface PlayerTransition {
  state: PlayerState;
  duplicate: boolean;
  reward: Equipment | null;
}

export function createPlayerState(): PlayerState {
  return {
    version: 2,
    revision: 0,
    coins: 0,
    xp: 0,
    level: 1,
    inventory: [],
    equippedItems: { boots: null, glider: null },
    completedEncounters: [],
    claimedRewards: [],
    collectedCoins: [],
  };
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(item => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function equipment(value: unknown): value is Equipment {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<Equipment>;
  return typeof item.id === 'string' && item.id.length > 0
    && (item.instanceId === undefined || typeof item.instanceId === 'string' && item.instanceId.length > 0)
    && typeof item.name === 'string' && item.name.length > 0
    && (item.slot === 'boots' || item.slot === 'glider')
    && ['common', 'rare', 'epic', 'legendary'].includes(item.rarity as string)
    && typeof item.jumpMultiplier === 'number' && Number.isFinite(item.jumpMultiplier)
    && (item.slot === 'glider' ? item.ability === 'glide' && item.jumpMultiplier === 1
      : item.jumpMultiplier >= 1.15 && item.jumpMultiplier <= 1.25)
    && (item.ability === undefined || item.ability === 'glide')
    && (item.color === undefined || (typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)))
    && typeof item.description === 'string';
}

/** Reject incompatible/corrupt saves rather than silently replacing earned progress. */
export function readPlayerState(value: unknown): PlayerState {
  if (value === undefined) return createPlayerState();
  if (typeof value !== 'object' || value === null) throw new Error('Saved player state is invalid. Progress was not changed.');
  const state = value as Partial<Omit<PlayerState, 'version'>> & { version?: unknown; equippedItemId?: unknown };
  if (state.version !== 2 && state.version !== 1) {
    throw new Error('Saved player state has an unsupported version. Progress was not changed.');
  }
  if (!nonnegativeInteger(state.revision)
    || !nonnegativeInteger(state.coins)
    || !nonnegativeInteger(state.xp)
    || state.level !== 1 + Math.floor(state.xp / 100)
    || !Array.isArray(state.inventory)
    || !state.inventory.every(equipment)
    || !uniqueStrings(state.completedEncounters)
    || !uniqueStrings(state.claimedRewards)
    || !uniqueStrings(state.collectedCoins)) {
    throw new Error('Saved player state is invalid. Progress was not changed.');
  }
  const owned = new Set<string>();
  for (const item of state.inventory) {
    const instance = inventoryItemId(item);
    if (owned.has(instance)) throw new Error('Saved inventory has duplicate equipment instances. Progress was not changed.');
    owned.add(instance);
  }
  const selection = { boots: null, glider: null } as PlayerState['equippedItems'];
  if (state.equippedItems !== undefined) {
    if (!state.equippedItems || typeof state.equippedItems !== 'object') throw new Error('Saved equipment slots are invalid.');
    for (const slot of ['boots', 'glider'] as const) {
      const id = state.equippedItems[slot];
      if (id !== null && (typeof id !== 'string'
        || !state.inventory.some(item => inventoryItemId(item) === id && item.slot === slot))) {
        throw new Error('Saved equipped item is not owned in that slot. Progress was not changed.');
      }
      selection[slot] = id;
    }
  } else {
    if (state.equippedItemId !== null && (typeof state.equippedItemId !== 'string' || !owned.has(state.equippedItemId))) {
      throw new Error('Saved equipped item is not owned. Progress was not changed.');
    }
    const selected = state.inventory.find(item => inventoryItemId(item) === state.equippedItemId);
    if (selected) selection[selected.slot] = inventoryItemId(selected);
  }
  // Keep encounter/coin claims intact; only equipment identity changes.
  const inventory: Equipment[] = [];
  const equippedItems = { ...selection };
  for (const item of state.inventory) {
    const id = equipmentId(item);
    // Deterministic migration preserves every old copy and its original stats.
    const instanceId = item.instanceId ?? `legacy:${item.id}`;
    if (inventoryItemId(item) === selection[item.slot]) equippedItems[item.slot] = instanceId;
    inventory.push(item.id === id && item.instanceId === instanceId ? item : { ...item, id, instanceId });
  }
  if (new Set(inventory.map(inventoryItemId)).size !== inventory.length) {
    throw new Error('Saved inventory has duplicate equipment instances. Progress was not changed.');
  }
  const changed = state.version !== 2 || state.equippedItemId !== undefined || !state.equippedItems
    || equippedItems.boots !== state.equippedItems.boots || equippedItems.glider !== state.equippedItems.glider
    || inventory.length !== state.inventory.length || inventory.some((item, index) => item !== state.inventory![index]);
  if (!changed) return state as PlayerState;
  const { equippedItemId: _legacySelection, ...rest } = state;
  return { ...rest, version: 2, inventory, equippedItems } as PlayerState;
}

function increment(value: number, amount: number): number {
  const next = value + amount;
  if (!Number.isSafeInteger(next)) throw new Error('Player progression exceeds the supported integer range.');
  return next;
}

/** Resolve rewards from both identities, never from equipment or amounts supplied by a caller. */
export function collectCoin(state: PlayerState, url: string, logicalKey: string, index: number): PlayerTransition {
  const encounter = encounterForPlatform(url, logicalKey);
  if (!Number.isInteger(index) || index < 0 || index >= encounter.coinCount) {
    throw new Error('Coin index is outside this platform encounter.');
  }
  const id = coinId(encounter, index);
  if (state.collectedCoins.includes(id)) return { state, duplicate: true, reward: null };

  const collectedCoins = [...state.collectedCoins, id];
  let complete = true;
  for (let coin = 0; coin < encounter.coinCount; coin++) {
    if (!collectedCoins.includes(coinId(encounter, coin))) {
      complete = false;
      break;
    }
  }
  const xp = increment(state.xp, encounter.xpPerCoin);
  return {
    duplicate: false,
    reward: null,
    state: {
      ...state,
      revision: increment(state.revision, 1),
      coins: increment(state.coins, encounter.coinValue),
      xp,
      level: 1 + Math.floor(xp / 100),
      collectedCoins,
      completedEncounters: complete && !state.completedEncounters.includes(encounter.id)
        ? [...state.completedEncounters, encounter.id] : state.completedEncounters,
    },
  };
}

/** Index directly saved ownership, independently of coins, without auto-equipping. */
export function collectEquipment(state: PlayerState, value: unknown): PlayerTransition {
  if (typeof value !== 'object' || value === null) throw new Error('Saved equipment ownership is invalid.');
  const record = value as Partial<EquipmentOwnership>;
  if (typeof record.encounterId !== 'string' || !record.encounterId
    || !equipment(record.equipment) || record.equipment.slot !== 'boots'
    || !(record.equipment.id.startsWith(`${record.encounterId}:equipment:`)
      || (/^encounter-v[12]:/.test(record.encounterId) && record.equipment.id === equipmentId(record.equipment)))) {
    throw new Error('Saved equipment ownership is invalid.');
  }
  const item = { ...record.equipment, id: equipmentId(record.equipment), instanceId: worldEquipmentId(record.encounterId) };
  if (state.claimedRewards.includes(record.encounterId)
    || state.inventory.some(owned => inventoryItemId(owned) === item.instanceId)) {
    return { state, duplicate: true, reward: null };
  }
  return {
    state: {
      ...state,
      revision: increment(state.revision, 1),
      inventory: [...state.inventory, item],
      claimedRewards: [...state.claimedRewards, record.encounterId],
    },
    duplicate: false,
    reward: item,
  };
}

export function equipItem(state: PlayerState, itemId: string | null, slot?: Equipment['slot']): PlayerTransition {
  const item = state.inventory.find(item => inventoryItemId(item) === itemId);
  if (itemId !== null && !item) {
    throw new Error('Cannot equip equipment that is not owned.');
  }
  if (slot !== undefined && slot !== 'boots' && slot !== 'glider') throw new Error('Invalid equipment slot.');
  if (item && slot !== undefined && item.slot !== slot) throw new Error('Item does not fit that equipment slot.');
  // Older clients sent null without a slot to unequip their single selection.
  const equippedItems = item ? { ...state.equippedItems, [item.slot]: itemId }
    : slot ? { ...state.equippedItems, [slot]: null } : { boots: null, glider: null };
  if (equippedItems.boots === state.equippedItems.boots && equippedItems.glider === state.equippedItems.glider) {
    return { state, duplicate: true, reward: null };
  }
  return {
    state: { ...state, revision: increment(state.revision, 1), equippedItems },
    duplicate: false,
    reward: null,
  };
}

export function buyItem(state: PlayerState, itemId: string): PlayerTransition {
  const offer = shopOffer(itemId);
  if (!offer) throw new Error('That shop item is unavailable.');
  if (state.inventory.some(item => equipmentId(item) === offer.item.id)) throw new Error('You already own that item.');
  if (state.coins < offer.price) throw new Error(`You need ${offer.price} coins.`);
  const revision = increment(state.revision, 1);
  const item = { ...offer.item, instanceId: `purchase:${revision}:${offer.item.id}` };
  return {
    state: {
      ...state,
      revision,
      coins: increment(state.coins, -offer.price),
      inventory: [...state.inventory, item],
      equippedItems: { ...state.equippedItems, [item.slot]: state.equippedItems[item.slot] ?? item.instanceId },
    },
    duplicate: false,
    reward: item,
  };
}

export function sellItem(state: PlayerState, itemId: string): PlayerTransition {
  const item = state.inventory.find(candidate => inventoryItemId(candidate) === itemId);
  if (!item) throw new Error('You do not own that item.');
  return {
    state: {
      ...state,
      revision: increment(state.revision, 1),
      coins: increment(state.coins, sellValue(item)),
      inventory: state.inventory.filter(candidate => inventoryItemId(candidate) !== itemId),
      equippedItems: { ...state.equippedItems, [item.slot]: state.equippedItems[item.slot] === itemId ? null : state.equippedItems[item.slot] },
    },
    duplicate: false,
    reward: null,
  };
}
