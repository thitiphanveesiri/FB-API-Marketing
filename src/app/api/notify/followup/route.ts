import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { computeFollowup, SILENT_OPTIONS } from "@/lib/followup";
import { localStamp } from "@/lib/fbSync";
import { notifyAudited, stableNotificationId, pushConfigured } from "@/lib/push";

export async function POST(req: Request) {
  await connection();
  const gate = await userGate(req);
  if ("err" in gate) return gate.err;
  if (gate.me.role !== "Administrator") return fail(403, "เฉพาะผู้ดูแลระบบเท่านั้น");
  if (!pushConfigured()) return fail(503, "ยังไม่ได้ตั้งค่า VAPID และ PUSH_SUBSCRIPTION_SECRET");

  try {
    const body = await req.json() as { leadId?: unknown; silentHours?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
    const silentHours = Number(body.silentHours);
    if (!leadId || leadId.length > 200) return fail(400, "ไม่พบลีดที่ต้องการแจ้ง");
    if (!SILENT_OPTIONS.some((option) => option.hours === silentHours)) return fail(400, "เกณฑ์ติดตามไม่ถูกต้อง");

    const { dataset } = gate.mapped;
    const { me } = gate;
    const lead = dataset.leads.find((item) => item.id === leadId && item.valid && !item.dropped);
    if (!lead) return fail(404, "ไม่พบลีดที่ยังติดตามได้");
    const rep = lead.repId && dataset.users.find((user) => user.id === lead.repId && user.active && user.role === "Sales Representative");
    if (!rep) return fail(409, "ลีดยังไม่ได้มอบหมายให้เซลล์ที่ใช้งานอยู่");

    const now = localStamp(new Date().toISOString(), process.env.APP_TZ || "Asia/Bangkok");
    const candidates = computeFollowup({
      leads: dataset.leads, messages: dataset.messages, pages: dataset.pages,
      start: now.slice(0, 10), end: now.slice(0, 10), now, pageId: "all",
      silentHours, repId: rep.id,
    }).silent;
    if (!candidates.some((candidate) => candidate.lead.id === lead.id)) return fail(409, "ลีดนี้ไม่อยู่ในคิวติดตามปัจจุบันแล้ว");

    const latest = [...(dataset.messages[lead.id] ?? [])].filter((message) => message.direction !== "note").sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    const stateKey = stableNotificationId("followup-state", lead.id, lead.repId ?? "", lead.status, lead.followUpDate ?? "", latest?.id ?? "", latest?.at ?? "");
    const notificationId = stableNotificationId("followup", lead.id, rep.id, stateKey);
    const result = await notifyAudited({
      notification_id: notificationId, kind: "followup", lead_id: lead.id, state_key: stateKey,
      recipient_id: rep.id, actor_id: me.id,
    }, [rep.id], { title: "มีลีดรอติดตาม", body: "ผู้ดูแลระบบขอให้ติดตามลูกค้า เปิดแอปเพื่อดู", url: "/followup", tag: `followup-${lead.id}` });

    if (result.status === "duplicate") {
      if (result.detail === "pending") return fail(409, "กำลังส่งการแจ้งเตือนนี้อยู่");
      return NextResponse.json({ ok: true, sent: 0, duplicate: true, message: "แจ้งเซลล์แล้วสำหรับสถานะติดตามนี้" }, noStore);
    }
    if (result.status === "failed") return fail(502, result.detail === "no_active_subscription" ? "เซลล์ยังไม่ได้เปิดรับ Push บนอุปกรณ์" : "ส่งการแจ้งเตือนไม่สำเร็จ", { status: result.status });
    return NextResponse.json({ ok: true, sent: result.sent, duplicate: false }, noStore);
  } catch (error) {
    console.error("[api/notify/followup]", error instanceof Error ? error.name : "UnknownError");
    return fail(502, "บันทึกหรือส่งการแจ้งเตือนไม่สำเร็จ");
  }
}
