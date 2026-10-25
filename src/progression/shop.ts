import type { Equipment } from './progression-types';
import { equipmentId } from './equipment-id';
import { bootTier, createBoot } from './boots';

export interface ShopOffer {
  item: Equipment;
  price: number;
  sellPrice: number;
}

const offers: { item: Omit<Equipment, 'id'>; price: number; sellPrice: number }[] = [
  { item: createBoot('common', true), price: 12, sellPrice: bootTier('common').sellPrice },
  {
    item: {
      name: 'Pocket Glider', slot: 'glider', rarity: 'common',
      jumpMultiplier: 1, ability: 'glide', color: '#7fe4d7',
      description: 'Hold Space while descending to float.',
    },
    price: 200, sellPrice: 100,
  },
];

export const SHOP_OFFERS: readonly ShopOffer[] = offers.map(offer => ({
  ...offer, item: { ...offer.item, id: equipmentId(offer.item) },
}));

export function shopOffer(itemId: string): ShopOffer | undefined {
  return SHOP_OFFERS.find(offer => offer.item.id === itemId);
}

export function sellValue(item: Equipment): number {
  return item.slot === 'glider' ? 100 : bootTier(item.rarity).sellPrice;
}
