export {};
interface GameStatus { active: boolean; error?: string }
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const status = document.querySelector<HTMLElement>('#status')!;
let tabId: number | undefined;
let busy = false;

function display(result: GameStatus): void {
  toggle.textContent = result.active ? 'Stop platforming' : 'Start platforming';
  status.textContent = result.error ?? (result.active ? 'Running. Focus the page to play.' : 'Ready to turn this page into platforms.');
}

function fail(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  status.textContent = `Cannot run on this page. Open a normal HTTP or HTTPS tab and try again. ${detail}`;
}

async function query(): Promise<GameStatus | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId!, { type: 'webpage-platformer:status' }) as GameStatus;
  } catch {
    // A fresh document has no content receiver until its first explicit Start.
    return undefined;
  }
}

toggle.addEventListener('click', async () => {
  if (busy || tabId === undefined) return;
  busy = true;
  toggle.disabled = true;
  try {
    const current = await query();
    if (current) {
      display(await chrome.tabs.sendMessage(tabId, { type: 'webpage-platformer:toggle' }) as GameStatus);
    } else {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const started = await query();
      if (!started) throw new Error('The page did not accept the game controller. Reload the page and retry.');
      display(started);
    }
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
    toggle.disabled = false;
  }
});

async function initialize(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      status.textContent = 'This page is restricted. Open an HTTP or HTTPS webpage, then use this popup.';
      return;
    }
    tabId = tab.id;
    display(await query() ?? { active: false });
    toggle.disabled = false;
  } catch (error) {
    fail(error);
  }
}
void initialize();
