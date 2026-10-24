import { PageGeometry } from '../page/geometry';
import { buildLevel, fellBelowViewport, outsidePage } from './level';
import { Input } from './input';
import { carryBody, createPlayer, dropThrough, respawnOnPlatform, stepBody } from './physics';
import { drawWorld } from '../rendering/render';
import { MOTION, OVERLAY_ID, type Body, type Level, type Platform } from './types';
import { TextClearance } from '../rendering/text-clearance';
import { sceneryDesigns } from '../rendering/scenery-art';
import { placeScenery, updateScenery } from '../rendering/scenery';
import type { SceneryDesign, SceneryScene } from '../rendering/scenery-types';
import { discoverEncounters } from '../progression/encounters';
import { pageSeedKey } from '../page/page-identity';
import { PickupIndex, planPickups, updatePickups } from '../progression/collectibles';
import { requestProgression } from '../progression/progression-client';
import { mountProgressionUI, type ProgressionPanel } from '../ui/progression-ui';
import { EQUIPMENT_STORAGE_PREFIX, PLAYER_STORAGE_KEY, type EquipmentOwnership, type PageEncounter, type PagePickup, type PlayerState } from '../progression/progression-types';
import { beginMeasurements, readBounds } from '../page/frame-measurement';
import { composedParent } from '../page/composed-dom';

const PAGE_MUTATIONS: MutationObserverInit = {
  subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
  attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'src', 'srcset', 'srcdoc', 'poster',
    'id', 'name', 'title', 'alt', 'role', 'aria-label', 'slot', 'type', 'href',
    'aria-expanded', 'expanded', 'collapsed', 'is-expanded', 'miniplayer', 'theater', 'fullscreen', 'is-two-columns_',
    'data-id', 'data-item-id', 'data-product-id', 'data-post-id', 'post-id', 'permalink'],
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
  private decorationRevision = -1;
  private levelRevision = -1;
  private layoutPending = false;
  private viewportChanged = true;
  private canvasDirty = true;
  private waitingForSpawn = false;
  private changes = new Map<Node, boolean>();
  private styleChanges = new Map<Element, string | null>();
  private observedRoots = new Set<ShadowRoot>();
  private rootsDirty = true;
  private rootRevision = -1;
  private documentWidth = 0;
  private lastStanding?: { id: string; offset: number };
  private pageHeight = 0;
  private nextBoundsRead = 0;
  private stranded = false;
  private player?: Body;
  private abort?: AbortController;
  private mutation?: MutationObserver;
  private resize?: ResizeObserver;
  private progressPanelDirty = false;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private debug = false;
  private facing = 1;
  private coyote = 0;
  private jumpBuffer = 0;
  private lastUrl = '';
  private lastHud = 0;
  private run = 0;
  private saved?: PlayerState;
  private encounters: PageEncounter[] = [];
  private encounterDefinitions = new Map<string, PageEncounter>();
  private seenLootKeys = new Set<string>();
  private newLootPlatforms: Platform[] = [];
  private rewardPlatforms: Platform[] = [];
  private rewardLogicalKeys = new Set<string>();
  private rewardSurfaceKeys = new Map<Platform, string>();
  private nextRewardSurfaceKeys = new Map<Platform, string>();
  private lootCollectedCount = -1;
  private pickupRevision = -1;
  private pickups: PagePickup[] = [];
  private pickupIndex = new PickupIndex();
  private visiblePickups: PagePickup[] = [];
  private nearbyPickups: PagePickup[] = [];
  private viewportBounds = { x: 0, y: 0, width: 0, height: 0 };
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
    this.resetLoot();
    this.decorationRevision = this.levelRevision = this.rootRevision = -1;
    this.changes.clear();
    this.styleChanges.clear();
    this.observedRoots.clear();
    this.rootsDirty = this.viewportChanged = this.canvasDirty = true;
    this.documentWidth = 0;
    this.waitingForSpawn = false;
    this.collected.clear();
    this.claimedEquipment.clear();
    this.pendingEquipment.clear();
    this.pendingClaims.clear();
    this.jumpMultiplier = 1;
    this.progressError = '';
    this.debug = false;
    this.facing = 1;
    this.lastHud = 0;
    this.lastStanding = undefined;
    this.stranded = false;
    this.nextBoundsRead = 0;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.geometry = new PageGeometry();
    this.clearance = new TextClearance();
    this.designs = sceneryDesigns(location.href);
    beginMeasurements();
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
    shadow.querySelector('.focus')!.addEventListener('click', focus, { signal });
    shadow.querySelector('.debug')!.addEventListener('click', () => { this.toggleDebug(); focus(); }, { signal });
    shadow.querySelector('.respawn')!.addEventListener('click', () => { this.respawn(); focus(); }, { signal });
    shadow.querySelector('.stop')!.addEventListener('click', () => this.stop(), { signal });
    // Input uses the shadow host as document.activeElement while the game surface is focused.
    this.input = new Input(host, () => this.stop(), () => this.toggleDebug());
    document.addEventListener('keydown', e => { if (e.code === 'Escape') this.stop(); }, { signal });
    window.addEventListener('resize', this.layoutChanged, { signal });
    window.addEventListener('scroll', this.scrolled, { signal, passive: true, capture: true });
    window.addEventListener('load', this.contentLoaded, { signal, capture: true });
    window.addEventListener('popstate', this.layoutChanged, { signal });
    document.addEventListener('animationstart', this.animationChanged, { signal, capture: true });
    document.addEventListener('animationend', this.animationChanged, { signal, capture: true });
    document.addEventListener('transitionrun', this.animationChanged, { signal, capture: true });
    document.addEventListener('transitionend', this.animationChanged, { signal, capture: true });
    window.visualViewport?.addEventListener('resize', this.layoutChanged, { signal });
    document.addEventListener('visibilitychange', () => { this.last = 0; this.accumulator = 0; this.input?.clear(); }, { signal });
    this.mutation = new MutationObserver(this.onMutations);
    this.mutation.observe(document.documentElement, PAGE_MUTATIONS);
    this.resize = new ResizeObserver(entries => {
      this.nextBoundsRead = 0;
      for (const entry of entries) {
        if (entry.target !== document.documentElement) continue;
        const width = entry.contentRect.width;
        if (this.documentWidth && width !== this.documentWidth) this.layoutChanged();
        this.documentWidth = width;
      }
    });
    this.resize.observe(document.documentElement);
    if (document.body) this.resize.observe(document.body);
    void document.fonts.ready.then(() => { if (this.active) this.layoutChanged(); });
    document.fonts.addEventListener('loadingdone', this.layoutChanged, { signal });
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
  }

  private scrolled = (event: Event): void => {
    this.geometry?.markScrolled(event.target);
    this.clearance?.markScrolled(event.target);
    this.viewportChanged = true;
  };

  private layoutChanged = (): void => {
    this.layoutPending = this.canvasDirty = this.viewportChanged = true;
    this.nextBoundsRead = 0;
  };

  private contentLoaded = (event: Event): void => {
    if (event.target instanceof Node) this.queueChange(event.target, true);
  };

  private animationChanged = (event: Event): void => {
    if (event.target instanceof Node) this.queueChange(event.target, false);
  };

  private queueChange(target: Node, discover: boolean): void {
    if (target === this.host || this.host?.contains(target)) return;
    this.changes.set(target, discover || this.changes.get(target) === true);
  }

  /** Observer callbacks only enqueue; one frame transaction coalesces native reads. */
  private onMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.target === this.host || this.host?.contains(record.target)) continue;
      if (record.type === 'attributes' && record.attributeName === 'style' && record.target instanceof Element) {
        if (!this.styleChanges.has(record.target)) this.styleChanges.set(record.target, record.oldValue);
      } else {
        const bulk = record.type === 'childList' && record.addedNodes.length > 32
          && record.target !== document.body && record.target !== document.documentElement;
        this.queueChange(record.target, record.type !== 'childList' || bulk);
        if (record.type === 'childList') {
          this.rootsDirty = true;
          if (!bulk) for (const node of record.addedNodes) this.queueChange(node, true);
        }
      }
    }
  };

  private flushChanges(): void {
    for (const [target, previous] of this.styleChanges) {
      if (!target.isConnected || target.getAttribute('style') === previous) continue;
      const motion = this.clearance!.markStyleMotion(target, previous);
      this.geometry!.markChanged(target, motion, !motion);
      if (!motion) this.clearance!.markChanged(target);
    }
    this.styleChanges.clear();
    for (const [target, discover] of this.changes) {
      if (!target.isConnected) continue;
      let covered = false;
      for (let ancestor = composedParent(target); ancestor; ancestor = composedParent(ancestor)) {
        if (this.changes.get(ancestor) === true) { covered = true; break; }
      }
      if (covered) continue;
      this.geometry!.markChanged(target, false, discover);
      this.clearance!.markChanged(target, discover);
    }
    this.changes.clear();
  }

  private syncShadowRoots(): void {
    const roots = this.geometry!.shadowRoots;
    if (!this.rootsDirty && this.rootRevision === this.geometry!.registryRevision
      && roots.size === this.observedRoots.size) return;
    this.rootsDirty = false;
    this.rootRevision = this.geometry!.registryRevision;
    if ([...this.observedRoots].some(root => !root.host.isConnected || !roots.has(root))) {
      this.onMutations(this.mutation!.takeRecords());
      this.mutation!.disconnect();
      this.mutation!.observe(document.documentElement, PAGE_MUTATIONS);
      this.observedRoots.clear();
    }
    for (const root of roots) {
      if (!root.host.isConnected || this.observedRoots.has(root)) continue;
      this.mutation!.observe(root, PAGE_MUTATIONS);
      this.observedRoots.add(root);
    }
  }

  private rebuild(): void {
    this.layoutPending = false;
    this.level = buildLevel(this.geometry!.rebuild(this.player));
    this.clearance!.rebuild();
    this.viewportChanged = true;
    this.measurePageBounds();
    if (!this.player) {
      this.player = createPlayer(scrollX + innerWidth / 2, scrollY + MOTION.height);
      this.waitingForSpawn = true;
    }
  }

  private resizeCanvas(): void {
    this.canvasDirty = false;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    const width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio);
    if (this.canvas!.width !== width) this.canvas!.width = width;
    if (this.canvas!.height !== height) this.canvas!.height = height;
    this.canvas!.style.width = `${innerWidth}px`;
    this.canvas!.style.height = `${innerHeight}px`;
    this.ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private refreshLevel(): void {
    if (!this.viewportChanged && this.levelRevision === this.geometry!.selectionRevision && !this.waitingForSpawn) return;
    this.viewportChanged = false;
    this.levelRevision = this.geometry!.selectionRevision;
    this.level = buildLevel(this.level!.platforms);
    this.host!.shadowRoot!.querySelector<HTMLButtonElement>('.respawn')!.disabled = !this.level.spawn;
    if (this.waitingForSpawn && this.level.spawn) {
      this.waitingForSpawn = !this.placeAtSpawn();
    } else if (this.waitingForSpawn && !this.geometry!.inspecting) {
      this.waitingForSpawn = false;
    }
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
    this.geometry!.setInterest(this.player);
    this.geometry!.commitMotion();
    this.stranded = false;
    this.rememberStanding();
    this.coyote = this.jumpBuffer = this.accumulator = 0;
    return true;
  }

  private respawn(): void {
    beginMeasurements();
    this.geometry!.setInterest(undefined);
    this.geometry!.markScrolled(document);
    this.geometry!.sampleMotion();
    this.level = buildLevel(this.level!.platforms);
    if (!this.placeAtSpawn()) this.waitingForSpawn = this.geometry!.inspecting;
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
    return true;
  }

  private measureSceneryHud(): void {
    const panel = readBounds(this.host!.shadowRoot!.querySelector('section')!);
    const reserve = this.scenery.reserved ??= { x: 0, y: 0, width: 0, height: 0 };
    reserve.x = panel.left + scrollX - 8;
    reserve.y = panel.top + scrollY - 8;
    reserve.width = panel.width + 16;
    reserve.height = panel.height + 16;
  }


  private refreshScenery(): void {
    if (!this.level || !this.host || !this.clearance) return;
    this.measureSceneryHud();
    this.scenery.protectedRects = this.clearance.rectangles;
    this.scenery.ready = this.clearance.complete;
    if (this.decorationRevision !== this.geometry!.registryRevision) {
      this.scenery.placements = placeScenery(this.designs, this.geometry!.registryPlatforms, this.scenery.placements);
      this.decorationRevision = this.geometry!.registryRevision;
    }
    updateScenery(this.scenery.placements, this.geometry!.registryPlatforms, this.scenery.protectedRects, this.scenery.reserved);
    if (this.pickupRevision !== this.geometry!.registryRevision) this.refreshPickups(false);
    else updatePickups(this.pickups, this.rewardPlatforms);
    this.pickupIndex.update(this.pickups);
    this.viewportBounds.x = scrollX;
    this.viewportBounds.y = scrollY;
    this.viewportBounds.width = innerWidth;
    this.viewportBounds.height = innerHeight;
    this.pickupIndex.query(this.viewportBounds, this.visiblePickups);
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
    this.refreshPickups();
    this.progressionPanel?.update(state, this.encounters);
    this.progressPanelDirty = false;
  }

  private showProgressError(error: unknown, run: number): void {
    if (!this.active || run !== this.run) return;
    this.progressError = error instanceof Error ? error.message : String(error);
    this.progressionPanel?.update(this.saved ?? null, this.encounters, this.progressError);
  }

  private resetLoot(): void {
    this.encounters.length = 0;
    this.encounterDefinitions.clear();
    this.seenLootKeys.clear();
    this.newLootPlatforms.length = this.rewardPlatforms.length = 0;
    this.rewardLogicalKeys.clear();
    this.rewardSurfaceKeys.clear();
    this.nextRewardSurfaceKeys.clear();
    this.lootCollectedCount = -1;
    this.pickupRevision = -1;
    this.pickups.length = 0;
    this.pickupIndex.update(this.pickups);
    this.visiblePickups.length = this.nearbyPickups.length = 0;
  }

  private refreshPickups(force = true): void {
    if (!this.geometry || !this.level || !this.saved) return;
    const registry = this.geometry.registryPlatforms;
    const rescanClaims = this.lootCollectedCount !== this.collected.size;
    this.newLootPlatforms.length = 0;
    for (const platform of registry) {
      const key = platform.logicalKey;
      if (!key || !rescanClaims && this.seenLootKeys.has(key)) continue;
      this.seenLootKeys.add(key);
      this.newLootPlatforms.push(platform);
    }
    const previousCount = this.encounters.length;
    this.encounters = discoverEncounters(location.href, this.newLootPlatforms, this.encounters, this.collected, this.encounterDefinitions);
    this.rewardLogicalKeys.clear();
    for (const encounter of this.encounters) this.rewardLogicalKeys.add(encounter.logicalKey);
    this.rewardPlatforms.length = 0;
    this.nextRewardSurfaceKeys.clear();
    let changed = force || previousCount !== this.encounters.length;
    for (const platform of registry) {
      const key = platform.logicalKey;
      if (!key || !this.rewardLogicalKeys.has(key)) continue;
      this.rewardPlatforms.push(platform);
      this.nextRewardSurfaceKeys.set(platform, key);
      if (this.rewardSurfaceKeys.get(platform) !== key) changed = true;
    }
    if (this.nextRewardSurfaceKeys.size !== this.rewardSurfaceKeys.size) changed = true;
    const previous = this.rewardSurfaceKeys;
    this.rewardSurfaceKeys = this.nextRewardSurfaceKeys;
    this.nextRewardSurfaceKeys = previous;
    if (changed) this.pickups = planPickups(this.encounters, this.rewardPlatforms, this.pickups, this.collected, this.claimedEquipment);
    else updatePickups(this.pickups, this.rewardPlatforms);
    this.pickupRevision = this.geometry.registryRevision;
    this.lootCollectedCount = this.collected.size;
    this.progressPanelDirty ||= changed;
  }

  private collectPickups(): void {
    if (!this.saved || !this.player || !this.level) return;
    const player = this.player;
    this.pickupIndex.query(player, this.nearbyPickups);
    for (const pickup of this.nearbyPickups) {
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
    beginMeasurements();
    if (location.href !== this.lastUrl) {
      const identityChanged = pageSeedKey(location.href) !== pageSeedKey(this.lastUrl);
      this.lastUrl = location.href;
      if (identityChanged) {
        this.designs = sceneryDesigns(location.href);
        this.scenery.placements.length = 0;
        this.resetLoot();
        this.decorationRevision = -1;
        this.refreshPickups();
      }
      this.layoutChanged();
    }
    // One measurement transaction per frame: every consumer sees the same endpoints.
    if (this.layoutPending) this.rebuild();
    this.flushChanges();
    this.geometry!.setInterest(this.player);
    this.geometry!.sampleMotion();
    this.clearance!.sampleMotion();
    this.syncShadowRoots();
    if (this.canvasDirty) this.resizeCanvas();
    this.refreshLevel();
    if (now >= this.nextBoundsRead) this.measurePageBounds();
    this.refreshScenery();
    const elapsed = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const input = this.input!, player = this.player!, level = this.level!;
    const previousY = player.y;
    if (input.focused && !this.stranded && !this.waitingForSpawn) {
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
      this.geometry!.commitMotion();
    } else {
      input.clear();
      this.accumulator = 0;
      if (!this.stranded && !this.waitingForSpawn) {
        carryBody(player, level.platforms);
        this.rememberStanding();
      }
      this.geometry!.commitMotion();
    }
    drawWorld(this.ctx!, this.level!, this.player!, this.debug, this.facing, this.scenery, this.visiblePickups, this.collected, this.jumpMultiplier > 1);
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      if (this.progressPanelDirty && this.saved) {
        this.progressionPanel?.update(this.saved, this.encounters, this.progressError);
        this.progressPanelDirty = false;
      }
      const offscreen = player.x + player.width < scrollX || player.x > scrollX + innerWidth
        || player.y + player.height < scrollY || player.y > scrollY + innerHeight;
      this.status!.textContent = this.waitingForSpawn
        ? 'Inspecting native surfaces…'
        : this.stranded
        ? 'Last platform unavailable · use Respawn or restart'
        : offscreen ? 'Character offscreen · scroll back or use Respawn'
        : input.focused ? 'Game focused · explore the page' : 'Paused · page controls are free';
      const ornaments = this.scenery.ready ? this.scenery.placements.filter(item => item.visible).length : 0;
      const inspecting = this.geometry!.inspecting || this.clearance!.inspecting;
      this.materialStatus!.textContent = !this.scenery.ready ? 'Preparing safe decoration regions…'
        : `Material: ${ornaments} visible surfaces${inspecting ? ' · updating layout' : ''}`;
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
    this.resetLoot();
    this.saved = undefined;
    this.pendingEquipment.clear();
    this.pendingClaims.clear();
    cancelAnimationFrame(this.frame);
    this.abort?.abort();
    this.input?.dispose();
    this.mutation?.disconnect();
    this.resize?.disconnect();
    this.changes.clear();
    this.styleChanges.clear();
    this.observedRoots.clear();
    beginMeasurements();
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
