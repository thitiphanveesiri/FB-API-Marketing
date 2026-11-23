import { connection, NextResponse } from "next/server";
import { lineSignatureOk } from "@/lib/extNotify";

// LINE webhook: when someone adds the Official Account or sends any message, reply with THEIR userId so the admin can paste it into
// the `notify_contacts` sheet tab. Nothing is stored here. Set the webhook URL to https://<your-domain>/api/webhook/line.
export async function POST(req: Request) {
  await connection();
  const raw = await req.text();
  if (!lineSignatureOk(raw, req.headers.get("x-line-signature"))) return NextResponse.json({ ok: false }, { status: 403 });
  let events: { type?: string; replyToken?: string; source?: { userId?: string } }[] = [];
  try { events = JSON.parse(raw).events ?? []; } catch { /* ignore */ }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (token) await Promise.all(events.filter((e) => e.replyToken && e.source?.userId && (e.type === "message" || e.type === "follow")).map((e) =>
    fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken: e.replyToken, messages: [{ type: "text", text: `LINE userId ของคุณ:\n${e.source!.userId}\n\nส่งรหัสนี้ให้แอดมินเพื่อเปิดการแจ้งเตือนผ่าน LINE` }] }),
    }).catch(() => undefined)));
  return NextResponse.json({ ok: true });
}
