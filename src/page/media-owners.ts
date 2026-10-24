import { composedParent } from './composed-dom';

/** Player frames that remain terrain while their internal video changes playback state. */
const PLAYER_FRAMES: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  'youtube.com': { movie_player: true },
};

export function mediaFrameOwner(element: Element): Element | undefined {
  let domain = element.ownerDocument.location.hostname;
  let ids: Readonly<Record<string, true>> | undefined;
  while (domain) {
    if (Object.hasOwn(PLAYER_FRAMES, domain)) { ids = PLAYER_FRAMES[domain]; break; }
    const separator = domain.indexOf('.');
    if (separator < 0) return;
    domain = domain.slice(separator + 1);
  }
  if (!ids) return;
  for (let owner: Element | null = element; owner; owner = composedParent(owner)) {
    if (Object.hasOwn(ids, owner.id)) return owner;
  }
}
