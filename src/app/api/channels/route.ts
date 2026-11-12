import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { invalidateCache } from "@/lib/sheetCache";
import { loadChannels, newVerifyToken, saveChannel, toPublic } from "@/lib/channels";
import { upsertRows } from "@/lib/sheetsWrite";

export const maxDuration = 30;
const GRAPH = () => `${process.env.FB_GRAPH_BASE || "https://graph.facebook.com"}/v21.0`;
const scrub = (s: string) => s.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…");
const origin = (req: Request) => process.env.APP_URL?.replace(/\/$/, "") || new URL(req.url).origin;

/** Admin only. Never returns tokens or secrets — only whether they are set and the last 4 characters of the token. */
export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  try {
    const list = (await loadChannels(true)).map(toPublic);
    return NextResponse.json({ ok: true, channels: list, webhookUrls: { facebook: `${origin(req)}/api/webhook/facebook` } }, noStore);
  } catch { return fail(502, "อ่านการตั้งค่าช่องทางจาก Google Sheet ไม่สำเร็จ"); }
}

interface Body { action?: "save" | "disconnect"; channel?: string; channelId?: string; accessToken?: string; appSecret?: string; sheetPageId?: string }

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as Body;
    if (b.channel && b.channel !== "facebook") return fail(400, "ช่องทางนี้ยังไม่เปิดให้ใช้ (ตอนนี้รองรับเฉพาะ Facebook Messenger)");
    const all = await loadChannels(true);

    if (b.action === "disconnect") {
      const c = all.find((x) => x.channelId === b.channelId); if (!c) return fail(404, "ไม่พบการเชื่อมต่อนี้");
      await upsertRows("channels", ["channel_id"], [{ channel_id: c.channelId, active: false, access_token: "", app_secret: "", updated_at: new Date().toISOString() }], "upsert");
      invalidateCache(); return NextResponse.json({ ok: true }, noStore);
    }

    const sheetPageId = (b.sheetPageId ?? "").trim();
    if (!sheetPageId || !g.mapped.dataset.pages.some((p) => p.id === sheetPageId)) return fail(400, "เลือกเพจในระบบที่จะเก็บแชทก่อน");
    const token = (b.accessToken ?? "").trim(), secret = (b.appSecret ?? "").trim();
    if (token && !/^[\w-]{20,400}$/.test(token)) return fail(400, "รูปแบบ Access Token ไม่ถูกต้อง (คัดลอกมาทั้งสตริง ไม่มีช่องว่าง)");
    if (secret && !/^[\w-]{8,100}$/.test(secret)) return fail(400, "รูปแบบ App Secret ไม่ถูกต้อง");

    let existing = all.find((x) => x.channelId === b.channelId);
    let accountId = existing?.accountId ?? "", name = existing?.name ?? "", subscribed: boolean | null = null, subscribeMessage = "";
    if (token) {
      // ask Meta which page this token belongs to — catches user tokens and typos before anything is saved
      const r = await fetch(`${GRAPH()}/me?${new URLSearchParams({ fields: "id,name,category", access_token: token })}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { id?: string; name?: string; category?: string; error?: { message?: string } };
      if (!r.ok || j.error) return fail(400, `Meta ไม่ยอมรับโทเคนนี้: ${scrub(j.error?.message ?? `HTTP ${r.status}`)}`);
      if (!j.id || !j.category) return fail(400, `โทเคนนี้เป็นของผู้ใช้${j.name ? ` (${j.name})` : ""} ไม่ใช่ของเพจ — ใน Graph API Explorer เลือก "Get Page Access Token" แล้วเลือกเพจ จากนั้นคัดลอกโทเคนใหม่`);
      accountId = j.id; name = j.name ?? ""; existing = all.find((x) => x.channelId === `facebook:${accountId}`) ?? existing;
      // subscribe the page to this app's webhook (needs the token to have pages_messaging)
      try {
        const s = await fetch(`${GRAPH()}/${accountId}/subscribed_apps`, { method: "POST", cache: "no-store", body: new URLSearchParams({ subscribed_fields: "messages,message_echoes", access_token: token }) });
        const sj = (await s.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
        subscribed = s.ok && sj.success === true; if (!subscribed) subscribeMessage = scrub(sj.error?.message ?? `HTTP ${s.status}`);
      } catch { subscribed = false; subscribeMessage = "เชื่อมต่อ Meta ไม่สำเร็จ"; }
    }
    if (!accountId) return fail(400, "วาง Page Access Token ก่อน");
    const channelId = `facebook:${accountId}`;
    if (!secret && !existing?.appSecret) return fail(400, "ใส่ App Secret ด้วย (Meta App → Settings → Basic) — ใช้ตรวจว่าข้อความมาจาก Meta จริง");
    await saveChannel({ channelId, channel: "facebook", accountId, name, accessToken: token, appSecret: secret, verifyToken: existing?.verifyToken || newVerifyToken(), sheetPageId, active: true });
    invalidateCache();
    return NextResponse.json({ ok: true, channelId, name, subscribed, subscribeMessage }, noStore);
  } catch (e) {
    console.error("[api/channels]", e instanceof Error ? scrub(e.message) : "error");
    return fail(502, "บันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}
