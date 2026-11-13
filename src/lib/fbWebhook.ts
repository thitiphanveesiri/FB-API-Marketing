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

export interface FbEvent { pageId: string; customerId: string; mid: string; out: boolean; text: string; at: number }
interface Payload { object?: string; entry?: { id?: string; messaging?: { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] } }[] }[] }

/** Only real messages: skips read receipts / deliveries / postbacks. Echo = the page (a person or the Inbox app) sent it. */
export function parseEvents(p: Payload): FbEvent[] {
  if (p.object !== "page") return [];
  const out: FbEvent[] = [];
  for (const e of p.entry ?? []) for (const m of e.messaging ?? []) {
    const msg = m.message; if (!msg?.mid || !e.id) continue;
    const echo = !!msg.is_echo, customer = echo ? m.recipient?.id : m.sender?.id; if (!customer) continue;
    out.push({ pageId: e.id, customerId: customer, mid: msg.mid, out: echo, text: (msg.text || (msg.attachments?.length ? "[ไฟล์แนบ]" : "")).slice(0, 2000), at: m.timestamp ?? Date.now() });
  }
  return out;
}

type Row = Record<string, string | number | boolean>;
export interface Writes { newLeads: Row[]; leadUpdates: Row[]; messages: Row[] }

/** Pure: decides which rows to write. `nameOf` is only called for a customer we have never seen (Graph profile lookup). */
export async function buildWrites(events: FbEvent[], ch: Channel, ds: Dataset, tz: string, nameOf: (psid: string) => Promise<string>): Promise<Writes> {
  const w: Writes = { newLeads: [], leadUpdates: [], messages: [] };
  const mine = ds.leads.filter((l) => l.pageId === ch.sheetPageId);
  const ids = new Set(mine.map((l) => l.id)), byName = new Map<string, string | null>();
  for (const l of mine) { const k = l.name.trim().toLowerCase(); if (k) byName.set(k, byName.has(k) ? null : l.id); }
  const hasPsid = new Set(mine.filter((l) => l.fbUserId).map((l) => l.id)); // leads whose Facebook user id is already stored
  const leadOf = new Map<string, string>(); // psid → lead id (this batch)
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const latest = new Map<string, Row>();
  for (const ev of sorted) {
    let id = leadOf.get(ev.customerId) ?? "";
    if (!id) {
      const mineId = `FB-${ev.customerId}`;
      if (ids.has(mineId)) id = mineId;
      else {
        const name = ((await nameOf(ev.customerId).catch(() => "")) || "").trim() || "ลูกค้า Facebook";
        id = byName.get(name.toLowerCase()) ?? "";           // an earlier import/sync of the same person (unique name only)
        if (!id) { id = mineId; ids.add(id); w.newLeads.push({ lead_id: id, name, page_id: ch.sheetPageId, ad_id: "", assigned_to: "", status: ev.out ? "Average" : "Not Responded", quality: ev.out ? "Average" : "Not Responded", valid: true, created_at: localStamp(new Date(ev.at).toISOString(), tz).slice(0, 10), phone: "", email: "", unread: !ev.out, channel: "facebook", fb_user_id: ev.customerId }); }
      }
      leadOf.set(ev.customerId, id);
    }
    const stamp = localStamp(new Date(ev.at).toISOString(), tz);
    w.messages.push({ message_id: ev.mid, lead_id: id, direction: ev.out ? "out" : "in", text: ev.text, sent_at: stamp, attachment_name: "" });
    latest.set(id, { lead_id: id, last_contact_at: stamp, last_message: ev.text.slice(0, 300), unread: !ev.out, ...(hasPsid.has(id) ? {} : { fb_user_id: ev.customerId, channel: "facebook" }) });
  }
  w.leadUpdates.push(...latest.values());
  return w;
}
