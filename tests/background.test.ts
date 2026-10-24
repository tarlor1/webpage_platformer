import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encounterForPlatform } from '../src/progression/encounters';
import {
  EQUIPMENT_STORAGE_PREFIX, LEGACY_PLAYER_STORAGE_KEY, PLAYER_STORAGE_KEY,
  type PlayerState, type ProgressionResponse,
} from '../src/progression/progression-types';

function equipmentEncounter(url: string) {
  for (let index = 0; index < 10000; index++) {
    const encounter = encounterForPlatform(url, `platform:${index}`);
    if (encounter.equipment) return { ...encounter, equipment: encounter.equipment };
  }
  throw new Error('A deterministic equipment platform must exist.');
}

test('worker recovers durable ownership and serializes storage pickups with coin and equip requests', async () => {
  const originalChrome = globalThis.chrome;
  const originalConsoleError = console.error;
  const legacyBoots = { id: 'legacy-boots', name: 'Old Boots', slot: 'boots', rarity: 'rare', jumpMultiplier: 1.2, description: 'Legacy reward.' };
  const legacy = { version: 1, revision: 5, coins: 15, xp: 60, level: 1, inventory: [legacyBoots], equippedItemId: legacyBoots.id,
    completedEncounters: ['encounter-v1:old'], claimedRewards: ['encounter-v1:old'], collectedCoins: ['encounter-v1:old:coin:0'] };
  const startupEncounter = equipmentEncounter('https://example.com/before-worker-started');
  const startupOwnership = { encounterId: startupEncounter.id, equipment: startupEncounter.equipment };
  const startupKey = EQUIPMENT_STORAGE_PREFIX + startupEncounter.equipment.id;
  const storage: Record<string, unknown> = {
    [LEGACY_PLAYER_STORAGE_KEY]: structuredClone(legacy),
    [startupKey]: structuredClone(startupOwnership),
  };
  let writes = 0;
  let fullReads = 0;
  let failNextWrite = false;
  let listener: ((request: unknown, sender: { id: string; tab?: { id: number } }, respond: (response: ProgressionResponse) => void) => boolean) | undefined;
  let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
  const mockChrome = {
    runtime: { id: 'test-extension', onMessage: { addListener(callback: typeof listener) { listener = callback; } } },
    storage: {
      onChanged: { addListener(callback: typeof storageListener) { storageListener = callback; } },
      local: {
        async get(keys: string[] | null) {
          await Promise.resolve();
          if (keys === null) { fullReads++; return structuredClone(storage); }
          return Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])]));
        },
        async set(values: Record<string, unknown>) {
          await Promise.resolve();
          if (PLAYER_STORAGE_KEY in values && failNextWrite) {
            failNextWrite = false;
            throw new Error('storage unavailable');
          }
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: structuredClone(storage[key]), newValue: structuredClone(value) };
            storage[key] = structuredClone(value);
          }
          if (PLAYER_STORAGE_KEY in values) writes++;
          storageListener?.(changes, 'local');
        },
      },
    },
  };
  globalThis.chrome = mockChrome as unknown as typeof chrome;
  try {
    // Static import cannot work: worker registration needs the installed Chrome global.
    await import('../src/extension/background');
    function send(request: unknown, tab = 1, extension = 'test-extension'): Promise<ProgressionResponse> {
      const { promise, resolve } = Promise.withResolvers<ProgressionResponse>();
      assert.ok(listener, 'background must register its message listener');
      listener(request, { id: extension, tab: { id: tab } }, resolve);
      return promise;
    }
    const loaded = await Promise.all([send({ type: 'progress:get' }, 1), send({ type: 'progress:get' }, 2)]);
    assert.equal(writes, 1, 'migration and ownership recovery share one queued commit');
    for (const result of loaded) {
      if (!result.ok) assert.fail(result.error);
      assert.deepEqual(result.state, {
        ...legacy, version: 2, revision: legacy.revision + 1,
        inventory: [legacyBoots, startupEncounter.equipment],
        claimedRewards: [...legacy.claimedRewards, startupEncounter.id],
      });
    }
    assert.deepEqual(storage[startupKey], startupOwnership);
    assert.deepEqual(storage[LEGACY_PLAYER_STORAGE_KEY], legacy);

    const url = 'https://example.com/worker';
    const encounter = equipmentEncounter(url);
    const logicalKey = encounter.logicalKey;
    const ownership = { encounterId: encounter.id, equipment: encounter.equipment };
    const ownershipKey = EQUIPMENT_STORAGE_PREFIX + encounter.equipment.id;
    const requests = Array.from({ length: encounter.coinCount }, (_, index) =>
      [send({ type: 'progress:collect', url, logicalKey, index }, 1),
        send({ type: 'progress:collect', url: `${url}?utm_source=tab#heading`, logicalKey, index }, 2)]).flat();
    // Physical pickups write ownership directly, concurrently with both tabs' coins.
    const ownershipWrites = Array.from({ length: 8 }, () => mockChrome.storage.local.set({ [ownershipKey]: ownership }));
    const results = await Promise.all(requests);
    await Promise.all(ownershipWrites);
    assert.ok(results.every(result => result.ok));
    assert.equal(results.filter(result => result.ok && !result.duplicate).length, encounter.coinCount);
    assert.equal(results.filter(result => result.ok && result.duplicate).length, encounter.coinCount);
    assert.equal(results.filter(result => result.ok && result.reward).length, 0);
    const final = await send({ type: 'progress:get' });
    if (!final.ok) throw new Error(final.error);
    assert.equal(final.state.coins, legacy.coins + encounter.coinCount * 5);
    assert.equal(final.state.xp, legacy.xp + encounter.coinCount * 20);
    assert.equal(final.state.revision, legacy.revision + encounter.coinCount + 2);
    assert.deepEqual(final.state.inventory, [legacyBoots, startupEncounter.equipment, encounter.equipment]);
    assert.equal(final.state.equippedItemId, legacyBoots.id);
    assert.equal(final.state.claimedRewards.filter(id => id === encounter.id).length, 1);
    assert.deepEqual(storage[ownershipKey], ownership);
    assert.deepEqual(storage[LEGACY_PLAYER_STORAGE_KEY], legacy);
    assert.equal(fullReads, 1, 'normal requests do not rescan durable ownership');

    const beforeDuplicate = writes;
    await mockChrome.storage.local.set({ [ownershipKey]: ownership });
    const duplicate = await send({ type: 'progress:get' });
    if (!duplicate.ok) throw new Error(duplicate.error);
    assert.deepEqual(duplicate.state, final.state);
    assert.equal(writes, beforeDuplicate);

    const [equipped] = await Promise.all([
      send({ type: 'progress:equip', itemId: startupEncounter.equipment.id }),
      mockChrome.storage.local.set({ [ownershipKey]: ownership }),
    ]);
    if (!equipped.ok) throw new Error(equipped.error);
    const afterEquip = await send({ type: 'progress:get' });
    if (!afterEquip.ok) throw new Error(afterEquip.error);
    assert.equal(afterEquip.state.equippedItemId, startupEncounter.equipment.id);
    assert.equal(afterEquip.state.coins, final.state.coins);
    assert.deepEqual(afterEquip.state.inventory, final.state.inventory);
    assert.equal(afterEquip.state.revision, final.state.revision + 1);

    const beforeInvalid = writes;
    for (const request of [
      { type: 'progress:collect', url, index: 0 },
      { type: 'progress:collect', url, logicalKey: '', index: 0 },
      { type: 'progress:collect', url, logicalKey, index: 0.5 },
      { type: 'progress:collect', url: 'file:///bad', logicalKey, index: 0 },
      { type: 'progress:collect', url, logicalKey, index: 99 },
      { type: 'progress:collect-equipment', url, logicalKey },
      { type: 'progress:equip', itemId: 42 },
      { type: 'progress:equip', itemId: 'unowned' },
      { type: 'progress:unknown' },
    ]) assert.equal((await send(request)).ok, false);
    assert.equal((await send({ type: 'progress:get' }, 1, 'foreign-extension')).ok, false);
    assert.equal(writes, beforeInvalid);

    assert.ok(storageListener);
    storageListener({ [ownershipKey]: { oldValue: ownership } }, 'local');
    storageListener({ [EQUIPMENT_STORAGE_PREFIX + 'ignored']: { newValue: {} } }, 'sync');
    storageListener({ unrelated: { newValue: {} } }, 'local');
    const afterIgnored = await send({ type: 'progress:get' });
    if (!afterIgnored.ok) throw new Error(afterIgnored.error);
    assert.deepEqual(afterIgnored.state, afterEquip.state);
    assert.equal(writes, beforeInvalid);

    const interrupted = equipmentEncounter('https://example.com/interrupted-index');
    const interruptedOwnership = { encounterId: interrupted.id, equipment: interrupted.equipment };
    const interruptedKey = EQUIPMENT_STORAGE_PREFIX + interrupted.equipment.id;
    const indexingFailure = Promise.withResolvers<void>();
    let indexingErrors = 0;
    console.error = () => { indexingErrors++; indexingFailure.resolve(); };
    failNextWrite = true;
    await mockChrome.storage.local.set({ [interruptedKey]: interruptedOwnership });
    await indexingFailure.promise;
    assert.deepEqual(storage[interruptedKey], interruptedOwnership);
    assert.deepEqual((storage[PLAYER_STORAGE_KEY] as PlayerState).inventory, afterEquip.state.inventory);
    failNextWrite = true;
    assert.equal((await send({ type: 'progress:get' })).ok, false);
    assert.deepEqual((storage[PLAYER_STORAGE_KEY] as PlayerState).inventory, afterEquip.state.inventory);
    assert.deepEqual(storage[interruptedKey], interruptedOwnership);
    const recoveredOwnership = await send({ type: 'progress:get' });
    if (!recoveredOwnership.ok) throw new Error(recoveredOwnership.error);
    assert.deepEqual(recoveredOwnership.state.inventory, [...afterEquip.state.inventory, interrupted.equipment]);
    assert.equal(recoveredOwnership.state.claimedRewards.filter(id => id === interrupted.id).length, 1);
    assert.equal(recoveredOwnership.state.coins, afterEquip.state.coins);
    assert.equal(recoveredOwnership.state.xp, afterEquip.state.xp);
    assert.equal(recoveredOwnership.state.equippedItemId, startupEncounter.equipment.id);
    assert.equal(fullReads, 3);
    assert.equal(indexingErrors, 1);
    assert.deepEqual(storage[interruptedKey], interruptedOwnership);

    const retry = { type: 'progress:collect', url, logicalKey: 'new-content', index: 0 };
    failNextWrite = true;
    assert.equal((await send(retry)).ok, false);
    const recovered = await send(retry, 2);
    if (!recovered.ok) throw new Error(recovered.error);
    assert.equal(recovered.state.coins, final.state.coins + 5);
    assert.deepEqual(recovered.state.inventory, recoveredOwnership.state.inventory);
    assert.equal(recovered.state.equippedItemId, startupEncounter.equipment.id);
    const retried = await send(retry);
    if (!retried.ok) throw new Error(retried.error);
    assert.equal(retried.duplicate, true);
    assert.deepEqual(retried.state, recovered.state);
    assert.equal(fullReads, 3);
  } finally {
    globalThis.chrome = originalChrome;
    console.error = originalConsoleError;
  }
});
