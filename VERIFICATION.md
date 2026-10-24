# Verification record

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

No progression or position persistence, inventory, reward claiming, combat, equipment, multiplayer, or deterministic encounters were verified; those features remain outside this platforming change.
