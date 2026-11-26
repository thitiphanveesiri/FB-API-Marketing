import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { pushConfigured, removeSub, saveSub, SubscriptionInUseError, vapidPublicKey, type SubInput } from "@/lib/push";

/** Any signed-in user: register / remove THIS device for alerts (only for their own account). */
export async function GET(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  return NextResponse.json({ ok: true, configured: pushConfigured(), publicKey: vapidPublicKey() }, noStore);
}
export async function POST(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  if (!pushConfigured()) return fail(503, "ยังไม่ได้ตั้งค่า VAPID และ PUSH_SUBSCRIPTION_SECRET");
  let b: { subscription?: SubInput; takeover?: unknown };
  try { b = await req.json() as { subscription?: SubInput; takeover?: unknown }; }
  catch { return fail(400, "ข้อมูลการสมัครรับแจ้งเตือนไม่ถูกต้อง"); }
  if (!b.subscription) return fail(400, "ไม่พบข้อมูลการสมัครรับแจ้งเตือน");
  if (b.takeover != null && typeof b.takeover !== "boolean") return fail(400, "takeover ต้องเป็น true หรือ false");
  try { await saveSub(g.me.id, b.subscription, { takeover: b.takeover === true }); return NextResponse.json({ ok: true }, noStore); }
  catch (e) {
    if (e instanceof SubscriptionInUseError) return fail(409, e.message, { code: "subscription_in_use" });
    const message = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
    return fail(message.includes("ไม่ถูกต้อง") ? 400 : 502, message);
  }
}
export async function DELETE(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  let b: { endpoint?: string };
  try { b = await req.json() as { endpoint?: string }; }
  catch { return fail(400, "ข้อมูลการสมัครรับแจ้งเตือนไม่ถูกต้อง"); }
  if (!b.endpoint) return fail(400, "ไม่พบอุปกรณ์ที่ต้องการปิด");
  try { await removeSub(g.me.id, b.endpoint); return NextResponse.json({ ok: true }, noStore); }
  catch (e) { console.error("[api/push/subscribe] removal failed", e instanceof Error ? e.name : "UnknownError"); return fail(502, "ปิดแจ้งเตือนไม่สำเร็จ"); }
}
