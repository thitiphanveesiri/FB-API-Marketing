"use client";
import { useState } from "react";
import { CalendarClock, Phone, Mail, StickyNote, History } from "lucide-react";
import { useStore } from "@/lib/store";
import { useLeadActions } from "@/lib/useLeadActions";
import { Facebook, Avatar, Badge, Btn, Drawer, Select, StatusBadge, TextArea, TextInput, hueOf } from "./ui";
import { LeadQuality, LeadStatus, QUALITIES, STATUSES, statusTh } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { roleCan } from "@/lib/queries";

export function ConversationView({ leadId, height = 260 }: { leadId: string; height?: number }) {
  const { data } = useStore();
  const msgs = data.messages[leadId] ?? [];
  return (
    <div>
      <p className="mb-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">Messages come from your Google Sheet — not a live Messenger connection.</p>
      <div className="space-y-2 overflow-y-auto rounded-xl bg-gray-50 p-3" style={{ maxHeight: height }}>
        {msgs.length === 0 && <p className="py-6 text-center text-sm text-muted">No messages recorded for this lead.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={m.direction === "out" ? "flex justify-end" : "flex"}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${m.direction === "out" ? "bg-brand text-white" : m.direction === "note" ? "border border-amber-200 bg-amber-50 text-amber-900" : "border border-line bg-surface"}`}>
              {m.direction === "note" && <b className="mr-1 text-[10px] uppercase">Internal note</b>}
              {m.text}
              {m.attachment && <div className="mt-1 rounded bg-black/10 px-1.5 py-0.5 text-xs">📎 {m.attachment.name}</div>}
              <div className={`mt-0.5 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-gray-400"}`}>{fmtDateTime(m.at)}{m.direction === "out" && m.senderType === "automated" ? " · ตอบอัตโนมัติ" : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LeadDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data, user, patchLead, addNote, toast } = useStore();
  const act = useLeadActions();
  const [note, setNote] = useState("");
  const lead = data.leads.find((l) => l.id === leadId);
  const ad = lead?.adId ? data.ads.find((a) => a.id === lead.adId) : null;
  const page = lead ? data.pages.find((p) => p.id === lead.pageId) : null;
  const canEdit = roleCan.editLeads(user.role);
  const reps = data.users.filter((u) => u.role === "Sales Representative" && u.active);

  return (
    <Drawer open={!!lead} onClose={onClose} title={lead ? <span className="flex items-center gap-2"><Avatar name={lead.name} hue={hueOf(lead.name)} size={28} />{lead.name}</span> : ""} width={600}>
      {lead && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="gray">{lead.id}</Badge><StatusBadge status={lead.status} />
            {lead.dropped && <Badge tone="red">Dropped · {lead.dropped.reason}</Badge>}
            {!lead.valid && <Badge tone="amber">Excluded: invalid lead</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs text-muted">Source Ad</dt><dd>{ad ? `${ad.id} · ${ad.name}` : "Unattributed"}</dd></div>
            <div><dt className="text-xs text-muted">Facebook Page</dt><dd className="flex items-center gap-1"><Facebook size={13} className="text-[#1877f2]" />{page?.name}</dd></div>
            <div><dt className="text-xs text-muted">Phone</dt><dd className="flex items-center gap-1"><Phone size={13} />{lead.phone || "—"}</dd></div>
            <div><dt className="text-xs text-muted">Email</dt><dd className="flex items-center gap-1 break-all"><Mail size={13} />{lead.email || "—"}</dd></div>
            {lead.phone2 && <div><dt className="text-xs text-muted">Secondary phone</dt><dd>{lead.phone2}</dd></div>}
            {lead.whatsapp && <div><dt className="text-xs text-muted">WhatsApp</dt><dd>{lead.whatsapp}</dd></div>}
            {lead.leadSource && <div><dt className="text-xs text-muted">Source</dt><dd>{lead.leadSource}</dd></div>}
            {lead.form && <div><dt className="text-xs text-muted">Form</dt><dd>{lead.form}</dd></div>}
            <div><dt className="text-xs text-muted">Created</dt><dd>{fmtDate(lead.createdAt)}</dd></div>
            <div><dt className="text-xs text-muted">Last contact</dt><dd>{fmtDateTime(lead.lastContactAt)}</dd></div>
            {lead.labels && <div className="col-span-2"><dt className="text-xs text-muted">Labels</dt><dd className="text-xs">{lead.labels}</dd></div>}
          </dl>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
            <Select label="Stage" value={lead.status} disabled={!canEdit} onChange={(v) => act.move(lead, v as LeadStatus)} options={STATUSES.map((s) => ({ value: s, label: statusTh(s) }))} />
            <Select label="Lead quality" value={lead.quality} disabled={!canEdit} onChange={(v) => act.quality(lead, v as LeadQuality)} options={QUALITIES.map((s) => ({ value: s, label: s }))} />
            <Select label="Assigned to" value={lead.repId ?? ""} disabled={!canEdit} onChange={(v) => act.assign(lead, v || null)} options={[{ value: "", label: "Unassigned" }, ...reps.map((r) => ({ value: r.id, label: r.name }))]} />
            <TextInput label="Follow-up reminder" type="date" disabled={!canEdit} value={lead.followUpDate ?? ""} onChange={(e) => { patchLead(lead.id, { followUpDate: e.target.value || null }); toast(e.target.value ? `Reminder set for ${fmtDate(e.target.value)}` : "Reminder cleared"); }} />
          </div>
          {lead.followUpDate && <p className="-mt-3 flex items-center gap-1 text-xs text-muted"><CalendarClock size={13} /> Follow up on {fmtDate(lead.followUpDate)}</p>}

          <div>
            <h4 className="mb-1.5 text-sm font-semibold">Conversation</h4>
            <ConversationView leadId={lead.id} />
          </div>

          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><StickyNote size={15} /> Internal notes</h4>
            <ul className="mb-2 space-y-1.5">
              {lead.notes.length === 0 && <li className="text-sm text-muted">No notes yet.</li>}
              {lead.notes.map((n, i) => <li key={i} className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm"><span className="text-xs text-amber-700">{n.by} · {fmtDateTime(n.at)}</span><br />{n.text}</li>)}
            </ul>
            {canEdit && (
              <div className="flex gap-2">
                <TextArea className="flex-1" rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
                <Btn variant="primary" className="self-end" disabled={!note.trim()} onClick={() => { addNote(lead.id, note.trim()); setNote(""); toast("Note added"); }}>Add</Btn>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><History size={15} /> Activity history</h4>
            <ol className="space-y-2 border-l-2 border-brand-soft pl-4">
              {[...lead.history].reverse().map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-2" />
                  <span className="font-medium">{h.from && h.from !== h.to ? `${h.from} → ${h.to}` : h.to}</span>
                  <span className="text-xs text-muted"> · {h.by} · {fmtDateTime(h.at)}</span>
                  {h.note && <p className="text-xs text-muted">{h.note}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Drawer>
  );
}
