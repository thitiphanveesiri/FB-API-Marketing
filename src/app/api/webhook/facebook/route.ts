import { connection, NextResponse } from "next/server";
import { defaultVerifyToken, loadChannels } from "@/lib/channels";
import { ensureSystemPage } from "@/lib/autoPage";
import { buildWrites, parseEvents, signatureOk } from "@/lib/fbWebhook";
import { getCached, invalidateCache, setCached } from "@/lib/sheetCache";
import { readTabs } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { upsertRows } from "@/lib/sheetsWrite";
import { notifyInbound } from "@/lib/push";

// PUBLIC endpoint (Meta calls it). It is excluded from the login gate in src/proxy.ts; every request is authenticated by Meta's signature instead.
export const maxDuration = 30;
const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

/** Meta's set-up handshake: echo hub.challenge only when hub.verify_token matches a connected channel. */
export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") !== "subscribe") return text("bad request", 400);
  const t = q.get("hub.verify_token") ?? "", def = defaultVerifyToken();
  if (t && def && t === def) return text(q.get("hub.challenge") ?? "", 200); // works before any page is connected
  const ch = (await loadChannels(true).catch(() => [])).filter((c) => c.channel === "facebook" && c.active && c.verifyToken);
  if (t && ch.some((c) => c.verifyToken === t)) return text(q.get("hub.challenge") ?? "", 200);
  return text("forbidden", 403);
}

export async function POST(req: Request) {
  await connection();
  const raw = await req.text();
  if (raw.length > 1_000_000) return text("too large", 413);
  const sig = req.headers.get("x-hub-signature-256");
  const channels = (await loadChannels().catch(() => [])).filter((c) => c.channel === "facebook" && c.active && c.accessToken);
  const signed = channels.filter((c) => signatureOk(raw, sig, c.appSecret));
  if (!signed.length) return text("invalid signature", 401);
  let body; try { body = JSON.parse(raw); } catch { return text("bad json", 400); }
  const events = parseEvents(body);
  if (!events.length) return text("ok", 200);
  try {
    const mapped = getCached() ?? mapSheets(await readTabs()); setCached(mapped);
    const knownMessageIds = new Set(Object.values(mapped.dataset.messages).flat().map((m) => m.id));
    const tz = process.env.APP_TZ || "Asia/Bangkok", base = process.env.FB_GRAPH_BASE || "https://graph.facebook.com";
    let wrote = false;
    for (const ch of signed) {
      const mine = events.filter((e) => e.pageId === ch.accountId); if (!mine.length) continue;
      const nameOf = async (psid: string) => {
        const r = await fetch(`${base}/v21.0/${psid}?${new URLSearchParams({ fields: "name", access_token: ch.accessToken })}`, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { name?: string }; return r.ok ? j.name ?? "" : "";
      };
      const sheetPageId = mapped.dataset.pages.some((page) => page.id === ch.sheetPageId)
        ? ch.sheetPageId
        : (await ensureSystemPage({ pages: mapped.dataset.pages, channels, fbPageId: ch.accountId, name: ch.name })).id;
      const w = await buildWrites(mine, { ...ch, sheetPageId }, mapped.dataset, tz, nameOf);
      const newMessages = w.messages.filter((m) => {
        const id = String(m.message_id ?? "");
        if (!id || knownMessageIds.has(id)) return false;
        knownMessageIds.add(id);
        return true;
      });
      if (w.newLeads.length) await upsertRows("leads", ["lead_id"], w.newLeads, "insert");
      if (w.messages.length) await upsertRows("messages", ["message_id"], w.messages, "insert");
      if (w.leadUpdates.length) await upsertRows("leads", ["lead_id"], w.leadUpdates, "updateOnly");
      wrote = true;
      // phone alerts must never make Meta retry the webhook: errors are swallowed and the wait is capped
      await Promise.race([notifyInbound(mapped.dataset, newMessages as { message_id: string; lead_id: string; direction: string; text: string }[]).catch((e) => {
        console.error("[webhook/facebook] push delivery failed", e instanceof Error ? e.name : "UnknownError");
      }), new Promise((r) => setTimeout(r, 8000))]);
    }
    if (wrote) invalidateCache();
    return text("ok", 200);
  } catch (e) {
    console.error("[webhook/facebook]", e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…") : "error");
    invalidateCache(); return text("error", 500); // Meta retries; message_id keys make a retry harmless
  }
}
