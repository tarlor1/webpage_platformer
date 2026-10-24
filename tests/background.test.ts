import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encounterForPlatform } from '../src/progression/encounters';
import { LEGACY_PLAYER_STORAGE_KEY, PLAYER_STORAGE_KEY, type ProgressionResponse } from '../src/progression/progression-types';

test('worker migrates once and serializes repeated two-tab coin/gear claims with strict messages', async () => {
  const originalChrome = globalThis.chrome;
  const legacyBoots = { id: 'legacy-boots', name: 'Old Boots', slot: 'boots', rarity: 'rare', jumpMultiplier: 1.2, description: 'Legacy reward.' };
  const legacy = { version: 1, revision: 5, coins: 15, xp: 60, level: 1, inventory: [legacyBoots], equippedItemId: legacyBoots.id,
    completedEncounters: ['encounter-v1:old'], claimedRewards: ['encounter-v1:old'], collectedCoins: ['encounter-v1:old:coin:0'] };
  const storage: Record<string, unknown> = { [LEGACY_PLAYER_STORAGE_KEY]: structuredClone(legacy) };
  let writes = 0;
  let failNextWrite = false;
  let listener: ((request: unknown, sender: { id: string; tab?: { id: number } }, respond: (response: ProgressionResponse) => void) => boolean) | undefined;
  const mockChrome = {
    runtime: { id: 'test-extension', onMessage: { addListener(callback: typeof listener) { listener = callback; } } },
    storage: { local: {
      async get(keys: string[]) {
        await Promise.resolve();
        return Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])]));
      },
      async set(values: Record<string, unknown>) {
        await Promise.resolve();
        if (failNextWrite) { failNextWrite = false; throw new Error('storage unavailable'); }
        for (const [key, value] of Object.entries(values)) storage[key] = structuredClone(value);
        writes++;
      },
    } },
  };
  // This mock implements exactly the Chrome worker APIs exercised by these requests.
  globalThis.chrome = mockChrome as unknown as typeof chrome;
  try {
    // Load only after installing Chrome: this test exercises the worker's module-registration boundary.
    await import('../src/extension/background');
    function send(request: unknown, tab = 1, extension = 'test-extension'): Promise<ProgressionResponse> {
      const { promise, resolve } = Promise.withResolvers<ProgressionResponse>();
      assert.ok(listener, 'background must register its message listener');
      listener(request, { id: extension, tab: { id: tab } }, resolve);
      return promise;
    }
    const loaded = await Promise.all([send({ type: 'progress:get' }, 1), send({ type: 'progress:get' }, 2)]);
    assert.equal(writes, 1, 'migration is one queued commit despite simultaneous tabs');
    for (const result of loaded) {
      if (!result.ok) assert.fail(result.error);
      assert.deepEqual(result.state, { ...legacy, version: 2 });
    }
    assert.deepEqual(storage[LEGACY_PLAYER_STORAGE_KEY], legacy, 'v1 backup is never overwritten');

    const url = 'https://example.com/worker';
    let logicalKey = '';
    for (let index = 0; index < 10000; index++) {
      if (encounterForPlatform(url, `platform:${index}`).equipment) { logicalKey = `platform:${index}`; break; }
    }
    assert.ok(logicalKey, 'a deterministic rare platform must exist');
    const encounter = encounterForPlatform(url, logicalKey);
    const requests = Array.from({ length: encounter.coinCount }, (_, index) =>
      [send({ type: 'progress:collect', url, logicalKey, index }, 1),
        send({ type: 'progress:collect', url: `${url}?utm_source=tab#heading`, logicalKey, index }, 2)]).flat();
    const results = await Promise.all(requests);
    assert.ok(results.every(result => result.ok));
    const accepted = results.filter(result => result.ok && !result.duplicate);
    const duplicates = results.filter(result => result.ok && result.duplicate);
    assert.equal(accepted.length, encounter.coinCount);
    assert.equal(duplicates.length, encounter.coinCount);
    assert.equal(results.filter(result => result.ok && result.reward).length, 1, 'gear is awarded exactly once');
    const final = await send({ type: 'progress:get' });
    if (!final.ok) throw new Error(final.error);
    assert.equal(final.state.coins, legacy.coins + encounter.coinCount * 5);
    assert.equal(final.state.xp, legacy.xp + encounter.coinCount * 20);
    assert.equal(final.state.revision, legacy.revision + encounter.coinCount);
    assert.deepEqual(final.state.inventory, [legacyBoots, encounter.equipment]);
    assert.equal(final.state.equippedItemId, legacyBoots.id);
    assert.equal(final.state.claimedRewards.filter(id => id === encounter.id).length, 1);
    assert.deepEqual(storage[LEGACY_PLAYER_STORAGE_KEY], legacy);

    const beforeInvalid = writes;
    for (const request of [
      { type: 'progress:collect', url, index: 0 },
      { type: 'progress:collect', url, logicalKey: '', index: 0 },
      { type: 'progress:collect', url, logicalKey, index: 0.5 },
      { type: 'progress:collect', url: 'file:///bad', logicalKey, index: 0 },
      { type: 'progress:collect', url, logicalKey, index: 99 },
      { type: 'progress:equip', itemId: 42 },
      { type: 'progress:equip', itemId: 'unowned' },
      { type: 'progress:unknown' },
    ]) assert.equal((await send(request)).ok, false);
    assert.equal((await send({ type: 'progress:get' }, 1, 'foreign-extension')).ok, false);
    assert.equal(writes, beforeInvalid);

    const retry = { type: 'progress:collect', url, logicalKey: 'new-content', index: 0 };
    failNextWrite = true;
    assert.equal((await send(retry)).ok, false);
    const recovered = await send(retry, 2);
    if (!recovered.ok) throw new Error(recovered.error);
    assert.equal(recovered.state.coins, final.state.coins + 5);
    assert.equal((await send(retry)).ok, true, 'failed storage must not poison the serialized queue');
  } finally {
    globalThis.chrome = originalChrome;
  }
});
