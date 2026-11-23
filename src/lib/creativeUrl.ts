// Meta serves ad pictures from a signed CDN: the link it stores in ads.creative_url carries an expiry and stops answering a few
// days after the sync that wrote it. The ad itself is fine — only the saved link dies — so the dashboard notices a dead link and
// asks for a fresh one (see lib/adsSync.ts resolveCreativeLinks and api/ads-refresh-images).
//
// Safe on both sides: no React, no server imports.

/** Hosts that serve Meta ad pictures. Anything else (a Google Drive link an admin pasted) is left alone. */
const META_CDN = /(^|\.)((scontent[^.]*)\.fna\.fbcdn\.net|scontent[^.]*\.cdninstagram\.com|cdninstagram\.com|fbcdn\.net|graph\.facebook\.com|lookaside\.fbsbx\.com|video\.fbcdn\.net)/i;

/** A link that came from Meta's own CDN (as opposed to one an admin pasted). */
export function isMetaCdnLink(url?: string): boolean {
  if (!url) return false;
  try { return META_CDN.test(new URL(url).hostname); } catch { return META_CDN.test(url); }
}

/**
 * When Meta says this link dies, in ms since epoch, or null when the link carries no expiry.
 * `oe` is the expiry as a hex unix timestamp (`oh` next to it is only a hash — do not read it as a date).
 */
export function metaLinkExpiryMs(url?: string): number | null {
  if (!url) return null;
  const m = /[?&]oe=([0-9a-fA-F]{6,9})/.exec(url);
  if (!m) return null;
  const secs = parseInt(m[1], 16);
  return Number.isFinite(secs) && secs > 1_000_000_000 ? secs * 1000 : null;
}

/** Ask for a new link a day before it actually dies: a thumbnail that breaks while someone is reading the page is worse. */
const SAFETY_MS = 24 * 3600 * 1000;

/** True when the link is expired now, or expires within the safety window. A link with no expiry never counts as dead. */
export function linkLooksExpired(url?: string, now: number = Date.now()): boolean {
  const exp = metaLinkExpiryMs(url);
  return exp != null && exp - SAFETY_MS <= now;
}

/**
 * Does this ad need a fresh link? Yes when the picture Meta knows about is missing or stale and we have somewhere to get it from:
 * a stored creative_ref (the reliable way) or, for rows written before that column existed, the old Meta link itself — its ad id
 * still lets us re-read the creative.
 */
export function needsFreshLink(ad: { id?: string; creative?: { url?: string; ref?: string } }, now: number = Date.now()): boolean {
  const url = ad.creative?.url;
  const ref = ad.creative?.ref;
  const videoFile = !!url && /\.(mp4|webm|mov)(\?|#|$)/i.test(url); // a video stored as the picture: ask for its cover
  if (ref) return !url || videoFile || (isMetaCdnLink(url) && linkLooksExpired(url, now));
  // No ref: only worth asking when the saved link is a Meta link that has already aged out.
  return !!url && isMetaCdnLink(url) && linkLooksExpired(url, now);
}
