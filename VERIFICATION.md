# Verification record

## Rarity, shop, and glider merge

Resolved the encounter and test conflicts while retaining independent coin/equipment rolls, encounter-v3 claim identities, one currency per coin, video loot exclusion, rarity-tier boots, per-copy inventory IDs, and separate boots/glider slots. The integrated world-boot chance is 1-in-400, with the feature branch's weighted rarity table. The default progression fixture now uses measured identity `foundry-workshop-700`: seven coins plus common Coppercoil Boots at 1.2× jump velocity.

Typecheck, 181 tests across 13 files, and the production build passed. A throwaway runtime smoke exercised the actual generator, pickup planner, player-state transitions, and physics: the fixture produced eight pickups; canonical v3 equipment claimed successfully; earned coins bought a glider; boots and glider slots coexisted; selling boots preserved the glider slot; serialized state restored; a sold world drop could not be reclaimed. After 120 fixed steps, free-fall speed was about 1600 CSS px/s and gliding speed was capped at 55 CSS px/s. No fresh browser/shop-modal visual or browser-restart check was performed for this merge. Earlier fixture seeds, stats, and drop-rate observations below describe their historical builds.

## Historical pre-merge generation-v3 encounter policy

Every encounter type rolls independently for each logical platform. Coins have a 10% (1-in-10) chance and boots have a 1% (1-in-100) chance. Every successful type spawns: a platform can contain 3–7 coins, one pair of boots, both, or neither. Types do not rank or compete, and neither forces or suppresses the other. Each type retains its existing deterministic roll seed domain and separate reward seed domain.

The version-2 save format and existing `encounter-v3:` reward IDs remain unchanged. This correction does not bump the generation or reset progress; existing inventory, equipment attributes, and completion/claim history remain preserved. The progression fixture retains its lower authored identity, `foundry-workshop-3055`, for the default `http://127.0.0.1:8080/fixtures/progression.html` URL. Its seed retains Piston Boots with a 1.2× jump multiplier and zero coins on the lower platform.

`bun run typecheck`, 164 tests across 12 files, and `bun run build` passed. Regression coverage includes naturally both-winning seeds, pickup materialization, both collection orders, worker duplicate prevention, and preserved reward IDs. The previously suppressed seed `collision-smoke:3129` at `https://www.lazyvim.org/keymaps` now generates seven coins and Cloudstep Boots with the same encounter ID.

Browser smoke used the actual Game class with a diagnostic handle in an unpacked-extension isolated world and the built service worker, in Linux headless Chromium at 1440×900 CSS pixels. On the progression fixture, the lower original button's authored identity was temporarily changed to `both-workshop:190` before activation; the actual generator and DOM measurement produced five coins and Skybound Boots on that same platform. Real movement and drop keys collected the boots first at zero coins; all five coins remained available and the HUD still showed 0/1 platforms complete. Native movement and jumps then collected all five coins: balance 25, XP 100, one inventory item, HUD 1/1 complete. Initial simultaneous-spawn and final completion screenshots were visually inspected. No fabricated pickups or character-position overrides were used. Browser restart and the full live-site matrix were not repeated. The following exclusive-selection checks are historical evidence, not current acceptance evidence.

## Historical generation-v3 exclusive-selection verification

The previous implementation selected at most one successful type using an independently seeded rank and a lexical type-ID tie-break. Its exclusive outcomes and collision winner counts below are superseded by the current independent-spawn policy.

Integrated checks passed: `bun run typecheck`, 162 tests across 12 files, and `bun run build`. A throwaway diagnostic exported the actual catalog without changing repository source: reversing its order for 50,000 platform identities produced identical encounters and zero combined coin/equipment outcomes. Of 48 cases where both candidates qualified, coins won 20 and equipment won 28.

Browser smoke used the actual Game class with a diagnostic handle in an unpacked-extension isolated world and the built service worker, in Linux headless Chromium at a 1440×900 CSS viewport. On the updated progression fixture, the only pickup was Piston Boots; real movement/drop keys collected them at zero coins. The HUD changed from 0/1 to 1/1 encounters complete, and manual Equip activated the 1.2× jump multiplier. A temporary original HTML button with a measured coin-winning identity was then inserted beside the lower platform: it produced four coins and no equipment. Walking into its first coin awarded 5 currency and 20 XP, with inventory still containing one item. The equipped fixture screenshot was visually inspected. This smoke did not repeat browser-restart or the full website matrix; historical observations below retain their original generation behavior and fixture identities.

## Version 1.3.0: rendering, viewport pickups, and incremental discovery

This section separates observed browser evidence from the later rendering and catch-up changes. Read-only browser agents exercised a frozen pre-final 1.3 build in owned disposable profiles using **Linux headless Chromium 155**. They used real keyboard events, native controls, DOM measurements, and visually inspected screenshots. Production activation and lifecycle checks used the actual unpacked extension; detailed motion and pickup measurements also used the Game diagnostic. The frozen observations below precede the final media-padding, clearance-epoch, discovery-priority, and population-cache refinements. They do not establish final post-fix rendering, catch-up latency, or performance.

### Stable support, responsive layout, and native input

| Frozen-build check | Observed result |
| --- | --- |
| Animated carrier, paused for 240 frames | Feet gap **0 CSS px**, support-local drift **0 CSS px**, and zero support losses while the character moved from x = 405.540 to 541.237 with its carrier. |
| Focused rider, 180 frames | Feet gap and local drift remained **0**; no support losses, missing matching materials, or material x/width mismatches. |
| Offscreen rider, scroll y = 1300, 180 frames | Support and local offset stayed unchanged, with feet gap **0**. Scrolling did not move the rider to visible terrain. |
| Navbar crossing, scroll y = 400, 120 frames | No support changes or local drift. |
| Real Space and Right keys | Space produced 44 airborne frames before landing on the carrier. Right produced 42 airborne frames during a 180-frame probe, followed by recovery; the next 180 frames had no airborne frames or support changes. |
| Real Down key | The character was airborne for 39 frames and its feet reached y = 920.045, beyond the 900-pixel viewport. Recovery returned to the same carrier, with local offset 455.0000305 → 455 CSS px. |
| Animated fixture at widths 1440/1024/768 | The cropped support retained its identity and local offset 163.126071 CSS px. |
| Native Chrome zoom to 125% | CSS viewport dimensions changed from 1440×900 to 1152×720; support identity and local offset were retained. |
| Wrapped layout at widths 1440/1024/768 | Support identity and local offset 139.171875 CSS px were retained as its width changed 229.453 → 229.453 → 146.734 and its top changed 487.609 → 487.609 → 513.203 CSS px. |

The open-shadow media fixture grew from eight fragments in one root to ten fragments in two roots after movement, late root attachment, and insertion of a native control. Video widths followed the measured layout changes, including 400 → 370 and 500 → 440 → 460 CSS px. Production Start created one overlay; Focus, Right, and Escape removed it and returned focus to `BODY`. Toggling the extension again created one overlay without duplication and restarted paused.

### Viewport pickups and full-width material observations

On `fixtures/rendering-lab.html` at 1440×900, a parent browser probe registered 137 surfaces, 131 collision surfaces, and 72 world pickups. With the game paused, moving the character from x = 30 to x = 1250 left **all 50 visible pickups unchanged, including the exact ID set**, with camera (0, 0) and zero collected coins. This distinguishes viewport drawing from character-nearest selection.

After the button-mask and small-edge changes, the same fixture showed **61 visible decorations**. The original wide button had a **1160 CSS-pixel rail**; nested geometry had only one 1160-pixel owner. A partly covered back edge had no material, while its front edge had a 754-pixel road. The 107-pixel grid controls also received full-width material. Inspected screenshots retained the original silver rails, brown sleepers, and roads, with readable native text.

These are intermediate rendering observations. The frozen motion fixture measured correct native video/cropped-image collision widths of 300/320/400 CSS px, but some corresponding material was missing. That observation motivated the later own-media padding correction; it is not evidence that the corrected material was rendered. A separate initial 2,000-card discovery probe completed 12,137 registered surfaces in 166 frames (4.32 seconds), retained 50 visible pickups, and had no global material-blackout frames, but a known clean strip disappeared for two frames. The later clearance-epoch change addresses that observation; the initial probe does not verify the change.

### Frozen-build live-site checks

| Site and view | Actual observed coverage | Native interaction and limits |
| --- | --- | --- |
| Google homepage, 1440×900 and 768×900 | Ready state true, 21 surfaces, seven pickups, one visible pickup, and one material. | Production typing preserved `platformer compatibility smoke`, paused gameplay, and retained the text after Escape removed the overlay. Narrow diagnostic typing preserved `wasd platformer smoke` and left player x = 373, y = 506, vx = vy = 0 unchanged. No search was submitted. |
| GitHub `https://github.com/oven-sh/bun`, 1440-wide top | 781 surfaces, 372 pickups, **68 visible pickups**: all 67 whose centers were inside the viewport, plus one edge pickup. Dense code at the top had no material. | The Code dropdown exposed the clone URL and Download ZIP; no download was started. At scroll y = 2700 there were 11 visible pickups and four materials. At width 768 and the same scroll position there were 567 surfaces, 266 pickups, six visible pickups, and no material. |
| Wikipedia `https://en.wikipedia.org/wiki/Platform_game`, redirected to `/wiki/Platformer`, 1440-wide top | 3,082 surfaces, 810 pickups, **40 visible pickups** and three materials. All 40 pickup centers inside the viewport were included, with none missing. | The native main menu expanded. At scroll y = 2500 there were 20 visible pickups and two materials. At width 768 and that scroll position there were 3,125 surfaces, 804 pickups, 16 visible pickups, and one material. |

Production activation and Escape worked on all three sites. GitHub README and Wikipedia top-view probes found no overlapping visible material pairs; inspected screenshots showed material above images and readable text. Coins can cross native text and control areas, so these checks do not establish pickup clearance. GitHub's inspection label persisted during a ready state, while the README still had four materials; the label alone did not indicate a global blackout.

### Initial YouTube catch-up evidence

The following measurements describe the **frozen pre-catch-up build**, not current post-fix results. On `https://www.youtube.com/watch?v=26P1KyvrmjI`, expanding the served description exposed 17 eligible prose/link lines. The actual prose had no role-button ancestor; only the native more/less controls did. Hidden expansion-sizing content had range rectangles but was correctly excluded by its hidden visibility.

| Initial frozen probe | Observed discovery and selection |
| --- | --- |
| Description expansion, frame 1 / 61.2 ms | 0 of 17 lines registered or selected. |
| Frame 2 / 115.9 ms | One line registered, none selected. |
| Frame 30 / 795.6 ms | All 17 registered, none selected. |
| Frame 64 / 1432.1 ms | All 17 registered and selected. A separate repeat still had 17 registered and none selected at frame 94 / 1987.7 ms. |
| Eight fast 650-pixel scrolls, y = 358 → 3483, frame 60 / 2269 ms | Ten of 14 viewport images registered, four still uninspected, none selected. |
| Frame 75 / 2611 ms and frame 150 / 4483 ms | All 14 images registered, six selected; selection still had not caught up at the latter sample. |

The observed level had 56 surfaces, below its 220 selection capacity, so these missing selections were not explained by reaching that capacity. Eligible empty-alt 40×40 shopping images and 242×136 thumbnails eventually registered and were selected. These observations motivated viewport lookahead and prioritized partial publication. They do not verify the later implementation's catch-up time.

### Access and verification limits

McDonald's returned **HTTP 403 / Access Denied** in normal Chromium navigation and in the static reader. The browser relay was unavailable because it timed out. No accessible McDonald's DOM was available to inspect, and neither a live image fix nor post-fix McDonald's coverage is claimed.

These are Linux headless Chromium 155 spot checks, not a cross-browser matrix, compositor benchmark, or FPS promise. Native DOM calls cannot be preempted by a JavaScript work-slice target. The narrow HUD occluded some lower-right page content, and the 768-wide fixture had horizontal overflow; whole-page unobstructed use is not claimed. Rotated and perspective geometry remains axis-aligned and approximate. Pseudo-element-painted images, closed shadow roots, and cross-origin iframe internals are outside the supported scan. Native controls and typing were usable in the exercised cases, without bypassing authentication, CAPTCHA, or access challenges.

## Historical version 1.2.0: sparse pickups, stable terrain, and site coverage

The following 1.2.0 record is historical. Its source-check totals, bundle sizes, 24-active-pickup cap, geometry policy, and live-site observations describe that release, not version 1.3 acceptance results.

The final source passed `bun run test` (**98 tests across eight files**), `bun run typecheck`, and `bun run build`, including the request-free equipment-ownership change. The build produced approximately 59.1 kB of content code, a 7.2 kB MV3 worker, and a 1.2 kB popup. Browser observations used the actual unpacked extension in Linux Chromium 155.

### Direct equipment pickup and persistence

On the default `http://127.0.0.1:8080/fixtures/progression.html` workshop, a fresh player walked over the visible Piston Boots without jumping or collecting coins. The world boot disappeared, inventory gained one item, and currency, XP, collected coins, and completed encounters remained empty/zero. The pickup did not auto-equip. Instrumented outgoing content messages contained only the initial `progress:get`; **no equipment-collection message was sent**. The durable ownership record and aggregate inventory both contained the same seeded boots.

After manual Inventory Equip, the message trace added only `progress:equip`. A real jump landed on the original upper control at y = 340, a 160 CSS-pixel rise from the lower control at y = 500. The character's measured top was y = 310 and feet y = 340.

Two extension content contexts then issued eight concurrent direct-storage writes of the same valid ownership record for a second seeded item. Inventory gained exactly one copy and one additional reward claim; aggregate revision advanced from 2 to 3. Coins and XP stayed zero, and Piston Boots remained equipped. This exercises concurrent ownership writes, not two synchronized physical pickups. The earlier equipment-RPC race is superseded.

The native browser process was stopped and restarted with the same disposable profile. The entire saved local-storage JSON was identical: aggregate player state, both ownership records, two inventory items, equipped Piston Boots, zero coins/XP, and revision 3. The restarted game displayed Inventory (2), with no browser page errors recorded. Unit coverage additionally exercises ownership recovery before indexing, failed-index recovery, legacy migration, and coin-write queue recovery.

### Density and geometry observations

On live `github.com/oven-sh/bun`, a **91-frame scroll probe** measured at most **23 coin draws and 24 total active pickups**. A separate current-DOM comparison found 145 logical surfaces: the old populate-all policy generated 725 coins, while the sparse policy populated 23 surfaces with 127 coins. These generated totals are distinct from retained HUD discovery history. The implemented policy seeds about 10% of ordinary surfaces plus all rare equipment surfaces, with 3–7 coins each and a 24-active-pickup cap. These measurements establish a draw bound, not an FPS or compositor benchmark.

| Check | Observed result |
| --- | --- |
| Moving-support fixture, 184 frames | Zero player-feet gap, support-local drift, track-edge gap, or missing anchored tracks; 36 frames retained support while its carrier was offscreen. |
| Lando scroll, 133 frames, 2920 → 3340 → 2920 | Zero feet gap, support-local drift about `5.12e-13` CSS px, no missing anchored tracks, and at least seven material draws. |
| Overlapping navbar, 100 frames, scroll 0 → 900 → 0 | Zero feet gap or local drift; support ID unchanged. |
| Airborne recovery | After 40 airborne frames and a 387 px fall, recovery returned to platform-local offset 455, not viewport center. |
| Animated media fixture | Clipped image, video, and iframe widths 300/320/320 CSS px, with zero top/left error; decorative fullscreen WebGL canvas excluded. Blob-video source recreation retained identity. |
| Open-shadow fixture | Native video width 400 CSS px, zero top/left error; actual game platform count 8 → 9 after shadow-child insertion → 10 after late root attachment without a light-DOM mutation. Grounded video support was retained. |
| Text protection | Eight visible text rectangles had zero checked paint overlap. A 4,200-span budget probe protected pending content and safely reported incomplete full discovery. |

Viewport checks covered fixture and Google homepage widths 1440/1024/768. Actual Chrome zoom 100% and 125% were exercised; a 1024-wide window at 125% yielded CSS dimensions 819×720 with material ready. Repeated activation produced overlay counts 1 → 0 → 1; Escape removed it. Typing `steel and steam platformer ` into Google preserved the exact text and paused gameplay.

### Live-site coverage and access limits

| Site | Actual observed coverage | Limits |
| --- | --- | --- |
| Reddit `r/programming` | Public feed: 27 posts, 43 light-DOM images, three iframes; title and thumbnail edges had zero measured error. Scrolling expanded discovery from 27 to 52 posts, ending at 49 with 135 registered surfaces. | Native post video in an open root was initially missing. The generic fix passed the local shadow fixture; the post-fix live-video recheck hit a network-security block. Live Reddit video is not verified after the fix. |
| TikTok `/` | Public first video by `juliadelgiorno`: two images and one video; video/poster frame about 544.759×968.460 CSS px, zero geometry error; coincident media deduplicated and caption ranges checked. | Login blocked advancing the feed. `/explore` exposed a login/skeleton shell, not a verified feed. |
| Instagram `/instagram/` | Public profile: 31 images and seven canvases; 14 visible images and seven highlights had zero edge error. After scrolling 740 px, all nine visible grid images were found with stable document coordinates. | No video or iframe was present; Instagram video was not verified. |
| YouTube | `watch?v=jNQXAC9IVRw` played at readyState 4. The stable `movie_player` owner measured exactly 990 CSS px wide with zero top error; temporarily hiding its internal video preserved the same platform. | Cold homepage had no recommended feed. This verifies the media-frame adapter, not full article semantics. |
| Google | Homepage geometry, material, viewport/zoom, and typing checks passed. | Current searches for `platformer physics` and `dom geometry` hit unusual-traffic CAPTCHA. Current SERPs were not verified; earlier results-page records below are historical. |
| Wikipedia `Platform_game` | Actual article: 21 images, one overlay, 54 material draws, and geometry smoke coverage. | Earlier dense coin counts do not describe current density. |
| GitHub `oven-sh/bun` | Actual overlay, geometry, and sparse-density scroll checks described above. | No FPS claim. |
| McDonald's | Current response was Access Denied with zero images. | The normal page was not verified. |

Closed shadow roots and cross-origin iframe internals remain inaccessible. Complex rotation, perspective, clipping, and loop resets use approximate axis-aligned geometry; the game supplies one-way tops, not full 3D collisions. Access challenges and login gates were not bypassed.

## Historical verification records

All sections below describe their named earlier builds. Their test totals, bundle sizes, reward rules, site checks, and screenshots are historical evidence, not current acceptance results. In particular, coin-completion equipment awards were replaced by visible physical equipment pickups.

### Historical version 1.1.0: persistent exploration progression

At version 1.1.0, `bun run typecheck`, **76 tests across seven files**, and `bun run build` passed. Output included the approximately 51.2 kB content bundle, 5.0 kB MV3 service worker, and 1.2 kB popup. The following historical checks used the actual unpacked extension and Chrome local storage in owned disposable profiles. No save was prefilled with equipment.

### Physical collection, equipment, and jump reach

On `http://127.0.0.1:8080/fixtures/progression.html?workshop=23`, a fresh player physically collected all three coins using game movement. The saved result was 15 coins, 60 XP, one completed/claimed encounter, and one rare Skybound Boots item. This URL was selected by calling the actual seeded generator, not by a special-case or debug grant. Inventory Equip/Unequip used the production worker and saved state.

The character stood at the same horizontal position under the fixture's upper original button for both jumps:

| Equipment | Landing surface top in document CSS pixels |
| --- | --- |
| None | Lower original button, y = 500 |
| Skybound Boots equipped | Upper original button, y = 340 |

The equipped jump reached the 160-pixel rise that the base jump could not. HUD samples also observed lower apex coordinates with boots, but those 100 ms samples are not claimed as an exact continuous peak-height measurement. Equipped footwear changed color.

A keyboard check initially exposed focus loss when pending equipment buttons were natively disabled. That was fixed by preserving focus with `aria-disabled` and rejecting pending actions in the handler. The final browser check equipped, unequipped, and re-equipped with Space; focus remained on the inventory button, and gameplay remained paused rather than interpreting Space as a jump.

### Actual two-tab claim races

Two tabs visited the same ordinary encounter, one with an added `utm_source` parameter. For each coin, each tab sent six simultaneous production claim messages from its extension content context: 12 requests per coin. Before these checks the rare workshop encounter had already earned 15 coins and 60 XP.

| Coin index | New claims | Duplicate replies | Saved coins | Saved XP | Level |
| --- | --- | --- | --- | --- | --- |
| 0 | 1 | 11 | 20 | 80 | 1 |
| 1 | 1 | 11 | 25 | 100 | 2 |
| 2 | 1 | 11 | 30 | 120 | 2 |

The ordinary encounter completed once, inventory remained one item, and the equipped rare item was unchanged. These were real worker/storage transactions, not mocked storage calls; the physical collision/collection path was exercised separately on the rare workshop page.

### Navigation, restart, independent players, and live Google

Chromium was fully closed and reopened with the same disposable profile. Starting on `fixtures/layout.html?workshop=23&utm_campaign=restart` restored 30 coins, 120 XP, level 2, the owned/equipped Skybound Boots, both completed encounters, both claimed rewards, and all six collected-coin IDs. The different pathname and tracking parameter deliberately shared the earlier rare encounter: page progress remained 3/3 and no extra reward was granted. The restored inventory screenshot was visually inspected.

On the live Google homepage, the same profile retained its equipped boots and physically collected the first coin of Google's encounter. The HUD showed 35 coins, 140 XP, level 2, current-page progress 1/3, inventory one, and no visible progression errors.

A second, fresh Chrome profile then visited the same rare workshop URL. It started with its own empty inventory and physically earned its own Skybound Boots after collecting three coins. Its resulting 15 coins, 60 XP, level 1, and unequipped item were independent of the first profile; the deterministic equipment ID/name matched.

Silver rails over brown wooden sleepers were also observed before progression integration: the actual Google overlay contained 1,608 silver-highlight pixels and 1,047 brown-sleeper pixels. Gold background panels remain removed.

### Scope and remaining limits

These checks cover the new progression surface and preserve earlier platforming evidence below. They do not repeat the entire historical viewport/zoom/search-results or other-site matrix. McDonald's remains unverified in this environment because its normal page returned Access Denied/HTTP 403. Activation and per-page coordinates are not saved; inventory, equipped item, coins, XP/level, and completion/claim history are. Empty or rapidly changing native layouts can need manual Respawn to replan pickups. There is no combat, shop, backend, account sync, or server anti-cheat.

## Historical version 1.0.2: thin tracks and roads

Removed the gold background drawing code. Version-3 URL seeds choose procedural railway tracks or dashed roads, limited to 10 CSS pixels high above native edges. Existing text/media clipping, stable anchors, and original collision geometry remain in use.

`bun run typecheck`, all **50 tests**, and `bun run build` passed (38.2 kB content bundle). The actual unpacked extension was exercised on the local decoration fixture and live Google homepage at widths 1440 and 1024, including a 6× CPU-throttled resize. Screenshots of both were visually inspected: thin rails/roads were visible and the gold panels were absent. An independent fixture Canvas/DOM Range probe checked 96 rectangles and found **zero decoration pixels over checked text/media**, excluding the playable character.

McDonald's was not revalidated for this appearance-only change; the prior access-denied limitation remains. Earlier background-specific pixel hashes and counts below are historical, not acceptance criteria for tracks.

## Historical version 1.0.1: missing-material fixes

Removed the 40 ms text-inspection cutoff: a slow but count-bounded scan no longer permanently disables material. Native animations without any protected source descendants are now ignored by clearance discovery; a rotating decorative element cannot disable the entire material layer. The HUD shows the installed version and material inspection status even with Debug off.

`bun run typecheck`, all **50 tests**, and `bun run build` passed (40.4 kB content bundle). The actual unpacked 1.0.1 extension rendered material on the decoration fixture with an infinitely rotating decorative div: 200,234 painted canvas pixels at width 1440, and 177,866 after resizing to width 1024 under 6× CPU throttling. These totals include the small playable character; their size establishes that the material layer was present, not merely the character. The fixture screenshot was visually inspected.

The live Google homepage reported eight eligible material surfaces with 97,201 painted canvas pixels, and 93,423 after the same throttled resize. Both checks displayed version 1.0.1. McDonald's root URL returned Access Denied in Chromium, and the static reader also received HTTP 403; its normal page could not be verified in this session. These checks establish visibility, not a new exhaustive text-overlap matrix.

## Historical change: gold platform material and scroll stability

That historical material build passed `bun run typecheck`, **50 tests across four files**, and `bun run build` (approximately 40 kB of bundled content code). It replaced the tiny-prop implementation below with generation-version-2 procedural brass material. No assets were downloaded or added, and no collision surfaces were added.

An additional Google keyboard/typing/Escape interaction scenario exceeded the browser-run deadline of 30 seconds. It is not counted as a passing interaction check for this change; the graphics verification below completed independently.

The actual unpacked extension was exercised in a disposable Chromium profile on `fixtures/decorations.html` at 1440, 1024, and 768 pixels wide, with a 1000-pixel viewport height. After each resize settled, a 40×24-pixel patch above the original image was sampled for 18 consecutive frames at each of six document scroll offsets: 0, 20, 80, 160, 240, and 300 CSS pixels. **All 960 patch pixels remained painted in every sample**, with one unchanged pixel hash per width:

| Viewport width | Patch hash across all 108 samples | Hash after scrolling away and back |
| --- | --- | --- |
| 1440 | 4198447683 | 4198447683 |
| 1024 | 2629226269 | 2629226269 |
| 768 | 860737783 | 860737783 |

Partial viewport clipping was checked separately: 480 pixels remained painted in a visible 40×12 strip when most of the material was above the viewport. It was not hidden as a whole.

An independent Canvas/DOM Range probe, with Debug off and the playable character excluded, found **zero material pixels over checked native text, controls, images, and SVGs**. Coverage included the three viewport widths, fixed and sticky page content, five nested-scroller positions, scrolling the nested region completely away and returning, newly inserted text before/after refresh, and a late native text animation. A continuously JavaScript-transformed original button moved about 83 pixels during 60 sampled frames; its tracked material patch retained all 960 pixels in every frame, with zero checked text coverage.

The running extension also reproduced the original material patch after returning to the same URL seed with a tracking parameter added. A different meaningful query changed the patch. Unit regressions cover stable edge choices as nearby candidates change, input-order independence, partially offscreen geometry, moving/resizing surfaces, missing sources, and normalized URL identity. Motion-mask refresh now finishes within its source/rectangle count bounds; an elapsed-time threshold no longer blanks an otherwise complete mask.

The live Google homepage was visually inspected with the larger gold material, and its independent text/media probe reported zero covered pixels. The McDonald's homepage returned **Access Denied** with zero images in this session, so the normal page could not be revalidated; the older image checks below remain historical evidence only. This cosmetic change did not rerun the earlier search-results/zoom or other-site matrix.

Real content/layout changes and resizing can briefly suppress material while protection is rebuilt. Unsupported animation bounds, opaque/embedded content, and inspection limits remain conservative omissions. The following sections retain previous implementation evidence and do not describe the current material appearance.

## Previous tiny-prop scenery (superseded)

The decoration build uses Bun 1.4.4 and passes `bun run typecheck`, **50 tests across four files**, and `bun run build` (`dist/content.js` approximately 37.3 kB). Type checking now includes the test files with Bun development types. The previous platforming record below is retained as earlier evidence; its bundle sizes and test totals are not the current decoration totals.

The actual unpacked extension was activated in a disposable Chromium 155 profile and visually inspected on `fixtures/decorations.html` and the real Google homepage. No user profile or sign-in was used.

- The fixture displayed five small ornaments; the Google homepage displayed four.
- With Debug off, an independent DOM/Range probe compared canvas pixels against native text rectangles and whole controls/images/SVGs. It excluded the playable character, which is intentionally allowed to move over the page. The initial fixture had **1,604 ornament pixels** and **zero pixels over protected text/media** across 36 checked rectangles; Google had **1,261 ornament pixels** and zero covered pixels.
- On the same fixture layout, `q=brass` produced ornament pixel hash `439521069`; `q=copper` changed it to `798796906`. Returning to `q=brass` with `utm_source=check` restored `439521069`, with zero covered pixels in each case. This exercised the running extension's URL-change path, not only the seed helper.
- Inserting new original text at an ornament's former position immediately hid the decoration layer for the next frame. After the bounded refresh, ornaments reappeared in safe slots with zero covered text pixels.
- Scrolling to the moving-copy section and testing widths 1440, 1024, and 768 produced zero covered text/media pixels across six samples per width. Visible ornament pixels remained present at each width. A late native text animation and the fixture's native text-insertion button also preserved zero overlap.
- Unit regressions cover normalized URL identity, meaningful parameter/fragment changes, deterministic artwork, blocked and incomplete scans, viewport/HUD exclusion, moving anchors, and hiding rather than relocating unsafe ornaments. Existing physics and recovery tests continue to pass.

Text clearance is conservative and bounded. It suppresses scenery when it cannot safely complete inspection or bound an animation. Opaque components and image/SVG lettering are protected by whole element bounds; this is not an OCR or exhaustive arbitrary-paint analysis. No new collision surfaces were introduced. Screenshots of the clean fixture and Google result were inspected.

Final packaging check: `bun install --frozen-lockfile` completed without changes. Clicking the actual Google HUD's Stop control removed the overlay (zero overlay hosts remaining); the verification browser and local fixture server were then closed.

## Scope and environment

This record covers the original-DOM-terrain build: generated bridges and artificial floors have been removed. Scrolling or resizing alone does not request a respawn or a move to visible terrain; exact coordinate observations and a live-layout qualification are recorded below. Automatic recovery applies only after falling below the actual document bottom and returns to the last standing original platform at its current position, including when that platform is offscreen. If that platform is unavailable, the fall stops with an explicit status; manual Respawn or a restart is required.

Browser checks used Linux Chromium **155.0.8059.84**, keyboard/click events, DOM measurements, HUD state, and screenshots. The Bun-driven fixture and recovery scripts activated the actual unpacked extension through its native action popup; those checks exercised the extension itself, rather than only injecting a page module. Focus emulation kept automated windows focused while clicking native page controls still exercised keyboard-gameplay pausing. The motion, recovery, and McDonald's checks used owned disposable profiles under `/tmp`; no user profile, cookies, or credentials were imported, and no sign-in or consent/terms acceptance actions were performed.

The recovery, cleanup, seven moving-platform scenes, image fixtures, and post-review native edge cases passed on the final **21.7 kB** content build. Live McDonald's and compatibility observations used the **21.2 kB recovery build**, before the final late-animation discovery and platform-handoff corrections; their exact scope is retained below. The former bridge-era Google width/zoom matrix is historical and is not counted as coverage of this implementation.

## Bun source checks

The recorded environment used Bun **1.4.4**, with `packageManager: bun@1.4.4` and `bun.lock`. Project commands no longer require Node or an npm lockfile; esbuild remains the bundler.

| Command | Observed result |
| --- | --- |
| `bun run typecheck` | Passed |
| `bun test ./tests` | **35 passed, 0 failed**: 29 physics and 6 level tests |
| `bun run build` | Passed; generated `dist/content.js` (21.7 kB) and `dist/popup.js` (1.2 kB) |
| `bun install --frozen-lockfile` | Passed on the final source and unchanged Bun lockfile |

The tests cover one-way landing and swept crossings, horizontal and vertical moving supports, relative-motion landing order, interpolated widths and fixed substeps, jump/drop detachment, paused rider transport, recovery onto a moving or narrowed previous platform, original-only terrain, empty terrain, retained offscreen terrain, and the distinction between leaving the viewport and falling below the document bottom.

## Current document-bottom recovery and cleanup

The final-build recovery smoke passed through the native extension popup at a 1440 × 900 viewport. It used a moving image as the last standing original platform:

- The initial character was grounded at document `x = 709`, `y = 420`, on `dom:11:0`. After scrolling the camera approximately 1,905 pixels, the rider remained on that same moving platform at `x = 779`, `y = 420`, with an offscreen status.
- The actual document bottom was `y = 2805`. Dropping through the platform produced an airborne character at `y = 1106.11`, still inside the document. Leaving the viewport did not trigger recovery.
- After the document-bottom fall, recovery returned the character to `x = 755.69`, `y = 420`, grounded on the same `dom:11:0`. The image's current bounds were `x = 677.521`, top `y = 450`, width `175`. The camera did not move; the recovered character remained offscreen.
- Removing the checkpoint platform caused a later fall to stop at `y = 2881.67`. That position stayed unchanged over 40 further frames, and the HUD reported **Last platform unavailable**. No replacement terrain was created.

The same run verified cleanup in the extension's isolated execution context:

| Resource | Active | After Stop and subsequent activity |
| --- | ---: | ---: |
| Window event listeners | 7 | 0 |
| Document event listeners | 7, including 4 animation/transition listeners | 0 |
| Active native observers | 2 | 0 |
| Extension animation-frame request count | 333 at Stop | 333 |
| Extension interval callback count | 344 at Stop | 344 |
| Overlay nodes | 1 while running | 0 |

The request and callback counts remained unchanged after 40 browser frames, a page mutation, and a resize event. A recovery screenshot was captured at `/tmp/steel-steam-last-platform-recovery.png`.

## Moving-platform fixture evidence

The final-build `fixtures/moving.html` rerun passed all seven scenes through the real extension popup and the fixture's native Run/Pause controls. Each scene retained its terrain ID while moving, and every paused-rider check remained grounded. On the vertical-image scene, jumping, landing again, and Down detachment also passed.

The browser compared rendered character-collider pixels with actual DOM top edges over **12 samples per scene**. Foot error is the maximum absolute distance between the rendered feet and a measured top edge. Offset drift is the range of the character's horizontal offset relative to its moving source. Both metrics are in CSS pixels.

| Native moving source | Maximum foot error | Horizontal offset drift |
| --- | ---: | ---: |
| Horizontal CSS-animated image | 0.00 | 0.68 |
| Vertical CSS-animated image | 2.00 | 0.00 |
| Wrapped text moving with an ancestor | 1.49 | 0.91 |
| CSS-transitioned element | 1.67 | 0.01 |
| Web Animations API article text | 1.50 | 0.83 |
| JavaScript style-animated element | 0.40 | 0.71 |
| CSS-animated native button | 1.57 | 0.81 |

Vertical-image and ancestor-motion screenshots from the earlier run were inspected; the table reports the final-build rerun's measurements. These checks establish moving DOM-bound support, rider transport, and the exercised detach/landing behavior; they do not measure animation-frame pixels inside an image.

### Post-review native edge cases

A review identified uncached late-start Web Animations and a carrier-handoff defect. Both were reproduced with the preceding build and exercised again after their fixes:

- In `fixtures/late-motion.html`, a preexisting offscreen image started its Web Animation after the extension's initial scan. The second case stayed opacity-zero during initial discovery. Before the fix, each visible image had zero rendered terrain-edge pixels. On the final build, both were discovered without a page DOM mutation and rendered 672 sampled edge pixels. Real Down inputs landed the character on the images: feet at document `y = 460` and `640`, respectively. The smoke advanced the native animation timeline after discovery to inspect the in-view poses.
- A separate original-HTML two-image scene raised one image through a stationary support. Before the fix, the character stayed on the old platform at `y = 470`. After the fix it transferred to the rising image, grounded on its distinct platform ID at `y = 410`, feet at the image's actual top `y = 440`. New permanent regressions cover this interception and old/new carrier displacement during handoff.

The final rising-image and initially transparent late-image screenshots were inspected. No extension-generated platform or engine-state override was used.

## Image extraction and exact offscreen preservation

### Local image fixture

The final-build `fixtures/images.html` rerun began at a 1440-pixel viewport with the character grounded at document `x = 709`, `y = 230`, on `dom:3:0`. After scrolling 1,500 pixels, resizing the viewport to 768 pixels, and scrolling back, each observation retained **exactly `x = 709`, `y = 230`**. The scrolled observation retained the same platform ID and grounded state and reported offscreen status. No viewport-edge respawn was involved.

The full-width hero and empty-alt promotional image produced original platforms matching their DOM bounds on the final rerun, and the explicit presentation-role image was excluded. In the earlier image-source inspection at a 768-pixel viewport, the measured hero was `x = 0`, top `y = 260`, width `768`, height `341.98`; the promo was `x = 28`, top `y = 1335.3`, width `712`, height `316.44`. That inspection also excluded `display:none` images.

The final-build empty fixture produced **zero original platforms**. Its character fell through `y = 1271.67`, then stopped at `y = 2586.11` with vertical velocity zero and **Last platform unavailable** status. The position stayed unchanged for 45 further frames. It received neither a fabricated checkpoint nor an infinite fall.

### Live McDonald's page

The real headed [McDonald's US homepage](https://www.mcdonalds.com/us/en-us.html) loaded at 1440 × 900 without accepting consent or terms. A static URL-reader request returned HTTP 403, so the evidence comes from the actual browser page. A fresh recovery-build rerun in the owned disposable `/tmp/steel-steam-webterrain-final` profile confirmed the hero, offscreen preservation, and empty-alt manual Respawn results below using the 21.2 kB content bundle. The subsequent review fixes concerned late-start animations and moving-platform handoffs; this live page was not rerun on the 21.7 kB bundle.

McDonald's activation used the installed unpacked extension: the native extension action granted `activeTab`, and `chrome.scripting` executed the production content bundle. The native popup's buttons were verified in the fixture and recovery runs, not clicked for this McDonald's check.

| Loaded image | Observed DOM bounds in document coordinates | Extension result |
| --- | --- | --- |
| Hero, `alt="get your bag, play in the app"` | `x = 0`, top `y = 322`, width `1425.655`, height `634.701` | Grounded at `x = 709`, `y = 292`; feet at `322`, on `dom:24:0` |
| Promotional image, `alt=""` | `x = 127.827`, top `y = 1632.8966`, width `755.517`, height `336.356` | Explicit manual Respawn near the image grounded the character at `x = 709`, `y = 1602.90`; feet at `1632.90`, on `dom:48:0` |

Scrolling 1,250 pixels while standing on the hero preserved the character's **exact `x = 709`, `y = 292`**, original platform ID, and grounded state; the HUD reported that the character was offscreen. The recovery-build screenshot was captured at `/tmp/steel-steam-mcdonalds-final.png`. Earlier hero and empty-alt screenshots were inspected at `/tmp/steel-steam-mcdonalds-hero.png` and `/tmp/steel-steam-mcdonalds-empty-alt.png`.

## Current live-site compatibility

A fresh headed Bun/Puppeteer run used the 21.2 kB recovery build in Chromium 155.0.8059.84 and an owned disposable profile, before the final two moving-terrain review fixes. It activated the actual extension with `Extensions.triggerAction` and the native popup's Start button, then exercised Focus game and Debug. It performed no login, consent, CAPTCHA, or external-write actions; typing probes were removed without submission. The browser was closed and its profile removed afterward.

| Live page | Actual viewport and tab zoom | Observed recovery-build checks |
| --- | --- | --- |
| [Google homepage](https://www.google.com/) | 1440 × 900, 100% | Native activation; Space airborne/landing; Down airborne/landing; ordinary typing while gameplay paused and character coordinates stayed exact. The page had no scroll overflow. |
| [Wikipedia: Steam engine](https://en.wikipedia.org/wiki/Steam_engine) | 1440 × 900, 100% | Native activation; Space and Down airborne/landing; typing pause with exact coordinates; scrolling 1,600 pixels and back preserved exact `x = 709`, `y = 374.54`, on `dom:109:0`, with offscreen status. |
| [GitHub: microsoft/TypeScript](https://github.com/microsoft/TypeScript) | 1440 × 900, 100% | Native activation; Space and Down airborne/landing; typing pause with exact coordinates; scrolling 1,600 pixels and back preserved exact `x = 722.54`, `y = 388.93`, on `dom:71:0`. |
| Wikipedia, additional narrow/zoom case | Requested 768 × 900 at native 125% tab zoom; effective CSS viewport 614 × 720, DPR 1.25 | Native activation; Space and Down airborne/landing. No initially visible editable field was available for a typing probe. Scroll qualification is described below. |

The narrow Wikipedia case retained the same grounded platform, `dom:12:0`, and `x = 296` through a scroll of approximately 1,600.147 pixels and back. Its document `y` changed **`324.47 → 288.07 → 324.47`**, so the original strict coordinate-equality assertion failed. A subsequent diagnostic correlated the actual retained text-node Range for “Steam locomotive” in `#mwBA`: its native document top moved **`354.4736 → 318.0690 → 354.4736`**, and the character's feet followed within **0.004 CSS pixels**. Native left position and width stayed unchanged.

This was a measured webpage layout shift: `.mw-body-header.vector-page-titlebar` changed height from `76` to `39.5954` pixels and back as `#vector-page-titlebar-toc` switched from relative positioning to fixed positioning and back. The article's original platform moved by 36.4046 pixels in document space, and the rider stayed attached without viewport respawn or teleportation. The diagnostic, recorded in `/tmp/steel-steam-compatibility-diagnostic.json`, qualifies the existing narrow-case result; it was not another full compatibility-matrix run. Exact numerical position preservation applies when the original support itself remains stationary.

The loaded Wikipedia page included “Steam engine,” “History,” and “Early experiments” headings; GitHub included “Repository navigation,” “About,” and “Latest commit.” Screenshots of the three wide pages, narrow/zoom Wikipedia before and during scrolling, and GitHub typing were inspected. Results were recorded in `/tmp/steel-steam-compatibility-results.json`.

Both requested Google searches, `typescript` and `steam engine`, redirected to `/sorry/index` with HTTP 429 and an unusual-traffic reCAPTCHA. They provide **no search-results coverage**. A second TypeScript request at a requested 768-pixel viewport was also blocked; 125% zoom was never applied to that page and is not claimed. No CAPTCHA was solved or bypassed.

The earlier 18-combination Google width/zoom matrix and bridge-era compatibility/lifecycle results are historical evidence for the previous implementation. They are excluded from current-build coverage. The four exercised page/viewport combinations above are spot checks, not a new full matrix.

## Verification limits

Only Linux Chromium 155 was exercised. Chrome on other operating systems, older browser versions, performance benchmarks, and exhaustive accessibility checks were not covered.

Terrain follows axis-aligned DOM bounds and text-line rectangles. Rotation, arbitrary clipping, and visual occlusion are not comprehensively modeled; there is no claim that every covered or visually hidden surface is rejected. Animated GIF or video pixels do not create independently moving terrain when their DOM element's bounds stay fixed. Iframe and shadow-root contents are outside the terrain scan. The live-site results are spot checks, not guarantees for every page, SPA state, animation mechanism, or document size.

The historical platforming-only checks above did not verify progression, inventory, or rewards. Version 1.1.0 subsequently verified its then-current progression path; the historical version 1.2.0 record and version 1.3 observations have their own sections above. Per-page coordinate persistence, combat, and multiplayer remain absent.
