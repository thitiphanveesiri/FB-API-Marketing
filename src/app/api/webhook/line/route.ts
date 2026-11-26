import { after, connection, NextResponse } from "next/server";
import { loadChannels } from "@/lib/channels";
import { lineSignatureOk } from "@/lib/extNotify";
import { buildExternalWrites, writeExternalWrites } from "@/lib/externalWebhook";
import { getCached, invalidateCache, setCached } from "@/lib/sheetCache";
import { readTabs } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { notifyInboundFresh } from "@/lib/push";
import { parseLineEvents } from "@/lib/lineWebhook";
import { readBoundedText } from "@/lib/webhookRequest";

export const maxDuration = 30;
const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  await connection();
  const bounded = await readBoundedText(req);
  if (!bounded.ok) return text("too large", bounded.status);
  const raw = bounded.text;
  let channels;
  try { channels = await loadChannels(); }
  catch { return text("error", 500); }
  const signed = channels.filter((channel) => channel.channel === "line" && channel.active && channel.accessToken && channel.appSecret && channel.sheetPageId && lineSignatureOk(raw, req.headers.get("x-line-signature"), channel.appSecret));
  if (signed.length !== 1) return text("invalid signature", 401);

  let payload: Parameters<typeof parseLineEvents>[0];
  try { payload = JSON.parse(raw); } catch { return text("bad json", 400); }
  const channel = signed[0];
  const events = parseLineEvents(payload, channel.accountId);
  if (!events.length) return text("ok", 200);

  try {
    const mapped = getCached() ?? mapSheets(await readTabs());
    setCached(mapped);
    const knownMessageIds = new Set(Object.values(mapped.dataset.messages).flat().map((message) => message.id));
    const writes = buildExternalWrites(events, {
      channel: "line",
      sheetPageId: channel.sheetPageId,
      dataset: mapped.dataset,
      timezone: process.env.APP_TZ || "Asia/Bangkok",
      knownMessageIds,
    });
    const newMessages = await writeExternalWrites(writes, knownMessageIds);
    if (!newMessages.length && !writes.newLeads.length && !writes.leadUpdates.length) return text("ok", 200);
    invalidateCache();
    if (newMessages.length) after(() => notifyInboundFresh(newMessages).catch((error) => {
      console.error("[webhook/line] push delivery failed", error instanceof Error ? error.name : "UnknownError");
    }));
    return text("ok", 200);
  } catch (error) {
    console.error("[webhook/line]", error instanceof Error ? error.name : "UnknownError");
    invalidateCache();
    return text("error", 500);
  }
}
