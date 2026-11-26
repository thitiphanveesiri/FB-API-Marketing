"use client";
import { useStore } from "./store";
import { checkTransition } from "./transitions";
import { roleCan } from "./queries";
import { statusTh, Lead, LeadQuality, LeadStatus, QUALIFIED_QUALITIES, QUALITIES, SALES_STAGES } from "./types";

/** Guarded lead mutations: permission checks + confirmations + toasts live here, not in the UI. */
export function useLeadActions() {
  const s = useStore();
  return {
    async move(lead: Lead, to: LeadStatus): Promise<boolean> {
      const chk = checkTransition(lead, to, s.user.role);
      if (chk.kind === "blocked") { s.toast(chk.message, "error"); return false; }
      let note: string | undefined;
      if (chk.kind === "confirm") {
        const r = await s.confirm({ title: chk.title, message: chk.message, requireReason: chk.requireReason, confirmLabel: "ย้ายแชท" });
        if (!r.ok) return false;
        note = r.reason;
      }
      s.moveLead(lead.id, to, note);
      s.toast(`ย้าย ${lead.name} ไป “${statusTh(to)}” แล้ว`);
      return true;
    },
    async recover(lead: Lead, to: LeadStatus): Promise<boolean> {
      const chk = checkTransition(lead, to, s.user.role);
      if (chk.kind === "blocked") { s.toast(chk.message, "error"); return false; }
      let note: string | undefined;
      if (chk.kind === "confirm") {
        const r = await s.confirm({ title: chk.title, message: chk.message, requireReason: chk.requireReason, confirmLabel: "นำกลับเข้างาน" });
        if (!r.ok) return false;
        note = r.reason;
      }
      s.recoverLead(lead.id, to, note);
      s.toast(`นำ ${lead.name} กลับไป “${statusTh(to)}” แล้ว`);
      return true;
    },
    async assign(lead: Lead, repId: string | null): Promise<boolean> {
      const claiming = lead.repId == null && repId === s.user.id;
      if (!roleCan.reassign(s.user.role) && !claiming) { s.toast("Only a Sales Manager or Administrator can reassign leads.", "error"); return false; }
      if (lead.repId && repId !== lead.repId) {
        const to = s.data.users.find((u) => u.id === repId)?.name ?? "nobody";
        const r = await s.confirm({ title: "Reassign lead?", message: `Move ${lead.name} from ${s.data.users.find((u) => u.id === lead.repId)?.name} to ${to}?`, confirmLabel: "Reassign" });
        if (!r.ok) return false;
      }
      s.assignLead(lead.id, repId);
      s.toast(repId ? "Lead assigned" : "Lead unassigned");
      return true;
    },
    async quality(lead: Lead, q: LeadQuality): Promise<boolean> {
      if (!roleCan.editLeads(s.user.role)) { s.toast("Your role has read-only access to leads.", "error"); return false; }
      if (q === lead.quality) return true;
      if (SALES_STAGES.includes(lead.status) && !QUALIFIED_QUALITIES.includes(q)) {
        s.toast(`This lead is already in ${lead.status}. Move it back to a quality stage first.`, "error");
        return false;
      }
      let note: string | undefined;
      if (QUALITIES.indexOf(q) < QUALITIES.indexOf(lead.quality)) {
        const r = await s.confirm({ title: "Downgrade lead quality?", message: `${lead.quality} → ${q}. This lowers the qualified lead rate for the source ad.`, requireReason: true, confirmLabel: "Downgrade" });
        if (!r.ok) return false;
        note = `Quality downgraded: ${lead.quality} → ${q}${r.reason ? ` (${r.reason})` : ""}`;
      }
      s.setQuality(lead.id, q, note);
      s.toast(`Quality set to ${q}`);
      return true;
    },
  };
}
