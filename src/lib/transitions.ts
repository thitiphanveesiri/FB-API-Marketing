import { LeadStatus, QUALIFIED_QUALITIES, Lead, Role, SALES_STAGES, STATUSES, statusTh } from "./types";
import { roleCan } from "./queries";

export type TransitionCheck =
  | { kind: "ok" }
  | { kind: "confirm"; title: string; message: string; requireReason?: boolean }
  | { kind: "blocked"; message: string };

/**
 * Stage-transition rules for the Board:
 *  - Converted can only be set / reverted by Administrator or Sales Manager.
 *  - Jumping from an unqualified grade straight into a sales stage is "invalid"
 *    and needs confirmation plus a reason; the lead is then upgraded to Qualified.
 *  - Reaching Converted without passing through Intake needs confirmation.
 *  - Moving backwards (to a lower quality grade) needs confirmation (downgrade).
 */
export function checkTransition(lead: Lead, to: LeadStatus, role: Role): TransitionCheck {
  const from = lead.status;
  if (from === to) return { kind: "ok" };
  if (!roleCan.editLeads(role)) return { kind: "blocked", message: "บทบาทของคุณดูข้อมูลได้อย่างเดียว" };
  if (to === "Converted" && !roleCan.moveToConverted(role))
    return { kind: "blocked", message: "เฉพาะผู้ดูแลระบบหรือ Sales Manager เท่านั้นที่ตั้งสถานะ “ปิดการขายแล้ว” ได้" };
  if (from === "Converted" && !roleCan.moveToConverted(role))
    return { kind: "blocked", message: "เฉพาะผู้ดูแลระบบหรือ Sales Manager เท่านั้นที่ย้ายออกจาก “ปิดการขายแล้ว” ได้" };
  if (from === "Converted")
    return { kind: "confirm", title: "เปิดเคสที่ปิดการขายแล้วอีกครั้ง?", message: "แชทนี้ปิดการขายแล้ว การย้ายกลับจะทำให้ยอดการปิดการขายลดลง", requireReason: true };
  if (SALES_STAGES.includes(to) && !QUALIFIED_QUALITIES.includes(lead.quality))
    return {
      kind: "confirm",
      title: "แชทนี้ยังไม่มีคุณสมบัติ",
      message: `“${lead.name}” อยู่ที่ระดับ ${statusTh(lead.quality)} การย้ายไป ${statusTh(to)} จะปรับเป็น “มีคุณสมบัติ” ทำต่อเมื่อบทสนทนาสมควรเท่านั้น`,
      requireReason: true,
    };
  if (to === "Converted" && from !== "Intake")
    return { kind: "confirm", title: "ข้ามขั้น “รับเข้า”?", message: `แชทนี้อยู่ที่ ${statusTh(from)} ปกติต้องผ่าน “รับเข้า” ก่อนปิดการขาย` };
  const gradeFrom = STATUSES.indexOf(from), gradeTo = STATUSES.indexOf(to);
  if (gradeTo < gradeFrom && gradeTo <= 5 && gradeFrom <= 9)
    return { kind: "confirm", title: "ย้ายแชทถอยหลัง?", message: `การย้ายจาก ${statusTh(from)} ไป ${statusTh(to)} เป็นการลดระดับแชทนี้`, requireReason: true };
  return { kind: "ok" };
}
