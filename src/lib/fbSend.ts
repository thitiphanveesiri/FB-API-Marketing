// SERVER ONLY. Send a Messenger reply through the Send API.
import { localStamp } from "./fbSync";
import { minutesBetween } from "./sla";
import type { Message } from "./types";

export const WINDOW_HOURS = 24;
const scrub = (s: string) => s.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…");
export class SendError extends Error { constructor(msg: string, public status = 502) { super(msg); } }

/** The customer's Messenger id: leads made by the webhook are "FB-<psid>"; older ones carry a conversation id (t_…) that Graph can resolve. */
export async function psidOf(leadId: string, pageId: string, token: string, base: string, stored?: string): Promise<string> {
  if (stored && /^\d{5,25}$/.test(stored)) return stored; // saved by the webhook / sync
  if (leadId.startsWith("FB-")) return leadId.slice(3);
  if (/^t_/.test(leadId)) {
    const r = await fetch(`${base}/v21.0/${leadId}?${new URLSearchParams({ fields: "participants", access_token: token })}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { participants?: { data?: { id?: string }[] }; error?: { message?: string } };
    const id = j.participants?.data?.find((p) => p.id && p.id !== pageId)?.id;
    if (r.ok && id) return id;
  }
  throw new SendError("ลีดนี้ไม่ได้มาจาก Messenger ที่เชื่อมไว้ จึงตอบจากระบบไม่ได้ (ตอบใน Business Suite แทน)", 400);
}

/** Minutes since the customer last wrote, or null when we have no inbound message. */
export function minutesSinceCustomer(msgs: Message[], tz: string, now = new Date()): number | null {
  const last = [...msgs].filter((m) => m.direction === "in").sort((a, b) => a.at.localeCompare(b.at)).pop();
  return last ? minutesBetween(last.at, localStamp(now.toISOString(), tz)) : null;
}

export async function sendText(o: { pageId: string; token: string; psid: string; text: string; base: string }): Promise<string> {
  const r = await fetch(`${o.base}/v21.0/${o.pageId}/messages?${new URLSearchParams({ access_token: o.token })}`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ recipient: { id: o.psid }, messaging_type: "RESPONSE", message: { text: o.text } }),
  });
  const j = (await r.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } };
  if (r.ok && j.message_id) return j.message_id;
  const code = j.error?.code, sub = j.error?.error_subcode, msg = scrub(j.error?.message ?? `HTTP ${r.status}`);
  if (code === 190) throw new SendError("โทเคนของเพจหมดอายุหรือถูกเพิกถอน — วางโทเคนใหม่ในการ์ด “เชื่อมช่องทางแชท” หน้า Upload", 502);
  if ((code === 10 && sub === 2018278) || /outside of allowed window|allowed window/i.test(msg)) throw new SendError(`ส่งไม่ได้: เกิน ${WINDOW_HOURS} ชั่วโมงหลังลูกค้าทักล่าสุด (กฎของ Meta) — ตอบใน Business Suite หรือรอให้ลูกค้าทักมาใหม่`, 400);
  if (code === 551 || sub === 1545041) throw new SendError("ลูกค้าคนนี้ไม่รับข้อความจากเพจแล้ว (ปิดกั้นหรือลบแชท)", 400);
  if (code === 200 || code === 100) throw new SendError(`Meta ไม่อนุญาตให้ส่ง: ${msg} (ตรวจว่าโทเคนมีสิทธิ์ pages_messaging)`, 400);
  throw new SendError(`Meta ตอบ ${r.status}: ${msg}`, 502);
}
