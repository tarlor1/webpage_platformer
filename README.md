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

Deterministic seeding populates about **10% of ordinary logical platforms**, plus every rare equipment platform, with **3–7 coins per populated surface**. Each coin gives **5 coins and 20 XP**, once per player. Levels advance every 100 XP: `level = 1 + floor(XP / 100)`. Coins currently accumulate as a balance; there is no shop or spending mechanic.

Roughly **1% of logical platforms** carry rare, visible boots. Walk into them to own them, with no coin, completion, or level prerequisite. Completing a platform's coin set records encounter completion without awarding equipment. The URL and logical platform determine the coin count and equipment identity, name, color, and attributes. Revisiting, rewrapping text, scrolling, or resizing does not reroll rewards. Every player can collect their own copy.

Open **Inventory** in the HUD to see owned items, rarity, effects, and equipped status. **Equip** or **Unequip** saves immediately. One boots slot is active at a time, with no stacking. New boots increase jump velocity by a seeded **15–25%**, producing approximately **32–56% greater ideal jump height** at unchanged gravity. The effect applies to subsequent jumps; equipped boots also change the character's footwear color. Previously earned boots retain their attributes.

At most **24 active pickups** (coins and equipment combined) are selected near the player and viewport, prioritizing equipment and the current support. Started and completed encounter history is retained independently of that cap. Selection avoids per-frame page-wide loot walks.

Generation version 2 uses **host/port + normalized pathname + approved content-changing query parameters + logical platform key**. Fragments, protocol, tracking parameters, and unrecognized query parameters are excluded. Path case, trailing slash, and encoded separators are preserved where they identify different content. The hostname-keyed `CONTENT_QUERY_PARAMS` registry in `src/page/page-identity.ts` covers Google, YouTube, Wikipedia, Reddit, TikTok, and Instagram; subdomains inherit parent-domain rules. Google country domains share parameter rules while retaining distinct seed hosts. Further content-query rules belong in this registry. Unknown sites still receive pathname-and-platform-seeded rewards. Full canonical identities are retained in claim IDs.

Logical platform keys use authored content IDs, stable controls, owning text blocks, links, and media identities rather than coordinates or discovery order. Wrapped lines and semantic carousel clones share a reward set. Newly inserted content gets its own set; a recycled element with genuinely new content gets a new key. Indistinguishable duplicates can share rewards when the page supplies no stable distinguishing identity. Physical placement adapts to native geometry, with walking and base-jump-reachable height offsets, including narrow surfaces. Only currently collision-selected surfaces expose pickups; missing or budget-omitted surfaces retain their encounter history. Moving surfaces carry their pickups. No bridges are generated.

Physical equipment contact writes an ownership record directly to `chrome.storage.local` under `steelSteam.equipment.v1:<equipment ID>`, with `{ encounterId, equipment }` as its value. There is no equipment-collection RPC. The worker indexes these durable records into inventory through storage-change notifications and recovers them on first load after restart; repeated same-item writes are idempotent. It remains the sole writer of aggregate player state, serializing coin claims and manual equip changes. New pickups are never auto-equipped. Coins, XP/level, inventory, equipped item, completed encounters, and claimed rewards persist locally, and active tabs synchronize through storage changes. Version-1 progression and inventory migrate without overwriting the original save. Legacy page-wide claims remain history; new platform-scoped rewards can be earned on previously visited pages. Invalid saves and storage errors are reported instead of silently resetting progress.

## Seeded steampunk scenery

The gold background panels are removed. Original platform edges at least 112 CSS pixels wide can receive thin railway tracks or road strips, with silver rails over brown sleepers or dashed lane markings. Each strip is 10 CSS pixels high, centered on the collision edge, and replaces the debug stroke along its decorated span. The original artwork is unchanged. It never creates a platform, bridge, obstacle, or additional collision surface.

Scenery generation version 3 uses the same canonical URL rules, including pathname and meaningful query parameters, with fragments excluded. Each discovered edge retains its cached style and anchor while scrolling; moving or resizing native surfaces carry their decoration.

The text-clearance mask removes portions overlapping rendered text and protected media/input content. Button labels are protected as text, allowing the edge strip to remain visible. Crowded or image-heavy edges may show only fragments. Dirty sources retain their existing masks while cached geometry is updated; ordinary scrolling and animation no longer hide the entire material layer. A full discovery that exceeds protection limits disables material safely. Coins and the character are game objects and are not text-masked.

After updating, reload the extension in `chrome://extensions`, refresh the webpage, and Start again. The HUD should show **1.2.0**. Its **Material:** status line describes track/road eligibility or an inspection-limit omission.

## Short demonstration

1. Serve the fixtures as described below and open **`http://127.0.0.1:8080/fixtures/progression.html`**.
2. Activate the extension with a fresh profile. On the lower button, walk into the visible **Piston Boots** with **0 coins**; collecting nearby coins is optional.
3. Open **Inventory**, choose **Equip**, then click **Focus game**. Equipment is always equipped manually.
4. Stand beneath the upper original button and jump. Its **160-pixel rise** is beyond the base jump and reachable with these boots.
5. Enable Debug to inspect native terrain edges, scroll to check grounded support, and use Down to drop through. Escape stops the game; starting again should leave one character and HUD.

For predictable local scenes, run:

```sh
bun run fixture
```

This uses Python 3 to serve `http://127.0.0.1:8080`. Open a fixture and activate the extension; no file-URL permissions are needed.

The default progression fixture selects a normal seed that places **Piston Boots** (1.2× jump velocity) on its lower `foundry-workshop-62` button, alongside three coins. This is an authored fixture seed, not a debug grant or engine exception. Walking into the boots requires neither a jump nor coins. After manual Equip, the upper button demonstrates the 160-pixel jump. A different hostname or port changes the seed and may place different equipment. Saved ownership is separate from activation and per-page coordinates; see the verification record for the scope of exercised restart checks.


- `fixtures/progression.html`: original lower/upper buttons for coin collection, rare rewards, and a 160-pixel equipment-gated jump.
- `fixtures/decorations.html`: silver railway tracks over brown wooden sleepers, roads, fine/wrapped text, image/SVG lettering, moving surfaces, fixed/sticky controls, nested scrolling, and dynamic text insertion.
- `fixtures/animated-layout.html`: JavaScript motion, sticky overlap, horizontal resets, oversized clipped images, native video/iframe frames, decorative canvas, wrapped text, and newly inserted platforms.
- `fixtures/clearance-motion.html`: animated text masks, opacity/clipping changes, decorative versus named canvases, nested scrolling, and immediate insertion protection.
- `fixtures/shadow-media.html`: open-shadow media extraction, inserted shadow children, and roots attached after activation.
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

Geometry uses `getBoundingClientRect()` for controls and media and `Range.getClientRects()` for readable text fragments. Extraction traverses accessible open shadow roots, observes mutations and late attachment, and follows composed ancestors for clipping and visibility. Media is intersected with ancestor overflow clips, so a parallax image inside a cropped frame supplies the visible frame edge. Native video and outer iframe frames are eligible; cross-origin iframe internals are not inspected. YouTube uses a stable media-frame owner so internal video replacement or temporary hiding does not discard the frame platform. Suitable CSS-background media is supported without treating arbitrary large wrappers as solid blocks. Accessibility-only `aria-hidden`, `inert`, or empty `alt` does not itself prove an element is unpainted. Fullscreen decorative GL/Rive canvases are excluded.

Physics uses **document CSS pixels** throughout. Measurements add the current scroll offset; rendering subtracts it. A 120 Hz fixed timestep and relative swept top-crossing checks prevent fast falls through thin ledges. Valid grounded support stays locked through crossings. Existing riders follow reflowed surfaces, but layout jumps are not swept into airborne characters as moving lifts. Detected horizontal resets detach without transporting the rider across the page. Jump buffering and brief coyote time make takeoff more forgiving.

Full DOM scans are debounced by 140 ms and run outside physics. At each animation-frame boundary, cached moving/dirty source bounds and text masks are sampled once; physics, tracks, coins, and the character use that snapshot. Native animation discovery and document-bottom measurement run about every 250 ms. The discovered registry survives viewport selection, while collision selection prioritizes the viewport, player, and retained checkpoint. Extraction budgets bound work on large pages: 6,000 visited nodes, 1,600 measured candidate rectangles per scan, and 220 selected collision platforms. Clearance has separate node/source/rectangle budgets and safely reports incomplete full discovery.

Stopping aborts active-game DOM/storage listeners, disconnects observers, cancels timers/animation frames, disposes the inventory panel, and removes the overlay. The content controller remains available for Start/Stop messages. Full navigation destroys the old controller. The separate MV3 service worker coordinates durable progression; stopping gameplay does not delete earned items or claims.

## Verification and limitations

See [VERIFICATION.md](VERIFICATION.md) for the exact live pages, viewport/zoom coverage, lifecycle checks, and verification limits.

- Open shadow roots are supported; closed roots are inaccessible. Cross-origin iframe internals, pseudo-element text, and objects painted inside arbitrary canvas/WebGL content are not separately detected. Outer iframe frames can provide terrain.
- Visibility and clipping are axis-aligned approximations, not complete paint/occlusion analysis. Rotations, unusual clip paths, transformed document roots, and overlapping dialogs can produce unsuitable surfaces.
- Geometry selection is bounded; very dense pages can omit collision surfaces. Grounded offscreen state and checkpoint identity are retained, but original surfaces are not guaranteed to form a connected route.
- Coin placement is sparse and deterministic, with a 24-active-pickup cap. Rarity is per logical platform, not a fixed per-page equipment quota. This bound is not an FPS guarantee.
- Loop resets cannot always be distinguished from very fast continuous movement using DOM bounds alone. The generic large-horizontal-reset fallback detaches conservatively; seamless loop riding needs a site-specific adapter.
- Empty pages or removed checkpoints can leave recovery unavailable. The HUD stops the fall and reports this condition; manual Respawn still requires a visible eligible original surface.
- Chrome-internal pages, the Chrome Web Store, PDFs in Chrome’s viewer, and other restricted documents cannot be injected. The popup explains injection failures.
- Combat and enemies remain absent. Rewards, inventory, equip effects, coins, levels, and local persistence are implemented. Save data is local and editable by the profile owner; this prototype has no server-side anti-cheat or cross-device synchronization.
