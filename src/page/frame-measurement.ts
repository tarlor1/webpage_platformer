/** DOM reads shared by geometry and clearance during one animation-frame transaction. */
export interface LayoutSnapshot {
  hidden: boolean;
  visibility: string;
  position: string;
  clipX: boolean;
  clipY: boolean;
  paintClip: boolean;
  containingBlock: boolean;
}

const styles = new Map<Element, CSSStyleDeclaration>();
const layouts = new Map<Element, LayoutSnapshot>();
const bounds = new Map<Element, DOMRect>();

export function beginMeasurements(): void {
  styles.clear();
  layouts.clear();
  bounds.clear();
}

export function readStyle(element: Element): CSSStyleDeclaration {
  let style = styles.get(element);
  if (!style) { style = getComputedStyle(element); styles.set(element, style); }
  return style;
}

export function readBounds(element: Element): DOMRect {
  let rect = bounds.get(element);
  if (!rect) { rect = element.getBoundingClientRect(); bounds.set(element, rect); }
  return rect;
}

/** Cache derived flags too: repeatedly accessing a live CSS declaration is expensive. */
export function readLayout(element: Element): LayoutSnapshot {
  let layout = layouts.get(element);
  if (!layout) {
    const style = readStyle(element);
    const contain = style.contain;
    layout = {
      hidden: style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0,
      visibility: style.visibility,
      position: style.position,
      clipX: /^(?:auto|scroll|hidden|overlay|clip)$/.test(style.overflowX),
      clipY: /^(?:auto|scroll|hidden|overlay|clip)$/.test(style.overflowY),
      paintClip: !!style.clipPath && style.clipPath !== 'none' || /(?:paint|strict|content)/.test(contain),
      containingBlock: style.transform !== 'none' || style.perspective !== 'none'
        || style.filter !== 'none' || !!style.backdropFilter && style.backdropFilter !== 'none'
        || /(?:layout|paint|strict|content)/.test(contain) || /(?:transform|perspective|filter)/.test(style.willChange),
    };
    layouts.set(element, layout);
  }
  return layout;
}
