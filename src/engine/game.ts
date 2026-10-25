import { PageGeometry } from '../page/geometry';
import { buildLevel, fellBelowViewport, outsidePage } from './level';
import { Input } from './input';
import { carryBody, createPlayer, dropThrough, respawnOnPlatform, stepBody } from './physics';
import { drawWorld } from '../rendering/render';
import { drawPlayerLocator } from '../rendering/player-locator';
import { MOTION, OVERLAY_ID, type Body, type Level } from './types';
import { TextClearance } from '../rendering/text-clearance';
import { sceneryDesigns } from '../rendering/scenery-art';
import { placeScenery, updateScenery } from '../rendering/scenery';
import type { SceneryDesign, SceneryScene } from '../rendering/scenery-types';
import { discoverEncounters } from '../progression/encounters';
import { pageSeedKey } from '../page/page-identity';
import { planPickups, selectActivePickups, updatePickups } from '../progression/collectibles';
import { requestProgression } from '../progression/progression-client';
import { mountProgressionUI, type ProgressionPanel } from '../ui/progression-ui';
import { mountMovablePanel } from '../ui/movable-panel';
import { EQUIPMENT_STORAGE_PREFIX, PLAYER_STORAGE_KEY, type EquipmentOwnership, type PageEncounter, type PagePickup, type PlayerState } from '../progression/progression-types';

const PAGE_MUTATIONS: MutationObserverInit = {
  subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
  attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'src', 'srcset', 'srcdoc', 'poster',
    'href', 'data-id', 'data-item-id', 'data-product-id', 'data-post-id', 'post-id', 'permalink'],
};

export class Game {
  active = false;
  private host?: HTMLDivElement;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private status?: HTMLElement;
  private detail?: HTMLElement;
  private materialStatus?: HTMLElement;
  private surface?: HTMLElement;
  private input?: Input;
  private level?: Level;
  private geometry?: PageGeometry;
  private clearance?: TextClearance;
  private designs: SceneryDesign[] = [];
  private scenery: SceneryScene = { placements: [], protectedRects: [], ready: false };
  private sceneryStale = true;
  private inspectedX = 0;
  private inspectedY = 0;
  private lastStanding?: { id: string; offset: number };
  private pageHeight = 0;
  private nextBoundsRead = 0;
  private stranded = false;
  private player?: Body;
  private abort?: AbortController;
  private mutation?: MutationObserver;
  private resize?: ResizeObserver;
  private timer = 0;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private debug = false;
  private facing = 1;
  private locatorStarted = -Infinity;
  private coyote = 0;
  private jumpBuffer = 0;
  private lastUrl = '';
  private lastHud = 0;
  private run = 0;
  private saved?: PlayerState;
  private encounters: PageEncounter[] = [];
  private pickupRevision = -1;
  private collisionRevision = -1;
  private pickups: PagePickup[] = [];
  private activePickups: PagePickup[] = [];
  private collected = new Set<string>();
  private claimedEquipment = new Set<string>();
  private pendingEquipment = new Set<string>();
  private pendingClaims = new Set<string>();
  private jumpMultiplier = 1;
  private progressError = '';
  private progressionPanel?: ProgressionPanel;

  start(): void {
    if (this.active) return;
    this.active = true;
    const run = ++this.run;
    this.saved = undefined;
    this.encounters = [];
    this.pickupRevision = -1;
    this.collisionRevision = -1;
    this.pickups = [];
    this.activePickups.length = 0;
    this.collected.clear();
    this.claimedEquipment.clear();
    this.pendingEquipment.clear();
    this.pendingClaims.clear();
    this.jumpMultiplier = 1;
    this.progressError = '';
    this.debug = false;
    this.facing = 1;
    this.locatorStarted = -Infinity;
    this.lastHud = 0;
    this.lastStanding = undefined;
    this.stranded = false;
    this.nextBoundsRead = 0;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.geometry = new PageGeometry();
    this.clearance = new TextClearance();
    this.designs = sceneryDesigns(location.href);
    this.sceneryStale = true;
    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    // Only the small HUD intercepts clicks. The canvas never blocks the webpage.
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{color-scheme:dark} *{box-sizing:border-box} canvas{position:absolute;inset:0;pointer-events:none}
      section{position:absolute;right:16px;bottom:16px;width:300px;max-height:calc(100vh - 32px);overflow:auto;overscroll-behavior:contain;padding:12px;border:2px solid #bc8c43;border-radius:8px;background:#1b2933f5;color:#f1e5ce;font:13px/1.45 system-ui,sans-serif;pointer-events:auto;box-shadow:0 3px 18px #0005}
      strong{color:#f5cb7d;letter-spacing:.07em} p{margin:5px 0} nav{display:flex;gap:6px;flex-wrap:wrap}
      button{background:#344953;color:#fff1d8;border:1px solid #ad874e;border-radius:4px;padding:6px 9px;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #62d8cd}
      .surface{position:absolute;width:1px;height:1px;overflow:hidden;outline:none;pointer-events:none}
      pre{white-space:pre-wrap;font:11px/1.4 monospace;margin:6px 0 0;color:#7fe4d7}
      section{max-width:calc(100vw - 16px)}
      section.minimized{width:230px;padding:6px 8px}
      .panel-header{display:flex;align-items:center;gap:6px}
      .panel-drag{flex:1;min-width:0;text-align:left;border:0;background:transparent;padding:4px 0;cursor:grab;touch-action:none;user-select:none}
      .panel-drag:active{cursor:grabbing}
      section.dragging{will-change:transform}
      .panel-drag strong{font-size:11px;letter-spacing:.04em}
      .panel-toggle{flex:none;font-size:18px;line-height:1;padding:4px 7px}
      [hidden]{display:none!important}
    </style><canvas aria-hidden="true"></canvas><div class="surface" tabindex="0" role="application" aria-label="Steel and Steam platformer. Arrows move, Space jumps, Down drops through. Escape stops."></div><section aria-label="Steel and Steam controls"><strong>STEEL &amp; STEAM</strong><p class="status" aria-live="polite"></p><p>← → / A D move · Space / W / ↑ jump<br>↓ / S drop through · B geometry · Esc stop</p><nav><button class="focus">Focus game</button><button class="debug" aria-pressed="false">Debug</button><button class="respawn">Respawn</button><button class="stop">Stop</button></nav><pre hidden></pre></section>`;
    document.documentElement.append(host);
    this.host = host;
    this.canvas = shadow.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.status = shadow.querySelector('.status')!;
    this.detail = shadow.querySelector('pre')!;
    shadow.querySelector('strong')!.append(` · ${chrome.runtime.getManifest().version}`);
    this.materialStatus = document.createElement('p');
    this.materialStatus.className = 'material-status';
    shadow.querySelector('nav')!.before(this.materialStatus);
    this.progressionPanel = mountProgressionUI(shadow.querySelector('section')!, {
      equip: async itemId => {
        const state = await requestProgression({ type: 'progress:equip', itemId });
        this.acceptProgress(state, run);
      },
    });
    this.progressionPanel.update(null, this.encounters);
    const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[PLAYER_STORAGE_KEY]?.newValue) {
        this.acceptProgress(changes[PLAYER_STORAGE_KEY].newValue as PlayerState, run);
      }
    };
    chrome.storage.onChanged.addListener(storageChanged);
    signal.addEventListener('abort', () => chrome.storage.onChanged.removeListener(storageChanged), { once: true });
    void requestProgression({ type: 'progress:get' }).then(state => this.acceptProgress(state, run))
      .catch(error => this.showProgressError(error, run));
    this.surface = shadow.querySelector('.surface')!;
    const focus = () => this.surface!.focus({ preventScroll: true });
    mountMovablePanel(shadow.querySelector('section')!, signal, focus);
    shadow.querySelector('.focus')!.addEventListener('click', focus, { signal });
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.className = 'locate';
    locate.textContent = 'Find player';
    locate.title = 'Show an arrow pointing to the player';
    shadow.querySelector('.focus')!.after(locate);
    locate.addEventListener('click', () => {
      this.locatorStarted = performance.now();
    }, { signal });
    shadow.querySelector('.debug')!.addEventListener('click', () => { this.toggleDebug(); focus(); }, { signal });
    shadow.querySelector('.respawn')!.addEventListener('click', () => { this.respawn(); focus(); }, { signal });
    shadow.querySelector('.stop')!.addEventListener('click', () => this.stop(), { signal });
    // Input uses the shadow host as document.activeElement while the game surface is focused.
    this.input = new Input(host, () => this.stop(), () => this.toggleDebug());
    document.addEventListener('keydown', e => { if (e.code === 'Escape') this.stop(); }, { signal });
    window.addEventListener('resize', this.layoutChanged, { signal });
    window.addEventListener('scroll', this.scrolled, { signal, passive: true, capture: true });
    window.addEventListener('load', this.layoutChanged, { signal, capture: true });
    window.addEventListener('popstate', this.layoutChanged, { signal });
    document.addEventListener('animationstart', this.layoutChanged, { signal, capture: true });
    document.addEventListener('animationend', this.layoutChanged, { signal, capture: true });
    document.addEventListener('transitionrun', this.layoutChanged, { signal, capture: true });
    document.addEventListener('transitionend', this.layoutChanged, { signal, capture: true });
    window.visualViewport?.addEventListener('resize', this.layoutChanged, { signal });
    document.addEventListener('visibilitychange', () => { this.last = 0; this.accumulator = 0; this.input?.clear(); }, { signal });
    this.mutation = new MutationObserver(records => {
      let changed = false;
      let structural = false;
      for (const record of records) {
        if (host.contains(record.target) || record.target === host) continue;
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        const hidden = element?.closest('[hidden]');
        const invisibleStyleWrite = record.type === 'attributes' && record.attributeName === 'style'
          && hidden && getComputedStyle(hidden).display === 'none';
        const styleMotion = !invisibleStyleWrite && record.type === 'attributes' && record.attributeName === 'style'
          && element && this.clearance?.markStyleMotion(element, record.oldValue);
        this.geometry?.markChanged(record.target, !!styleMotion);
        if (!invisibleStyleWrite && !styleMotion) {
          this.sceneryStale = true;
          this.clearance?.markChanged(record.target);
          if (record.type === 'childList') {
            for (const node of record.addedNodes) this.clearance?.markChanged(node);
          }
          structural = true;
        }
        changed = true;
      }
      if (changed && (structural || this.geometry?.needsRebuild || this.clearance?.needsRebuild)) this.schedule();
    });
    this.mutation.observe(document.documentElement, PAGE_MUTATIONS);
    this.resize = new ResizeObserver(this.layoutChanged);
    this.resize.observe(document.documentElement);
    if (document.body) this.resize.observe(document.body);
    void document.fonts.ready.then(() => { if (this.active) this.layoutChanged(); });
    this.lastUrl = location.href;
    this.rebuild();
    focus();
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private toggleDebug(): void {
    this.debug = !this.debug;
    this.host?.shadowRoot?.querySelector('.debug')?.setAttribute('aria-pressed', String(this.debug));
    if (this.detail) this.detail.hidden = !this.debug;
    this.layoutChanged();
  }

  private scrolled = (event: Event): void => {
    this.geometry?.markScrolled(event.target);
    this.clearance?.markScrolled(event.target);
    this.schedule();
  };

  private layoutChanged = (): void => {
    this.sceneryStale = true;
    this.clearance?.markChanged(document.documentElement);
    this.schedule();
  };

  // Bounded debounce: continuous mutations/scrolling cannot postpone a rebuild indefinitely.
  private schedule = (): void => {
    if (this.timer || !this.active) return;
    this.timer = window.setTimeout(() => { this.timer = 0; if (this.active) this.rebuild(); }, 140);
  };

  private rebuild(): void {
    this.level = buildLevel(this.geometry!.rebuild(this.player));
    this.mutation!.disconnect();
    this.mutation!.observe(document.documentElement, PAGE_MUTATIONS);
    for (const root of this.geometry!.shadowRoots) this.mutation!.observe(root, PAGE_MUTATIONS);
    this.measurePageBounds();
    if (!this.player && !this.placeAtSpawn()) {
      // Empty pages still show the character, but never receive an invented floor.
      this.player = createPlayer(scrollX + innerWidth / 2, scrollY + MOTION.height);
    }
    this.inspectedX = this.player!.x;
    this.inspectedY = this.player!.y;
    this.host!.shadowRoot!.querySelector<HTMLButtonElement>('.respawn')!.disabled = !this.level.spawn;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    const width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio);
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width;
      this.canvas!.height = height;
    }
    this.canvas!.style.width = `${innerWidth}px`;
    this.canvas!.style.height = `${innerHeight}px`;
    this.ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.rebuildScenery();
    this.refreshPickups();
  }

  private placeAtSpawn(): boolean {
    const spawn = this.level?.spawn;
    if (!spawn) return false;
    this.player = createPlayer(spawn.x, spawn.y);
    const surface = this.level!.platforms.find(p => Math.abs(p.y - spawn.y - MOTION.height) < 0.5
      && spawn.x + MOTION.width > p.x && spawn.x < p.x + p.width);
    if (surface) {
      this.player.grounded = true;
      this.player.platformId = surface.id;
    }
    this.commitMotion();
    this.stranded = false;
    this.rememberStanding();
    this.coyote = this.jumpBuffer = this.accumulator = 0;
    return true;
  }

  private respawn(): void {
    this.pickups = [];
    // Manual recovery chooses a real surface in the current viewport.
    this.level = buildLevel(this.geometry!.rebuild());
    if (this.placeAtSpawn()) {
      this.inspectedX = this.player!.x;
      this.inspectedY = this.player!.y;
    }
    this.rebuildScenery();
    this.refreshPickups();
  }

  private measurePageBounds(): void {
    this.pageHeight = Math.max(innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    this.nextBoundsRead = performance.now() + 250;
  }

  private rememberStanding(): void {
    const player = this.player!;
    if (!player.grounded || !player.platformId) return;
    const platform = this.level!.platforms.find(p => p.id === player.platformId);
    if (!platform) return;
    if (this.lastStanding) {
      this.lastStanding.id = platform.id;
      this.lastStanding.offset = player.x - platform.x;
    } else {
      this.lastStanding = { id: platform.id, offset: player.x - platform.x };
    }
    this.geometry!.retainPlatform(platform.id);
  }

  private restoreLastStanding(): boolean {
    const saved = this.lastStanding;
    const platform = saved && this.geometry!.registryPlatforms.find(p => p.id === saved.id);
    if (!platform) return false;
    respawnOnPlatform(this.player!, platform, saved!.offset);
    this.stranded = false;
    this.input!.clear();
    this.coyote = this.jumpBuffer = this.accumulator = 0;
    this.inspectedX = this.player!.x;
    this.inspectedY = this.player!.y;
    return true;
  }

  private commitMotion(): void {
    for (const p of this.geometry!.registryPlatforms) {
      p.previousX = p.x;
      p.previousY = p.y;
      p.previousWidth = p.width;
      p.discontinuous = false;
      p.reflow = false;
    }
  }
  private measureSceneryHud(): void {
    const panel = this.host!.shadowRoot!.querySelector('section')!.getBoundingClientRect();
    const reserve = this.scenery.reserved ??= { x: 0, y: 0, width: 0, height: 0 };
    reserve.x = panel.left + scrollX - 8;
    reserve.y = panel.top + scrollY - 8;
    reserve.width = panel.width + 16;
    reserve.height = panel.height + 16;
  }

  private rebuildScenery(): void {
    if (this.sceneryStale) this.clearance!.rebuild();
    this.sceneryStale = false;
    this.measureSceneryHud();
    this.scenery.protectedRects = this.clearance!.rectangles;
    this.scenery.placements = placeScenery(this.designs, this.geometry!.registryPlatforms, this.scenery.placements);
    this.scenery.ready = this.clearance!.complete;
  }

  private refreshScenery(): void {
    if (!this.level || !this.host || !this.clearance) return;
    this.measureSceneryHud();
    this.scenery.protectedRects = this.clearance.rectangles;
    this.scenery.ready = this.clearance.complete;
    updateScenery(this.scenery.placements, this.geometry!.registryPlatforms);
    if (this.pickupRevision !== this.geometry!.registryRevision
      || this.collisionRevision !== this.geometry!.selectionRevision) this.refreshPickups();
    else updatePickups(this.pickups, this.level.platforms);
    if (this.player) selectActivePickups(this.pickups, this.player, this.activePickups);
  }

  private acceptProgress(state: PlayerState, run: number): void {
    if (!this.active || run !== this.run || this.saved && state.revision < this.saved.revision) return;
    if (state.version !== 2 || !Array.isArray(state.inventory) || !Array.isArray(state.collectedCoins)) {
      this.showProgressError(new Error('Saved progression format is incompatible.'), run);
      return;
    }
    this.saved = state;
    this.collected = new Set(state.collectedCoins);
    for (const item of state.inventory) this.pendingEquipment.delete(item.id);
    this.claimedEquipment = new Set([...state.claimedRewards, ...state.inventory.map(item => item.id), ...this.pendingEquipment]);
    this.jumpMultiplier = state.inventory.find(item => item.id === state.equippedItemId)?.jumpMultiplier ?? 1;
    this.progressError = '';
    this.progressionPanel?.update(state, this.encounters);
    this.refreshPickups();
  }

  private showProgressError(error: unknown, run: number): void {
    if (!this.active || run !== this.run) return;
    this.progressError = error instanceof Error ? error.message : String(error);
    this.progressionPanel?.update(this.saved ?? null, this.encounters, this.progressError);
  }

  private refreshPickups(): void {
    if (!this.geometry || !this.level || !this.saved) return;
    this.encounters = discoverEncounters(location.href, this.geometry.registryPlatforms, this.encounters, this.collected);
    this.pickups = planPickups(this.encounters, this.level.platforms, this.pickups, this.collected, this.claimedEquipment);
    this.pickupRevision = this.geometry.registryRevision;
    this.collisionRevision = this.geometry.selectionRevision;
    if (this.player) selectActivePickups(this.pickups, this.player, this.activePickups);
    this.progressionPanel?.update(this.saved, this.encounters, this.progressError);
  }

  private collectPickups(): void {
    if (!this.saved || !this.player || !this.level) return;
    const player = this.player;
    for (const pickup of this.activePickups) {
      if (!pickup.available || this.collected.has(pickup.id) || this.pendingClaims.has(pickup.id)) continue;
      const dx = pickup.x - Math.max(player.x, Math.min(player.x + player.width, pickup.x));
      const dy = pickup.y - Math.max(player.y, Math.min(player.y + player.height, pickup.y));
      if (dx * dx + dy * dy > 64) continue;
      this.pendingClaims.add(pickup.id);
      const run = this.run;
      if (pickup.kind === 'equipment') {
        this.pendingEquipment.add(pickup.id);
        this.claimedEquipment.add(pickup.id);
        pickup.available = false;
        const index = this.pickups.indexOf(pickup);
        if (index >= 0) this.pickups.splice(index, 1);
        const ownership: EquipmentOwnership = { encounterId: pickup.encounterId, equipment: pickup.equipment };
        void chrome.storage.local.set({ [EQUIPMENT_STORAGE_PREFIX + pickup.id]: ownership })
          .catch(error => {
            if (!this.active || run !== this.run) return;
            this.pendingEquipment.delete(pickup.id);
            if (!this.saved?.inventory.some(item => item.id === pickup.id)) this.claimedEquipment.delete(pickup.id);
            this.refreshPickups();
            this.showProgressError(error, run);
          })
          .finally(() => { if (run === this.run) this.pendingClaims.delete(pickup.id); });
        continue;
      }
      void requestProgression({ type: 'progress:collect', url: location.href, logicalKey: pickup.logicalKey, index: pickup.index })
        .then(state => this.acceptProgress(state, run))
        .catch(error => this.showProgressError(error, run))
        .finally(() => { if (run === this.run) this.pendingClaims.delete(pickup.id); });
    }
  }


  private tick = (now: number): void => {
    if (!this.active) return;
    if (location.href !== this.lastUrl) {
      const identityChanged = pageSeedKey(location.href) !== pageSeedKey(this.lastUrl);
      this.lastUrl = location.href;
      if (identityChanged) {
        this.designs = sceneryDesigns(location.href);
        this.scenery.placements = placeScenery(this.designs, this.geometry!.registryPlatforms);
        this.encounters = [];
        this.pickups = [];
        this.activePickups.length = 0;
        this.pickupRevision = -1;
        this.refreshPickups();
      }
      this.schedule();
    }
    // One measurement transaction per frame: every consumer sees the same endpoints.
    this.geometry!.sampleMotion();
    this.clearance!.sampleMotion();
    if (this.geometry!.needsRebuild || this.clearance!.needsRebuild) this.schedule();
    if (now >= this.nextBoundsRead) this.measurePageBounds();
    this.refreshScenery();
    const elapsed = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const input = this.input!, player = this.player!, level = this.level!;
    const previousY = player.y;
    if (input.focused && !this.stranded) {
      if (input.jump) this.jumpBuffer = 0.13;
      input.jump = false;
      this.accumulator += elapsed;
      const steps = Math.floor(this.accumulator / MOTION.step);
      for (let index = 0; index < steps; index++) {
        const dt = MOTION.step;
        this.coyote = player.grounded ? 0.09 : Math.max(0, this.coyote - dt);
        if (input.drop) {
          if (dropThrough(player)) this.coyote = this.jumpBuffer = 0;
          input.drop = false;
        }
        this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
        player.vx = (Number(input.right) - Number(input.left)) * MOTION.speed;
        if (player.vx) this.facing = Math.sign(player.vx);
        if (this.jumpBuffer > 0 && this.coyote > 0) {
          player.vy = -MOTION.jump * this.jumpMultiplier;
          player.grounded = false;
          this.coyote = this.jumpBuffer = 0;
        }
        stepBody(player, level.platforms, dt, index / steps, (index + 1) / steps);
        this.accumulator -= dt;
        this.collectPickups();
        this.rememberStanding();
        if (fellBelowViewport(player, previousY, scrollY + innerHeight) || outsidePage(player, this.pageHeight)) {
          if (!this.restoreLastStanding()) {
            // No real checkpoint exists (empty page or removed surface). Stop the
            // fall without inventing a floor or relocating into the viewport.
            this.stranded = true;
            player.vx = player.vy = this.accumulator = 0;
          }
          break;
        }
      }
      if (!steps) {
        carryBody(player, level.platforms);
        this.rememberStanding();
      }
      this.commitMotion();
    } else {
      input.clear();
      this.accumulator = 0;
      if (!this.stranded) {
        carryBody(player, level.platforms);
        this.rememberStanding();
      }
      this.commitMotion();
    }
    if (Math.abs(player.x - this.inspectedX) > 200 || Math.abs(player.y - this.inspectedY) > 200) this.schedule();
    drawWorld(this.ctx!, this.level!, this.player!, this.debug, this.facing, this.scenery, this.activePickups, this.collected, this.jumpMultiplier > 1);
    drawPlayerLocator(this.ctx!, player, now - this.locatorStarted);
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      const offscreen = player.x + player.width < scrollX || player.x > scrollX + innerWidth
        || player.y + player.height < scrollY || player.y > scrollY + innerHeight;
      this.status!.textContent = this.stranded
        ? 'Last platform unavailable · use Respawn or restart'
        : offscreen ? 'Character offscreen · scroll back or use Respawn'
        : input.focused ? 'Game focused · explore the page' : 'Paused · page controls are free';
      const ornaments = this.scenery.ready ? this.scenery.placements.filter(item => item.visible).length : 0;
      this.materialStatus!.textContent = !this.scenery.ready ? 'Material blocked: inspection limit reached'
        : ornaments ? `Material: ${ornaments} eligible surfaces` : 'Material: no wide native surfaces here';
      if (this.debug) {
        const p = this.player!;
        this.detail!.textContent = `DOM ${level.platforms.length} · moving ${level.platforms.filter(p => p.moving).length} · decor ${ornaments}\nx ${p.x.toFixed(2)} y ${p.y.toFixed(2)} · vy ${p.vy.toFixed(2)}\n${p.grounded ? 'GROUNDED' : 'AIRBORNE'} · on ${p.platformId ?? 'none'}\nteal: DOM · gold: moving · red: player`;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.run++;
    this.progressionPanel?.dispose();
    this.progressionPanel = undefined;
    this.pickups = [];
    this.activePickups.length = 0;
    this.pendingClaims.clear();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.timer = 0;
    this.abort?.abort();
    this.input?.dispose();
    this.mutation?.disconnect();
    this.resize?.disconnect();
    this.geometry?.clear();
    this.geometry = undefined;
    this.clearance?.clear();
    this.clearance = undefined;
    this.scenery.placements.length = 0;
    this.scenery.protectedRects = [];
    this.scenery.ready = false;
    this.designs = [];
    this.host?.remove();
    this.player = undefined;
    this.level = undefined;
    this.accumulator = 0;
    this.host = undefined;
  }
}
