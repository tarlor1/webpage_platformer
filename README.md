# Steel & Steam

A Chrome extension that turns a webpage’s rendered text, controls, and images into a small Canvas 2D platformer. Terrain comes only from the original webpage, including moving DOM elements; the extension adds no bridges, stepping stones, or artificial floor.

**Current scope includes persistent platforming progression.** Running, jumping, downward drop-through, moving platforms, silver railway tracks over brown sleepers, roads, coins, XP/levels, rare jump boots, inventory, and saved equipment/completion history are implemented. Combat and enemies are not implemented. Progression persists across navigation and browser restarts; activation and per-page character coordinates do not.

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

The build bundles all runtime code locally. There are no runtime packages to install, remote assets, extension network requests, account requirements, or backend services. Permissions are `activeTab`, `scripting`, and `storage`; the extension does not request blanket website access. Chrome grants page access when you activate it. Player data stays in this Chrome profile's `chrome.storage.local`, not a server or Chrome Sync.

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
| **Inventory → Equip / Unequip** | Manage owned boots; inventory controls retain keyboard focus and pause gameplay |
| Escape, HUD **Stop**, or popup **Stop platforming** | Remove the game overlay |

Only the focused game surface takes movement keys. Clicking inventory controls, a search box, a page link, or another webpage element pauses keyboard gameplay and airborne motion. Grounded riders still follow their moving DOM support. Window blur and hidden tabs pause gameplay too. Use **Focus game** to resume. Escape stops when the game owns focus; page controls may consume Escape, so the HUD Stop button is also available.

The canvas is click-through. The small HUD occupies its own bottom-right rectangle; use Stop if it covers a page control you need. The extension does not change the page’s layout or CSS.

Scrolling or leaving the viewport never requests a relocation, and stationary terrain preserves the character’s document position. A real moving or reflowing webpage surface can still carry its rider; the game does not scroll the camera automatically. Falling below the **document’s bottom** restores the last original platform you stood on at its current location, including when it has moved or is offscreen. If there is no checkpoint or its surface has been removed, the fall stops and the HUD reports **Last platform unavailable · use Respawn or restart**. Use manual Respawn to choose a visible original surface, or stop and restart; no replacement floor is generated.

## Coins, levels, and rare equipment

Each exploration encounter contains **three coin pickups**. Each gives **5 coins and 20 XP**, once per player. Levels advance every 100 XP: `level = 1 + floor(XP / 100)`. Coins currently accumulate as a balance; there is no shop or spending mechanic.

Collecting all three completes that encounter and claims its reward. Roughly **1 in 10 distinct page identities** contains rare boots; this is fixed by the seed, not rerolled on revisits. A rare page gives the same named boots and attributes to every player, while each Chrome profile earns its own copy. Ordinary pages do not guarantee equipment, and changing only tracking parameters cannot farm another reward.

Open **Inventory** in the HUD to see owned items, rarity, effects, and equipped status. **Equip** or **Unequip** saves immediately. One boots slot is active at a time, with no stacking. Boots increase jump velocity by 20%, giving approximately **44% greater jump height** at unchanged gravity. The effect applies to subsequent jumps; equipped boots also change the character's footwear color.

Encounter version 1 uses **host/port + normalized meaningful query parameters + fragment**, excluding recognized tracking parameters, pathname, and protocol. Distinct paths with the same remaining components deliberately share an encounter and its claims. Full canonical identities are retained in claim IDs instead of relying on a collision-prone short hash.

Placement adapts to measured native geometry. The first coin is reachable from the standing surface, and further placements use conservative base-jump routes or same-surface positions/height offsets on sparse pages. No boots are required to earn a page's coins, and no bridges are generated. Moving surfaces carry their pickups. Manual Respawn can replan the remaining pickups when the page layout has become unsuitable.

The service worker is the sole saved-state writer. It serializes coin claims and equipment changes, commits before replying, and treats repeated claims as no-ops. Coins, XP/level, inventory, equipped item, completed encounters, and claimed rewards survive navigation and browser restart. Active tabs synchronize through storage-change notifications. Storage errors are shown in the HUD instead of silently resetting progress.

## Seeded steampunk scenery

The gold background panels are removed. Original platform edges at least 112 CSS pixels wide can receive thin railway tracks or road strips, with rails/sleepers or dashed lane markings. Each decoration is only 10 CSS pixels high and sits just above its original edge. It never creates a platform, bridge, obstacle, or additional collision surface.

Generation version 3 uses the URL's host/port, sorted meaningful query parameters, and fragment. The path/protocol and recognized tracking/cache parameters are excluded. Each original edge keeps its seeded style and anchor while scrolling; moving or resizing native surfaces carry their decoration.

The existing text-clearance mask removes any portion overlapping rendered text, controls, images, SVGs, or protected component bounds. Crowded edges may show only short fragments or no decoration. Tracks and roads do not paint across text to complete a route.

After updating, reload the extension in `chrome://extensions`, refresh the webpage, and Start again. The HUD should show **1.1.0**. Its **Material:** status line describes track/road eligibility. Genuine layout changes can briefly pause decoration while protection rebuilds; unsupported inspection remains a conservative omission.

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

For a reproducible equipment demonstration, open **`http://127.0.0.1:8080/fixtures/progression.html?workshop=23`**. On a fresh profile, start the game and walk along the lower button to collect all three coins. This particular seed awards Skybound Boots. Open Inventory, equip them, click Focus game, stand under the upper button, and jump. Its 160-pixel rise is beyond the base jump but reachable with boots. Restart Chrome using the same profile and activate again to inspect the saved inventory and completion. Using `localhost` or a different port changes the seed.


- `fixtures/progression.html`: original lower/upper buttons for coin collection, rare rewards, and a 160-pixel equipment-gated jump.
- `fixtures/decorations.html`: silver railway tracks over brown wooden sleepers, roads, fine/wrapped text, image/SVG lettering, moving surfaces, fixed/sticky controls, nested scrolling, and dynamic text insertion.
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
| `src/render.ts` | Character/debug rendering and protected-content clipping of the material layer |
| `src/game.ts` | Fixed-step simulation, geometry scheduling, checkpoint recovery, HUD, and complete active-game cleanup |
| `src/types.ts` | Shared geometry/body contracts and movement constants |
| `src/page-identity.ts`, `src/encounters.ts` | Shared URL normalization and deterministic exploration/rare-reward definitions |
| `src/collectibles.ts` | Base-jump reachability and stable native-surface coin anchors |
| `src/player-state.ts`, `src/background.ts` | Versioned state transitions and serialized MV3 storage transactions |
| `src/progression-client.ts`, `src/progression-ui.ts` | Worker messaging, live HUD progression, inventory, and equip/unequip |
| `src/progression-types.ts` | Shared player, equipment, encounter, and message contracts |
| `src/scenery-art.ts` | Cached procedural silver-rail/brown-sleeper and road textures |
| `src/scenery.ts`, `src/scenery-types.ts` | Per-edge style selection and stable native-surface anchors |
| `src/text-clearance.ts` | Text/media masks for native animations, scrolling, and scripted motion |

Geometry uses `getBoundingClientRect()` for controls/images and `Range.getClientRects()` for individual readable text fragments. Generic wrappers are not solid blocks. Large images and images with empty `alt` text are eligible; explicitly hidden or presentation-only images are excluded. Coincident static top edges are deduplicated; independently moving sources keep separate identities. Measurements follow browser layout, including grid, flexbox, wrapping, and zoom, without reproducing CSS layout or using site-specific selectors.

Physics uses **document CSS pixels** throughout. Measurements add the current scroll offset; rendering subtracts it. A 120 Hz fixed timestep and relative swept top-crossing checks support thin ledges and moving surfaces. Riders follow their supporting surface, including while gameplay is paused; jumping or dropping detaches them. Jump buffering and brief coyote time make takeoff more forgiving.

Full DOM scans are debounced by 140 ms and run outside physics. Cached moving sources are sampled about every 16 ms; animation discovery and document-bottom measurement run about every 250 ms. CSS animation/transition, Web Animations, ancestor movement, and mutation-driven style movement feed those samples. Geometry selection considers the viewport, the player, and the retained last-standing source, so offscreen position and checkpoint identity survive scrolling. Extraction budgets bound work on large pages: 6,000 visited nodes, 1,600 measured candidate rectangles, and 220 selected platforms.

Stopping aborts active-game DOM/storage listeners, disconnects observers, cancels timers/animation frames, disposes the inventory panel, and removes the overlay. The content controller remains available for Start/Stop messages. Full navigation destroys the old controller. The separate MV3 service worker coordinates durable progression; stopping gameplay does not delete earned items or claims.

## Verification and limitations

See [VERIFICATION.md](VERIFICATION.md) for the exact live pages, viewport/zoom coverage, lifecycle checks, and verification limits.

- Light DOM only: iframe contents, shadow-root contents, pseudo-element text, and pixels inside arbitrary canvases are not terrain. A canvas element’s own bounds can be a surface.
- Visibility filtering handles common hidden and decorative cases; it is not a full paint/occlusion analysis. Clipped content, overlapping dialogs, and transformed document roots can produce unsuitable surfaces.
- Geometry is selected around the viewport and player, with the last-standing source retained. The game preserves offscreen document position, does not auto-scroll the camera, and does not guarantee that original surfaces form a connected route.
- Very dense pages can be busy in Debug mode, and extraction budgets can omit terrain. Turn Debug off for ordinary play.
- Geometry sampling and debounced scans can lag abrupt layout changes. Moving-platform support follows measured DOM bounds; arbitrary painted pixels are not collision geometry.
- Empty pages or removed checkpoints can leave recovery unavailable. The HUD stops the fall and reports this condition; manual Respawn still requires a visible eligible original surface.
- Chrome-internal pages, the Chrome Web Store, PDFs in Chrome’s viewer, and other restricted documents cannot be injected. The popup explains injection failures.
- Combat and enemies remain absent. Rewards, inventory, equip effects, coins, levels, and local persistence are implemented. Save data is local and editable by the profile owner; this prototype has no server-side anti-cheat or cross-device synchronization.
