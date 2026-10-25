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
| Space / W / ↑ | Jump; hold while descending in mid-air to glide |
| S / ↓ | Drop through the platform you are standing on; tap again for another level |
| E | Talk to the nearby shopkeeper and open the shop |
| B or **Debug** | Toggle terrain edges, player collision box, coordinates, and grounded state; gold edges identify actual moving DOM terrain |
| **Focus game** | Return keyboard control to the game |
| **Find player** | Show a large arrow that shrinks toward the player, then fades; offscreen players are indicated at the viewport edge |
| **Respawn** | Explicitly move to a currently visible original webpage surface |
| **Inventory → Equip / Unequip** | Manage owned equipment; inventory controls retain keyboard focus and pause gameplay |
| Escape, HUD **Stop**, or popup **Stop platforming** | Remove the game overlay |

Only the focused game surface takes movement keys. Clicking inventory controls, a search box, a page link, or another webpage element pauses keyboard gameplay and airborne motion. Grounded riders still follow their moving DOM support. Window blur and hidden tabs pause gameplay too. Use **Focus game** to resume. Escape stops when the game owns focus; page controls may consume Escape, so the HUD Stop button is also available.

The canvas is click-through. The small HUD occupies its own bottom-right rectangle; use Stop if it covers a page control you need. The extension does not change the page’s layout or CSS.

Grounded characters remain attached to their current original platform when scrolling takes them out of view. Another crossing platform cannot steal support. Jumping, dropping through, walking off, removing the surface, or a detected loop/reset releases support. A falling airborne character whose top moves below the **viewport's bottom** returns to its last standing platform and horizontal offset; falling below the document also recovers. Scrolling a stationary or grounded character out of view does not respawn it. Recovery uses the checkpoint platform's current location, even offscreen; it never creates a floor or scrolls the camera. If that platform has been removed, the fall stops and the HUD reports **Last platform unavailable · use Respawn or restart**. Manual Respawn explicitly chooses a visible original surface.

## Coins, levels, and rare equipment

Deterministic seeding populates about **10% of ordinary logical platforms**, plus every rare equipment platform, with **3–7 coins per populated surface**. Each coin gives **1 coin and 20 XP**, once per player. Levels advance every 100 XP: `level = 1 + floor(XP / 100)`. Coins accumulate as a balance and can be spent at the merchant.

Roughly **0.25% of logical platforms** carry rare, visible boots. Walk into them to own them, with no coin, completion, or level prerequisite. The merchant sells gliders; gliders never spawn in the world. Completing a platform's coin set records encounter completion without awarding equipment. The URL and logical platform determine the coin count and equipment identity, name, color, and attributes. Revisiting, rewrapping text, scrolling, or resizing does not reroll rewards. Every player can collect their own copy.

Open **Inventory** in the HUD to see owned items, rarity, effects, and equipped status. **Equip** or **Unequip** saves immediately. One equipment item is active at a time. New boots increase jump velocity by a seeded **15–25%**, producing approximately **32–56% greater ideal jump height** at unchanged gravity. The effect applies to subsequent jumps; equipped boots also change the character's footwear color. Previously earned boots retain their attributes.

The shopkeeper sells **Springheel Boots for 12 coins** and a **Pocket Glider for 20 coins**. Buying the first item equips it automatically; later purchases can be equipped from Inventory. The glider activates while descending when Space is held. Selling an item returns **6 coins for boots** or **10 coins for the glider**, below its purchase price.

Equipment catalog IDs use `name:rarity:type`, such as `coppercoil-boots:rare:boots`. Each owned copy also has a unique `instanceId`, used for equipping and selling just that copy. Identical boots found on different platforms can all be collected and sold; owning one does not suppress other drops. The shop blocks buying an identical name/rarity/type while any copy is owned, but permits buying it again after all copies are sold. Each world source is collected once, so reloading or replaying a storage event does not restore a sold drop. Existing saves migrate without merging inventory copies or changing coin/encounter claims.

Pickups are registered across the discovered level and indexed in spatial buckets. Drawing queries every pickup intersecting the viewport, with no nearest-pickup drawing cap; collection uses a separate local query around the player's body. Moving the player does not hide otherwise visible pickups. Encounter definitions and seeded population decisions are cached during incremental discovery.

Generation version 2 uses **host/port + normalized pathname + approved content-changing query parameters + logical platform key**. Fragments, protocol, tracking parameters, and unrecognized query parameters are excluded. Path case, trailing slash, and encoded separators are preserved where they identify different content. The hostname-keyed `CONTENT_QUERY_PARAMS` registry in `src/page/page-identity.ts` covers Google, YouTube, Wikipedia, Reddit, TikTok, and Instagram; subdomains inherit parent-domain rules. Google country domains share parameter rules while retaining distinct seed hosts. Further content-query rules belong in this registry. Unknown sites still receive pathname-and-platform-seeded rewards. Full canonical identities are retained in claim IDs.

Logical platform keys use authored content IDs, stable controls, owning text blocks, links, and media identities rather than coordinates or discovery order. Wrapped lines and semantic carousel clones share a reward set. Newly inserted content gets its own set; a recycled element with genuinely new content gets a new key. Indistinguishable duplicates can share rewards when the page supplies no stable distinguishing identity. Physical placement adapts to native geometry, with walking and base-jump-reachable height offsets, including narrow surfaces. Registered reward-bearing platforms supply pickups independently of the current physics selection; undiscovered surfaces retain their deterministic encounter identity when discovered. Moving surfaces carry their pickups. No bridges are generated.

Physical equipment contact writes an ownership record directly to `chrome.storage.local` under `steelSteam.equipment.v1:<equipment ID>`, with `{ encounterId, equipment }` as its value. There is no equipment-collection RPC. The worker indexes these durable records into inventory through storage-change notifications and recovers them on first load after restart; repeated same-item writes are idempotent. It remains the sole writer of aggregate player state, serializing coin claims and manual equip changes. New pickups are never auto-equipped. Coins, XP/level, inventory, equipped item, completed encounters, and claimed rewards persist locally, and active tabs synchronize through storage changes. The version-2 save format and reward identities are unchanged. Version-1 progression and inventory migrate without overwriting the original save, which remains a backup. Legacy page-wide claims remain history; new platform-scoped rewards can be earned on previously visited pages. Invalid saves and storage errors are reported instead of silently resetting progress.

## Seeded steampunk scenery

Original platform edges at least **30 CSS pixels wide** can receive a railway track or road strip. The unchanged **480 × 10** artwork—silver rails over brown sleepers or dashed road markings—is tiled at native scale across the full eligible edge width, centered on the collision edge. There is no random inset or width cap. Scenery never creates a platform, bridge, obstacle, or additional collision surface.

Each overlapping edge band has a single painted, topmost owner and one stable seeded material. Transparent, layout-only `div` wrappers receive no graphics. A strip is drawn only when its entire width forms a clean continuous band: rendered text, controls, pending inspection, unrelated media, or the HUD can make the result **NONE**. Clearance does not erase fragments from a painted strip. An eligible media surface may decorate its own visible, cropped edge; padding metadata distinguishes that edge from protected interior content. Coins and the character are game objects and do not use material clearance.

Scenery generation version 3 retains the canonical URL rules, including pathname and meaningful query parameters, with fragments excluded. Moving or resizing native surfaces carry their decoration. Valid clearance regions remain available while local dirty or newly discovered regions are queued; uncertainty blocks only the affected region. Discovery continues across large pages without a global inspection-limit shutdown.

After updating, reload the extension in `chrome://extensions`, refresh the webpage, and Start again. The HUD should show **1.3.0**. Its **Material:** status describes track/road eligibility; **updating layout** indicates continuing discovery.

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
- `fixtures/rendering-lab.html`: full-width materials, overlapping owners, protected controls, viewport pickups, and a dynamic **2,000-card** load for incremental discovery.
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

Geometry and clearance use separate incremental queues, each targeting approximately **2 ms of work per animation frame**. Discovery and dirty-source measurement continue across frames, sharing measured geometry and computed/derived style caches so physics, scenery, and pickups can reuse results. Valid geometry and clearance regions are retained while local pending regions are protected. Child mutations are batched and coalesced; scrolling does not schedule a whole-page rebuild.

Catch-up discovery prepares approximately **one viewport behind and two ahead** in the scroll direction. Current rendered roots and newly visible platforms take priority over the background walk, and partial collision selections are published before discovery completes. The retained registry survives viewport selection; physics still selects at most **220 collision platforms**, prioritizing the viewport, player, and retained checkpoint. Material and pickup rendering query the registry independently of that physics cap.

These work slices are scheduling targets, not strict frame-time or FPS guarantees: individual native DOM measurement calls cannot be preempted. Measurement and identity caches can grow with connected page content; disconnected content is pruned. Native animation discovery and document-bottom measurement run periodically, and the last standing source remains tracked even offscreen.

The latest YouTube implementation observes description expansion and layout-state changes, prioritizes currently rendered content during rapid scrolling, and publishes newly measured platforms incrementally. These are implementation changes; exact live-site observations and their build scope are recorded in [VERIFICATION.md](VERIFICATION.md).

Stopping aborts active-game DOM/storage listeners, disconnects observers, cancels timers/animation frames, disposes the inventory panel, and removes the overlay. The content controller remains available for Start/Stop messages. Full navigation destroys the old controller. The separate MV3 service worker coordinates durable progression; stopping gameplay does not delete earned items or claims.

## Verification and limitations

See [VERIFICATION.md](VERIFICATION.md) for the exact live pages, viewport/zoom coverage, lifecycle checks, and verification limits.

- Open shadow roots are supported; closed roots are inaccessible. Cross-origin iframe internals, pseudo-element text or images, and objects painted inside arbitrary canvas/WebGL content are not separately detected. Outer iframe frames can provide terrain.
- Visibility and clipping are axis-aligned approximations, not complete paint/occlusion analysis. Rotations, unusual clip paths, transformed document roots, and overlapping dialogs can produce unsuitable surfaces.
- Physics selection remains capped at 220 platforms, so very dense pages can omit collision surfaces even when their graphics or pickups are visible. Grounded offscreen state and checkpoint identity are retained, but original surfaces are not guaranteed to form a connected route.
- Coin placement is sparse and deterministic. Viewport pickup rendering is uncapped; rarity is per logical platform, not a fixed per-page equipment quota. Neither incremental scheduling nor uncapped rendering guarantees a particular FPS.
- McDonald's normal page returned HTTP 403 Access Denied, and the browser relay was unavailable. Its reported image cases could not be inspected or verified; generic media and catch-up changes do not establish a live-site fix.
- Loop resets cannot always be distinguished from very fast continuous movement using DOM bounds alone. The generic large-horizontal-reset fallback detaches conservatively; seamless loop riding needs a site-specific adapter.
- Empty pages or removed checkpoints can leave recovery unavailable. The HUD stops the fall and reports this condition; manual Respawn still requires a visible eligible original surface.
- Chrome-internal pages, the Chrome Web Store, PDFs in Chrome’s viewer, and other restricted documents cannot be injected. The popup explains injection failures.
- Combat and enemies remain absent. Rewards, inventory, equip effects, coins, levels, and local persistence are implemented. Save data is local and editable by the profile owner; this prototype has no server-side anti-cheat or cross-device synchronization.
