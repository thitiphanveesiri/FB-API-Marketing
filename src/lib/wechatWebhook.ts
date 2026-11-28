// SERVER ONLY. WeChat Official Account: server check, inbound messages (plain-text mode, XML) and the customer-service reply.
import { createHash, timingSafeEqual } from "node:crypto";
import { externalMessageId, type ExternalEvent } from "./externalWebhook";

/** WeChat signs `sha1(sort([token, timestamp, nonce]).join(""))` as a lowercase hex string, on both the server check (GET) and every message (POST). */
export function wechatSignatureOk(token: string, timestamp: string, nonce: string, signature: string): boolean {
  if (!token || !timestamp || !nonce || !signature) return false;
  const want = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(signature.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** WeChat's XML is flat: <tag>value</tag> or <tag><![CDATA[value]]></tag>. */
export function xmlField(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`).exec(xml);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

/** Text and picture messages become chat messages; follow/unfollow, menu clicks and the like are ignored. accountId is filled in by the caller. */
export function parseWeChatEvents(xml: string): Omit<ExternalEvent, "accountId">[] {
  const type = xmlField(xml, "MsgType"), from = xmlField(xml, "FromUserName"), created = Number(xmlField(xml, "CreateTime"));
  if (!from || !created || (type !== "text" && type !== "image")) return [];
  const text = type === "text" ? xmlField(xml, "Content") : "[รูปภาพ]";
  if (!text) return [];
  const mid = xmlField(xml, "MsgId") || `${from}-${created}`; // MsgId is what WeChat retries with, so a retry never makes a second message
  return [{ customerId: from, mid: externalMessageId("wechat", mid), text: text.slice(0, 2000), at: created * 1000, ...(type === "image" ? { attachmentName: "image" } : {}) }];
}
