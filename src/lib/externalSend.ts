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

// shortcut: the WeChat access token (valid 2 h) is cached per server instance; each new instance asks WeChat for its own. Fine at this volume (WeChat allows 2,000 token requests a day).
const wechatTokens = new Map<string, { token: string; until: number }>();

async function wechatAccessToken(appId: string, secret: string, fresh = false, doFetch: typeof fetch = fetch): Promise<string> {
  const hit = wechatTokens.get(appId);
  if (!fresh && hit && hit.until > Date.now()) return hit.token;
  const r = await doFetch(`https://api.weixin.qq.com/cgi-bin/token?${new URLSearchParams({ grant_type: "client_credential", appid: appId, secret })}`, { signal: timeout() });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!j.access_token) {
    if (j.errcode === 40013 || j.errcode === 40125 || j.errcode === 40001) throw new SendError("AppID หรือ AppSecret ของ WeChat ไม่ถูกต้อง — ตรวจสอบการเชื่อมต่อในหน้า Upload", 401);
    if (j.errcode === 40164) throw new SendError("WeChat ไม่รับ IP ของเซิร์ฟเวอร์นี้ — เพิ่ม IP ใน IP whitelist ของ Official Account (Developer settings)", 400);
    throw new SendError(`WeChat ออกโทเคนไม่ได้: ${scrub(j.errmsg ?? `HTTP ${r.status}`, secret)}`, 502);
  }
  wechatTokens.set(appId, { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 7200) - 300) * 1000 });
  return j.access_token;
}

/** Customer-service message (text). Only allowed within 48 h after the customer's last message. */
export async function sendWeChatText(channel: Pick<Channel, "accountId" | "accessToken">, to: string, text: string, doFetch: typeof fetch = fetch): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await wechatAccessToken(channel.accountId, channel.accessToken, attempt > 0, doFetch);
    const r = await doFetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?${new URLSearchParams({ access_token: token })}`, {
      method: "POST", signal: timeout(), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ touser: to, msgtype: "text", text: { content: text } }),
    });
    const j = (await r.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (!j.errcode) return `WC-OUT-${randomUUID()}`;
    if ((j.errcode === 40001 || j.errcode === 42001) && attempt === 0) continue; // token expired early: ask for a new one once
    if (j.errcode === 45015 || j.errcode === 45047) throw new SendError("ส่งข้อความ WeChat ได้เฉพาะภายใน 48 ชั่วโมงหลังลูกค้าทักมาล่าสุด (หรือเกินจำนวนที่ WeChat อนุญาต)", 400);
    if (j.errcode === 40003) throw new SendError("รหัสผู้รับ WeChat (OpenID) ไม่ถูกต้อง", 400);
    if (j.errcode === 43004) throw new SendError("ลูกค้าเลิกติดตามบัญชีนี้แล้ว ส่งข้อความหาไม่ได้", 400);
    throw new SendError(`WeChat ตอบ ${j.errcode}: ${scrub(j.errmsg ?? "", channel.accessToken)}`, 502);
  }
  throw new SendError("ส่งข้อความ WeChat ไม่สำเร็จ", 502);
}

export function sendExternalText(channel: Channel, kind: ExternalChatChannel, to: string, text: string): Promise<string> {
  return kind === "line" ? sendLineText(channel, to, text) : kind === "wechat" ? sendWeChatText(channel, to, text) : sendWhatsAppText(channel, to, text);
}
