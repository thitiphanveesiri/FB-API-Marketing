import { connection, NextResponse } from "next/server";
import { shapeOf, tiktokSignatureOk } from "@/lib/tiktokWebhook";
import { readBoundedText } from "@/lib/webhookRequest";

export const maxDuration = 10;
const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

/**
 * TikTok webhook receiver. Needs TIKTOK_CLIENT_SECRET (the app's client secret). Verifies TikTok-Signature, then only logs the SHAPE of the
 * event (field names and types, no values). TikTok's message payload is not documented publicly without an approved app, so messages are
 * not saved to chats yet: once the first real event's shape is in the logs, add a parser here the way wechatWebhook.ts does.
 */
export async function POST(req: Request) {
  await connection();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!secret) return text("not configured", 503);
  const bounded = await readBoundedText(req);
  if (!bounded.ok) return text("too large", bounded.status);
  if (!tiktokSignatureOk(bounded.text, req.headers.get("tiktok-signature") ?? "", secret)) return text("invalid signature", 401);
  try { console.log("[webhook/tiktok] event shape", JSON.stringify(shapeOf(JSON.parse(bounded.text))).slice(0, 1500)); } catch { console.log("[webhook/tiktok] non-JSON body"); }
  return text("ok", 200);
}
