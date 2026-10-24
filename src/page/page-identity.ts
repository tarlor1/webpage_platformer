/** Add a domain here to support its content-changing query parameters. */
const CONTENT_QUERY_PARAMS: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  'google.com': { q: true, tbm: true, udm: true, start: true, num: true, tbs: true, hl: true, lr: true, cr: true, safe: true, filter: true },
  'youtube.com': { v: true, list: true, index: true, search_query: true, page: true },
  'wikipedia.org': { title: true, search: true, oldid: true, diff: true, curid: true, pageid: true },
};

function contentParameters(hostname: string): Readonly<Record<string, true>> | undefined {
  // Google country domains share the same rules; the host remains distinct in the seed.
  let domain = /(^|\.)google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(hostname)
    ? 'google.com' : hostname;
  while (domain) {
    const parameters = Object.hasOwn(CONTENT_QUERY_PARAMS, domain) ? CONTENT_QUERY_PARAMS[domain] : undefined;
    if (parameters) return parameters;
    const separator = domain.indexOf('.');
    if (separator < 0) return;
    domain = domain.slice(separator + 1);
  }
}

function normalizedPath(path: string): string {
  // Decode only unreserved ASCII. Encoded separators remain distinct from actual path separators.
  return path.replace(/%[0-9a-f]{2}/gi, escape => {
    const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : escape.toUpperCase();
  });
}

/** Host/port, case-sensitive normalized pathname, and adapter-allowed content queries; no fragment. */
export function pageSeedKey(url: string): string {
  const page = new URL(url);
  if (page.protocol !== 'http:' && page.protocol !== 'https:') throw new Error('Progression requires an HTTP(S) page URL.');
  const allowed = contentParameters(page.hostname);
  // Unknown parameters are deliberately ignored: there is no generic semantic query inference.
  const params = [...page.searchParams].filter(([name]) => allowed && Object.hasOwn(allowed, name));
  params.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  return JSON.stringify([page.host, normalizedPath(page.pathname), params]);
}
