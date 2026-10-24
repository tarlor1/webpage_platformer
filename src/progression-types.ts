export interface Equipment {
  id: string;
  name: string;
  slot: 'boots';
  rarity: 'rare';
  jumpMultiplier: number;
  description: string;
}
export interface PlayerState {
  version: 1;
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
export interface PageEncounter {
  id: string;
  seedKey: string;
  coinCount: number;
  coinValue: number;
  xpPerCoin: number;
  equipment: Equipment | null;
}
export interface PagePickup {
  id: string;
  index: number;
  platformId: string;
  fraction: number;
  lift: number;
  x: number;
  y: number;
}
export type ProgressionRequest = { type: 'progress:get' }
  | { type: 'progress:collect'; url: string; index: number }
  | { type: 'progress:equip'; itemId: string | null };
export type ProgressionResponse = { ok: true; state: PlayerState; duplicate?: boolean; reward?: Equipment | null }
  | { ok: false; error: string };
export const PLAYER_STORAGE_KEY = 'steelSteam.player.v1';
