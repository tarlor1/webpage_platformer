import { OVERLAY_ID, type Platform } from './types';

const MAX_NODES = 6000;
const MAX_RECTS = 1600;
const MAX_PLATFORMS = 220;
const IGNORED_TAGS: Record<string, true> = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true, HEAD: true, IFRAME: true, OBJECT: true, EMBED: true };
const CONTROL_TAGS: Record<string, true> = { BUTTON: true, INPUT: true, SELECT: true, TEXTAREA: true };

/** Measure once per rebuild. All returned coordinates are document CSS pixels. */
export function extractPlatforms(): Platform[] {
  if (!document.body) return [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const marginX = Math.min(240, width * 0.4);
  const marginY = Math.min(320, height * 0.5);
  const viewport = { left: -marginX, right: width + marginX, top: -marginY, bottom: height + marginY };
  const candidates: Platform[] = [];
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const styleFor = (element: Element): CSSStyleDeclaration => {
    let style = styles.get(element);
    if (!style) {
      style = getComputedStyle(element);
      styles.set(element, style);
    }
    return style;
  };
  let rects = 0;
  const add = (rect: DOMRect, label: string, text: boolean): void => {
    rects++;
    if (rect.right < viewport.left || rect.left > viewport.right || rect.bottom < viewport.top
      || rect.top > viewport.bottom || rect.width < 18 || rect.height < 4) return;
    // Large page wrappers and hero artwork are not useful footholds. A wrapped
    // paragraph is measured as its individual line fragments, never its box.
    if (rect.width > width * (text ? 1.08 : 0.94)
      || rect.height > (text ? 80 : Math.min(220, height * 0.42))) return;
    const x = Math.round((rect.left + scrollX) * 2) / 2;
    const y = Math.round((rect.top + scrollY) * 2) / 2;
    const surfaceWidth = Math.round(rect.width * 2) / 2;
    candidates.push({ id: `dom:${x}:${y}:${surfaceWidth}`, x, y, width: surfaceWidth, kind: 'dom', label });
  };
  let visited = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Return one final node at the budget boundary so nextNode cannot spend
      // unbounded work walking a long sequence of rejected siblings.
      if (++visited >= MAX_NODES) return NodeFilter.FILTER_ACCEPT;
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      if (element.id === OVERLAY_ID || IGNORED_TAGS[element.tagName]
        || element.hasAttribute('hidden') || element.hasAttribute('inert')
        || element.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
      const style = styleFor(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return NodeFilter.FILTER_REJECT;
      // display:contents has no box but its descendants can still be visible.
      if (style.display !== 'contents') {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.right < viewport.left || rect.left > viewport.right
          || rect.bottom < viewport.top || rect.top > viewport.bottom)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const range = document.createRange();
  let node: Node | null;
  while (visited < MAX_NODES && rects < MAX_RECTS && (node = walker.nextNode())) {
    if (visited >= MAX_NODES) break;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const control = CONTROL_TAGS[element.tagName] || element.getAttribute('role') === 'button'
        || element.getAttribute('role') === 'textbox';
      const image = element.tagName === 'IMG' || element.tagName === 'VIDEO'
        || element.tagName === 'CANVAS' || element.getAttribute('role') === 'img';
      const decorative = element.getAttribute('role') === 'presentation' || element.getAttribute('role') === 'none'
        || (element.tagName === 'IMG' && element.getAttribute('alt') === '');
      if ((control || image) && !decorative && element.getAttribute('type') !== 'hidden') {
        const label = (element.getAttribute('aria-label') || element.getAttribute('alt')
          || element.getAttribute('value') || element.textContent || element.tagName).trim().slice(0, 70);
        add(element.getBoundingClientRect(), label, false);
      }
      continue;
    }
    const text = node as Text;
    if (!text.data.trim()) continue;
    const parent = text.parentElement;
    if (!parent || parent.closest('button, input, select, textarea, [role="button"], [role="textbox"], svg, canvas')) continue;
    const style = styleFor(parent);
    if (Number.parseFloat(style.fontSize) < 8 || style.color === 'transparent'
      || style.color === 'rgba(0, 0, 0, 0)' || Number.parseFloat(style.opacity) === 0) continue;
    // Range rects retain separate flex/grid items, wrapped link fragments, and
    // heading-link lines (including search results), unlike parent bounding boxes.
    range.setStart(text, 0);
    range.setEnd(text, Math.min(text.length, 8000));
    const label = text.data.trim().replace(/\s+/g, ' ').slice(0, 70);
    const lines = range.getClientRects();
    for (let i = 0; i < lines.length && i < 80 && rects < MAX_RECTS; i++) add(lines[i], label, true);
  }
  range.detach();

  candidates.sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: Platform[] = [];
  for (const candidate of candidates) {
    // A line can contain many inline nodes. Merge only overlapping/adjacent
    // fragments on the same top; never fill a genuine inter-column gap.
    const match = merged.find(p => Math.abs(p.y - candidate.y) <= 2
      && candidate.x <= p.x + p.width + 3 && candidate.x + candidate.width >= p.x - 3);
    if (match) {
      const right = Math.max(match.x + match.width, candidate.x + candidate.width);
      match.x = Math.min(match.x, candidate.x);
      match.width = right - match.x;
      match.id = `dom:${match.x}:${match.y}:${match.width}`;
      if ((candidate.label?.length ?? 0) > (match.label?.length ?? 0)) match.label = candidate.label;
    } else {
      merged.push(candidate);
    }
  }
  const centerX = scrollX + width / 2;
  const centerY = scrollY + height / 2;
  return merged.sort((a, b) => {
    const distance = (p: Platform): number => Math.abs(p.y - centerY) + Math.abs(p.x + p.width / 2 - centerX) * 0.35;
    return distance(a) - distance(b);
  }).slice(0, MAX_PLATFORMS).sort((a, b) => a.y - b.y || a.x - b.x);
}
