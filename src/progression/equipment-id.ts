import type { Equipment } from './progression-types';

/** Item identity is independent of the shop or platform where it was found. */
export function equipmentId(item: Pick<Equipment, 'name' | 'rarity' | 'slot'>): string {
  const name = item.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${name}:${item.rarity}:${item.slot}`;
}

/** Equip and sell a particular copy, rather than every item of the same kind. */
export function inventoryItemId(item: Equipment): string {
  return item.instanceId ?? item.id;
}

/** One pickup per encounter, even if several encounters drop the same catalog item. */
export function worldEquipmentId(encounterId: string): string {
  return `world:${encounterId}`;
}
