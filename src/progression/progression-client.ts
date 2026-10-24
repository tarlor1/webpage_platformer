import { readPlayerState } from './player-state';
import type { PlayerState, ProgressionRequest, ProgressionResponse } from './progression-types';

export async function requestProgression(request: ProgressionRequest): Promise<PlayerState> {
  const response: ProgressionResponse | undefined = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error ?? 'Progress could not be saved: extension worker unavailable.');
  return readPlayerState(response.state);
}
