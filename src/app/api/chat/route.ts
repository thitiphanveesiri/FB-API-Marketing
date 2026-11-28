import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { rewrite } from "@/lib/chatAi";
import { scopeDataset } from "@/lib/authz";

export const maxDuration = 15;
// shortcut: per-instance limit (not shared between servers); fine for 20-30 users, move to the database if the free AI quota gets hit.
const hits = new Map<string, number[]>();

/** POST { question } → { ok, text }: the question rewritten into a form the keyword rules understand. 503 when no GEMINI_API_KEY is set. */
export async function POST(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return fail(503, "AI ยังไม่ได้ตั้งค่า");
  const now = Date.now(), mine = (hits.get(g.me.id) ?? []).filter((t) => now - t < 60_000);
  if (mine.length >= 10) return fail(429, "ถามถี่เกินไป รอสักครู่");
  hits.set(g.me.id, [...mine, now]);
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return fail(400, "พิมพ์คำถามก่อน");
    const d = scopeDataset(g.mapped.dataset, g.me);
    const text = await rewrite(question, { ads: d.ads.map((a) => a.name), pages: d.pages.map((p) => p.name), reps: d.users.filter((u) => u.role === "Sales Representative").map((u) => u.name) }, key);
    return NextResponse.json({ ok: true, text }, noStore);
  } catch { return fail(502, "ถาม AI ไม่สำเร็จ"); }
}
