import { collectCoin, collectEquipment, equipItem, readPlayerState } from '../progression/player-state';
import { validLogicalKey } from '../progression/encounters';
import {
  EQUIPMENT_STORAGE_PREFIX, LEGACY_PLAYER_STORAGE_KEY, PLAYER_STORAGE_KEY,
  type PlayerState, type ProgressionResponse,
} from '../progression/progression-types';

// Aggregate reads and commits share one queue across messages and ownership events.
let queue: Promise<void> = Promise.resolve();
let recoveryPending = true;

interface LoadedPlayerState {
  state: PlayerState;
  stored: unknown;
  recovering: boolean;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

async function loadCurrentState(): Promise<LoadedPlayerState> {
  const recovering = recoveryPending;
  const saved = await chrome.storage.local.get(recovering ? null : [PLAYER_STORAGE_KEY, LEGACY_PLAYER_STORAGE_KEY]);
  const source = saved[PLAYER_STORAGE_KEY] === undefined ? saved[LEGACY_PLAYER_STORAGE_KEY] : saved[PLAYER_STORAGE_KEY];
  let state = readPlayerState(source);
  if (recovering) {
    for (const [key, value] of Object.entries(saved)) {
      if (key.startsWith(EQUIPMENT_STORAGE_PREFIX)) state = collectEquipment(state, value).state;
    }
  }
  return { state, stored: saved[PLAYER_STORAGE_KEY], recovering };
}

async function commitState(loaded: LoadedPlayerState, state: PlayerState): Promise<void> {
  if (loaded.stored !== state) await chrome.storage.local.set({ [PLAYER_STORAGE_KEY]: state });
  if (loaded.recovering) recoveryPending = false;
}

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

  const loaded = await loadCurrentState();
  const current = loaded.state;
  const transition = request.type === 'progress:collect'
    ? collectCoin(current, request.url as string, request.logicalKey as string, request.index as number)
    : request.type === 'progress:equip'
      ? equipItem(current, request.itemId as string | null)
      : { state: current, duplicate: false, reward: null };
  await commitState(loaded, transition.state);
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
  // Storage failures reach the caller without poisoning later queued work.
  const response = enqueue(() => handleRequest(request));
  void response.then(
    result => sendResponse(result),
    error => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ProgressionResponse),
  );
  // Keep Chrome's response channel alive until the queued storage commit finishes.
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const ownership = Object.entries(changes)
    .filter(([key, change]) => key.startsWith(EQUIPMENT_STORAGE_PREFIX) && 'newValue' in change)
    .map(([, change]) => change.newValue);
  if (ownership.length === 0) return;
  void enqueue(async () => {
    try {
      const loaded = await loadCurrentState();
      let state = loaded.state;
      for (const value of ownership) state = collectEquipment(state, value).state;
      await commitState(loaded, state);
    } catch (error) {
      // Ownership stays durable so a later load can retry an interrupted index.
      recoveryPending = true;
      console.error('Failed to index saved equipment ownership.', error);
    }
  });
});
