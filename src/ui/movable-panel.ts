/** Add a draggable heading and a minimize toggle without stopping the game. */
export function mountMovablePanel(panel: HTMLElement, signal: AbortSignal, focusGame: () => void, changed: () => void): void {
  const doc = panel.ownerDocument;
  const content = doc.createElement('div');
  content.id = 'game-panel-content';
  const title = panel.querySelector('strong')!;
  title.remove();
  content.append(...panel.childNodes);
  const header = doc.createElement('header');
  header.className = 'panel-header';
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.className = 'panel-drag';
  handle.title = 'Drag to move controls, or focus and use arrow keys';
  handle.setAttribute('aria-label', 'Move game controls. Use arrow keys to reposition.');
  handle.append(title);
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'panel-toggle';
  toggle.setAttribute('aria-controls', content.id);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', 'Minimize game controls');
  toggle.title = 'Minimize controls';
  toggle.textContent = '−';
  header.append(handle, toggle);
  panel.append(header, content);

  function position(x: number, y: number): void {
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(innerWidth - rect.width, x))}px`;
    panel.style.top = `${Math.max(0, Math.min(innerHeight - rect.height, y))}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    changed();
  }
  const fit = () => {
    const rect = panel.getBoundingClientRect();
    position(rect.left, rect.top);
  };
  toggle.addEventListener('click', () => {
    content.hidden = !content.hidden;
    panel.classList.toggle('minimized', content.hidden);
    toggle.textContent = content.hidden ? '+' : '−';
    toggle.setAttribute('aria-expanded', String(!content.hidden));
    toggle.setAttribute('aria-label', content.hidden ? 'Show game controls' : 'Minimize game controls');
    toggle.title = content.hidden ? 'Show controls' : 'Minimize controls';
    fit();
    // Keep playing after minimizing; restoring keeps focus on the controls.
    if (content.hidden) focusGame();
  }, { signal });

  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    event.preventDefault();
  }, { signal });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  }, { signal });
  const endDrag = () => { drag = undefined; };
  handle.addEventListener('pointerup', endDrag, { signal });
  handle.addEventListener('pointercancel', endDrag, { signal });
  handle.addEventListener('lostpointercapture', endDrag, { signal });
  handle.addEventListener('keydown', event => {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 10;
    position(rect.left + direction[0] * step, rect.top + direction[1] * step);
  }, { signal });
  window.addEventListener('resize', fit, { signal });
  // Inventory expansion and debug text can change the panel's size.
  const observer = new ResizeObserver(fit);
  observer.observe(panel);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}
