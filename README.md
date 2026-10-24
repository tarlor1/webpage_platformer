# Steel & Steam

A working Chrome extension that turns rendered webpage text, controls, and images into a small Canvas 2D platformer. It runs on Google’s homepage and search results, with a reusable engine also checked on Wikipedia and GitHub.

**Current scope is platforming only**, following the revised request. Running, jumping, downward drop-through, supplementary platforms, debug geometry, and browsing-safe activation are implemented. Enemies, combat, equipment, inventory, encounter generation, and saved progression are deferred. Character position and activation are not persisted across full page navigation or browser restart.

## Build and install

Requirements: Node.js 22+ and npm. Python 3 is optional for serving the fixtures.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

1. Open `chrome://extensions` in Chrome or Chromium.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project’s **`dist` directory**, not the project root.
4. Pin **Steel & Steam** using Chrome’s extensions menu.
5. Open `https://www.google.com/`, click the extension, and choose **Start platforming**.
6. Close the popup and click **Focus game** in the bottom-right HUD if gameplay is paused.

The build bundles all runtime code locally. There are no runtime packages to install, remote assets, network requests, account requirements, or backend services. The extension requests only `activeTab` and `scripting`; it does not request blanket access to every site. Chrome grants access when you activate it on a tab.

For development, `npm run watch` rebuilds TypeScript changes. After changing the build, reload the extension in `chrome://extensions`, reload the test webpage, and activate again. Restart the watcher after changing the manifest or popup HTML.

## Controls

| Control | Action |
| --- | --- |
| A / D or ← / → | Run left / right |
| Space / W / ↑ | Jump; pass upward through platforms |
| S / ↓ | Drop through the platform you are standing on; tap again for another level |
| B or **Debug** | Toggle detected top edges, bridge labels, player collision box, coordinates, and grounded state |
| **Focus game** | Return keyboard control to the game |
| **Respawn** | Return to a nearby launch surface |
| Escape, HUD **Stop**, or popup **Stop platforming** | Remove the game overlay |

Only the game’s focused HUD/surface takes movement keys. Clicking a search box, page link, or other webpage element gives control back to the page and pauses physics. Window blur and hidden tabs pause gameplay too. Escape stops the game even when a page field has focus; the key’s normal page behavior is not prevented in that case.

The canvas is click-through. The small HUD occupies its own bottom-right rectangle; use Stop if it covers a page control you need. The extension does not change the page’s layout or CSS.

## Short demonstration

1. Start on Google’s homepage. Enable Debug: **teal edges** are measured DOM surfaces, **brass ledges** are supplementary platforms, and the **red box** is the character collider.
2. Run along the search field or buttons, jump to a higher surface, and tap Down to descend. Dense text can provide closely spaced footholds.
3. Click Google’s search box and type a query such as `typescript`. Gameplay pauses and typing works normally.
4. Submit the search. A full document navigation removes the old game; use the extension’s Start control on the results page.
5. Explore result headings and text. Scroll with the wheel/trackpad, resize the window, or change browser zoom. Nearby geometry rebuilds after a short delay. If the old position is unsafe or offscreen, the character respawns on a nearby visible surface.
6. Press Escape, then Start again. There should be exactly one character and HUD.

For a predictable local demonstration:

```sh
npm run fixture
```

Open `http://127.0.0.1:8080/fixtures/layout.html` for grid, flexbox, wrapped text, native links, scrolling, hidden elements, and an **Append and move platforms** button. Open `http://127.0.0.1:8080/fixtures/sparse.html` for an image surface and visible brass stepping stones. Activate the extension on either page; no file-URL permissions are needed.

## Architecture

TypeScript, Manifest V3, esbuild, and Canvas 2D. No UI or game framework.

| File | Responsibility |
| --- | --- |
| `src/popup.ts`, `popup.html` | User-controlled Start/Stop, active-tab permission, content injection, restricted-page errors |
| `src/content.ts` | One controller per document, extension status/toggle/stop messages, duplicate-injection protection |
| `src/geometry.ts` | DOM inspection, visibility filtering, rendered measurement, text-line extraction, top-edge deduplication |
| `src/level.ts` | Visible spawn selection and a short reachable route using DOM surfaces and limited supplementary bridges |
| `src/physics.ts` | Gravity, swept one-way landing, stable support, and deliberate downward drop-through |
| `src/input.ts` | Focus-gated keys, input clearing, and disposable event listeners |
| `src/render.ts` | Character, brass platforms, and geometry/collider visualization |
| `src/game.ts` | Fixed-step simulation, rebuild scheduling, respawn, HUD, and complete active-game cleanup |
| `src/types.ts` | Shared geometry/body contracts and movement constants |

Geometry uses `getBoundingClientRect()` for controls/images and `Range.getClientRects()` for individual readable text fragments. Generic wrappers are not solid blocks. Hidden/decorative content and the extension overlay are excluded, then overlapping fragments on the same top edge are merged. This follows browser layout, including grid, flexbox, wrapping, and zoom, without reproducing CSS layout in the engine. No Google-specific selector is required in the extractor.

Physics uses **document CSS pixels** throughout. Measurements add the current scroll offset; rendering subtracts it. A 120 Hz fixed timestep and swept top-crossing checks avoid tunneling through thin ledges during fast falls. Jump buffering and brief coyote time make takeoff more forgiving. Bridge spacing derives from the same gravity, speed, and jump impulse as character movement, with conservative reach margins.

DOM measurement and route search happen only during rebuilds, outside the animation loop. Mutation/resize observers, scrolling, load/font completion, viewport changes, and URL changes schedule bounded 140 ms rebuilds. A rebuild preserves a safe position; otherwise it selects a nearby visible spawn. Extraction budgets bound work on large pages: 6,000 visited nodes, 1,600 measured candidate rectangles, and 220 selected platforms.

Stopping aborts active-game DOM listeners, disconnects observers, cancels the rebuild timer and animation frame, and removes the overlay. A single extension-message listener remains so the popup can start a new game without reinjecting duplicate controllers. Full document navigation naturally destroys the old controller. There is no service worker or storage layer in this platforming-only build.

## Verification and limitations

See [VERIFICATION.md](VERIFICATION.md) for the exact live pages, viewport/zoom coverage, lifecycle checks, and verification limits.

- Light DOM only: iframe contents, shadow-root contents, pseudo-element text, and pixels inside arbitrary canvases are not terrain. A canvas element’s own bounds can be a surface.
- Visibility filtering handles common hidden and decorative cases; it is not a full paint/occlusion analysis. Clipped content, overlapping dialogs, CSS animation, and transformed document roots can produce unsuitable surfaces.
- Geometry is local to the viewport plus a margin. Large scrolls can deliberately respawn the character nearby. The game does not auto-scroll the browser camera or guarantee that every surface on an entire website is connected.
- Very dense pages can be busy in Debug mode, and extraction budgets can omit terrain. Turn Debug off for ordinary play.
- Rebuilds are delayed briefly during layout changes. Continually animated layouts are not moving-platform gameplay.
- Chrome-internal pages, the Chrome Web Store, PDFs in Chrome’s viewer, and other restricted documents cannot be injected. The popup explains injection failures.
- Google can show CAPTCHAs to automated browsers. The ordinary headed-browser Google result checks passed; a blocked headless attempt is recorded separately.
- Combat, rewards, inventory, and persistence are intentionally absent. When seeded encounters are added, the requested seed input is host + normalized meaningful query parameters + fragment, excluding recognized tracking parameters. Omitting the pathname deliberately makes distinct paths with the same remaining components share a seed. No seed generator is active in this build.
