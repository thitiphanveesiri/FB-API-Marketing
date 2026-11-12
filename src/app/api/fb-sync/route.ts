import { connection, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfigured, resolveUser, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getCached, invalidateCache, setCached } from "@/lib/sheetCache";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets, type MapResult } from "@/lib/sheetMapper";
import { upsertRows } from "@/lib/sheetsWrite";
import { FbError, fbConfigs, syncStep, type SyncState } from "@/lib/fbSync";

export const maxDuration = 60;
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (status: number, message: string, extra: object = {}) => NextResponse.json({ ok: false, message, ...extra }, { status, ...noStore });

/** Same gate as /api/mutate, plus: Administrators only (this reads customer conversations). */
async function adminOnly(req: Request, write: boolean): Promise<{ err: NextResponse } | { mapped: MapResult }> {
  if (!sheetsConfigured()) return { err: fail(503, "ยังไม่ได้เชื่อม Google Sheet") };
  if (write) { const origin = req.headers.get("origin"); if (origin && origin !== new URL(req.url).origin) return { err: fail(403, "Bad origin") }; }
  let session = null as { email: string; name: string } | null;
  if (authConfigured()) { session = verifySession((await cookies()).get(SESSION_COOKIE)?.value); if (!session) return { err: fail(401, "กรุณาล็อกอินใหม่") }; }
  else if (process.env.ALLOW_PUBLIC !== "1") return { err: fail(503, "ยังไม่ได้ตั้งค่าการล็อกอิน") };
  const mapped = getCached() ?? mapSheets(await readTabs()); setCached(mapped);
  const me = session ? resolveUser(mapped.dataset, session.email, session.name) : mapped.dataset.users.find((u) => u.role === "Administrator") ?? null;
  if (!me || me.role !== "Administrator") return { err: fail(403, "เฉพาะผู้ดูแลระบบเท่านั้น") };
  return { mapped };
}

export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  // never send tokens to the browser: only which Facebook pages are configured
  return NextResponse.json({ ok: true, pages: fbConfigs().map((c) => ({ fbPageId: c.fbPageId, sheetPageId: c.sheetPageId ?? "" })) }, noStore);
}

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { fbPageId?: string; sheetPageId?: string; days?: number; state?: SyncState };
    const cfg = fbConfigs().find((c) => c.fbPageId === b.fbPageId); if (!cfg) return fail(400, "ไม่พบเพจนี้ในการตั้งค่า (FB_PAGE_ID / FB_PAGE_TOKEN ใน Vercel)");
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
    if (e instanceof FbError) return fail(e.rateLimited ? 429 : 502, e.message, { rateLimited: e.rateLimited });
    console.error("[api/fb-sync]", e instanceof Error ? e.message : "error"); invalidateCache();
    return fail(502, "ดึงข้อมูลหรือบันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}
