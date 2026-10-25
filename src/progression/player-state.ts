import { coinId, encounterForPlatform } from './encounters';
import type { Equipment, EquipmentOwnership, PlayerState } from './progression-types';

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
    equippedItemId: null,
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
    && typeof item.name === 'string' && item.name.length > 0
    && item.slot === 'boots' && item.rarity === 'rare'
    && typeof item.jumpMultiplier === 'number' && Number.isFinite(item.jumpMultiplier)
    && item.jumpMultiplier >= 1.15 && item.jumpMultiplier <= 1.25
    && (item.color === undefined || (typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)))
    && typeof item.description === 'string';
}

/** Reject incompatible/corrupt saves rather than silently replacing earned progress. */
export function readPlayerState(value: unknown): PlayerState {
  if (value === undefined) return createPlayerState();
  if (typeof value !== 'object' || value === null) throw new Error('Saved player state is invalid. Progress was not changed.');
  const state = value as Partial<Omit<PlayerState, 'version'>> & { version?: unknown };
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
    if (owned.has(item.id)) throw new Error('Saved inventory has duplicate equipment. Progress was not changed.');
    owned.add(item.id);
  }
  if (state.equippedItemId !== null && (typeof state.equippedItemId !== 'string' || !owned.has(state.equippedItemId))) {
    throw new Error('Saved equipped item is not owned. Progress was not changed.');
  }
  // Legacy IDs remain untouched: old page-wide claims cannot be mapped to absent platform keys.
  return state.version === 2 ? state as PlayerState : { ...state, version: 2 } as PlayerState;
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
    || !equipment(record.equipment) || !record.equipment.id.startsWith(`${record.encounterId}:equipment:`)) {
    throw new Error('Saved equipment ownership is invalid.');
  }
  const item = record.equipment;
  if (state.claimedRewards.includes(record.encounterId) || state.inventory.some(owned => owned.id === item.id)) {
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

export function equipItem(state: PlayerState, itemId: string | null): PlayerTransition {
  if (itemId !== null && !state.inventory.some(item => item.id === itemId)) {
    throw new Error('Cannot equip equipment that is not owned.');
  }
  if (state.equippedItemId === itemId) return { state, duplicate: true, reward: null };
  return {
    state: { ...state, revision: increment(state.revision, 1), equippedItemId: itemId },
    duplicate: false,
    reward: null,
  };
}
