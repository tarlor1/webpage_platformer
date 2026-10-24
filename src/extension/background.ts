import { collectCoin, equipItem, readPlayerState } from '../progression/player-state';
import { validLogicalKey } from '../progression/encounters';
import { LEGACY_PLAYER_STORAGE_KEY, PLAYER_STORAGE_KEY, type ProgressionResponse } from '../progression/progression-types';

// The worker is the sole writer. Reads belong inside the same queue as commits so
// simultaneous tabs cannot both claim a coin against the same saved revision.
let queue: Promise<void> = Promise.resolve();

function progressionMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
    && 'type' in value && typeof value.type === 'string' && value.type.startsWith('progress:');
}

async function handleRequest(request: Record<string, unknown>): Promise<ProgressionResponse> {
  if (request.type !== 'progress:get' && request.type !== 'progress:collect' && request.type !== 'progress:equip') {
    throw new Error('Unknown progression request.');
  }
  if (request.type === 'progress:collect' && (typeof request.url !== 'string' || request.url.length > 65536
    || !validLogicalKey(request.logicalKey) || typeof request.index !== 'number' || !Number.isSafeInteger(request.index))) {
    throw new Error('Collecting a coin requires a page URL, logical platform key, and integer coin index.');
  }
  if (request.type === 'progress:equip' && request.itemId !== null && typeof request.itemId !== 'string') {
    throw new Error('Equipping requires an owned item ID or null.');
  }

  const saved = await chrome.storage.local.get([PLAYER_STORAGE_KEY, LEGACY_PLAYER_STORAGE_KEY]);
  const source = saved[PLAYER_STORAGE_KEY] === undefined ? saved[LEGACY_PLAYER_STORAGE_KEY] : saved[PLAYER_STORAGE_KEY];
  const current = readPlayerState(source);
  const transition = request.type === 'progress:collect'
    ? collectCoin(current, request.url as string, request.logicalKey as string, request.index as number)
    : request.type === 'progress:equip'
      ? equipItem(current, request.itemId as string | null)
      : { state: current, duplicate: false, reward: null };
  if (saved[PLAYER_STORAGE_KEY] !== current || transition.state !== current) {
    await chrome.storage.local.set({ [PLAYER_STORAGE_KEY]: transition.state });
  }
  return request.type === 'progress:get'
    ? { ok: true, state: transition.state }
    : { ok: true, ...transition };
}

chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
  if (!progressionMessage(request)) return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Progression requests must originate from this extension.' } satisfies ProgressionResponse);
    return false;
  }
  const response = queue.then(() => handleRequest(request));
  // A failed storage operation must reach its caller without poisoning later work.
  queue = response.then(() => undefined, () => undefined);
  void response.then(
    result => sendResponse(result),
    error => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ProgressionResponse),
  );
  // Keep Chrome's response channel alive until the queued storage commit finishes.
  return true;
});
