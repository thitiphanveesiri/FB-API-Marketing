import { LeadStatus, QUALIFIED_QUALITIES, Lead, Role, SALES_STAGES, STATUSES } from "./types";
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
  if (!roleCan.editLeads(role)) return { kind: "blocked", message: "Your role has read-only access to leads." };
  if (to === "Converted" && !roleCan.moveToConverted(role))
    return { kind: "blocked", message: "Only an Administrator or Sales Manager can mark a lead as Converted." };
  if (from === "Converted" && !roleCan.moveToConverted(role))
    return { kind: "blocked", message: "Only an Administrator or Sales Manager can move a lead out of Converted." };
  if (from === "Converted")
    return { kind: "confirm", title: "Reopen converted lead?", message: "This lead is already Converted. Moving it back will reduce conversion counts.", requireReason: true };
  if (SALES_STAGES.includes(to) && !QUALIFIED_QUALITIES.includes(lead.quality))
    return {
      kind: "confirm",
      title: "Lead is not qualified yet",
      message: `"${lead.name}" is graded ${lead.quality}. Moving it into ${to} will upgrade its quality to Qualified. Continue only if the conversation justifies it.`,
      requireReason: true,
    };
  if (to === "Converted" && from !== "Intake")
    return { kind: "confirm", title: "Skip Intake?", message: `This lead is in ${from}. Normally leads pass through Intake before Converted.` };
  const gradeFrom = STATUSES.indexOf(from), gradeTo = STATUSES.indexOf(to);
  if (gradeTo < gradeFrom && gradeTo <= 5 && gradeFrom <= 9)
    return { kind: "confirm", title: "Move lead backwards?", message: `Moving from ${from} to ${to} downgrades this lead.`, requireReason: true };
  return { kind: "ok" };
}
