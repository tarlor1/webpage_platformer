export class Input {
  left = false;
  right = false;
  jump = false;
  drop = false;
  private abort = new AbortController();
  constructor(private surface: HTMLElement, stop: () => void, debug: () => void) {
    const codes: Record<string, true> = { ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true, KeyA: true, KeyD: true, KeyW: true, KeyS: true, Space: true, KeyB: true };
    const signal = this.abort.signal;
    window.addEventListener('keydown', e => {
      // Escape is reserved only while the game surface owns keyboard focus.
      if (!this.focused) return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); return; }
      if (!codes[e.code]) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.right = true;
      if (!e.repeat && ['Space', 'KeyW', 'ArrowUp'].includes(e.code)) this.jump = true;
      if (!e.repeat && (e.code === 'ArrowDown' || e.code === 'KeyS')) this.drop = true;
      if (!e.repeat && e.code === 'KeyB') debug();
    }, { signal, capture: true });
    window.addEventListener('keyup', e => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.right = false;
    }, { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
    document.addEventListener('focusin', () => { if (document.activeElement !== surface) this.clear(); }, { signal });
  }
  get focused(): boolean {
    return document.activeElement === this.surface && !document.hidden && document.hasFocus()
      && this.surface.shadowRoot?.activeElement?.classList.contains('surface') === true;
  }
  clear(): void { this.left = this.right = this.jump = this.drop = false; }
  dispose(): void { this.abort.abort(); this.clear(); }
}
