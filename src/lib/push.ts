// SERVER ONLY. Web Push subscriptions and notification audit data live in Google Sheets.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import * as webpush from "web-push";
import { readTabs } from "./googleSheets";
import { rewriteRow, upsertRows } from "./sheetsWrite";
import type { Obj } from "./sheetOps";
import { extConfigured, notifyExternal } from "./extNotify";
import { isClosingMessage } from "./sla";
import type { Dataset } from "./dataset";
import type { Lead } from "./types";
import { mapSheets } from "./sheetMapper";

export const pushConfigured = () => !!(
  process.env.VAPID_PUBLIC_KEY?.trim() &&
  process.env.VAPID_PRIVATE_KEY?.trim() &&
  process.env.VAPID_SUBJECT?.trim() &&
  process.env.PUSH_SUBSCRIPTION_SECRET &&
  process.env.PUSH_SUBSCRIPTION_SECRET.length >= 32
);
/** Any delivery channel at all (Web Push, LINE or WhatsApp). */
export const notifyConfigured = () => pushConfigured() || extConfigured();
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";
export interface Note { title: string; body: string; url?: string; tag?: string }
export interface SubInput { endpoint: string; keys: { p256dh: string; auth: string } }
interface Sub { endpoint: string; endpointKey: string; userId: string; keys: { p256dh: string; auth: string } }
export interface AuditInput {
  notification_id: string;
  kind: "inbound" | "followup";
  lead_id: string;
  message_ids?: string;
  state_key?: string;
  recipient_id: string;
  actor_id?: string;
}
export interface AuditResult { status: "sent" | "failed" | "duplicate"; sent: number; failed: number; detail: string }
export const NOTIFICATION_PENDING_LEASE_MS = 2 * 60_000;
export const pendingNotificationRetryable = (status: string, attemptedAt: string, now = Date.now()) => {
  if (status !== "pending") return false;
  const at = Date.parse(attemptedAt);
  return !Number.isFinite(at) || now - at >= NOTIFICATION_PENDING_LEASE_MS;
};

let cache: { at: number; subs: Sub[] } | null = null;
const TTL = 30_000;
let dispatchChain: Promise<unknown> = Promise.resolve();
export const invalidateSubs = () => { cache = null; };

const endpointKey = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
function encryptionKey(): Buffer {
  const secret = process.env.PUSH_SUBSCRIPTION_SECRET;
  if (!secret || secret.length < 32) throw new Error("PUSH_SUBSCRIPTION_SECRET must be at least 32 characters");
  return createHash("sha256").update(secret, "utf8").digest();
}
function encryptSubscription(sub: SubInput): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(sub), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
function decryptSubscription(value: string): SubInput {
  const [iv, tag, body, extra] = value.split(".");
  if (!iv || !tag || !body || extra) throw new Error("Invalid encrypted push subscription");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as SubInput;
  if (!validSubscription(parsed)) throw new Error("Invalid stored push subscription");
  return parsed;
}
export function validEndpoint(endpoint: string): boolean {
  if (!endpoint || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint), host = url.hostname.toLowerCase();
    const known = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" || host === "wns.windows.com" || host.endsWith(".notify.windows.com");
    return url.protocol === "https:" && !url.username && !url.password && known;
  } catch { return false; }
}
export function validSubscription(s: SubInput | undefined): s is SubInput {
  return !!s && validEndpoint(s.endpoint) &&
    /^[A-Za-z0-9_-]{20,200}$/.test(s.keys?.p256dh ?? "") &&
    /^[A-Za-z0-9_-]{16,200}$/.test(s.keys?.auth ?? "");
}

async function loadSubs(fresh = false): Promise<Sub[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.subs;
  const grid = (await readTabs()).push_subs ?? [];
  const head = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const at = (r: string[], n: string) => { const i = head.indexOf(n); return i < 0 ? "" : String(r[i] ?? "").trim(); };
  const subs: Sub[] = [], migrations: { oldEndpoint: string; row: Obj }[] = [];
  for (const row of grid.slice(1)) {
    if (at(row, "active").toLowerCase() === "false") continue;
    const key = at(row, "endpoint"), userId = at(row, "user_id");
    if (!key || !userId) continue;
    if (/^[a-f0-9]{64}$/.test(key)) {
      const encrypted = at(row, "encrypted_subscription");
      if (!encrypted) continue;
      const subscription = decryptSubscription(encrypted);
      subs.push({ endpoint: subscription.endpoint, endpointKey: key, userId, keys: subscription.keys });
      continue;
    }

    // Migrate existing plaintext rows in place and erase their old endpoint/key cells.
    const legacy = { endpoint: key, keys: { p256dh: at(row, "p256dh"), auth: at(row, "auth") } };
    if (!validSubscription(legacy)) continue;
    const hashed = endpointKey(key);
    subs.push({ endpoint: key, endpointKey: hashed, userId, keys: legacy.keys });
    if (pushConfigured()) migrations.push({ oldEndpoint: key, row: {
      endpoint: hashed, user_id: userId, encrypted_subscription: encryptSubscription(legacy),
      created_at: at(row, "created_at") || new Date().toISOString(), active: true, p256dh: "", auth: "",
    } });
  }
  for (const migration of migrations) await rewriteRow("push_subs", "endpoint", migration.oldEndpoint, migration.row);
  cache = { at: Date.now(), subs };
  return subs;
}

export class SubscriptionInUseError extends Error { constructor() { super("อุปกรณ์นี้เปิดแจ้งเตือนสำหรับบัญชีอื่นแล้ว"); } }

export async function saveSub(userId: string, s: SubInput, options: { takeover?: boolean } = {}): Promise<void> {
  if (!pushConfigured()) throw new Error("ตั้งค่า VAPID และ PUSH_SUBSCRIPTION_SECRET ก่อน");
  if (!validSubscription(s)) throw new Error("การสมัครรับแจ้งเตือนไม่ถูกต้อง");
  const existing = (await loadSubs(true)).find((sub) => sub.endpoint === s.endpoint);
  if (existing && existing.userId !== userId && !options.takeover) throw new SubscriptionInUseError();
  await upsertRows("push_subs", ["endpoint"], [{
    endpoint: endpointKey(s.endpoint), user_id: userId, encrypted_subscription: encryptSubscription(s),
    created_at: new Date().toISOString(), active: true, p256dh: "", auth: "",
  }], "upsert");
  invalidateSubs();
}
export async function removeSub(userId: string, endpoint: string): Promise<void> {
  if (!validEndpoint(endpoint)) throw new Error("การสมัครรับแจ้งเตือนไม่ถูกต้อง");
  const mine = (await loadSubs(true)).find((s) => s.endpoint === endpoint && s.userId === userId);
  if (!mine) return;
  await upsertRows("push_subs", ["endpoint"], [{ endpoint: mine.endpointKey, active: false }], "updateOnly");
  invalidateSubs();
}

/** Send to every active device registered to these users. Dead endpoints are disabled in the sheet. */
export async function notifyUsers(userIds: string[], n: Note): Promise<{ sent: number; failed: number }> {
  const [web, ext] = await Promise.all([notifyWebPush(userIds, n), notifyExternal(userIds, n)]);
  return { sent: web.sent + ext.sent, failed: web.failed + ext.failed };
}

async function notifyWebPush(userIds: string[], n: Note): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured() || !userIds.length) return { sent: 0, failed: 0 };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const want = new Set(userIds), subs = (await loadSubs()).filter((s) => want.has(s.userId));
  const dead: string[] = []; let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(n), { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      failed++;
      const code = typeof e === "object" && e !== null && "statusCode" in e ? Number(e.statusCode) : 0;
      if (code === 404 || code === 410) dead.push(s.endpointKey);
      else console.error("[push] delivery failed", { code: code || "unknown" });
    }
  }));
  if (dead.length) {
    try { await upsertRows("push_subs", ["endpoint"], dead.map((endpoint) => ({ endpoint, active: false })), "updateOnly"); }
    catch (e) { console.error("[push] could not disable expired subscriptions", e instanceof Error ? e.name : "UnknownError"); }
    invalidateSubs();
  }
  return { sent, failed };
}

/** Record an idempotent audit row before delivery, then persist its result. */
export async function notifyAudited(input: AuditInput, userIds: string[], note: Note): Promise<AuditResult> {
  const run = async (): Promise<AuditResult> => {
    const grid = (await readTabs()).notification_log ?? [];
    const headers = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
    const idCol = headers.indexOf("notification_id"), statusCol = headers.indexOf("status"), attemptedCol = headers.indexOf("attempted_at");
    const prior = idCol < 0 ? "" : grid.slice(1).find((row) => String(row[idCol] ?? "").trim() === input.notification_id);
    const priorStatus = prior && statusCol >= 0 ? String(prior[statusCol] ?? "").trim().toLowerCase() : "";
    const priorAttemptedAt = prior && attemptedCol >= 0 ? String(prior[attemptedCol] ?? "").trim() : "";
    if (priorStatus === "sent" || (priorStatus === "pending" && !pendingNotificationRetryable(priorStatus, priorAttemptedAt)))
      return { status: "duplicate", sent: 0, failed: 0, detail: priorStatus };

    const base: Obj = { ...input, attempted_at: new Date().toISOString(), sent_at: "", sent_count: 0, failed_count: 0, detail: "" };
    await upsertRows("notification_log", ["notification_id"], [{ ...base, status: "pending" }], "upsert");
    let result: { sent: number; failed: number }, detail = "";
    try {
      result = await notifyUsers(userIds, note);
      if (!result.sent) { result = { ...result, failed: Math.max(1, result.failed) }; detail = "no_active_subscription"; }
    } catch (e) {
      result = { sent: 0, failed: 1 };
      detail = "delivery_error";
      console.error("[push] audited delivery failed", e instanceof Error ? e.name : "UnknownError");
    }
    const status = result.sent > 0 ? "sent" : "failed";
    await upsertRows("notification_log", ["notification_id"], [{
      ...base, sent_at: new Date().toISOString(), status, sent_count: result.sent, failed_count: result.failed, detail,
    }], "upsert");
    return { status, ...result, detail };
  };
  const pending = dispatchChain.then(run, run);
  dispatchChain = pending.then(() => undefined, () => undefined);
  return pending;
}

export const stableNotificationId = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");

/** Who should hear about a lead: its salesperson, or (no owner yet) the managers and administrators. */
export function recipientsFor(ds: Dataset, lead: Pick<Lead, "repId"> | null): string[] {
  const rep = lead?.repId && ds.users.find((u) => u.id === lead.repId && u.active) ? [lead.repId] : [];
  return rep.length ? rep : managersOf(ds);
}
export const managersOf = (ds: Dataset): string[] => ds.users.filter((u) => u.active && (u.role === "Administrator" || u.role === "Sales Manager")).map((u) => u.id);

/** Quiet hours (default 22:00–08:00, Bangkok): new-message alerts are not sent so phones stay silent at night. */
export function isQuiet(date = new Date(), tz = process.env.APP_TZ || "Asia/Bangkok"): boolean {
  const cfg = (process.env.PUSH_QUIET_HOURS || "22-8").trim().toLowerCase(); if (cfg === "off") return false;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(cfg); const from = m ? +m[1] : 22, to = m ? +m[2] : 8;
  const h = +new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(date);
  return from > to ? h >= from || h < to : h >= from && h < to;
}

export async function notifyInboundFresh(msgs: { message_id: string; lead_id: string; direction: string; text: string }[]): Promise<void> {
  const mapped = mapSheets(await readTabs(true));
  await notifyInbound(mapped.dataset, msgs);
}

/** One audited push per responsible user; unassigned chats go to managers and administrators. */
export async function notifyInbound(ds: Dataset, msgs: { message_id: string; lead_id: string; direction: string; text: string }[]): Promise<void> {
  if (!notifyConfigured() || isQuiet()) return;
  const grouped = new Map<string, { text: string; ids: string[] }>();
  for (const m of msgs) {
    if (m.direction !== "in" || !m.message_id || isClosingMessage(m.text)) continue;
    const group = grouped.get(m.lead_id) ?? { text: "", ids: [] };
    group.text = m.text;
    group.ids.push(m.message_id);
    grouped.set(m.lead_id, group);
  }
  for (const [leadId, group] of grouped) {
    const lead = ds.leads.find((l) => l.id === leadId);
    if (!lead) continue;
    const ids = [...new Set(group.ids)].sort();
    for (const recipientId of recipientsFor(ds, lead)) {
      const id = stableNotificationId("inbound", leadId, recipientId, ids.join("|"));
      await notifyAudited({
        notification_id: id, kind: "inbound", lead_id: leadId, message_ids: ids.join(","), recipient_id: recipientId,
      }, [recipientId], { title: "ข้อความใหม่ใน Inbox", body: "มีลูกค้าส่งข้อความใหม่ เปิดแอปเพื่อดู", url: "/inbox", tag: `msg-${leadId}` });
    }
  }
}
