import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { readTabs } from "@/lib/googleSheets";
import { findOrphanLeads } from "@/lib/orphanLeads";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";

export const maxDuration = 60;
const CHUNK = 300;

/** Administrators only. GET: leads pointing at a page that no longer exists. POST {from, to}: move them to an existing page. */
export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  try {
    const orphans = findOrphanLeads(await readTabs(true));
    // The sheet mapper shows missing pages as "<id> (ไม่พบในแท็บ Pages)" placeholders; they are not real targets.
    const real = g.mapped.dataset.pages.filter((p) => !p.name.includes("ไม่พบในแท็บ Pages"));
    return NextResponse.json({ ok: true, orphans: orphans.map((o) => ({ pageId: o.pageId, count: o.leadIds.length })), pages: real.map((p) => ({ id: p.id, name: p.name })) }, noStore);
  } catch { return fail(502, "อ่านชีตไม่สำเร็จ ลองใหม่อีกครั้ง"); }
}

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { from?: string; to?: string; offset?: number };
    const from = typeof b.from === "string" ? b.from : "", to = typeof b.to === "string" ? b.to : "";
    if (from === to) return fail(400, "เลือกเพจปลายทางที่ไม่ใช่เพจเดิม");
    const target = g.mapped.dataset.pages.find((p) => p.id === to);
    if (!target || target.name.includes("ไม่พบในแท็บ Pages")) return fail(400, "ไม่พบเพจปลายทางนี้ในแท็บ pages");
    const orphan = findOrphanLeads(await readTabs(true)).find((o) => o.pageId === from);
    if (!orphan) return NextResponse.json({ ok: true, moved: 0, done: true }, noStore);
    const batch = orphan.leadIds.slice(0, CHUNK); // always the first chunk: moved leads drop out of the list, so the next call continues
    await upsertRows("leads", ["lead_id"], batch.map((id) => ({ lead_id: id, page_id: to })), "updateOnly");
    invalidateCache();
    return NextResponse.json({ ok: true, moved: batch.length, done: orphan.leadIds.length <= CHUNK }, noStore);
  } catch (e) {
    const quota = e instanceof Error && /\b429\b/.test(e.message);
    return fail(quota ? 429 : 502, quota ? "Google Sheets จำกัดจำนวนคำขอ — รอ 1 นาทีแล้วกดใหม่" : "ย้ายลีดไม่สำเร็จ ลองใหม่อีกครั้ง", { rateLimited: quota });
  }
}
