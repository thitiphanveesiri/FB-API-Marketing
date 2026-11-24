import { after, connection, NextResponse } from "next/server";
import { loadChannels } from "@/lib/channels";
import { buildExternalWrites, dedupeExternalEvents, writeExternalWrites } from "@/lib/externalWebhook";
import { getCached, invalidateCache, setCached } from "@/lib/sheetCache";
import { readTabs } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { notifyInbound } from "@/lib/push";
import { parseWhatsAppEvents, whatsappSignatureOk } from "@/lib/whatsappWebhook";

export const maxDuration = 30;
const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  await connection();
  const query = new URL(req.url).searchParams;
  if (query.get("hub.mode") !== "subscribe") return text("bad request", 400);
  const token = query.get("hub.verify_token") ?? "";
  if (token && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) return text(query.get("hub.challenge") ?? "", 200);
  let channels;
  try { channels = await loadChannels(); }
  catch { return text("error", 500); }
  if (token && channels.some((channel) => channel.channel === "whatsapp" && channel.active && channel.verifyToken && channel.verifyToken === token)) return text(query.get("hub.challenge") ?? "", 200);
  return text("forbidden", 403);
}

export async function POST(req: Request) {
  await connection();
  const raw = await req.text();
  if (raw.length > 1_000_000) return text("too large", 413);
  let channels;
  try { channels = await loadChannels(); }
  catch { return text("error", 500); }
  const signed = channels.filter((channel) => channel.channel === "whatsapp" && channel.active && channel.accessToken && channel.appSecret && channel.sheetPageId && whatsappSignatureOk(raw, req.headers.get("x-hub-signature-256"), channel.appSecret));
  if (!signed.length) return text("invalid signature", 401);

  let payload: Parameters<typeof parseWhatsAppEvents>[0];
  try { payload = JSON.parse(raw); } catch { return text("bad json", 400); }
  const events = parseWhatsAppEvents(payload);
  if (!events.length) return text("ok", 200);

  try {
    const mapped = getCached() ?? mapSheets(await readTabs());
    setCached(mapped);
    const knownMessageIds = new Set(Object.values(mapped.dataset.messages).flat().map((message) => message.id));
    let wrote = false;
    for (const channel of signed) {
      const mine = dedupeExternalEvents(events.filter((event) => event.accountId === channel.accountId), knownMessageIds);
      if (!mine.length) continue;
      const writes = buildExternalWrites(mine, {
        channel: "whatsapp",
        sheetPageId: channel.sheetPageId,
        dataset: mapped.dataset,
        timezone: process.env.APP_TZ || "Asia/Bangkok",
      });
      const newMessages = await writeExternalWrites(writes, knownMessageIds);
      if (!newMessages.length) continue;
      wrote = true;
      after(() => notifyInbound(mapped.dataset, newMessages).catch((error) => {
        console.error("[webhook/whatsapp] push delivery failed", error instanceof Error ? error.name : "UnknownError");
      }));
    }
    if (wrote) invalidateCache();
    return text("ok", 200);
  } catch (error) {
    console.error("[webhook/whatsapp]", error instanceof Error ? error.name : "UnknownError");
    invalidateCache();
    return text("error", 500);
  }
}
