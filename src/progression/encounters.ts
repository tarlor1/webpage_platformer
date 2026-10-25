import { pageSeedKey } from '../page/page-identity';
import type { PageEncounter } from './progression-types';
import type { Platform } from '../engine/types';

const VERSION = 3;
const BOOT_NAMES = ['Springheel Boots', 'Skybound Boots', 'Piston Boots', 'Cloudstep Boots', 'Coppercoil Boots', 'Vaulting Boots'] as const;
const BOOT_COLORS = ['#ad874e', '#8bb6ca', '#b9b3ff', '#7fe4d7', '#cf8d67', '#d5a653'] as const;

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
    id: 'equipment:boots', oneIn: 100,
    rewards: (next, id) => {
      const name = BOOT_NAMES[next() % BOOT_NAMES.length]!;
      const jumpMultiplier = (115 + next() % 11) / 100;
      const color = BOOT_COLORS[next() % BOOT_COLORS.length]!;
      return { coinCount: 0, equipment: {
        id: `${id}:equipment:boots`, name, slot: 'boots', rarity: 'rare', jumpMultiplier, color,
        description: `Increases jump speed by ${Math.round((jumpMultiplier - 1) * 100)}%. Find these boots on their webpage platform and pick them up; coins are not required.`,
      } };
    },
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
