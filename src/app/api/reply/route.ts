import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { loadChannels, type Channel } from "@/lib/channels";
import { channelOf } from "@/lib/types";
import { psidOf, minutesSinceCustomer, sendText, SendError, WINDOW_HOURS } from "@/lib/fbSend";
import { localStamp } from "@/lib/fbSync";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";
import { roleCan } from "@/lib/queries";
import { instagramRecipientFor } from "@/lib/instagramWebhook";
import { externalRecipientOf } from "@/lib/externalWebhook";
import { sendExternalText } from "@/lib/externalSend";
import { metaApiVersion } from "@/lib/metaApi";

export const maxDuration = 30;

/** Send a Messenger reply from the dashboard and record WHO sent it (messages.sent_by) — that is what SLA attributes the reply to. */
export async function POST(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { leadId?: string; text?: string };
    const text = (b.text ?? "").trim();
    if (!b.leadId || !text) return fail(400, "พิมพ์ข้อความก่อนส่ง");
    if (text.length > 2000) return fail(400, "ข้อความยาวเกินไป (สูงสุด 2,000 ตัวอักษร)");
    const { mapped, me } = g;
    if (!roleCan.editLeads(me.role)) return fail(403, "บทบาทของคุณตอบแชทไม่ได้");
    const lead = mapped.dataset.leads.find((l) => l.id === b.leadId);
    if (!lead) return fail(404, "ไม่พบลีดนี้");
    if (me.role === "Sales Representative" && lead.repId !== me.id) return fail(403, "ตอบได้เฉพาะลีดที่ได้รับมอบหมาย");
    const channel = channelOf(lead);
    if (channel === "instagram" && Buffer.byteLength(text, "utf8") >= 1000) return fail(400, "ข้อความ Instagram ต้องสั้นกว่า 1,000 ไบต์");
    const channels = await loadChannels();
    let ch: Channel | undefined;
    let externalRecipient: string | null = null;
    if (channel === "line" || channel === "whatsapp") {
      ch = channels.find((item) => item.channel === channel && item.active && item.accessToken && item.sheetPageId === lead.pageId && externalRecipientOf(lead.id, channel, item.accountId) !== null);
      if (!ch) return fail(400, `${channel === "line" ? "LINE" : "WhatsApp"} นี้ยังไม่ได้เชื่อมตอบกลับ — ตรวจสอบการเชื่อมต่อในหน้า Upload`);
      externalRecipient = externalRecipientOf(lead.id, channel, ch.accountId);
    } else {
      ch = channel === "instagram"
        ? channels.find((item) => item.channel === "instagram" && item.active && item.accessToken && (item.sheetPageId === lead.pageId || item.channelId === `instagram:${lead.pageId}`) && instagramRecipientFor(lead, item.accountId) !== null)
        : channels.find((item) => item.channel === "facebook" && item.active && item.accessToken && item.sheetPageId === lead.pageId);
      if (!ch) return fail(400, channel === "instagram" ? "บัญชี Instagram นี้ยังไม่ได้เชื่อมข้อความ (ไปที่หน้า Upload → เชื่อมเพจ Facebook ที่ผูก Instagram ไว้)" : "เพจนี้ยังไม่ได้เชื่อม Messenger (ไปที่หน้า Upload → เชื่อมช่องทางแชท)");
    }

    const tz = process.env.APP_TZ || "Asia/Bangkok", base = process.env.FB_GRAPH_BASE || "https://graph.facebook.com";
    const since = minutesSinceCustomer(mapped.dataset.messages[lead.id] ?? [], tz);
    if (channel === "instagram" && since == null) return fail(400, "ส่งข้อความ Instagram ได้หลังจากลูกค้าทักมาเท่านั้น");
    if (channel === "whatsapp" && since == null) return fail(400, "ส่งข้อความ WhatsApp ได้หลังจากลูกค้าทักมาผ่าน Webhook เท่านั้น");
    if (channel !== "line" && since != null && since > WINDOW_HOURS * 60) return fail(400, `ส่งไม่ได้: ลูกค้าทักล่าสุดเกิน ${WINDOW_HOURS} ชั่วโมงแล้ว — ตอบในช่องทางของลูกค้าหรือรอให้ลูกค้าทักมาใหม่`);
    let mid: string;
    if (channel === "line" || channel === "whatsapp") {
      if (!externalRecipient) return fail(400, "ไม่พบผู้รับ LINE/WhatsApp ของลีดนี้");
      mid = await sendExternalText(ch, channel, externalRecipient, text);
    } else {
      const instagram = channel === "instagram" ? instagramRecipientFor(lead, ch.accountId) : null;
      const pageId = channel === "instagram" ? ch.channelId.slice("instagram:".length) : ch.accountId;
      const psid = instagram ?? await psidOf(lead.id, ch.accountId, ch.accessToken, base, lead.fbUserId);
      mid = await sendText({
        pageId, token: ch.accessToken, psid, text, base, channel,
        ...(channel === "instagram" ? { apiVersion: metaApiVersion("v27.0") } : {}),
      });
    }

    const at = localStamp(new Date().toISOString(), tz);
    // From here the customer HAS the message. If the sheet write fails we still answer ok (saved:false): an error here would make the
    // admin press Send again and the customer would get the same message twice. Meta's echo (webhook) fills the sheet in anyway.
    const upd: Record<string, string | boolean> = { lead_id: lead.id, last_contact_at: at, last_message: text.slice(0, 300), unread: false };
    if (lead.status === "Not Responded") { upd.status = "Average"; upd.quality = "Average"; }
    let saved = true;
    try {
      // upsert: Meta's echo of this message may already be saved without a sender — this fills in sent_by
      await upsertRows("messages", ["message_id"], [{ message_id: mid, lead_id: lead.id, direction: "out", sender_type: "human", text, sent_at: at, attachment_name: "", sent_by: me.id }], "upsert");
      await upsertRows("leads", ["lead_id"], [upd], "updateOnly");
    } catch (e) { saved = false; console.error("[api/reply] sent, but the sheet write failed:", e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…") : "error"); }
    invalidateCache();
    return NextResponse.json({ ok: true, messageId: mid, at, status: upd.status ?? lead.status, saved }, noStore);
  } catch (e) {
    if (e instanceof SendError) return fail(e.status, e.message);
    console.error("[api/reply]", e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…") : "error");
    return fail(502, "ส่งข้อความไม่สำเร็จ (ข้อความยังไม่ถูกส่งถึงลูกค้า) ลองใหม่อีกครั้ง");
  }
}
