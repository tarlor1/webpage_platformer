import type { PlayerState } from '../progression/progression-types';
import { SHOP_OFFERS, shopOffer } from '../progression/shop';
import { equipmentId, inventoryItemId } from '../progression/equipment-id';

export interface ShopPanel {
  update(state: PlayerState | null, error?: string): void;
  dispose(): void;
}

export function mountShopUI(
  dialog: HTMLElement,
  actions: { buy: (itemId: string) => Promise<void>; sell: (itemId: string) => Promise<void> },
): ShopPanel {
  const document = dialog.ownerDocument;
  const description = document.createElement('p');
  const offers = document.createElement('div');
  offers.className = 'shop-offers';
  const inventory = document.createElement('div');
  inventory.className = 'shop-sell';
  const message = document.createElement('p');
  message.className = 'shop-message';
  message.setAttribute('role', 'status');
  dialog.append(description, offers, inventory, message);
  const listeners = new AbortController();
  let state: PlayerState | null = null;
  let error = '';
  let pending = '';

  function render(): void {
    const owned = new Set(state?.inventory.map(equipmentId) ?? []);
    offers.replaceChildren();
    for (const offer of SHOP_OFFERS) {
      const row = document.createElement('div');
      row.className = 'shop-offer';
      const text = document.createElement('span');
      text.textContent = `${offer.item.name} — ${offer.price} coins · ${offer.item.description}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.shopBuy = offer.item.id;
      button.textContent = pending === `buy:${offer.item.id}` ? 'Buying…' : 'Buy';
      button.disabled = !state || owned.has(offer.item.id) || state.coins < offer.price || !!pending;
      row.append(text, button);
      offers.append(row);
    }
    inventory.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = 'Sell inventory';
    inventory.append(heading);
    if (!state?.inventory.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No items to sell.';
      inventory.append(empty);
    } else for (const item of state.inventory) {
      const instanceId = inventoryItemId(item);
      const row = document.createElement('div');
      row.className = 'shop-offer';
      const text = document.createElement('span');
      const offer = shopOffer(item.id);
      text.textContent = `${item.name} — sell for ${offer?.sellPrice ?? (item.slot === 'glider' ? 10 : 6)} coins`;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.shopSell = instanceId;
      button.textContent = pending === `sell:${instanceId}` ? 'Selling…' : 'Sell';
      button.disabled = !!pending;
      row.append(text, button);
      inventory.append(row);
    }
    description.textContent = state ? `Coins: ${state.coins}. Buy equipment or sell owned items for a lower return.` : 'Loading shop…';
    message.textContent = error;
    message.hidden = !error;
  }

  dialog.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || pending) return;
    const buy = target.closest<HTMLButtonElement>('[data-shop-buy]')?.dataset.shopBuy;
    const sell = target.closest<HTMLButtonElement>('[data-shop-sell]')?.dataset.shopSell;
    const kind = buy ? 'buy' : sell ? 'sell' : '';
    const itemId = buy ?? sell;
    if (!kind || !itemId) return;
    pending = `${kind}:${itemId}`;
    error = '';
    render();
    void (kind === 'buy' ? actions.buy(itemId) : actions.sell(itemId)).catch(caught => {
      error = caught instanceof Error ? caught.message : String(caught);
    }).finally(() => { pending = ''; render(); });
  }, { signal: listeners.signal });

  render();
  return {
    update(next, nextError) { state = next; error = nextError ?? ''; render(); },
    dispose() { listeners.abort(); dialog.removeChild(description); dialog.removeChild(offers); dialog.removeChild(inventory); dialog.removeChild(message); },
  };
}
