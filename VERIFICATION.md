# Verification record

## Tested build and environment

The platforming-only MV3 build was loaded as an actual unpacked extension in Linux Chromium **155.0.8059.84**. Its real action popup was exercised using a standalone Puppeteer run: Start, Down, Escape, Start again, and popup Stop all passed. The final native-popup smoke ended with zero overlay nodes. This was not a page-script-only simulation.

Final source checks passed:

```text
npm run typecheck     passed
npm test              6 tests passed, 0 failed
npm run build         passed; dist/content.js and dist/popup.js generated
```

The six physics regressions cover first-top landing during a fast fall, stable resting over 1,200 steps, ascent through one-way tops followed by landing, horizontal misses, swept horizontal crossing before leaving a ledge, dropping onto the next lower platform, and ignoring drop input in midair. Some cases cover multiple invariants.

Browser checks used disposable profiles, extension action activation, real keyboard/click events, DOM measurements, HUD state, and screenshots. Automated focus emulation kept the test window focused; clicking webpage fields still changed `document.activeElement` and exercised the game’s real pause logic. Temporary browser drivers and inspection bundles were removed from the source tree after verification.

## Google coverage

All three pages below completed jump/airborne/landing checks at each window-width and browser-zoom combination in the next table: **18 successful combinations**. Horizontal keyboard movement was additionally checked at the widest 100% case on each page.

| Live page | Browser mode | Observed content |
| --- | --- | --- |
| [Google homepage](https://www.google.com/) | Headed initial checks; headless full matrix | Logo, search field, buttons, and footer text |
| [Search: typescript](https://www.google.com/search?q=typescript) | Headed | Actual result headings including “TypeScript: JavaScript With Syntax For Types.” and documentation links |
| [Search: steam engine](https://www.google.com/search?q=steam+engine) | Headed | Actual results including “Steam engine” and “Steam engine \| Definition, History, Impact, & Facts” |

The window content area was configured 900 pixels high at 100%. These are **real Chrome tab zoom settings**, checked through `chrome.tabs.getZoom`, not CSS transforms or device-scale-only substitutes:

| Configured width | CSS viewport at 100% | CSS viewport at 125% |
| ---: | ---: | ---: |
| 1440 | 1440 × 900 | 1152 × 720 |
| 1024 | 1024 × 900 | 819 × 720 |
| 768 | 768 × 900 | 614 × 720 |

Additional live Google checks:

- Scrolling results by approximately 700 CSS pixels rebuilt nearby geometry and produced a visible grounded character at document `y = 1115.5`.
- Typing `steam engine ad ws`, arrow-key editing, and a space into Google’s search textarea worked normally. The HUD reported Paused; the character remained at `x = 202.0`, `y = 1115.5` throughout the keyboard check. Focus game resumed control.
- Navigation between the homepage and two result queries removed the previous document’s overlay. Activation on the new document worked.
- Geometry changed as Google’s dynamic results loaded, without modifying the page layout.
- Escape removed the overlay; starting again produced one overlay.

A separate **headless** search request was redirected to Google’s `/sorry/` CAPTCHA page. Its movement checks are **excluded** from the search-results coverage above. No CAPTCHA was solved or bypassed. The two search-result matrices were completed in ordinary headed Chromium instead. Google’s experiments and dynamic content changed exact platform counts between visits.

## Reusable geometry fixtures

Both fixtures were served locally over HTTP using `npm run fixture` and activated through the extension.

### `fixtures/layout.html`

- Grid headings appeared at distinct measured positions rather than card-wrapper rectangles.
- Flex items at different heights produced separate text platforms.
- All **12 measured Range fragments** in the wrapped paragraph/link case matched extracted top edges.
- Hidden-attribute, `display:none`, `visibility:hidden`, zero-opacity, decorative, offscreen, and overlay content did not appear in the checked platform labels.
- Keyboard running, jumping through a top from below, and landing on a higher text line worked.
- Down and S descended to successive lines: grounded character `y = 480.5 → 506.0 → 531.5`; page scroll remained zero. The independent native-popup run also verified Down on the final build (`483.0 → 509.0`).
- Clicking **Append and move platforms** shifted the grid heading by 45 pixels, appended content, and led to a safe grounded position on the rebuilt geometry.
- A native wrapped link navigated to `#lower` and scrolled the page while the canvas was active. The game rebuilt nearby terrain and could be refocused there.
- Adding unrelated far-offscreen content preserved a safe character position exactly (`x = 709.0`, `y = 483.0`).

### `fixtures/sparse.html`

- The image’s rendered top became DOM terrain.
- The sparse viewport produced three explicitly rendered brass supplementary platforms alongside three measured DOM surfaces.
- Keyboard jumping reached a supplementary destination, with a grounded character at `y = 227.3`; the visible route was inspected in a screenshot.
- Running off the image produced a fall to `y = 643.1`, downward speed `893.3`, then an automatic grounded respawn at `y = 390.0`.

## Additional live-site compatibility

| Page | Exercised behavior | Adjustments |
| --- | --- | --- |
| [Wikipedia: Steam engine](https://en.wikipedia.org/wiki/Steam_engine) | Activation; jump and landing; Down to the next text line; approximately 1,200 pixels of scrolling; grounded respawn; screenshot alignment | None; generic text/image extraction |
| [GitHub: microsoft/TypeScript](https://github.com/microsoft/TypeScript) | Activation; jump and landing; Down; approximately 1,100 pixels of scrolling; resize from 1440 to 768; grounded state and screenshot alignment | None; generic text/control extraction |

These are compatibility spot checks, not a claim that every Wikipedia or GitHub page is supported. Debug rendering is visually dense on text-heavy pages. Only the Google pages received the full width/zoom matrix.

## Lifecycle and restart

- Ten Start/Stop cycles, each including repeated content-bundle injection while active, completed without leaving an overlay after Stop.
- In the extension’s **isolated execution context**, native DOM event-listener inspection showed seven Window listeners and three Document listeners while active; both returned to zero after Stop.
- The extension-world animation request counter was 24 at Stop and still 24 after 30 further browser frames, a page mutation, and a resize event. No overlay reappeared.
- A real Chromium process was closed and relaunched using the same test profile. The unpacked extension remained enabled, and the native activation path produced a grounded character on the local fixture again.
- Debug mode restarted consistently: after Stop/Start it defaulted off, and the first Debug click correctly showed geometry and pressed state.

No progression or position restoration is claimed. No inventory, reward-claim, multiplayer, or deterministic-encounter test was run, because those features were explicitly deferred.

## Verification limits

Only Linux Chromium 155 was exercised; Chrome on other operating systems and older versions were not. Manual Developer-mode installation instructions are provided, while automated installation used Chromium’s unpacked-extension debugging API. No performance benchmark or exhaustive accessibility audit was run.

Iframe/shadow-root terrain, occluded/clipped content, continuous CSS animations, arbitrary SPA frameworks, and extreme document sizes were not comprehensively tested. The bounded local bridge route does not make every element of a full website reachable. These constraints are also described in the README.
