import { Game } from './game';

// The isolated-world global survives repeated executeScript injections on this document.
const scope = globalThis as typeof globalThis & { __steelSteamControllerInstalled?: boolean };
if (!scope.__steelSteamControllerInstalled) {
  const game = new Game();
  chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const type = message.type;
    if (type !== 'webpage-platformer:status' && type !== 'webpage-platformer:toggle' && type !== 'webpage-platformer:stop') return;
    try {
      if (type === 'webpage-platformer:toggle') {
        if (game.active) game.stop();
        else game.start();
      } else if (type === 'webpage-platformer:stop') {
        game.stop();
      }
      respond({ active: game.active });
    } catch (error) {
      game.stop();
      respond({ active: game.active, error: error instanceof Error ? error.message : String(error) });
    }
  });
  scope.__steelSteamControllerInstalled = true;
  // This entry is injected only by an explicit Start action, never on page load.
  game.start();
}
