import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { loadChannels } from "@/lib/channels";
import { fetchPageName, systemPageIdFor } from "@/lib/autoPage";
import { adsStep, type AdsState } from "@/lib/adsSync";
import { FbError } from "@/lib/fbSync";
import { expiredMetaTokenMessage, isExpiredMetaToken } from "@/lib/metaTokenError";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";

export const maxDuration = 60;
const adsChannels = async (fresh = false) => (await loadChannels(fresh)).filter((c) => c.channel === "ads" && c.active && c.accessToken && c.accountId);

/** Administrators only. Lists connected ad accounts (never the tokens). */
export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  try { return NextResponse.json({ ok: true, accounts: (await adsChannels()).map((c) => ({ channelId: c.channelId, name: c.name, accountId: c.accountId, sheetPageId: c.sheetPageId })) }, noStore); }
  catch { return fail(502, "อ่านการตั้งค่าจาก Google Sheet ไม่สำเร็จ"); }
}

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { channelId?: string; days?: number; state?: AdsState };
    const ch = (await adsChannels(false)).find((c) => c.channelId === b.channelId); if (!ch) return fail(400, "ไม่พบบัญชีโฆษณานี้ (เชื่อมบัญชีโฆษณาในหน้า Upload ก่อน)");
    if (!g.mapped.dataset.pages.some((p) => p.id === ch.sheetPageId)) return fail(400, "เพจในระบบที่ผูกไว้ไม่มีแล้ว — แก้การเชื่อมต่อบัญชีโฆษณาใหม่");
    const days = Math.min(90, Math.max(1, Math.floor(Number(b.days) || 7)));
    const phase = b.state?.phase === "insights" || b.state?.phase === "done" ? b.state.phase : "ads";
    const after = typeof b.state?.after === "string" && /^[\w=+/.-]{1,400}$/.test(b.state.after) ? b.state.after : undefined;
    const pageMap: Record<string, string> = {};
    const stalePages: string[] = [];
    if (!ch.forceSheetPage) {
      const known = new Set(g.mapped.dataset.pages.map((p) => p.id));
      // Ads boosted from Instagram carry the IG account id in effective_object_story_id, so Instagram channels map to their own
      // page as well; without this those ads fall back to the account's default page.
      for (const c of await loadChannels()) if ((c.channel === "facebook" || c.channel === "instagram") && c.active && c.accountId && c.sheetPageId) {
        if (known.has(c.sheetPageId)) pageMap[c.accountId] = c.sheetPageId;
        else stalePages.push(c.name || c.accountId);
      }
    }
    const pageNames = Object.fromEntries(g.mapped.dataset.pages.map((p) => [p.id, p.name]));
    // ads can post as a Page that was never connected: give that Page its own system page so the ad is shown under it.
    // Names are read in parallel and saved in one write; the agency/team of the account's own page is inherited, since it is
    // the same advertiser — otherwise those campaigns would vanish as soon as an agency or sales-rep filter is used.
    const accountPage = g.mapped.dataset.pages.find((p) => p.id === ch.sheetPageId);
    const createdPages: string[] = [];
    const resolvePages = async (fbPageIds: string[]) => {
      const out: Record<string, string> = {}, missing: string[] = [];
      for (const id of fbPageIds) {
        const own = systemPageIdFor(id);
        if (g.mapped.dataset.pages.some((p) => p.id === own)) out[id] = own; else missing.push(id);
      }
      const named = await Promise.all(missing.map(async (id) => ({ id, name: await fetchPageName(id, ch.accessToken) })));
      const rows = named.filter((x) => x.name).map((x) => ({
        page_id: systemPageIdFor(x.id), name: x.name, active: true,
        ...(accountPage?.agencyId ? { agency_id: accountPage.agencyId } : {}),
        ...(accountPage?.teamIds.length ? { sales_team: accountPage.teamIds.join(",") } : {}),
      }));
      if (rows.length) {
        await upsertRows("pages", ["page_id"], rows, "insert");
        invalidateCache(); // the next batch must see the new pages instead of looking them up again
        createdPages.push(...rows.map((r) => r.name));
        for (const x of named) if (x.name) out[x.id] = systemPageIdFor(x.id);
      }
      return out;
    };
    const out = await adsStep({ pageNames, ...(ch.forceSheetPage ? {} : { resolvePages }), accountId: ch.accountId, token: ch.accessToken, sheetPageId: ch.sheetPageId, days, state: { phase, after, fallback: b.state?.fallback === true, tier: Number.isInteger(b.state?.tier) ? Math.min(9, Math.max(0, Number(b.state?.tier))) : undefined, win: Number.isInteger(b.state?.win) ? Math.min(12, Math.max(0, Number(b.state?.win))) : undefined, lim: Number.isInteger(b.state?.lim) ? Math.min(5, Math.max(0, Number(b.state?.lim))) : undefined }, base: process.env.FB_GRAPH_BASE, pageMap });
    for (const w of out.writes) await upsertRows(w.tab, w.keyCols, w.rows, w.mode);
    if (out.next.phase === "done") invalidateCache();
    // A stale channel mapping used to make every campaign disappear in the mapper; now those ads land on the account's page and the admin is told.
    const forced = ch.forceSheetPage ? `บัญชีนี้ตั้ง “บังคับใช้เพจที่เลือกกับโฆษณาทั้งหมด” — ทุกแคมเปญจะอยู่ใต้เพจ ${g.mapped.dataset.pages.find((p) => p.id === ch.sheetPageId)?.name ?? ch.sheetPageId}; ถ้าต้องการแยกตามเพจต้นทาง ให้แก้การเชื่อมต่อที่หน้า Upload แล้วเอาติ๊กออก` : "";
    const warnings = [...(out.warnings ?? []), forced,
      createdPages.length ? `เพิ่มเพจใหม่ ${createdPages.length} เพจจากเพจต้นทางของโฆษณา (${createdPages.slice(0, 3).join(", ")}${createdPages.length > 3 ? " …" : ""}) — ตั้งเอเจนซี/ทีมเซลล์ได้ที่หน้า Settings → Pages` : "",
      stalePages.length ? `เพจที่ผูกกับการเชื่อมช่องทางไม่มีอยู่ในรายการเพจของระบบ (${stalePages.slice(0, 3).join(", ")}${stalePages.length > 3 ? " …" : ""}) — โฆษณาของเพจนั้นถูกนับเข้ากับเพจหลักของบัญชีโฆษณา; แก้การเชื่อมต่อที่หน้า Upload` : ""].filter(Boolean);
    return NextResponse.json({ ok: true, next: out.next, counts: out.counts, ...(warnings.length ? { warnings } : {}), byPage: out.byPage }, noStore);
  } catch (e) {
    if (e instanceof FbError) return fail(e.rateLimited ? 429 : 502, isExpiredMetaToken(e) ? expiredMetaTokenMessage("ads") : e.message, { rateLimited: e.rateLimited });
    const sheetStatus = e instanceof Error ? /^Google Sheets (\d+):/i.exec(e.message)?.[1] : undefined;
    if (sheetStatus) {
      invalidateCache();
      const rateLimited = sheetStatus === "429";
      const hint = sheetStatus === "403" ? " ตรวจสิทธิ์ Editor ของ service account ใน Google Sheet" : rateLimited ? " ลองใหม่หลังรอสักครู่" : "";
      return fail(rateLimited ? 429 : 502, `ดึงข้อมูลจาก Meta ได้แต่บันทึก Google Sheet ไม่สำเร็จ (HTTP ${sheetStatus}).${hint}`, { rateLimited });
    }
    console.error("[api/ads-sync]", e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…") : "error"); invalidateCache();
    const why = e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…").slice(0, 140) : "";
    return fail(502, `ดึงข้อมูลหรือบันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง${why ? ` (${why})` : ""}`);
  }
}
