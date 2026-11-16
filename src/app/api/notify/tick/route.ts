import { timingSafeEqual } from "crypto";
import { connection, NextResponse } from "next/server";
import { readTabs } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { chatEvents, SLA_RULES } from "@/lib/sla";
import { localStamp } from "@/lib/fbSync";
import { isQuiet, managersOf, notifyUsers, pushConfigured, recipientsFor } from "@/lib/push";

// PUBLIC endpoint for an external timer (cron-job.org etc.): protected by CRON_SECRET, so it is excluded from the login gate like /api/*.
// Every call looks at the chats still waiting for a reply and warns about the ones that CROSSED a threshold during the last `interval` minutes,
// so with a timer firing every `interval` minutes each warning is sent about once.
export const maxDuration = 30;
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const json = (b: object, status = 200) => NextResponse.json(b, { status, headers: { "Cache-Control": "no-store" } });

async function run(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim(); if (!secret) return json({ ok: false, message: "CRON_SECRET not set" }, 503);
  const url = new URL(req.url), given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("key") || "";
  if (!given || !safeEq(given, secret)) return json({ ok: false, message: "forbidden" }, 403);
  if (!pushConfigured()) return json({ ok: false, message: "VAPID keys not set" }, 503);
  const win = Math.min(30, Math.max(1, Number(url.searchParams.get("interval")) || 5));
  const ds = mapSheets(await readTabs()).dataset;
  const now = localStamp(new Date().toISOString(), process.env.APP_TZ || "Asia/Bangkok");
  const reps = ds.users.filter((u) => u.role === "Sales Representative" && u.active);
  const warnAt = SLA_RULES.chatMinutes - 5, staleAt = SLA_RULES.staleHours * 60;
  const crossed = (m: number, at: number) => m >= at && m < at + win;
  const out = { warn: 0, late: 0, stale: 0 }, quiet = isQuiet();
  for (const l of ds.leads) {
    if (!l.valid || l.dropped) continue;
    for (const e of chatEvents(l, ds.messages[l.id] ?? [], now, (id) => reps.some((r) => r.id === id))) {
      if (!e.open || e.minutes > staleAt + win) continue;
      const to = recipientsFor(ds, l), counts = e.band === "work" && !e.holiday;
      if (counts && crossed(e.minutes, warnAt)) { out.warn++; await notifyUsers(to, { title: `ตอบ ${l.name} ภายใน 5 นาที`, body: `ลูกค้ารอมา ${e.minutes} นาที ใกล้เกิน ${SLA_RULES.chatMinutes} นาที (โดนหัก ${SLA_RULES.chatPenalty} แต้ม)`, url: "/inbox", tag: `warn-${l.id}` }); }
      if (counts && crossed(e.minutes, SLA_RULES.chatMinutes)) { out.late++; await notifyUsers(to, { title: `เกิน ${SLA_RULES.chatMinutes} นาทีแล้ว · ${l.name}`, body: "ตอบเร็วที่สุดเพื่อไม่ให้ค้างเพิ่ม", url: "/inbox", tag: `late-${l.id}` }); }
      if (!quiet && crossed(e.minutes, staleAt)) { out.stale++; await notifyUsers([...new Set([...to, ...managersOf(ds)])], { title: `แชทค้างเกิน ${SLA_RULES.staleHours} ชั่วโมง · ${l.name}`, body: e.holiday ? "ลูกค้าทักวันหยุด (ไม่หักแต้ม)" : "ยังไม่มีใครตอบ", url: "/followup", tag: `stale-${l.id}` }); }
    }
  }
  return json({ ok: true, now, interval: win, ...out });
}
export const GET = run;
export const POST = run;
