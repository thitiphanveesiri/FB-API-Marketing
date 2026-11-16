import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { pushConfigured, removeSub, saveSub, vapidPublicKey, type SubInput } from "@/lib/push";

/** Any signed-in user: register / remove THIS device for alerts (only for their own account). */
export async function GET(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  return NextResponse.json({ ok: true, configured: pushConfigured(), publicKey: vapidPublicKey() }, noStore);
}
export async function POST(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  if (!pushConfigured()) return fail(503, "ยังไม่ได้ตั้งค่าการแจ้งเตือนบนเซิร์ฟเวอร์ (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  try { const b = (await req.json()) as { subscription?: SubInput }; if (!b.subscription) return fail(400, "ไม่พบข้อมูลการสมัครรับแจ้งเตือน"); await saveSub(g.me.id, b.subscription); return NextResponse.json({ ok: true }, noStore); }
  catch (e) { return fail(400, e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); }
}
export async function DELETE(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (b.endpoint) await removeSub(g.me.id, b.endpoint).catch(() => {});
  return NextResponse.json({ ok: true }, noStore);
}
