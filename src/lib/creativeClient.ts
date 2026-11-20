"use client";
// Small client-side store for refreshed ad pictures. A dashboard grid can hold hundreds of thumbnails; when one of the saved Meta
// links has aged out the <img> errors, we ask for that ad, and the requests are collected into one batch call per short window.
import { useSyncExternalStore } from "react";

const fresh = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; for (const l of [...listeners]) l(); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** The freshly fetched link for this ad when we have one, otherwise the link stored in the sheet. */
export function useCreativeUrl(adId: string | undefined, stored?: string): string | undefined {
  useSyncExternalStore(subscribe, () => version, () => version);
  return (adId ? fresh.get(adId) : undefined) ?? stored;
}

/** One attempt per ad per page view: if Meta refuses (a token without rights) we must not retry on every render. */
const asked = new Set<string>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

type RefreshResponse = { ok?: boolean; urls?: Record<string, string>; checked?: number; fixed?: number; message?: string };

async function post(body: object): Promise<RefreshResponse> {
  try {
    const r = await fetch("/api/ads-refresh-images", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const j = (await r.json().catch(() => null)) as RefreshResponse | null;
    if (j?.urls) for (const [id, url] of Object.entries(j.urls)) if (typeof url === "string" && url) fresh.set(id, url);
    if (j?.urls && Object.keys(j.urls).length) bump();
    return j ?? {};
  } catch { return { message: "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ" }; }
}

/** Called when a thumbnail fails to load, or when its saved link is already past Meta's expiry. */
export function askForFreshLink(adId?: string) {
  if (!adId || asked.has(adId)) return;
  asked.add(adId);
  queue.push(adId);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ids = [...new Set(queue)]; queue = [];
    if (ids.length) await post({ ids });
  }, 400);
}

export function forgetCreativeLinks() { fresh.clear(); asked.clear(); queue = []; bump(); }

/**
 * "รีเฟรชรูป" — let the server pick the ads whose picture link has aged out (it can see every row, not only the ones on screen)
 * and store the new links back in the sheet, so the next visitor does not have to ask again.
 */
export async function refreshCreativeLinks(limit = 120): Promise<{ checked: number; fixed: number; message?: string }> {
  const j = await post({ all: true, limit });
  return { checked: j.checked ?? 0, fixed: j.fixed ?? 0, ...(j.message ? { message: j.message } : {}) };
}
