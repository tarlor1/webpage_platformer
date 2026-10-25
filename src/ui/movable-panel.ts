interface Point {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  pointerStart: Point;
  panelStart: Point;
}

const KEY_DIRECTIONS: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function createPanelControls(panel: HTMLElement) {
  const doc = panel.ownerDocument;
  const title = panel.querySelector('strong')!;
  title.remove();

  const content = doc.createElement('div');
  content.id = 'game-panel-content';
  content.append(...panel.childNodes);

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

  const header = doc.createElement('header');
  header.className = 'panel-header';
  header.append(handle, toggle);
  panel.append(header, content);

  return { content, handle, toggle };
}

/** Add dragging and minimization. Moving this overlay does not change page geometry. */
export function mountMovablePanel(panel: HTMLElement, signal: AbortSignal, focusGame: () => void): void {
  const { content, handle, toggle } = createPanelControls(panel);
  const initialBounds = panel.getBoundingClientRect();
  const position: Point = { x: initialBounds.left, y: initialBounds.top };
  const maxPosition: Point = { x: 0, y: 0 };
  let drag: DragState | undefined;
  let pendingFrame = 0;

  // Establish one fixed origin; subsequent moves only update the transform.
  panel.style.left = '0';
  panel.style.top = '0';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';

  function renderPosition(): void {
    pendingFrame = 0;
    panel.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
  }

  function moveTo(x: number, y: number): void {
    position.x = Math.max(0, Math.min(maxPosition.x, x));
    position.y = Math.max(0, Math.min(maxPosition.y, y));
    if (!pendingFrame) pendingFrame = requestAnimationFrame(renderPosition);
  }

  function measureAndFit(): void {
    const bounds = panel.getBoundingClientRect();
    maxPosition.x = Math.max(0, innerWidth - bounds.width);
    maxPosition.y = Math.max(0, innerHeight - bounds.height);
    moveTo(position.x, position.y);
  }

  function updateToggle(): void {
    const minimized = content.hidden;
    panel.classList.toggle('minimized', minimized);
    toggle.textContent = minimized ? '+' : '−';
    toggle.title = minimized ? 'Show controls' : 'Minimize controls';
    toggle.setAttribute('aria-expanded', String(!minimized));
    toggle.setAttribute('aria-label', minimized ? 'Show game controls' : 'Minimize game controls');
  }

  function toggleMinimized(): void {
    content.hidden = !content.hidden;
    updateToggle();
    measureAndFit();
    if (content.hidden) focusGame();
  }

  function startDrag(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    drag = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      panelStart: { ...position },
    };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    panel.classList.add('dragging');
    event.preventDefault();
  }

  function dragPanel(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // No layout reads or page scans here, regardless of pointer event frequency.
    moveTo(
      drag.panelStart.x + event.clientX - drag.pointerStart.x,
      drag.panelStart.y + event.clientY - drag.pointerStart.y,
    );
  }

  function endDrag(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    drag = undefined;
    panel.classList.remove('dragging');
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  }

  function moveWithKeyboard(event: KeyboardEvent): void {
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    moveTo(position.x + direction.x * step, position.y + direction.y * step);
  }

  updateToggle();
  measureAndFit();
  toggle.addEventListener('click', toggleMinimized, { signal });
  handle.addEventListener('pointerdown', startDrag, { signal });
  handle.addEventListener('pointermove', dragPanel, { signal });
  handle.addEventListener('pointerup', endDrag, { signal });
  handle.addEventListener('pointercancel', endDrag, { signal });
  handle.addEventListener('lostpointercapture', endDrag, { signal });
  handle.addEventListener('keydown', moveWithKeyboard, { signal });
  window.addEventListener('resize', measureAndFit, { signal });

  // Re-measure only when the viewport or panel size changes (e.g. inventory opens).
  const observer = new ResizeObserver(measureAndFit);
  observer.observe(panel);
  signal.addEventListener('abort', () => {
    observer.disconnect();
    cancelAnimationFrame(pendingFrame);
    panel.classList.remove('dragging');
    if (drag && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
    drag = undefined;
  }, { once: true });
}
