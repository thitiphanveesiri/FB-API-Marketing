import { createHmac, timingSafeEqual } from "node:crypto";
import { connection, NextResponse } from "next/server";

// WhatsApp Cloud API webhook — PREPARED, NOT CONNECTED. It completes Meta's handshake and acknowledges signed deliveries, but does not
// store messages yet. Set WHATSAPP_VERIFY_TOKEN (any secret string) and, for signature checking, WHATSAPP_APP_SECRET on the server.
export const maxDuration = 30;
const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

function whatsappSignatureOk(raw: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams, token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (q.get("hub.mode") !== "subscribe") return text("bad request", 400);
  if (token && q.get("hub.verify_token") === token) return text(q.get("hub.challenge") ?? "", 200);
  return text("forbidden", 403);
}

export async function POST(req: Request) {
  await connection();
  const raw = await req.text();
  if (raw.length > 1_000_000) return text("too large", 413);
  if (!whatsappSignatureOk(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) return text("invalid signature", 401);
  return text("ok", 200); // acknowledged only; inbound WhatsApp messages are not ingested yet
}
