import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { loadChannels } from "@/lib/channels";
import { actId, resolveCreativeLinks } from "@/lib/adsSync";
import { FbError, metaAdsFetch } from "@/lib/fbSync";
import { isMetaCdnLink, needsFreshLink } from "@/lib/creativeUrl";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";

export const maxDuration = 60;

/** Meta ad ids are digits (sometimes with an underscore for the account prefix); nothing else is put into a Graph query. */
const ID = /^[\w:-]{1,48}$/;

/**
 * Fresh picture links for ads whose saved Meta link has aged out.
 *
 * Meta's CDN links are signed: they answer for a few days and then stop, even though the ad itself is unchanged. Because the
 * dashboard stores the link in the sheet, images that were fine on sync day can be blank a week later. The ids that identify the
 * picture (stored in ads.creative_ref, and failing that the ad id itself) do not expire, so this route re-reads them and writes
 * the new link back. Administrators only, and it never touches a link an admin pasted themselves.
 */
export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { ids?: unknown; all?: boolean; limit?: unknown };
    const now = Date.now();
    const owned = g.mapped.dataset.ads.filter((a) => !a.creative.url || isMetaCdnLink(a.creative.url));
    const wanted = new Set(Array.isArray(b.ids) ? (b.ids as unknown[]).filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, 100) : []);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(b.limit) || 100)));
    // `all` (or a request with no usable ids): sweep the whole ads tab — used by the "รีเฟรชรูป" button.
    const targets = (b.all || !wanted.size ? owned.filter((a) => needsFreshLink(a, now)) : owned.filter((a) => wanted.has(a.id))).slice(0, limit);
    if (!targets.length) return NextResponse.json({ ok: true, urls: {}, checked: 0, fixed: 0 }, noStore);
    const chans = (await loadChannels(false)).filter((c) => c.channel === "ads" && c.active && c.accessToken && c.accountId);
    if (!chans.length) return fail(400, "ยังไม่มีการเชื่อมบัญชีโฆษณา จึงรีเฟรชรูปล่าสุดจาก Meta ไม่ได้ (ตั้งค่าที่หน้า Upload)");
    const base = process.env.FB_GRAPH_BASE || "https://graph.facebook.com";
    const urls: Record<string, string> = {};
    const videos = new Map<string, string>();
    let open = targets.map((a) => ({ adId: a.id, ref: a.creative.ref, url: a.creative.url }));
    const errors: string[] = [];
    // The sheet does not record which ad account each row came from, so ask every connected account until the pictures are found.
    for (const ch of chans) {
      if (!open.length) break;
      try {
        const got = await resolveCreativeLinks(open, ch.accessToken, metaAdsFetch, base, actId(ch.accountId));
        for (const [id, v] of Object.entries(got)) { urls[id] = v.url; if (v.video) videos.set(id, v.video); }
        open = open.filter((x) => !got[x.adId]);
      } catch (e) { if (e instanceof FbError) errors.push(e.message); else throw e; }
    }
    const rows = Object.entries(urls).map(([ad_id, url]) => ({ ad_id, creative_url: url, ...(videos.get(ad_id) ? { video_url: videos.get(ad_id) } : {}) }));
    if (rows.length) {
      // updateOnly: this route must never add rows — an ad id that is no longer in the sheet stays removed.
      await upsertRows("ads", ["ad_id"], rows, "updateOnly");
      invalidateCache();
    }
    const message = rows.length === 0 && errors.length ? `Meta ยังไม่ให้ดึงรูปใหม่ (${errors[0].slice(0, 150)})` : undefined;
    return NextResponse.json({ ok: true, urls, checked: targets.length, fixed: rows.length, ...(message ? { message } : {}) }, noStore);
  } catch (e) {
    console.error("[api/ads-refresh-images]", e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…") : "error");
    return fail(502, "รีเฟรชรูปล่าสุดจาก Meta ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}
