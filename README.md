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

For development, `bun run watch` rebuilds TypeScript changes. After changing the build, **reload the extension in `chrome://extensions` first**, then reload the webpage and activate again. Refreshing only the webpage can leave the previous service worker running. Restart the watcher after changing the manifest or popup HTML.

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

Grounded characters remain attached to their current original platform when scrolling takes them out of view. Another crossing platform cannot steal support. Jumping, dropping through, walking off, removing the surface, or a detected loop/reset releases support. A falling airborne character whose top moves below the **viewport's bottom** returns to its last standing platform and horizontal offset; falling below the document also recovers. Scrolling a stationary or grounded character out of view does not respawn it. Recovery uses the checkpoint platform's current location, even offscreen; it never creates a floor or scrolls the camera. If that platform has been removed, the fall stops and the HUD reports **Last platform unavailable · use Respawn or restart**. Manual Respawn explicitly chooses a visible original surface.

## Coins, levels, and rare equipment

Each eligible logical platform has **3–7 seeded coin pickups**. Each gives **5 coins and 20 XP**, once per player. Levels advance every 100 XP: `level = 1 + floor(XP / 100)`. Coins currently accumulate as a balance; there is no shop or spending mechanic.

Collecting a platform's entire coin set completes its encounter. Roughly **1% of logical platforms** award rare movement boots automatically to inventory on completion. The URL and logical platform together determine the count, equipment identity, name, color, and attributes. Revisiting, rewrapping text, scrolling, or changing viewport size does not reroll rewards. Every player can earn their own copy.

Open **Inventory** in the HUD to see owned items, rarity, effects, and equipped status. **Equip** or **Unequip** saves immediately. One boots slot is active at a time, with no stacking. New boots increase jump velocity by a seeded **15–25%**, producing approximately **32–56% greater ideal jump height** at unchanged gravity. The effect applies to subsequent jumps; equipped boots also change the character's footwear color. Previously earned boots retain their attributes.

Generation version 2 uses **host/port + normalized pathname + approved content-changing query parameters + logical platform key**. Fragments, protocol, tracking parameters, and unrecognized query parameters are excluded. Path case, trailing slash, and encoded separators are preserved where they can identify different content. A single hostname-keyed lookup table, `CONTENT_QUERY_PARAMS` in `src/page/page-identity.ts`, contains Google, YouTube, and Wikipedia query rules; subdomains inherit their registered parent-domain rule, and Google country domains share Google's parameter rules. Adding another ordinary website requires a table entry, not another variable or conditional branch. Unknown sites still get pathname-and-platform-seeded rewards. Full canonical identities are retained in claim IDs.

Logical platform keys use authored content IDs, stable controls, owning text blocks, links, and media identities rather than coordinates or discovery order. Wrapped lines and semantic carousel clones share a reward set. Newly inserted content gets its own set; a recycled element with genuinely new content gets a new key. Indistinguishable duplicates can share rewards when the page supplies no stable distinguishing identity. Physical placement adapts to native geometry, with walking and base-jump-reachable height offsets, including narrow surfaces. Only currently collision-selected surfaces expose pickups; missing or budget-omitted surfaces retain their encounter history. Moving surfaces carry their pickups. No bridges are generated.

The service worker is the sole saved-state writer. It serializes coin claims and equipment changes, commits before replying, and treats repeated claims as no-ops. Coins, XP/level, inventory, equipped item, completed encounters, and claimed rewards survive navigation and browser restart. Active tabs synchronize through storage-change notifications. Storage version 2 migrates version-1 progression and inventory without overwriting the original save. Legacy page-wide claims remain history; new platform-scoped rewards can be earned on previously visited pages because old saves did not record platform identities. Invalid saves and storage errors are reported instead of silently resetting progress.

## Seeded steampunk scenery

The gold background panels are removed. Original platform edges at least 112 CSS pixels wide can receive thin railway tracks or road strips, with silver rails over brown sleepers or dashed lane markings. Each strip is 10 CSS pixels high, centered on the collision edge, and replaces the debug stroke along its decorated span. The original artwork is unchanged. It never creates a platform, bridge, obstacle, or additional collision surface.

Scenery generation version 3 uses the same canonical URL rules, including pathname and meaningful query parameters, with fragments excluded. Each discovered edge retains its cached style and anchor while scrolling; moving or resizing native surfaces carry their decoration.

The text-clearance mask removes portions overlapping rendered text and protected media/input content. Button labels are protected as text, allowing the edge strip to remain visible. Crowded or image-heavy edges may show only fragments. Dirty sources retain their existing masks while cached geometry is updated; ordinary scrolling and animation no longer hide the entire material layer. A full discovery that exceeds protection limits disables material safely. Coins and the character are game objects and are not text-masked.

After updating, reload the extension in `chrome://extensions`, refresh the webpage, and Start again. The HUD should show **1.2.0**. Its **Material:** status line describes track/road eligibility or an inspection-limit omission.

## Short demonstration

1. Start on Google’s homepage. Enable Debug: **teal edges** show unskinned static DOM segments, **gold edges** identify moving terrain, and the **red box** is the character collider. Road/track strips occupy their collision edges.
2. Run along the search field or buttons, jump to a higher surface, and tap Down to descend. Dense text can provide closely spaced footholds.
3. Click Google’s search box and type a query such as `typescript`. Gameplay pauses and typing works normally.
4. Submit the search. A full document navigation removes the old game; use the extension’s Start control on the results page.
5. Explore result headings and text. Scroll, resize, or change browser zoom: grounded support remains attached even offscreen. Falling below the viewport while airborne recovers the last standing platform. Use **Respawn** explicitly to choose currently visible terrain.
6. Press Escape, then Start again. There should be exactly one character and HUD.

For predictable local scenes, run:

```sh
bun run fixture
```

This uses Python 3 to serve `http://127.0.0.1:8080`. Open a fixture and activate the extension; no file-URL permissions are needed.

For a reproducible equipment demonstration, open **`http://127.0.0.1:8080/fixtures/progression.html`**. Its lower control has a stable authored platform key whose normal seed awards **Piston Boots** after three coins; this is a selected fixture seed, not a debug grant or game-engine exception. Other platforms still have their own seeded counts. Walk and jump to collect the lower control's coins, open Inventory, equip the boots, click Focus game, stand under the upper button, and jump. Its 160-pixel rise is beyond the base jump but reachable with these boots. Restart Chrome using the same profile and activate again to inspect the saved inventory and completion. A different hostname or port changes the seed and may not award these boots.


- `fixtures/progression.html`: original lower/upper buttons for coin collection, rare rewards, and a 160-pixel equipment-gated jump.
- `fixtures/decorations.html`: silver railway tracks over brown wooden sleepers, roads, fine/wrapped text, image/SVG lettering, moving surfaces, fixed/sticky controls, nested scrolling, and dynamic text insertion.
- `fixtures/animated-layout.html`: JavaScript motion, sticky overlap, horizontal resets, oversized clipped images, native video/iframe frames, decorative canvas, wrapped text, and newly inserted platforms.
- `fixtures/clearance-motion.html`: animated text masks, opacity/clipping changes, decorative versus named canvases, nested scrolling, and immediate insertion protection.
- `fixtures/moving.html`: use the scene selector, **Reset**, and **Run/Pause** controls to explore moving images, text, and controls, including ancestor motion, CSS transitions, Web Animations, and JavaScript-driven movement.
- `fixtures/late-motion.html`: activate first, then start an offscreen image’s native Web Animation, including the initially transparent case; no DOM mutation is needed for discovery.
- `fixtures/images.html`: large and empty-alt image surfaces, plus excluded presentation/hidden images.
- `fixtures/empty.html`: no eligible original terrain; no fallback floor is added.
- `fixtures/layout.html`: grid, flexbox, wrapped text, native links, scrolling, hidden elements, and **Append and move platforms**.
- `fixtures/sparse.html`: sparse original image terrain. Gaps stay gaps; neither this scene nor the layout scene receives generated bridges.

## Architecture

TypeScript, Manifest V3, esbuild, and Canvas 2D. No UI or game framework.

| Area | Responsibility |
| --- | --- |
| `src/extension/` | Popup Start/Stop, active-tab permission, one content controller per document, MV3 worker and serialized storage transactions |
| `src/page/` | Reusable DOM extraction, clipping/media frames, retained surface registry, logical content identity, hostname-keyed URL query rules |
| `src/engine/` | Fixed-step physics, input, support locking, reflow/reset semantics, checkpoint recovery, game lifecycle |
| `src/rendering/` | Canvas character/debug rendering, unchanged rail/road textures, stable edge placement, text/media clearance |
| `src/progression/` | Deterministic platform encounters, pickup anchors, equipment, player state/migration, worker protocol/client |
| `src/ui/` | HUD progression, inventory, equip/unequip |

Geometry uses `getBoundingClientRect()` for controls and media and `Range.getClientRects()` for readable text fragments. It intersects media with ancestor overflow clips, so a parallax image inside a stable cropped frame supplies the visible frame edge. Native video and outer iframe frames are eligible; their internal pixels or cross-origin DOM are not inspected. Suitable CSS-background media is supported without treating arbitrary large wrappers as solid blocks. Accessibility-only `aria-hidden`, `inert`, or empty `alt` does not itself prove an element is unpainted. Fullscreen decorative GL/Rive canvases are excluded from terrain and whole-viewport protection.

Physics uses **document CSS pixels** throughout. Measurements add the current scroll offset; rendering subtracts it. A 120 Hz fixed timestep and relative swept top-crossing checks prevent fast falls through thin ledges. Valid grounded support stays locked through crossings. Existing riders follow reflowed surfaces, but layout jumps are not swept into airborne characters as moving lifts. Detected horizontal resets detach without transporting the rider across the page. Jump buffering and brief coyote time make takeoff more forgiving.

Full DOM scans are debounced by 140 ms and run outside physics. At each animation-frame boundary, cached moving/dirty source bounds and text masks are sampled once; physics, tracks, coins, and the character use that snapshot. Native animation discovery and document-bottom measurement run about every 250 ms. The discovered registry survives viewport selection, while collision selection prioritizes the viewport, player, and retained checkpoint. Extraction budgets bound work on large pages: 6,000 visited nodes, 1,600 measured candidate rectangles per scan, and 220 selected collision platforms. Clearance has separate node/source/rectangle budgets and safely reports incomplete full discovery.

Stopping aborts active-game DOM/storage listeners, disconnects observers, cancels timers/animation frames, disposes the inventory panel, and removes the overlay. The content controller remains available for Start/Stop messages. Full navigation destroys the old controller. The separate MV3 service worker coordinates durable progression; stopping gameplay does not delete earned items or claims.

## Verification and limitations

See [VERIFICATION.md](VERIFICATION.md) for the exact live pages, viewport/zoom coverage, lifecycle checks, and verification limits.

- Terrain uses Light DOM boundaries: iframe internals, shadow-root internals, pseudo-element text, and objects painted inside arbitrary canvas/WebGL content are not separately detected. Clearance also inspects accessible shadow-root text.
- Visibility and clipping are axis-aligned approximations, not complete paint/occlusion analysis. Rotations, unusual clip paths, transformed document roots, and overlapping dialogs can produce unsuitable surfaces.
- Geometry selection is bounded; very dense pages can omit collision surfaces. Grounded offscreen state and checkpoint identity are retained, but original surfaces are not guaranteed to form a connected route.
- Text-heavy pages can show many coins. Rarity is per logical platform, not a fixed per-page equipment quota.
- Loop resets cannot always be distinguished from very fast continuous movement using DOM bounds alone. The generic large-horizontal-reset fallback detaches conservatively; seamless loop riding needs a site-specific adapter.
- Empty pages or removed checkpoints can leave recovery unavailable. The HUD stops the fall and reports this condition; manual Respawn still requires a visible eligible original surface.
- Chrome-internal pages, the Chrome Web Store, PDFs in Chrome’s viewer, and other restricted documents cannot be injected. The popup explains injection failures.
- Combat and enemies remain absent. Rewards, inventory, equip effects, coins, levels, and local persistence are implemented. Save data is local and editable by the profile owner; this prototype has no server-side anti-cheat or cross-device synchronization.
