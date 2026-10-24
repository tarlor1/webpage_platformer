const CONTENT_OWNER = 'p,h1,h2,h3,h4,h5,h6,li,a,button,label,figcaption,blockquote,[data-item-id],[data-product-id]';

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 2000);
}

function resource(value: string, responsive = false): string {
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    if (!/^(https?:|data:)$/.test(url.protocol)) return '';
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|dclid$|msclkid$)/i.test(name)
        || responsive && /^(width|height|w|h|quality|q|format)$/i.test(name)) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return value; }
}

/** Content identity deliberately excludes position, line wrapping, classes and DOM order. */
export function logicalSurfaceKey(node: Element | Text): string {
  const element = node instanceof Element ? node : node.parentElement!;
  const text = node instanceof Text;
  const owner = text ? element.closest(CONTENT_OWNER) ?? element : element;
  const entity = owner.closest('[data-item-id],[data-product-id],[data-id]');
  const authored = entity?.getAttribute('data-item-id') || entity?.getAttribute('data-product-id') || entity?.getAttribute('data-id') || '';
  const link = owner.closest('a[href]');
  const href = resource(link?.getAttribute('href') ?? '');
  const kind = text ? 'text' : element.tagName.toLowerCase();
  let content: string;
  if (text) content = normalized(owner.textContent ?? '');
  else if (/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName) && (element.id || element.getAttribute('name'))) {
    // A toggle label or typed value is state, not newly discovered content.
    content = element.id || element.getAttribute('name')!;
  }
  else if (element instanceof HTMLImageElement) {
    // src is independent of the browser's responsive currentSrc selection.
    content = resource(element.getAttribute('src') || element.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '', true)
      || normalized(element.alt);
  } else if (element instanceof HTMLVideoElement) {
    content = resource(element.getAttribute('src') || '') || resource(element.querySelector('source')?.getAttribute('src') || '')
      || resource(element.poster, true) || normalized(element.getAttribute('aria-label') || element.id);
  } else if (element instanceof HTMLIFrameElement) content = resource(element.getAttribute('src') || '')
    || normalized(element.getAttribute('title') || element.getAttribute('srcdoc') || '');
  else {
    content = normalized(element.getAttribute('aria-label') || element.textContent || element.getAttribute('name') || '');
    if (!content) content = getComputedStyle(element).backgroundImage;
  }
  // Preserve the full signature: a short hash alone would merge unrelated claims.
  return JSON.stringify([kind, authored, href, content]);
}
