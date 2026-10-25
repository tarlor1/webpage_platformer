import { equipmentId } from './equipment-id';
import type { Equipment } from './progression-types';

export const BOOT_TIERS = [
  { rarity: 'common', name: 'Coppercoil Boots', jumpMultiplier: 1.2, color: '#ad874e', weight: 60, price: 12, sellPrice: 6 },
  { rarity: 'uncommon', name: 'Piston Boots', jumpMultiplier: 1.35, color: '#7fe4a1', weight: 25, price: 30, sellPrice: 15 },
  { rarity: 'rare', name: 'Skybound Boots', jumpMultiplier: 1.5, color: '#8bb6ff', weight: 10, price: 60, sellPrice: 30 },
  { rarity: 'epic', name: 'Cloudstep Boots', jumpMultiplier: 1.7, color: '#b9b3ff', weight: 4, price: 120, sellPrice: 60 },
  { rarity: 'legendary', name: 'Vaulting Boots', jumpMultiplier: 1.9, color: '#f5cb7d', weight: 1, price: 240, sellPrice: 120 },
] as const;

export function bootTier(rarity: Equipment['rarity']) {
  return BOOT_TIERS.find(tier => tier.rarity === rarity)!;
}

export function createBoot(rarity: Equipment['rarity'], shopCommon = false): Equipment {
  const tier = bootTier(rarity);
  const name = rarity === 'common' && shopCommon ? 'Springheel Boots' : tier.name;
  return {
    id: equipmentId({ name, rarity, slot: 'boots' }), name, rarity, slot: 'boots',
    jumpMultiplier: tier.jumpMultiplier, color: tier.color,
    description: `Increases jump speed by ${Math.round((tier.jumpMultiplier - 1) * 100)}%.`,
  };
}

/** The integer roll is in [0, 100); weights decrease with rarity. */
export function worldBoot(roll: number): Equipment {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 100) throw new Error('Boot roll is outside the rarity table.');
  let remaining = roll;
  for (const tier of BOOT_TIERS) {
    if (remaining < tier.weight) return createBoot(tier.rarity);
    remaining -= tier.weight;
  }
  throw new Error('Boot roll is outside the rarity table.');
}

/** Bring old randomized names/stats into the same ordered catalog as new items. */
export function normalizeBoot(item: Equipment): Equipment {
  if (item.slot !== 'boots') return item;
  const boot = createBoot(item.rarity, item.name === 'Springheel Boots' || item.id === 'shop:boots');
  if (item.id === boot.id && item.name === boot.name && item.jumpMultiplier === boot.jumpMultiplier
    && item.color === boot.color && item.description === boot.description && item.ability === undefined) return item;
  const { ability: _oldAbility, ...rest } = item;
  return { ...rest, ...boot };
}
