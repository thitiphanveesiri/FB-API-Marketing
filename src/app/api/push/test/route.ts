import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { notifyUsers, pushConfigured } from "@/lib/push";

export async function POST(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  if (!pushConfigured()) return fail(503, "ยังไม่ได้ตั้งค่าการแจ้งเตือนบนเซิร์ฟเวอร์");
  const r = await notifyUsers([g.me.id], { title: "ทดสอบการแจ้งเตือน", body: "ถ้าเห็นข้อความนี้ แสดงว่าเครื่องนี้พร้อมรับแจ้งเตือนแล้ว", url: "/inbox", tag: "test" });
  return NextResponse.json({ ok: r.sent > 0, ...r, message: r.sent ? undefined : "ไม่พบอุปกรณ์ที่เปิดแจ้งเตือนไว้ — กด “เปิดแจ้งเตือน” บนเครื่องนี้ก่อน" }, noStore);
}
