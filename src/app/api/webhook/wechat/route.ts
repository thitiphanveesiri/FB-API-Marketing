import { after, connection, NextResponse } from "next/server";
import { loadChannels } from "@/lib/channels";
import { buildExternalWrites, writeExternalWrites } from "@/lib/externalWebhook";
import { readTabs } from "@/lib/googleSheets";
import { notifyInboundFresh } from "@/lib/push";
import { getCached, invalidateCache, setCached } from "@/lib/sheetCache";
import { mapSheets } from "@/lib/sheetMapper";
import { readBoundedText } from "@/lib/webhookRequest";
import { parseWeChatEvents, wechatSignatureOk } from "@/lib/wechatWebhook";

export const maxDuration = 30;
const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

// Channel mapping: verifyToken = the "Token" typed into WeChat's server settings; accountId = AppID; accessToken = AppSecret.
const wechatChannels = async () => (await loadChannels()).filter((c) => c.channel === "wechat" && c.active && c.verifyToken && c.accessToken && c.sheetPageId);

/** WeChat "server address" check: it sends signature/timestamp/nonce/echostr and expects echostr back when the token matches. */
export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams, echo = q.get("echostr") ?? "";
  let list; try { list = await wechatChannels(); } catch { return text("error", 500); }
  return echo && list.some((c) => wechatSignatureOk(c.verifyToken, q.get("timestamp") ?? "", q.get("nonce") ?? "", q.get("signature") ?? "")) ? text(echo, 200) : text("forbidden", 403);
}

export async function POST(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const bounded = await readBoundedText(req);
  if (!bounded.ok) return text("too large", bounded.status);
  let list; try { list = await wechatChannels(); } catch { return text("error", 500); }
  const mine = list.filter((c) => wechatSignatureOk(c.verifyToken, q.get("timestamp") ?? "", q.get("nonce") ?? "", q.get("signature") ?? ""));
  if (!mine.length) return text("invalid signature", 401);
  // encrypted mode (an <Encrypt> body) is not supported: choose "Plain text" in WeChat's message encryption setting
  const found = parseWeChatEvents(bounded.text);
  if (!found.length) return text("success", 200);
  try {
    const mapped = getCached() ?? mapSheets(await readTabs());
    setCached(mapped);
    const known = new Set(Object.values(mapped.dataset.messages).flat().map((m) => m.id));
    let wrote = false;
    for (const ch of mine) {
      const writes = buildExternalWrites(found.map((e) => ({ ...e, accountId: ch.accountId })), { channel: "wechat", sheetPageId: ch.sheetPageId, dataset: mapped.dataset, timezone: process.env.APP_TZ || "Asia/Bangkok", knownMessageIds: known });
      const fresh = await writeExternalWrites(writes, known);
      if (writes.newLeads.length || writes.leadUpdates.length || fresh.length) wrote = true;
      if (fresh.length) after(() => notifyInboundFresh(fresh).catch((e) => console.error("[webhook/wechat] push failed", e instanceof Error ? e.name : "UnknownError")));
    }
    if (wrote) invalidateCache();
    return text("success", 200);
  } catch (e) {
    console.error("[webhook/wechat]", e instanceof Error ? e.name : "UnknownError");
    invalidateCache();
    return text("error", 500);
  }
}
