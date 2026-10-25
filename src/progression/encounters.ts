import { pageSeedKey } from '../page/page-identity';
import { worldBoot } from './boots';
import type { PageEncounter } from './progression-types';
import type { Platform } from '../engine/types';
import { surfaceMetadata } from '../page/surface-metadata';

const VERSION = 3;

function seededRandom(key: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < key.length; index++) state = Math.imul(state ^ key.charCodeAt(index), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

export function validLogicalKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192;
}

type EncounterRewards = Pick<PageEncounter, 'coinCount' | 'equipment'>;
interface EncounterType {
  id: string;
  oneIn: number;
  rewards: (next: () => number, encounterId: string) => EncounterRewards;
}

/** Each type has independent eligibility and reward-attribute seed domains. */
const ENCOUNTER_TYPES: readonly EncounterType[] = [
  {
    id: 'coins', oneIn: 10,
    rewards: next => ({ coinCount: 3 + next() % 5, equipment: null }),
  },
  {
    id: 'equipment:boots', oneIn: 400,
    rewards: next => ({ coinCount: 0, equipment: worldBoot(next() % 100) }),
  },
];

/** Full structured identity prevents seed-hash collisions from sharing persistent claims. */
export function encounterForPlatform(url: string, logicalKey: string): PageEncounter {
  if (!validLogicalKey(logicalKey)) throw new Error('A platform encounter requires a logical platform key.');
  const seedKey = pageSeedKey(url);
  const id = `encounter-v${VERSION}:${JSON.stringify([seedKey, logicalKey])}`;
  let coinCount = 0;
  let equipment: PageEncounter['equipment'] = null;
  for (const type of ENCOUNTER_TYPES) {
    if (seededRandom(`${id}:roll:${type.id}`)() % type.oneIn !== 0) continue;
    const rewards = type.rewards(seededRandom(`${id}:reward:${type.id}`), id);
    coinCount += rewards.coinCount;
    if (rewards.equipment) equipment = rewards.equipment;
  }
  return {
    id, seedKey, logicalKey, coinValue: 1, xpPerCoin: 20, coinCount, equipment,
  };
}

/** Any independently successful type makes the platform reward-bearing. */
export function populatedEncounter(encounter: PageEncounter): boolean {
  return encounter.coinCount > 0 || encounter.equipment !== null;
}

function startedEncounter(encounter: PageEncounter, collected?: ReadonlySet<string>): boolean {
  if (!collected?.size) return false;
  for (let index = 0; index < encounter.coinCount; index++) {
    if (collected.has(coinId(encounter, index))) return true;
  }
  return false;
}

/** Geometry gates eligibility, never the identity, reward count, or gear roll. */
export function eligibleLootPlatform(platform: Platform): boolean {
  const source = surfaceMetadata(platform)?.element;
  // Video interiors remain walkable, but never receive generated loot.
  if (source && (source.tagName.toUpperCase() === 'VIDEO' || source.querySelector('video'))) return false;
  return validLogicalKey(platform.logicalKey) && Number.isFinite(platform.x)
    && Number.isFinite(platform.y) && Number.isFinite(platform.width) && platform.width >= 6;
}

/** Register newly discovered content without clearing previously discovered platform rewards. */
export function discoverEncounters(
  url: string,
  platforms: readonly Platform[],
  known: readonly PageEncounter[] = [],
  collected?: ReadonlySet<string>,
  definitions?: Map<string, PageEncounter>,
): PageEncounter[] {
  const seedKey = pageSeedKey(url);
  const encounters = known.filter(encounter => encounter.seedKey === seedKey
    && (populatedEncounter(encounter) || startedEncounter(encounter, collected)));
  const seen = new Set(encounters.map(encounter => encounter.logicalKey));
  for (const platform of platforms) {
    if (!eligibleLootPlatform(platform) || seen.has(platform.logicalKey!)) continue;
    seen.add(platform.logicalKey!);
    const key = platform.logicalKey!;
    let encounter = definitions?.get(key);
    if (!encounter || encounter.seedKey !== seedKey) {
      encounter = encounterForPlatform(url, key);
      definitions?.set(key, encounter);
    }
    if (populatedEncounter(encounter) || startedEncounter(encounter, collected)) encounters.push(encounter);
  }
  return encounters.sort((a, b) => a.logicalKey < b.logicalKey ? -1 : a.logicalKey > b.logicalKey ? 1 : 0);
}

export function coinId(encounter: PageEncounter, index: number): string {
  return `${encounter.id}:coin:${index}`;
}
