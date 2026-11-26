// SERVER ONLY. Turns Meta "page" webhook payloads (Messenger) into sheet rows — one message at a time, as they happen.
import { createHmac, timingSafeEqual } from "crypto";
import type { Dataset } from "./dataset";
import type { Channel } from "./channels";
import { localStamp } from "./fbSync";

export function signatureOk(raw: string, header: string | null, secret: string): boolean {
  if (!header || !secret || !header.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(raw, "utf8").digest("hex"), got = header.slice(7);
  return want.length === got.length && timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

export interface FbEvent { pageId: string; customerId: string; mid: string; out: boolean; text: string; at: number; appId?: string }
interface Payload { object?: string; entry?: { id?: string; messaging?: { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string; sticker_id?: number; attachments?: { payload?: { sticker_id?: number } }[] } }[] }[] }

/** Only real messages: skips read receipts / deliveries / postbacks. Echo = the page (a person or the Inbox app) sent it. */
export function parseEvents(p: Payload): FbEvent[] {
  if (p.object !== "page") return [];
  const out: FbEvent[] = [];
  for (const e of p.entry ?? []) for (const m of e.messaging ?? []) {
    const msg = m.message; if (!msg?.mid || !e.id) continue;
    const echo = !!msg.is_echo, customer = echo ? m.recipient?.id : m.sender?.id; if (!customer) continue;
    out.push({ pageId: e.id, customerId: customer, mid: msg.mid, out: echo, text: (msg.text || (msg.sticker_id || msg.attachments?.some((a) => a.payload?.sticker_id) ? "[สติ๊กเกอร์]" : msg.attachments?.length ? "[ไฟล์แนบ]" : "")).slice(0, 2000), at: m.timestamp ?? Date.now(), appId: echo && msg.app_id ? String(msg.app_id) : undefined });
  }
  return out;
}

type Row = Record<string, string | number | boolean>;
export interface Writes { newLeads: Row[]; leadUpdates: Row[]; messages: Row[] }

/** Pure: decides which rows to write. `nameOf` is only called for a customer we have never seen (Graph profile lookup). */
export async function buildWrites(events: FbEvent[], ch: Channel, ds: Dataset, tz: string, nameOf: (psid: string) => Promise<string>, knownMessageIds: ReadonlySet<string> = new Set()): Promise<Writes> {
  const w: Writes = { newLeads: [], leadUpdates: [], messages: [] };
  const mine = ds.leads.filter((l) => l.pageId === ch.sheetPageId);
  const mineById = new Map(mine.map((lead) => [lead.id, lead]));
  const ids = new Set(mine.map((l) => l.id)), byName = new Map<string, string | null>();
  for (const l of mine) { const k = l.name.trim().toLowerCase(); if (k) byName.set(k, byName.has(k) ? null : l.id); }
  const hasPsid = new Set(mine.filter((l) => l.fbUserId).map((l) => l.id)); // leads whose Facebook user id is already stored
  const leadOf = new Map<string, string>(); // psid → lead id (this batch)
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const latest = new Map<string, { row: Row; at: number; fresh: boolean }>();
  for (const ev of sorted) {
    let id = leadOf.get(ev.customerId) ?? "";
    if (!id) {
      const mineId = `FB-${ev.customerId}`;
      const byPsid = mine.find((l) => l.fbUserId === ev.customerId)?.id; // a lead the sync/earlier chat already linked to this person
      if (byPsid) id = byPsid;
      else if (ids.has(mineId)) id = mineId;
      else {
        const name = ((await nameOf(ev.customerId).catch(() => "")) || "").trim() || "ลูกค้า Facebook";
        id = byName.get(name.toLowerCase()) ?? "";           // an earlier import/sync of the same person (unique name only)
        if (!id) { id = mineId; ids.add(id); w.newLeads.push({ lead_id: id, name, page_id: ch.sheetPageId, ad_id: "", assigned_to: "", status: ev.out ? "Average" : "Not Responded", quality: ev.out ? "Average" : "Not Responded", valid: true, created_at: localStamp(new Date(ev.at).toISOString(), tz).slice(0, 10), phone: "", email: "", unread: !ev.out, channel: "facebook", fb_user_id: ev.customerId }); }
      }
      leadOf.set(ev.customerId, id);
    }
    const stamp = localStamp(new Date(ev.at).toISOString(), tz);
    w.messages.push({ message_id: ev.mid, lead_id: id, direction: ev.out ? "out" : "in", sender_type: ev.out ? "unknown" : "customer", sender_app: ev.appId ?? "", text: ev.text, sent_at: stamp, attachment_name: "" });
    const row: Row = { lead_id: id, last_contact_at: stamp, last_message: ev.text.slice(0, 300), unread: !ev.out, ...(hasPsid.has(id) ? {} : { fb_user_id: ev.customerId, channel: "facebook" }) };
    const fresh = !knownMessageIds.has(ev.mid);
    const previous = latest.get(id);
    if (!previous || ev.at > previous.at || (ev.at === previous.at && fresh)) latest.set(id, { row, at: ev.at, fresh });
  }
  const contactMinute = (value: string) => value.replace("T", " ").slice(0, 16);
  for (const [id, entry] of latest) {
    const existing = mineById.get(id);
    const stamp = contactMinute(String(entry.row.last_contact_at));
    const missingSummary = existing?.lastMessage === "" && existing.lastContactAt === `${existing.createdAt}T09:00:00`;
    const current = existing && !missingSummary ? contactMinute(existing.lastContactAt) : "";
    if (existing && (stamp < current || (stamp === current && !entry.fresh))) continue;
    w.leadUpdates.push(entry.row);
  }
  return w;
}
