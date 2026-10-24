import { pageSeedKey } from './page-identity';
import type { PageEncounter } from './progression-types';

const VERSION = 1;
const BOOT_NAMES = ['Springheel Boots', 'Skybound Boots', 'Piston Boots', 'Cloudstep Boots', 'Coppercoil Boots', 'Vaulting Boots'] as const;

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

/** Rewards depend on the normalized page alone, never viewport geometry or session state. */
export function encounterForUrl(url: string): PageEncounter {
  const seedKey = pageSeedKey(url);
  // Full canonical identity is retained in persistent IDs: a 32-bit seed collision cannot share claims.
  const id = `encounter-v${VERSION}:${seedKey}`;
  const next = seededRandom(id);
  const hasBoots = next() % 10 === 0;
  return {
    id, seedKey, coinCount: 3, coinValue: 5, xpPerCoin: 20,
    equipment: hasBoots ? {
      id: `${id}:equipment:boots`,
      name: BOOT_NAMES[next() % BOOT_NAMES.length]!,
      slot: 'boots', rarity: 'rare', jumpMultiplier: 1.2,
      description: 'Increases jump speed by 20%, reaching 44% higher. Earned by collecting all three coins on this page.',
    } : null,
  };
}

export function coinId(encounter: PageEncounter, index: number): string {
  return `${encounter.id}:coin:${index}`;
}
