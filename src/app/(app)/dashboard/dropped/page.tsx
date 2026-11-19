"use client";
import { useMemo, useState } from "react";
import { useDash } from "@/lib/useDash";
import { useStore } from "@/lib/store";
import { useLeadActions } from "@/lib/useLeadActions";
import { roleCan } from "@/lib/queries";
import { fmtInt, fmtPct } from "@/lib/metrics";
import { Badge, Btn, Card, Column, DataTable, Drawer, KpiCard, Modal, Select, Skeleton, TextInput, useBrief } from "@/components/ui";
import { ConversationView } from "@/components/LeadDrawer";
import { DROP_REASONS, Lead, LeadStatus, RecoveryStatus, STATUSES } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/dates";

const REC_TONE: Record<RecoveryStatus, "gray" | "amber" | "green" | "red"> = { "Not Started": "gray", "In Progress": "amber", Recovered: "green", Lost: "red" };

export default function Dropped() {
  const D = useDash();
  const { data, user, recoverLead, setRecovery, toast } = useStore();
  const act = useLeadActions();
  const loading = useBrief();
  const [rep, setRep] = useState("all");
  const [reason, setReason] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<string | null>(null);
  const [reassign, setReassign] = useState<Lead | null>(null);
  const [recover, setRecover] = useState<Lead | null>(null);
  const [recStage, setRecStage] = useState<LeadStatus>("Average");
  const [newRep, setNewRep] = useState("");

  const dropped = useMemo(() => D.leads.filter((l) => l.dropped), [D.leads]);
  const rows = dropped.filter((l) => (rep === "all" || (rep === "none" ? !l.repId : l.repId === rep)) && (reason === "all" || l.dropped!.reason === reason) && (!from || l.lastContactAt.slice(0, 10) >= from) && (!to || l.lastContactAt.slice(0, 10) <= to));
  const nameOf = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "Unassigned";
  const pageOf = (id: string) => data.pages.find((p) => p.id === id)?.name ?? id;
  const reps = data.users.filter((u) => u.role === "Sales Representative" && u.active);
  const canAct = roleCan.editLeads(user.role);

  const noResp = dropped.filter((l) => l.dropped!.reason === "No Response").length;
  const noFollow = dropped.filter((l) => l.dropped!.reason === "No Follow-up" || (l.followUps === 0 && l.firstResponseMin != null)).length;
  const rejected = dropped.filter((l) => l.dropped!.reason === "Rejected After Qualification").length;
  const lost = dropped.filter((l) => l.dropped!.recovery !== "Recovered" && ["Qualified", "Appointment Booked", "Connection Created", "In-Process", "Intake", "New"].includes(l.dropped!.previousStatus)).length;
  const validAll = D.leads.filter((l) => l.valid).length;

  const cols: Column<Lead>[] = [
    { key: "id", header: "Lead ID", sort: (l) => l.id, render: (l) => <span className="font-medium text-brand">{l.id}</span> },
    { key: "n", header: "Customer Name", sort: (l) => l.name, render: (l) => l.name, minW: 150 },
    { key: "p", header: "Page", sort: (l) => pageOf(l.pageId), render: (l) => <span className="whitespace-nowrap">{pageOf(l.pageId)}</span> },
    { key: "a", header: "Ad ID", sort: (l) => l.adId, render: (l) => l.adId ?? <span className="text-gray-400">—</span> },
    { key: "r", header: "Assigned Salesperson", sort: (l) => nameOf(l.repId), render: (l) => nameOf(l.repId) },
    { key: "lc", header: "Last Contact", sort: (l) => l.lastContactAt, render: (l) => <span className="whitespace-nowrap">{fmtDate(l.lastContactAt)}</span> },
    { key: "ps", header: "Previous Lead Status", sort: (l) => l.dropped!.previousStatus, render: (l) => <Badge>{l.dropped!.previousStatus}</Badge> },
    { key: "dr", header: "Drop Reason", sort: (l) => l.dropped!.reason, render: (l) => <Badge tone="red">{l.dropped!.reason}</Badge> },
    { key: "la", header: "Last Activity", render: (l) => <span className="text-muted">{l.dropped!.lastActivity}</span>, minW: 170 },
    { key: "rc", header: "Recovery Status", sort: (l) => l.dropped!.recovery, render: (l) => <Badge tone={REC_TONE[l.dropped!.recovery]}>{l.dropped!.recovery}</Badge> },
    { key: "ac", header: "Actions", render: (l) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Btn size="sm" onClick={() => setView(l.id)}>Chat</Btn>
        {canAct && <Btn size="sm" onClick={() => { setNewRep(l.repId ?? ""); setReassign(l); }} disabled={!roleCan.reassign(user.role)} title={roleCan.reassign(user.role) ? "" : "Managers only"}>Reassign</Btn>}
        {canAct && <Btn size="sm" variant="primary" onClick={() => { setRecStage("Average"); setRecover(l); }}>Recover</Btn>}
      </div>) },
  ];

  if (loading) return <Skeleton className="h-96" />;
  const viewLead = data.leads.find((l) => l.id === view);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Dropped Leads" value={fmtInt(dropped.length)} />
        <KpiCard label="Dropped Lead Rate" value={fmtPct(validAll ? (dropped.length / validAll) * 100 : null)} tip="Dropped ÷ valid leads created in range" />
        <KpiCard label="Lost Opportunities" value={fmtInt(lost)} tip="Dropped leads that had reached at least Qualified and were not recovered" />
        <KpiCard label="Leads Without Follow-up" value={fmtInt(noFollow)} />
        <KpiCard label="Leads With No Response" value={fmtInt(noResp)} />
        <KpiCard label="Rejected After Qualification" value={fmtInt(rejected)} />
      </div>
      <Card title="Dropped leads" subtitle="Customers who stopped progressing. Recover them into the right stage or hand them to another salesperson.">
        <DataTable columns={cols} rows={rows} rowKey={(l) => l.id} searchText={(l) => `${l.name} ${l.id} ${l.adId ?? ""}`} searchPlaceholder="Search customer or Lead ID…" defaultSort={{ key: "lc", dir: "desc" }} onRowClick={(l) => setView(l.id)} caption="Dropped leads" emptyTitle="No dropped leads" emptyHint="Nothing matches these filters."
          toolbar={<div className="flex flex-wrap items-end gap-2">
            <Select value={rep} onChange={setRep} options={[{ value: "all", label: "All salespeople" }, { value: "none", label: "Unassigned" }, ...reps.map((r) => ({ value: r.id, label: r.name }))]} />
            <Select value={reason} onChange={setReason} options={[{ value: "all", label: "All reasons" }, ...DROP_REASONS.map((r) => ({ value: r, label: r }))]} />
            <TextInput type="date" aria-label="Last contact from" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            <TextInput type="date" aria-label="Last contact to" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
          </div>} />
      </Card>

      <Drawer open={!!viewLead} onClose={() => setView(null)} title={viewLead ? `${viewLead.name} · ${viewLead.id}` : ""}>
        {viewLead && <div className="space-y-3"><div className="flex items-center gap-2"><Badge tone="red">{viewLead.dropped?.reason}</Badge><label className="ml-auto text-xs text-muted">Recovery status
          <select className="ml-2 h-8 rounded-lg border border-line text-sm" value={viewLead.dropped?.recovery} disabled={!canAct} onChange={(e) => { setRecovery(viewLead.id, e.target.value as RecoveryStatus); toast("Recovery status updated"); }}>{(["Not Started", "In Progress", "Recovered", "Lost"] as RecoveryStatus[]).map((s) => <option key={s}>{s}</option>)}</select></label></div>
          <ConversationView leadId={viewLead.id} height={380} /><p className="text-xs text-muted">Dropped {fmtDateTime(viewLead.dropped?.at)}</p></div>}
      </Drawer>

      <Modal open={!!reassign} onClose={() => setReassign(null)} title="Reassign lead" footer={<><Btn onClick={() => setReassign(null)}>Cancel</Btn><Btn variant="primary" disabled={!reassign || newRep === (reassign.repId ?? "")} onClick={async () => { if (reassign && await act.assign(reassign, newRep || null)) setReassign(null); }}>Reassign</Btn></>}>
        <Select label={`New owner for ${reassign?.name ?? ""}`} value={newRep} onChange={setNewRep} options={[{ value: "", label: "Unassigned" }, ...reps.map((r) => ({ value: r.id, label: r.name }))]} />
      </Modal>
      <Modal open={!!recover} onClose={() => setRecover(null)} title="Recover lead" footer={<><Btn onClick={() => setRecover(null)}>Cancel</Btn><Btn variant="primary" onClick={() => { if (recover) { recoverLead(recover.id, recStage); toast(`${recover.name} moved back to ${recStage}`); setRecover(null); } }}>Move to pipeline</Btn></>}>
        <p className="mb-3 text-sm text-muted">Previously <b>{recover?.dropped?.previousStatus}</b>. Choose the stage this lead should re-enter.</p>
        <Select label="Pipeline stage" value={recStage} onChange={(v) => setRecStage(v as LeadStatus)} options={STATUSES.filter((s) => s !== "Converted").map((s) => ({ value: s, label: s }))} />
      </Modal>
    </div>
  );
}
