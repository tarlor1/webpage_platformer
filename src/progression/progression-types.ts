export interface Equipment {
  /** Lowercase hyphenated name:rarity:slot, shared by all sources of this item. */
  id: string;
  /** Unique owned copy. Absent on catalog offers and uncollected world items. */
  instanceId?: string;
  name: string;
  slot: 'boots' | 'glider';
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  jumpMultiplier: number;
  description: string;
  ability?: 'glide';
  color?: string;
}
export interface PlayerState {
  version: 2;
  revision: number;
  coins: number;
  xp: number;
  level: number;
  inventory: Equipment[];
  /** One owned instance per equipment slot. */
  equippedItems: Record<Equipment['slot'], string | null>;
  completedEncounters: string[];
  claimedRewards: string[];
  collectedCoins: string[];
}
/** A complete, persistent reward set for one logical native platform. */
export interface PageEncounter {
  id: string;
  seedKey: string;
  logicalKey: string;
  coinCount: number;
  coinValue: number;
  xpPerCoin: number;
  equipment: Equipment | null;
}
interface PickupAnchor {
  id: string;
  logicalKey: string;
  platformId: string;
  fraction: number;
  lift: number;
  x: number;
  y: number;
  available: boolean;
}
export interface CoinPickup extends PickupAnchor {
  kind: 'coin';
  index: number;
}
/** Durable item ownership, written directly when the player touches equipment. */
export interface EquipmentOwnership {
  encounterId: string;
  equipment: Equipment;
}
export interface EquipmentPickup extends PickupAnchor, EquipmentOwnership {
  kind: 'equipment';
}
export type PagePickup = CoinPickup | EquipmentPickup;
export type ProgressionRequest = { type: 'progress:get' }
  | { type: 'progress:collect'; url: string; logicalKey: string; index: number }
  | { type: 'progress:equip'; itemId: string | null; slot?: Equipment['slot'] }
  | { type: 'progress:buy'; itemId: string }
  | { type: 'progress:sell'; itemId: string };
export type ProgressionResponse = { ok: true; state: PlayerState; duplicate?: boolean; reward?: Equipment | null }
  | { ok: false; error: string };
export const PLAYER_STORAGE_KEY = 'steelSteam.player.v2';
/** Retained as an untouched migration backup, never overwritten by v2. */
export const LEGACY_PLAYER_STORAGE_KEY = 'steelSteam.player.v1';
export const EQUIPMENT_STORAGE_PREFIX = 'steelSteam.equipment.v1:';
