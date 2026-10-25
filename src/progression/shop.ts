import type { Equipment } from './progression-types';

export interface ShopOffer {
  item: Equipment;
  price: number;
  sellPrice: number;
}

export const SHOP_OFFERS: readonly ShopOffer[] = [
  {
    item: {
      id: 'shop:boots', name: 'Springheel Boots', slot: 'boots', rarity: 'common',
      jumpMultiplier: 1.2, color: '#ad874e',
      description: 'Increases jump height.',
    },
    price: 12, sellPrice: 6,
  },
  {
    item: {
      id: 'shop:glider', name: 'Pocket Glider', slot: 'glider', rarity: 'common',
      jumpMultiplier: 1, ability: 'glide', color: '#7fe4d7',
      description: 'Hold Space while descending to float.',
    },
    price: 20, sellPrice: 10,
  },
];

export function shopOffer(itemId: string): ShopOffer | undefined {
  return SHOP_OFFERS.find(offer => offer.item.id === itemId);
}

export function sellValue(item: Equipment): number {
  return shopOffer(item.id)?.sellPrice ?? (item.slot === 'glider' ? 10 : 6);
}
