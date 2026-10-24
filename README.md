# Steel & Steam

A Chrome extension that turns a webpage’s rendered text, controls, and images into a small Canvas 2D platformer. Terrain comes only from the original webpage, including moving DOM elements; the extension adds no bridges, stepping stones, or artificial floor.

**Current scope is platforming only.** Running, jumping, downward drop-through, moving platforms, debug geometry, and browsing-safe activation are implemented. Enemies, combat, equipment, inventory, encounter generation, and saved progression are deferred. Character position and activation are not persisted across full page navigation or browser restart.

## Build and install

Requirements: **Bun 1.4.4**. Python 3 is optional for serving the fixtures.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

1. Open `chrome://extensions` in Chrome or Chromium.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project’s **`dist` directory**, not the project root.
4. Pin **Steel & Steam** using Chrome’s extensions menu.
5. Open `https://www.google.com/`, click the extension, and choose **Start platforming**.
6. Close the popup and click **Focus game** in the bottom-right HUD if gameplay is paused.

The build bundles all runtime code locally. There are no runtime packages to install, remote assets, network requests, account requirements, or backend services. The extension requests only `activeTab` and `scripting`; it does not request blanket access to every site. Chrome grants access when you activate it on a tab.

For development, `bun run watch` rebuilds TypeScript changes. After changing the build, reload the extension in `chrome://extensions`, reload the test webpage, and activate again. Restart the watcher after changing the manifest or popup HTML.

## Controls

| Control | Action |
| --- | --- |
| A / D or ← / → | Run left / right |
| Space / W / ↑ | Jump; pass upward through platforms |
| S / ↓ | Drop through the platform you are standing on; tap again for another level |
| B or **Debug** | Toggle terrain edges, player collision box, coordinates, and grounded state; gold edges identify actual moving DOM terrain |
| **Focus game** | Return keyboard control to the game |
| **Respawn** | Explicitly move to a currently visible original webpage surface |
| Escape, HUD **Stop**, or popup **Stop platforming** | Remove the game overlay |

Only the game’s focused HUD/surface takes movement keys. Clicking a search box, page link, or other webpage element gives control back to the page and pauses keyboard gameplay and airborne motion. Grounded riders still follow their moving DOM support. Window blur and hidden tabs pause gameplay too. Escape stops the game even when a page field has focus; the key’s normal page behavior is not prevented in that case.

The canvas is click-through. The small HUD occupies its own bottom-right rectangle; use Stop if it covers a page control you need. The extension does not change the page’s layout or CSS.

Scrolling or leaving the viewport never requests a relocation, and stationary terrain preserves the character’s document position. A real moving or reflowing webpage surface can still carry its rider; the game does not scroll the camera automatically. Falling below the **document’s bottom** restores the last original platform you stood on at its current location, including when it has moved or is offscreen. If there is no checkpoint or its surface has been removed, the fall stops and the HUD reports **Last platform unavailable · use Respawn or restart**. Use manual Respawn to choose a visible original surface, or stop and restart; no replacement floor is generated.

## Short demonstration

1. Start on Google’s homepage. Enable Debug: **teal edges** show measured static DOM surfaces, **gold edges** show actual moving DOM terrain, and the **red box** is the character collider.
2. Run along the search field or buttons, jump to a higher surface, and tap Down to descend. Dense text can provide closely spaced footholds.
3. Click Google’s search box and type a query such as `typescript`. Gameplay pauses and typing works normally.
4. Submit the search. A full document navigation removes the old game; use the extension’s Start control on the results page.
5. Explore result headings and text. Scroll, resize, or change browser zoom: geometry refreshes without relocating the character into view. A real moving or reflowing support can still carry its rider. Use **Respawn** explicitly if you want to return to visible terrain.
6. Press Escape, then Start again. There should be exactly one character and HUD.

For predictable local scenes, run:

```sh
bun run fixture
```

This uses Python 3 to serve `http://127.0.0.1:8080`. Open a fixture and activate the extension; no file-URL permissions are needed.

- `fixtures/moving.html`: use the scene selector, **Reset**, and **Run/Pause** controls to explore moving images, text, and controls, including ancestor motion, CSS transitions, Web Animations, and JavaScript-driven movement.
- `fixtures/late-motion.html`: activate first, then start an offscreen image’s native Web Animation, including the initially transparent case; no DOM mutation is needed for discovery.
- `fixtures/images.html`: large and empty-alt image surfaces, plus excluded presentation/hidden images.
- `fixtures/empty.html`: no eligible original terrain; no fallback floor is added.
- `fixtures/layout.html`: grid, flexbox, wrapped text, native links, scrolling, hidden elements, and **Append and move platforms**.
- `fixtures/sparse.html`: sparse original image terrain. Gaps stay gaps; neither this scene nor the layout scene receives generated bridges.

## Architecture

TypeScript, Manifest V3, esbuild, and Canvas 2D. No UI or game framework.

| File | Responsibility |
| --- | --- |
| `src/popup.ts`, `popup.html` | User-controlled Start/Stop, active-tab permission, content injection, restricted-page errors |
| `src/content.ts` | One controller per document, extension status/toggle/stop messages, duplicate-injection protection |
| `src/geometry.ts` | DOM inspection, visibility filtering, stable source/line identities, text-line extraction, and moving-source measurement |
| `src/level.ts` | Original-surface selection and visible spawn selection |
| `src/physics.ts` | Gravity, swept one-way landing, moving support, and deliberate downward drop-through |
| `src/input.ts` | Focus-gated keys, input clearing, and disposable event listeners |
| `src/render.ts` | Character and original-terrain/collider visualization |
| `src/game.ts` | Fixed-step simulation, geometry scheduling, checkpoint recovery, HUD, and complete active-game cleanup |
| `src/types.ts` | Shared geometry/body contracts and movement constants |

Geometry uses `getBoundingClientRect()` for controls/images and `Range.getClientRects()` for individual readable text fragments. Generic wrappers are not solid blocks. Large images and images with empty `alt` text are eligible; explicitly hidden or presentation-only images are excluded. Coincident static top edges are deduplicated; independently moving sources keep separate identities. Measurements follow browser layout, including grid, flexbox, wrapping, and zoom, without reproducing CSS layout or using site-specific selectors.

Physics uses **document CSS pixels** throughout. Measurements add the current scroll offset; rendering subtracts it. A 120 Hz fixed timestep and relative swept top-crossing checks support thin ledges and moving surfaces. Riders follow their supporting surface, including while gameplay is paused; jumping or dropping detaches them. Jump buffering and brief coyote time make takeoff more forgiving.

Full DOM scans are debounced by 140 ms and run outside physics. Cached moving sources are sampled about every 16 ms; animation discovery and document-bottom measurement run about every 250 ms. CSS animation/transition, Web Animations, ancestor movement, and mutation-driven style movement feed those samples. Geometry selection considers the viewport, the player, and the retained last-standing source, so offscreen position and checkpoint identity survive scrolling. Extraction budgets bound work on large pages: 6,000 visited nodes, 1,600 measured candidate rectangles, and 220 selected platforms.

Stopping aborts active-game DOM listeners, disconnects observers, cancels the rebuild timer, moving-source interval, and animation frame, and removes the overlay. A single extension-message listener remains so the popup can start a new game without reinjecting duplicate controllers. Full document navigation naturally destroys the old controller. There is no service worker or storage layer in this platforming-only build.

## Verification and limitations

See [VERIFICATION.md](VERIFICATION.md) for the exact live pages, viewport/zoom coverage, lifecycle checks, and verification limits.

- Light DOM only: iframe contents, shadow-root contents, pseudo-element text, and pixels inside arbitrary canvases are not terrain. A canvas element’s own bounds can be a surface.
- Visibility filtering handles common hidden and decorative cases; it is not a full paint/occlusion analysis. Clipped content, overlapping dialogs, and transformed document roots can produce unsuitable surfaces.
- Geometry is selected around the viewport and player, with the last-standing source retained. The game preserves offscreen document position, does not auto-scroll the camera, and does not guarantee that original surfaces form a connected route.
- Very dense pages can be busy in Debug mode, and extraction budgets can omit terrain. Turn Debug off for ordinary play.
- Geometry sampling and debounced scans can lag abrupt layout changes. Moving-platform support follows measured DOM bounds; arbitrary painted pixels are not collision geometry.
- Empty pages or removed checkpoints can leave recovery unavailable. The HUD stops the fall and reports this condition; manual Respawn still requires a visible eligible original surface.
- Chrome-internal pages, the Chrome Web Store, PDFs in Chrome’s viewer, and other restricted documents cannot be injected. The popup explains injection failures.
- Combat, rewards, inventory, and persistence are intentionally absent. When seeded encounters are added, the requested seed input is host + normalized meaningful query parameters + fragment, excluding recognized tracking parameters. Omitting the pathname deliberately makes distinct paths with the same remaining components share a seed. No seed generator is active in this build.
