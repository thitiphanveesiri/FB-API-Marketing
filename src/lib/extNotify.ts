// SERVER ONLY. LINE + WhatsApp delivery for the same notifications Web Push sends. Every channel is OFF until its env vars are set.
import { createHmac, timingSafeEqual } from "crypto";
import { readTabs } from "./googleSheets";
import { metaApiVersion } from "./metaApi";

export interface ExtNote { title: string; body: string; url?: string }
export const lineConfigured = () => !!process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
export const whatsappConfigured = () => !!(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() && process.env.WHATSAPP_TEMPLATE_NAME?.trim());
export const extConfigured = () => lineConfigured() || whatsappConfigured();

const appUrl = () => (process.env.APP_URL || "https://fb-api-marketing.vercel.app").replace(/\/$/, "");
const withTimeout = (ms = 8000) => AbortSignal.timeout(ms);

/** Who gets what: sheet tab `notify_contacts` (user_id, line_user_id, whatsapp). A missing tab or blank cell simply means "not on that channel". */
export async function loadContacts(): Promise<Map<string, { line?: string; whatsapp?: string }>> {
  const grid = (await readTabs()).notify_contacts ?? [];
  const h = (grid[0] ?? []).map((x) => String(x).trim().toLowerCase());
  const col = (n: string) => h.indexOf(n), u = col("user_id"), l = col("line_user_id"), w = col("whatsapp");
  const out = new Map<string, { line?: string; whatsapp?: string }>();
  if (u < 0) return out;
  for (const r of grid.slice(1)) {
    const id = String(r[u] ?? "").trim(); if (!id) continue;
    const line = l >= 0 ? String(r[l] ?? "").trim() : "", wa = w >= 0 ? String(r[w] ?? "").replace(/[^\d]/g, "") : "";
    out.set(id, { ...(line ? { line } : {}), ...(wa ? { whatsapp: wa } : {}) });
  }
  return out;
}

export async function sendLine(to: string, text: string): Promise<boolean> {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST", signal: withTimeout(),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) console.error("[line] push failed", r.status);
  return r.ok;
}

/** WhatsApp only lets a business start a chat with an approved TEMPLATE, so the text goes in as the template's single body variable ({{1}}). */
export async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const flat = text.replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").slice(0, 900);
  const r = await fetch(`https://graph.facebook.com/${metaApiVersion()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST", signal: withTimeout(),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: process.env.WHATSAPP_TEMPLATE_NAME, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "th" }, components: [{ type: "body", parameters: [{ type: "text", text: flat }] }] } }),
  });
  if (!r.ok) console.error("[whatsapp] send failed", r.status);
  return r.ok;
}

export const noteText = (n: ExtNote) => `${n.title}\n${n.body}${n.url ? `\n${appUrl()}${n.url}` : ""}`;

export async function notifyExternal(userIds: string[], n: ExtNote): Promise<{ sent: number; failed: number }> {
  if (!extConfigured() || !userIds.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  try {
    const contacts = await loadContacts(), text = noteText(n);
    await Promise.all([...new Set(userIds)].map(async (id) => {
      const c = contacts.get(id); if (!c) return;
      const jobs: Promise<boolean>[] = [];
      if (c.line && lineConfigured()) jobs.push(sendLine(c.line, text));
      if (c.whatsapp && whatsappConfigured()) jobs.push(sendWhatsApp(c.whatsapp, text));
      for (const ok of await Promise.all(jobs.map((j) => j.catch(() => false)))) { if (ok) sent++; else failed++; }
    }));
  } catch (e) { console.error("[ext-notify]", e instanceof Error ? e.name : "UnknownError"); failed++; }
  return { sent, failed };
}

/** LINE signs the raw body with the channel secret (HMAC-SHA256, base64) in x-line-signature. */
export function lineSignatureOk(rawBody: string, signature: string | null, secret = process.env.LINE_CHANNEL_SECRET || ""): boolean {
  if (!secret || !signature) return false;
  const a = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("base64")), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
