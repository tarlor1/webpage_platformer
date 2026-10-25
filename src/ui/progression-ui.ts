import { coinId } from '../progression/encounters';
import type { Equipment, PageEncounter, PlayerState } from '../progression/progression-types';
import { inventoryItemId } from '../progression/equipment-id';

interface EquipmentRow {
  element: HTMLLIElement;
  icon: HTMLElement;
  name: HTMLElement;
  rarity: HTMLElement;
  description: HTMLElement;
  effect: HTMLElement;
  ids: HTMLElement;
  marker: HTMLElement;
  button: HTMLButtonElement;
}

export interface ProgressionPanel {
  update(state: PlayerState | null, encounters: readonly PageEncounter[], error?: string): void;
  setDebug(enabled: boolean): void;
  dispose(): void;
}

export function mountProgressionUI(
  section: HTMLElement,
  actions: { equip: (itemId: string | null, slot: Equipment['slot']) => Promise<void> },
): ProgressionPanel {
  const document = section.ownerDocument;
  const root = document.createElement('div');
  root.className = 'progression-panel';
  const style = document.createElement('style');
  style.textContent = `
    .progression-panel{margin:9px 0;padding-top:8px;border-top:1px solid #ad874e88;font:13px/1.45 system-ui,sans-serif;color:#f1e5ce}
    .progression-panel .progression-stats{display:flex;justify-content:space-between;gap:8px;color:#f5cb7d;font-weight:600}
    .progression-panel .progression-xp-label{display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-size:12px}
    .progression-panel progress{display:block;width:100%;height:7px;margin:3px 0 6px;accent-color:#d5a653;border:0;border-radius:4px;overflow:hidden;background:#101b22}
    .progression-panel progress::-webkit-progress-bar{background:#101b22}
    .progression-panel progress::-webkit-progress-value{background:#d5a653}
    .progression-panel .progression-page{font-size:12px;color:#d6dfdc}
    .progression-panel details{margin-top:7px;border:1px solid #ad874e66;border-radius:4px;background:#15212b}
    .progression-panel summary{padding:6px 8px;cursor:pointer;color:#f5cb7d;font-weight:600}
    .progression-panel summary:focus-visible{outline:2px solid #62d8cd;outline-offset:2px;border-radius:3px}
    .progression-panel .progression-inventory{max-height:220px;overflow:auto;overscroll-behavior:contain;padding:0 8px 8px;scrollbar-color:#ad874e #15212b}
    .progression-panel .progression-empty{margin:2px 0;color:#c8d2d3;font-size:12px}
    .progression-panel ul{list-style:none;padding:0;margin:0}
    .progression-panel li{padding:8px 0;border-top:1px solid #59697166}
    .progression-panel .progression-item-heading{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
    .progression-panel .progression-boot{display:inline-block;width:16px;height:16px;border-left:7px solid #ad874e;border-bottom:6px solid #ad874e;border-radius:2px}
    .progression-panel .progression-item-name{font-weight:600;color:#f1e5ce}
    .progression-panel .progression-rare{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#b9b3ff;border:1px solid #9286cd;border-radius:3px;padding:0 4px}
    .progression-panel .progression-equipped{font-size:11px;color:#7fe4d7}
    .progression-panel .progression-description{font-size:12px;color:#c8d2d3;margin:3px 0}
    .progression-panel .progression-effect{font-size:12px;color:#f5cb7d;margin:3px 0 6px}
    .progression-panel .progression-item-ids{display:none;font:11px/1.4 monospace;color:#c8d2d3;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}
    .progression-panel[data-debug] .progression-item-ids{display:block}
    .progression-panel button{background:#344953;color:#fff1d8;border:1px solid #ad874e;border-radius:4px;padding:5px 9px;font:inherit;cursor:pointer}
    .progression-panel button:focus-visible{outline:2px solid #62d8cd}
    .progression-panel button:disabled,.progression-panel button[aria-disabled="true"]{cursor:wait;opacity:.55}
    .progression-panel .progression-message{font-size:12px;margin:5px 0 0;color:#c8d2d3}
    .progression-panel .progression-error{color:#ffbeb1;overflow-wrap:anywhere}
    .progression-panel [hidden]{display:none!important}
  `;

  const stats = document.createElement('div');
  stats.className = 'progression-stats';
  const level = document.createElement('span');
  const coins = document.createElement('span');
  stats.append(level, coins);
  const xpLabel = document.createElement('div');
  xpLabel.className = 'progression-xp-label';
  const xpText = document.createElement('span');
  const xpNext = document.createElement('span');
  xpLabel.append(xpText, xpNext);
  const xpBar = document.createElement('progress');
  xpBar.max = 100;
  xpBar.value = 0;
  xpBar.setAttribute('aria-label', 'Experience toward next level');
  const page = document.createElement('div');
  page.className = 'progression-page';

  const inventory = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Inventory';
  const inventoryBody = document.createElement('div');
  inventoryBody.className = 'progression-inventory';
  const empty = document.createElement('p');
  empty.className = 'progression-empty';
  const list = document.createElement('ul');
  list.setAttribute('aria-label', 'Owned equipment');
  inventoryBody.append(empty, list);
  inventory.append(summary, inventoryBody);

  const status = document.createElement('p');
  status.className = 'progression-message';
  status.setAttribute('role', 'status');
  const errorMessage = document.createElement('p');
  errorMessage.className = 'progression-message progression-error';
  errorMessage.setAttribute('role', 'alert');
  errorMessage.hidden = true;
  root.append(style, stats, xpLabel, xpBar, page, inventory, status, errorMessage);
  section.append(root);

  const listeners = new AbortController();
  const rows = new Map<string, EquipmentRow>();
  let currentState: PlayerState | null = null;
  let currentEncounters: readonly PageEncounter[] = [];
  let externalError = '';
  let equipError = '';
  let pending = false;
  let pendingItemId: string | null = null;
  let disposed = false;

  function setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }

  function createRow(item: Equipment): EquipmentRow {
    const element = document.createElement('li');
    const heading = document.createElement('div');
    heading.className = 'progression-item-heading';
    const icon = document.createElement('span');
    icon.className = 'progression-boot';
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'progression-item-name';
    const rarity = document.createElement('span');
    rarity.className = 'progression-rare';
    const marker = document.createElement('span');
    marker.className = 'progression-equipped';
    marker.textContent = 'Equipped';
    heading.append(icon, name, rarity, marker);
    const description = document.createElement('p');
    description.className = 'progression-description';
    const effect = document.createElement('p');
    effect.className = 'progression-effect';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.equipmentId = inventoryItemId(item);
    const ids = document.createElement('div');
    ids.className = 'progression-item-ids';
    element.append(heading, description, effect, button, ids);
    list.append(element);
    return { element, icon, name, rarity, description, effect, ids, marker, button };
  }

  function render(): void {
    if (disposed) return;
    const state = currentState;
    setText(level, state ? `Level ${state.level}` : 'Level —');
    setText(coins, state ? `${state.coins} coins` : 'Coins —');
    const progress = state ? state.xp % 100 : 0;
    setText(xpText, state ? `${state.xp} XP total` : 'XP —');
    setText(xpNext, state ? `${progress}/100 to next level` : 'Loading…');
    xpBar.value = progress;
    xpBar.setAttribute('aria-valuetext', state ? `${progress} of 100 XP toward next level` : 'Loading experience');
    const encounters = currentEncounters;
    let total = 0, collected = 0, completed = 0;
    const claimed = new Set(state?.collectedCoins ?? []);
    for (const encounter of encounters) {
      total += encounter.coinCount;
      let platformCoins = 0;
      for (let index = 0; index < encounter.coinCount; index++) {
        if (claimed.has(coinId(encounter, index))) platformCoins++;
      }
      collected += platformCoins;
      const coinsComplete = platformCoins === encounter.coinCount;
      const equipmentComplete = !encounter.equipment || state?.claimedRewards.includes(encounter.id);
      if ((encounter.coinCount > 0 || encounter.equipment) && coinsComplete && equipmentComplete) completed++;
    }
    setText(page, state
      ? `Discovered platforms: ${completed}/${encounters.length} complete · ${collected}/${total} coins collected`
      : `Discovered platforms: ${encounters.length} · loading saved coin progress…`);
    setText(summary, state ? `Inventory (${state.inventory.length})` : 'Inventory');
    setText(empty, state
      ? 'Boots appear on about 0.25% of platforms. Higher rarities jump higher and are harder to find. Gliders are sold by the merchant.'
      : 'Loading saved inventory…');
    empty.hidden = !!state?.inventory.length;

    const ownedIds = new Set(state?.inventory.map(inventoryItemId) ?? []);
    for (const [id, row] of rows) {
      if (!ownedIds.has(id)) {
        row.element.remove();
        rows.delete(id);
      }
    }
    for (const item of state?.inventory ?? []) {
      const instanceId = inventoryItemId(item);
      let row = rows.get(instanceId);
      if (!row) {
        row = createRow(item);
        rows.set(instanceId, row);
      }
      const equipped = state?.equippedItems[item.slot] === instanceId;
      setText(row.name, item.name);
      setText(row.rarity, item.rarity);
      row.rarity.style.color = item.color ?? '#ad874e';
      row.rarity.style.borderColor = item.color ?? '#ad874e';
      setText(row.ids, `ID: ${item.id}\nInstance ID: ${instanceId}`);
      row.icon.style.borderColor = item.color ?? '#ad874e';
      setText(row.description, item.description);
      const heightBonus = Math.round((item.jumpMultiplier ** 2 - 1) * 100);
      setText(row.effect, item.slot === 'glider' ? 'Hold jump in midair to glide'
        : `Jump power ×${item.jumpMultiplier} · ${heightBonus}% higher jumps`);
      row.marker.hidden = !equipped;
      setText(row.button, pending && (pendingItemId === instanceId || (pendingItemId === null && equipped))
        ? 'Saving…' : equipped ? 'Unequip' : 'Equip');
      row.button.setAttribute('aria-label', `${equipped ? 'Unequip' : 'Equip'} ${item.name}`);
      // Keep keyboard focus during saves; the delegated handler rejects pending actions.
      row.button.disabled = !state;
      row.button.setAttribute('aria-disabled', String(pending || !state));
    }
    const error = [externalError, equipError].filter(Boolean).join(' ');
    setText(errorMessage, error);
    errorMessage.hidden = !error;
    setText(status, pending ? 'Saving equipment…' : !state ? 'Loading saved progress…' : '');
    status.hidden = !pending && !!state;
    inventoryBody.setAttribute('aria-busy', String(pending || !state));
  }

  root.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button[data-equipment-id]');
    if (!button || !root.contains(button) || pending || !currentState) return;
    const id = button.dataset.equipmentId;
    const item = currentState.inventory.find(item => inventoryItemId(item) === id);
    if (!id || !item) return;
    const itemId = currentState.equippedItems[item.slot] === id ? null : id;
    pending = true;
    pendingItemId = itemId;
    equipError = '';
    render();
    void (async () => {
      try {
        await actions.equip(itemId, item.slot);
      } catch (error: unknown) {
        if (!disposed) equipError = `Could not save equipment: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        if (!disposed) {
          pending = false;
          pendingItemId = null;
          render();
        }
      }
    })();
  }, { signal: listeners.signal });

  render();
  return {
    setDebug(enabled) {
      if (!disposed) root.toggleAttribute('data-debug', enabled);
    },
    update(state, encounters, error) {
      if (disposed) return;
      currentState = state;
      currentEncounters = encounters;
      externalError = error ?? '';
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      rows.clear();
      root.remove();
    },
  };
}
