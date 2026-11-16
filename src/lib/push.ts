// SERVER ONLY. Web Push to the salespeople's phones. Subscriptions live in the Google Sheet tab "push_subs" (endpoint = key).
import * as webpush from "web-push";
import { readTabs } from "./googleSheets";
import { upsertRows } from "./sheetsWrite";
import { isClosingMessage } from "./sla";
import type { Dataset } from "./dataset";
import type { Lead } from "./types";

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";
export interface Note { title: string; body: string; url?: string; tag?: string }
export interface SubInput { endpoint: string; keys: { p256dh: string; auth: string } }
interface Sub { endpoint: string; userId: string; p256dh: string; auth: string }

let cache: { at: number; subs: Sub[] } | null = null;
const TTL = 30_000;
export const invalidateSubs = () => { cache = null; };

async function loadSubs(fresh = false): Promise<Sub[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.subs;
  const grid = (await readTabs()).push_subs ?? [];
  const head = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const at = (r: string[], n: string) => { const i = head.indexOf(n); return i < 0 ? "" : String(r[i] ?? "").trim(); };
  const subs = grid.slice(1).filter((r) => at(r, "endpoint") && at(r, "active").toLowerCase() !== "false")
    .map((r): Sub => ({ endpoint: at(r, "endpoint"), userId: at(r, "user_id"), p256dh: at(r, "p256dh"), auth: at(r, "auth") }));
  cache = { at: Date.now(), subs };
  return subs;
}

const validEndpoint = (e: string) => /^https:\/\/[^\s]{10,1000}$/.test(e);
export async function saveSub(userId: string, s: SubInput): Promise<void> {
  if (!validEndpoint(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw new Error("การสมัครรับแจ้งเตือนไม่ถูกต้อง");
  await upsertRows("push_subs", ["endpoint"], [{ endpoint: s.endpoint, user_id: userId, p256dh: s.keys.p256dh, auth: s.keys.auth, created_at: new Date().toISOString(), active: true }], "upsert");
  invalidateSubs();
}
export async function removeSub(userId: string, endpoint: string): Promise<void> {
  const mine = (await loadSubs(true)).find((s) => s.endpoint === endpoint && s.userId === userId); if (!mine) return;
  await upsertRows("push_subs", ["endpoint"], [{ endpoint, active: false }], "updateOnly"); invalidateSubs();
}

/** Send to every device of the given users. Dead subscriptions (404/410) are switched off. Never throws. */
export async function notifyUsers(userIds: string[], n: Note): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured() || !userIds.length) return { sent: 0, failed: 0 };
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    const want = new Set(userIds), subs = (await loadSubs()).filter((s) => want.has(s.userId));
    const dead: string[] = []; let sent = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(n), { TTL: 3600, urgency: "high" }); sent++; }
      catch (e) { failed++; const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.push(s.endpoint); }
    }));
    if (dead.length) { await upsertRows("push_subs", ["endpoint"], dead.map((endpoint) => ({ endpoint, active: false })), "updateOnly").catch(() => {}); invalidateSubs(); }
    return { sent, failed };
  } catch (e) { console.error("[push]", e instanceof Error ? e.message.slice(0, 120) : "error"); return { sent: 0, failed: 0 }; }
}

/** Who should hear about a lead: its salesperson, or (no owner yet) the managers and administrators. */
export function recipientsFor(ds: Dataset, lead: Pick<Lead, "repId"> | null): string[] {
  const rep = lead?.repId && ds.users.find((u) => u.id === lead.repId && u.active) ? [lead.repId] : [];
  return rep.length ? rep : managersOf(ds);
}
export const managersOf = (ds: Dataset): string[] => ds.users.filter((u) => u.active && (u.role === "Administrator" || u.role === "Sales Manager")).map((u) => u.id);

/** Quiet hours (default 22:00–08:00, Bangkok): new-message alerts are not sent so phones stay silent at night. PUSH_QUIET_HOURS="off" or "23-7". */
export function isQuiet(date = new Date(), tz = process.env.APP_TZ || "Asia/Bangkok"): boolean {
  const cfg = (process.env.PUSH_QUIET_HOURS || "22-8").trim().toLowerCase(); if (cfg === "off") return false;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(cfg); const from = m ? +m[1] : 22, to = m ? +m[2] : 8;
  const h = +new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(date);
  return from > to ? h >= from || h < to : h >= from && h < to;
}

/** One push per customer for the inbound messages of a webhook batch (closing messages like "ขอบคุณค่ะ" and stickers stay silent). */
export async function notifyInbound(ds: Dataset, msgs: { lead_id: string; direction: string; text: string }[], newLeadNames: Map<string, string>): Promise<void> {
  if (!pushConfigured() || isQuiet()) return;
  const last = new Map<string, { text: string; n: number }>();
  for (const m of msgs) { if (m.direction !== "in" || isClosingMessage(m.text)) continue; const c = last.get(m.lead_id); last.set(m.lead_id, { text: m.text, n: (c?.n ?? 0) + 1 }); }
  for (const [id, v] of last) {
    const lead = ds.leads.find((l) => l.id === id) ?? null;
    await notifyUsers(recipientsFor(ds, lead), { title: `ข้อความใหม่ · ${lead?.name ?? newLeadNames.get(id) ?? "ลูกค้า"}${v.n > 1 ? ` (${v.n})` : ""}`, body: v.text.slice(0, 120), url: "/inbox", tag: `msg-${id}` });
  }
}
