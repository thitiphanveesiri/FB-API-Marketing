import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { loadChannels } from "@/lib/channels";
import { adsStep, type AdsState } from "@/lib/adsSync";
import { FbError } from "@/lib/fbSync";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";

export const maxDuration = 60;
const adsChannels = async () => (await loadChannels(true)).filter((c) => c.channel === "ads" && c.active && c.accessToken && c.accountId);

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
    const ch = (await adsChannels()).find((c) => c.channelId === b.channelId); if (!ch) return fail(400, "ไม่พบบัญชีโฆษณานี้ (เชื่อมบัญชีโฆษณาในหน้า Upload ก่อน)");
    if (!g.mapped.dataset.pages.some((p) => p.id === ch.sheetPageId)) return fail(400, "เพจในระบบที่ผูกไว้ไม่มีแล้ว — แก้การเชื่อมต่อบัญชีโฆษณาใหม่");
    const days = Math.min(90, Math.max(1, Math.floor(Number(b.days) || 7)));
    const phase = b.state?.phase === "insights" || b.state?.phase === "done" ? b.state.phase : "ads";
    const after = typeof b.state?.after === "string" && /^[\w=+/.-]{1,400}$/.test(b.state.after) ? b.state.after : undefined;
    const pageMap: Record<string, string> = {};
    for (const c of await loadChannels(true)) if (c.channel === "facebook" && c.active && c.accountId && c.sheetPageId) pageMap[c.accountId] = c.sheetPageId;
    const out = await adsStep({ accountId: ch.accountId, token: ch.accessToken, sheetPageId: ch.sheetPageId, days, state: { phase, after }, base: process.env.FB_GRAPH_BASE, pageMap });
    for (const w of out.writes) await upsertRows(w.tab, w.keyCols, w.rows, w.mode);
    if (out.writes.length) invalidateCache();
    return NextResponse.json({ ok: true, next: out.next, counts: out.counts }, noStore);
  } catch (e) {
    if (e instanceof FbError) return fail(e.rateLimited ? 429 : 502, e.message, { rateLimited: e.rateLimited });
    console.error("[api/ads-sync]", e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…") : "error"); invalidateCache();
    return fail(502, "ดึงข้อมูลหรือบันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}
