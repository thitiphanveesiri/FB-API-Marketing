import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";
import { fbSyncConfigs } from "@/lib/channels";
import { FbError, syncStep, type SyncState } from "@/lib/fbSync";
import { expiredMetaTokenMessage, isExpiredMetaToken } from "@/lib/metaTokenError";

export const maxDuration = 60;
export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  // never send tokens to the browser: only which Facebook pages are configured
  return NextResponse.json({ ok: true, pages: (await fbSyncConfigs()).map((c) => ({ fbPageId: c.fbPageId, sheetPageId: c.sheetPageId ?? "", name: c.name ?? "" })) }, noStore);
}

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { fbPageId?: string; sheetPageId?: string; days?: number; state?: SyncState };
    const cfg = (await fbSyncConfigs()).find((c) => c.fbPageId === b.fbPageId); if (!cfg) return fail(400, "ไม่พบเพจนี้ในการตั้งค่า (เชื่อมเพจในหน้า Upload ก่อน)");
    const ds = g.mapped.dataset;
    if (!b.sheetPageId || !ds.pages.some((p) => p.id === b.sheetPageId)) return fail(400, "เลือกเพจในระบบที่จะเก็บข้อมูลก่อน");
    const days = Math.min(90, Math.max(1, Math.floor(Number(b.days) || 7)));
    const phase = b.state?.phase === "comments" || b.state?.phase === "done" ? b.state.phase : "chats";
    const after = typeof b.state?.after === "string" && /^[\w=+/.-]{1,400}$/.test(b.state.after) ? b.state.after : undefined;
    const out = await syncStep({ cfg, sheetPageId: b.sheetPageId, days, state: { phase, after }, ds, tz: process.env.APP_TZ || "Asia/Bangkok", base: process.env.FB_GRAPH_BASE });
    for (const w of out.writes) await upsertRows(w.tab, w.keyCols, w.rows, w.mode);
    if (out.writes.length) invalidateCache();
    return NextResponse.json({ ok: true, next: out.next, counts: out.counts }, noStore);
  } catch (e) {
    if (e instanceof FbError) return fail(e.rateLimited ? 429 : 502, isExpiredMetaToken(e) ? expiredMetaTokenMessage("facebook") : e.message, { rateLimited: e.rateLimited });
    const sheetStatus = e instanceof Error ? /^Google Sheets (\d+):/i.exec(e.message)?.[1] : undefined;
    if (sheetStatus) {
      invalidateCache();
      const rateLimited = sheetStatus === "429";
      const hint = sheetStatus === "403" ? " ตรวจสิทธิ์ Editor ของ service account ใน Google Sheet" : rateLimited ? " ลองใหม่หลังรอสักครู่" : "";
      return fail(rateLimited ? 429 : 502, `ดึงข้อมูลจาก Meta ได้แต่บันทึก Google Sheet ไม่สำเร็จ (HTTP ${sheetStatus}).${hint}`, { rateLimited });
    }
    console.error("[api/fb-sync]", e instanceof Error ? e.message : "error"); invalidateCache();
    const why = e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…").slice(0, 140) : "";
    return fail(502, `ดึงข้อมูลหรือบันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง${why ? ` (${why})` : ""}`);
  }
}
