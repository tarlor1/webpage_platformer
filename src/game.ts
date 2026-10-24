import { PageGeometry } from './geometry';
import { buildLevel, outsidePage } from './level';
import { Input } from './input';
import { carryBody, createPlayer, dropThrough, respawnOnPlatform, stepBody } from './physics';
import { drawWorld } from './render';
import { MOTION, OVERLAY_ID, type Body, type Level } from './types';

export class Game {
  active = false;
  private host?: HTMLDivElement;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private status?: HTMLElement;
  private detail?: HTMLElement;
  private surface?: HTMLElement;
  private input?: Input;
  private level?: Level;
  private geometry?: PageGeometry;
  private motionTimer = 0;
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
  private coyote = 0;
  private jumpBuffer = 0;
  private lastUrl = '';
  private lastHud = 0;

  start(): void {
    if (this.active) return;
    this.active = true;
    this.debug = false;
    this.facing = 1;
    this.lastHud = 0;
    this.lastStanding = undefined;
    this.stranded = false;
    this.nextBoundsRead = 0;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.geometry = new PageGeometry();
    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    // Only the small HUD intercepts clicks. The canvas never blocks the webpage.
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{color-scheme:dark} *{box-sizing:border-box} canvas{position:absolute;inset:0;pointer-events:none}
      section{position:absolute;right:16px;bottom:16px;width:300px;padding:12px;border:2px solid #bc8c43;border-radius:8px;background:#1b2933f5;color:#f1e5ce;font:13px/1.45 system-ui,sans-serif;pointer-events:auto;box-shadow:0 3px 18px #0005}
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
    this.surface = shadow.querySelector('.surface')!;
    const focus = () => this.surface!.focus({ preventScroll: true });
    shadow.querySelector('.focus')!.addEventListener('click', focus, { signal });
    shadow.querySelector('.debug')!.addEventListener('click', () => { this.toggleDebug(); focus(); }, { signal });
    shadow.querySelector('.respawn')!.addEventListener('click', () => { this.respawn(); focus(); }, { signal });
    shadow.querySelector('.stop')!.addEventListener('click', () => this.stop(), { signal });
    // Input uses the shadow host as document.activeElement while the game surface is focused.
    this.input = new Input(host, () => this.stop(), () => this.toggleDebug());
    document.addEventListener('keydown', e => { if (e.code === 'Escape') this.stop(); }, { signal });
    window.addEventListener('resize', this.schedule, { signal });
    window.addEventListener('scroll', this.schedule, { signal, passive: true, capture: true });
    window.addEventListener('load', this.schedule, { signal, capture: true });
    window.addEventListener('popstate', this.schedule, { signal });
    document.addEventListener('animationstart', this.schedule, { signal, capture: true });
    document.addEventListener('animationend', this.schedule, { signal, capture: true });
    document.addEventListener('transitionrun', this.schedule, { signal, capture: true });
    document.addEventListener('transitionend', this.schedule, { signal, capture: true });
    window.visualViewport?.addEventListener('resize', this.schedule, { signal });
    document.addEventListener('visibilitychange', () => { this.last = 0; this.accumulator = 0; this.input?.clear(); }, { signal });
    this.mutation = new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        if (host.contains(record.target) || record.target === host) continue;
        this.geometry?.markChanged(record.target);
        changed = true;
      }
      if (changed) this.schedule();
    });
    this.mutation.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'src'] });
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(document.documentElement);
    if (document.body) this.resize.observe(document.body);
    void document.fonts.ready.then(() => { if (this.active) this.schedule(); });
    this.lastUrl = location.href;
    this.rebuild();
    // Only cached moving sources are measured here; full DOM scans stay debounced.
    this.motionTimer = window.setInterval(() => {
      this.geometry?.sampleMotion();
      if (this.geometry?.needsRebuild) this.schedule();
      if (performance.now() >= this.nextBoundsRead) this.measurePageBounds();
    }, 16);
    focus();
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private toggleDebug(): void {
    this.debug = !this.debug;
    this.host?.shadowRoot?.querySelector('.debug')?.setAttribute('aria-pressed', String(this.debug));
    if (this.detail) this.detail.hidden = !this.debug;
  }

  // Bounded debounce: continuous mutations/scrolling cannot postpone a rebuild indefinitely.
  private schedule = (): void => {
    if (this.timer || !this.active) return;
    this.timer = window.setTimeout(() => { this.timer = 0; if (this.active) this.rebuild(); }, 140);
  };

  private rebuild(): void {
    this.level = buildLevel(this.geometry!.rebuild(this.player));
    this.measurePageBounds();
    if (!this.player && !this.placeAtSpawn()) {
      // Empty pages still show the character, but never receive an invented floor.
      this.player = createPlayer(scrollX + innerWidth / 2, scrollY + MOTION.height);
    }
    this.inspectedX = this.player!.x;
    this.inspectedY = this.player!.y;
    this.host!.shadowRoot!.querySelector<HTMLButtonElement>('.respawn')!.disabled = !this.level.spawn;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    this.canvas!.width = Math.round(innerWidth * ratio);
    this.canvas!.height = Math.round(innerHeight * ratio);
    this.canvas!.style.width = `${innerWidth}px`;
    this.canvas!.style.height = `${innerHeight}px`;
    this.ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
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
    // Manual recovery chooses a real surface in the current viewport.
    this.level = buildLevel(this.geometry!.rebuild());
    if (this.placeAtSpawn()) {
      this.inspectedX = this.player!.x;
      this.inspectedY = this.player!.y;
    }
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
    const platform = saved && this.level!.platforms.find(p => p.id === saved.id);
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
    for (const p of this.level!.platforms) {
      p.previousX = p.x;
      p.previousY = p.y;
      p.previousWidth = p.width;
    }
  }

  private tick = (now: number): void => {
    if (!this.active) return;
    if (location.href !== this.lastUrl) { this.lastUrl = location.href; this.schedule(); }
    const elapsed = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const input = this.input!, player = this.player!, level = this.level!;
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
          player.vy = -MOTION.jump;
          player.grounded = false;
          this.coyote = this.jumpBuffer = 0;
        }
        stepBody(player, level.platforms, dt, index / steps, (index + 1) / steps);
        this.accumulator -= dt;
        this.rememberStanding();
        if (outsidePage(player, this.pageHeight)) {
          if (!this.restoreLastStanding()) {
            // No real checkpoint exists (empty page or removed surface). Stop the
            // fall without inventing a floor or relocating into the viewport.
            this.stranded = true;
            player.vx = player.vy = this.accumulator = 0;
          }
          break;
        }
      }
      if (steps) this.commitMotion();
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
    drawWorld(this.ctx!, this.level!, this.player!, this.debug, this.facing);
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      const offscreen = player.x + player.width < scrollX || player.x > scrollX + innerWidth
        || player.y + player.height < scrollY || player.y > scrollY + innerHeight;
      this.status!.textContent = this.stranded
        ? 'Last platform unavailable · use Respawn or restart'
        : offscreen ? 'Character offscreen · scroll back or use Respawn'
        : input.focused ? 'Game focused · explore the page' : 'Paused · page controls are free';
      if (this.debug) {
        const p = this.player!;
        this.detail!.textContent = `DOM ${level.platforms.length} · moving ${level.platforms.filter(p => p.moving).length}\nx ${p.x.toFixed(2)} y ${p.y.toFixed(2)} · vy ${p.vy.toFixed(2)}\n${p.grounded ? 'GROUNDED' : 'AIRBORNE'} · on ${p.platformId ?? 'none'}\nteal: DOM · gold: moving · red: player`;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    clearInterval(this.motionTimer);
    this.motionTimer = 0;
    this.timer = 0;
    this.abort?.abort();
    this.input?.dispose();
    this.mutation?.disconnect();
    this.resize?.disconnect();
    this.geometry?.clear();
    this.geometry = undefined;
    this.host?.remove();
    this.player = undefined;
    this.level = undefined;
    this.accumulator = 0;
    this.host = undefined;
  }
}
