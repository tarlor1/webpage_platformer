import { extractPlatforms } from './geometry';
import { buildLevel } from './level';
import { Input } from './input';
import { createPlayer, dropThrough, stepBody, supported } from './physics';
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
    this.abort = new AbortController();
    const signal = this.abort.signal;
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
    window.visualViewport?.addEventListener('resize', this.schedule, { signal });
    document.addEventListener('visibilitychange', () => { this.last = 0; this.accumulator = 0; this.input?.clear(); }, { signal });
    this.mutation = new MutationObserver(records => {
      if (records.some(r => !host.contains(r.target) && r.target !== host)) this.schedule();
    });
    this.mutation.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'src'] });
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(document.documentElement);
    if (document.body) this.resize.observe(document.body);
    void document.fonts.ready.then(() => { if (this.active) this.schedule(); });
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

  // Bounded debounce: continuous mutations/scrolling cannot postpone a rebuild indefinitely.
  private schedule = (): void => {
    if (this.timer || !this.active) return;
    this.timer = window.setTimeout(() => { this.timer = 0; if (this.active) this.rebuild(); }, 140);
  };

  private rebuild(): void {
    const old = this.player;
    this.level = buildLevel(extractPlatforms(), old);
    const level = this.level;
    if (!old) this.respawn();
    else {
      const inView = old.x + old.width > scrollX && old.x < scrollX + innerWidth && old.y + old.height > scrollY && old.y < scrollY + innerHeight;
      const safeBelow = level.platforms.some(p => p.y >= old.y + old.height - 2 && p.y - old.y < 240 && p.x < old.x + old.width && p.x + p.width > old.x);
      if (!inView || (!supported(old, level.platforms) && (!safeBelow || old.grounded))) this.respawn();
    }
    const ratio = Math.min(devicePixelRatio || 1, 3);
    this.canvas!.width = Math.round(innerWidth * ratio);
    this.canvas!.height = Math.round(innerHeight * ratio);
    this.canvas!.style.width = `${innerWidth}px`;
    this.canvas!.style.height = `${innerHeight}px`;
    this.ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private respawn(): void {
    if (!this.level) return;
    this.player = createPlayer(this.level.spawn.x, this.level.spawn.y);
    this.coyote = this.jumpBuffer = 0;
  }

  private tick = (now: number): void => {
    if (!this.active) return;
    if (location.href !== this.lastUrl) { this.lastUrl = location.href; this.schedule(); }
    const elapsed = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const input = this.input!, player = this.player!, level = this.level!;
    if (input.focused) {
      if (input.jump) this.jumpBuffer = 0.13;
      input.jump = false;
      this.accumulator += elapsed;
      while (this.accumulator >= MOTION.step) {
        const dt = MOTION.step;
        this.coyote = player.grounded ? 0.09 : Math.max(0, this.coyote - dt);
        if (input.drop) {
          if (dropThrough(player)) this.coyote = this.jumpBuffer = 0;
          input.drop = false;
        }
        this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
        player.vx = (Number(input.right) - Number(input.left)) * MOTION.speed;
        if (player.vx) this.facing = Math.sign(player.vx);
        if (this.jumpBuffer > 0 && this.coyote > 0) { player.vy = -MOTION.jump; player.grounded = false; this.coyote = this.jumpBuffer = 0; }
        stepBody(player, level.platforms, dt);
        this.accumulator -= dt;
        if (player.y > Math.min(level.bounds.bottom + 150, scrollY + innerHeight + 160) || player.x < level.bounds.left - 120 || player.x > level.bounds.right + 120) { this.respawn(); break; }
      }
    } else { input.clear(); this.accumulator = 0; }
    drawWorld(this.ctx!, this.level!, this.player!, this.debug, this.facing);
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      this.status!.textContent = input.focused ? 'Game focused · explore the page' : 'Paused · page controls are free';
      if (this.debug) {
        const p = this.player!;
        this.detail!.textContent = `DOM ${level.measured} · bridges ${level.platforms.filter(p => p.kind === 'bridge').length}\nx ${p.x.toFixed(1)} y ${p.y.toFixed(1)} · vy ${p.vy.toFixed(1)}\n${p.grounded ? 'GROUNDED' : 'AIRBORNE'} · ${level.platforms.length} platforms\nteal: DOM · brass: bridge · red: player`;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.timer = 0;
    this.abort?.abort();
    this.input?.dispose();
    this.mutation?.disconnect();
    this.resize?.disconnect();
    this.host?.remove();
    this.player = undefined;
    this.level = undefined;
    this.accumulator = 0;
    this.host = undefined;
  }
}
