// SERVER ONLY. Real customer replies for LINE and WhatsApp.
import { randomUUID } from "node:crypto";
import type { Channel } from "./channels";
import { SendError } from "./fbSend";
import { metaApiVersion } from "./metaApi";
import type { ExternalChatChannel } from "./externalWebhook";

const scrub = (value: string, token: string) => {
  const clean = value.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…");
  return token ? clean.replaceAll(token, "…") : clean;
};
const timeout = () => AbortSignal.timeout(10_000);

export async function sendLineText(channel: Pick<Channel, "accessToken">, to: string, text: string): Promise<string> {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    signal: timeout(),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${channel.accessToken}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const result = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.ok) return `LINE-OUT-${randomUUID()}`;
  const message = scrub(result.message ?? `HTTP ${response.status}`, channel.accessToken);
  if (response.status === 401 || response.status === 403) throw new SendError("โทเคน LINE หมดอายุหรือไม่มีสิทธิ์ — ตรวจสอบการเชื่อมต่อ LINE ในหน้า Upload", 502);
  if (response.status === 429) throw new SendError("LINE จำกัดจำนวนการส่งชั่วคราว — รอสักครู่แล้วลองใหม่", 429);
  throw new SendError(`LINE ตอบ ${response.status}: ${message}`, response.status >= 400 && response.status < 500 ? 400 : 502);
}

export async function sendWhatsAppText(channel: Pick<Channel, "accountId" | "accessToken">, to: string, text: string): Promise<string> {
  const base = process.env.FB_GRAPH_BASE || "https://graph.facebook.com";
  const response = await fetch(`${base}/${metaApiVersion()}/${encodeURIComponent(channel.accountId)}/messages`, {
    method: "POST",
    signal: timeout(),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${channel.accessToken}` },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  const messageId = result.messages?.[0]?.id;
  if (response.ok && messageId) return messageId;
  const message = scrub(result.error?.message ?? `HTTP ${response.status}`, channel.accessToken);
  if (result.error?.code === 190) throw new SendError("โทเคน WhatsApp หมดอายุหรือถูกเพิกถอน — วางโทเคนใหม่ในการเชื่อมต่อ WhatsApp", 502);
  if (result.error?.code === 131047 || /outside.*24|24.hour|service window/i.test(message)) throw new SendError("ส่งข้อความ WhatsApp ได้เฉพาะภายใน 24 ชั่วโมงหลังลูกค้าทักมา — รอให้ลูกค้าทักมาใหม่ หรือใช้เทมเพลตที่อนุมัติแล้ว", 400);
  if (result.error?.code === 131026 || /not.*valid.*recipient|undeliverable/i.test(message)) throw new SendError("เบอร์นี้รับข้อความ WhatsApp ไม่ได้", 400);
  throw new SendError(`WhatsApp ตอบ ${response.status}: ${message}`, response.status >= 400 && response.status < 500 ? 400 : 502);
}

export function sendExternalText(channel: Channel, kind: ExternalChatChannel, to: string, text: string): Promise<string> {
  return kind === "line" ? sendLineText(channel, to, text) : sendWhatsAppText(channel, to, text);
}
