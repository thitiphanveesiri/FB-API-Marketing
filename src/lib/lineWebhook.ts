import { externalMessageId, type ExternalEvent } from "./externalWebhook";

interface LineMessage {
  id?: string;
  type?: string;
  text?: string;
  fileName?: string;
}
interface LineEvent {
  type?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: LineMessage;
}
interface LinePayload { events?: LineEvent[] }

const attachmentText = (type: string) => ({
  image: "[รูปภาพ]", video: "[วิดีโอ]", audio: "[เสียง]", file: "[ไฟล์แนบ]",
  sticker: "[สติ๊กเกอร์]", location: "[ตำแหน่ง]", unsupported: "[ข้อความแบบไม่รองรับ]",
}[type] ?? `[${type || "ข้อความ"}]`);

export function parseLineEvents(payload: LinePayload, accountId: string): ExternalEvent[] {
  const events: ExternalEvent[] = [];
  for (const event of payload.events ?? []) {
    const message = event.message;
    if (event.type !== "message" || !message?.id || event.source?.type !== "user" || !event.source.userId) continue;
    const type = message.type ?? "unknown";
    const text = type === "text" ? message.text ?? "" : attachmentText(type);
    if (!text) continue;
    events.push({
      accountId,
      customerId: event.source.userId,
      mid: externalMessageId("line", message.id),
      text: text.slice(0, 2000),
      at: event.timestamp ?? Date.now(),
      attachmentName: type === "file" ? message.fileName ?? "" : "",
    });
  }
  return events;
}
