import { createHmac, timingSafeEqual } from "node:crypto";
import { externalMessageId, type ExternalEvent } from "./externalWebhook";

interface WhatsAppMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string; id?: string };
  video?: { caption?: string; id?: string };
  audio?: { id?: string };
  document?: { caption?: string; filename?: string; id?: string };
  sticker?: { id?: string };
  location?: { name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string } }[];
  reaction?: { emoji?: string };
}
interface WhatsAppPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WhatsAppMessage[];
      };
    }[];
  }[];
}

export function whatsappSignatureOk(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

function messageText(message: WhatsAppMessage): string {
  const type = message.type ?? "unknown";
  if (type === "text") return message.text?.body ?? "";
  if (type === "button") return message.button?.text ?? "[ปุ่มตอบกลับ]";
  if (type === "interactive") return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "[ข้อความแบบโต้ตอบ]";
  if (type === "image") return message.image?.caption || "[รูปภาพ]";
  if (type === "video") return message.video?.caption || "[วิดีโอ]";
  if (type === "audio") return "[เสียง]";
  if (type === "document") return message.document?.caption || "[ไฟล์แนบ]";
  if (type === "sticker") return "[สติ๊กเกอร์]";
  if (type === "location") return message.location?.name || message.location?.address || "[ตำแหน่ง]";
  if (type === "contacts") return `[การ์ดติดต่อ${message.contacts?.[0]?.name?.formatted_name ? `: ${message.contacts[0].name.formatted_name}` : ""}]`;
  if (type === "reaction") return `[รีแอกชัน: ${message.reaction?.emoji ?? ""}]`;
  return `[${type}]`;
}

export function parseWhatsAppEvents(payload: WhatsAppPayload): ExternalEvent[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const events: ExternalEvent[] = [];
  for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
    if (change.field !== "messages") continue;
    const value = change.value, accountId = value?.metadata?.phone_number_id;
    if (!accountId) continue;
    const names = new Map((value?.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name ?? ""]));
    for (const message of value?.messages ?? []) {
      if (!message.id || !message.from || message.type === "system") continue;
      const timestamp = Number(message.timestamp);
      events.push({
        accountId,
        customerId: message.from,
        mid: externalMessageId("whatsapp", message.id),
        text: messageText(message).slice(0, 2000),
        at: Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now(),
        displayName: names.get(message.from),
        phone: message.from,
        attachmentName: message.document?.filename ?? "",
      });
    }
  }
  return events;
}
