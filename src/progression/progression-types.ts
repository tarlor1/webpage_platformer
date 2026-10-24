export interface Equipment {
  id: string;
  name: string;
  slot: 'boots';
  rarity: 'rare';
  jumpMultiplier: number;
  description: string;
  color?: string;
}
export interface PlayerState {
  version: 2;
  revision: number;
  coins: number;
  xp: number;
  level: number;
  inventory: Equipment[];
  equippedItemId: string | null;
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
export interface PagePickup {
  id: string;
  index: number;
  logicalKey: string;
  platformId: string;
  fraction: number;
  lift: number;
  x: number;
  y: number;
  available: boolean;
}
export type ProgressionRequest = { type: 'progress:get' }
  | { type: 'progress:collect'; url: string; logicalKey: string; index: number }
  | { type: 'progress:equip'; itemId: string | null };
export type ProgressionResponse = { ok: true; state: PlayerState; duplicate?: boolean; reward?: Equipment | null }
  | { ok: false; error: string };
export const PLAYER_STORAGE_KEY = 'steelSteam.player.v2';
/** Retained as an untouched migration backup, never overwritten by v2. */
export const LEGACY_PLAYER_STORAGE_KEY = 'steelSteam.player.v1';
