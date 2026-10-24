const TRACKING_PARAMS: Record<string, true> = {
  gclid: true, dclid: true, fbclid: true, msclkid: true, gbraid: true, wbraid: true, yclid: true,
  igshid: true, mc_cid: true, mc_eid: true, _ga: true, _gl: true, srsltid: true,
};
const GOOGLE_TRACKING: Record<string, true> = {
  ei: true, sei: true, ved: true, uact: true, oq: true, aqs: true, sclient: true, sourceid: true,
  iflsig: true, gs_lcrp: true, gs_lp: true, gs_l: true, gs_ssp: true, source: true, sa: true, zx: true,
};

/** Page identity: host/port, sorted non-tracking query pairs, and fragment; no path or protocol. */
export function pageSeedKey(url: string): string {
  const page = new URL(url);
  const google = page.hostname === 'google.com' || page.hostname.endsWith('.google.com');
  const params = [...page.searchParams].filter(([name]) => {
    const lower = name.toLowerCase();
    return !lower.startsWith('utm_') && !Object.hasOwn(TRACKING_PARAMS, lower)
      && !(google && Object.hasOwn(GOOGLE_TRACKING, lower));
  });
  params.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  return JSON.stringify([page.host, params, page.hash]);
}
