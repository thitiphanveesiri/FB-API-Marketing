"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { allLeadsFor, rangeOf, roleCan } from "@/lib/queries";
import { leadStats, fmtPct } from "@/lib/metrics";
import { Btn, Card, Column, DataTable, EmptyState, KpiCard, Modal, Select, STATUS_COLOR, StatusBadge, TextArea, InfoTip } from "@/components/ui";
import { ConversationView } from "@/components/LeadDrawer";
import { ChartCard } from "@/components/charts";
import { Evaluation, Lead, LeadQuality, QUALITIES } from "@/lib/types";
import { fmtDateTime } from "@/lib/dates";

const DEFS: Record<LeadQuality, string> = {
  "Not Responded": "Customer sent a message but no salesperson reply was recorded.",
  "Very Poor": "Replied, but clearly not a fit: no intent, spam, wrong audience or wrong location.",
  Average: "Some interest or questions, but no clear intent or budget yet.",
  Qualified: "Clear need, real intent and fits the target customer. Worth active follow-up.",
  "Appointment Booked": "Qualified and an appointment/visit has been scheduled.",
  "Connection Created": "Qualified and contact details verified; ready to hand over to the sales pipeline.",
};
const CRITERIA = [
  { key: "responsiveness", label: "Responsiveness", hint: "Was the customer answered promptly?" },
  { key: "needIdentified", label: "Need identified", hint: "Did the chat uncover what they want?" },
  { key: "intent", label: "Buying intent", hint: "Did the customer show real intent / budget?" },
  { key: "contactCaptured", label: "Contact captured", hint: "Phone / details confirmed?" },
] as const;

export default function QualityPage() {
  const { data, eff, user, addEvaluation, toast } = useStore();
  const [dim, setDim] = useState<"campaign" | "ad" | "agency" | "rep">("campaign");
  const [target, setTarget] = useState<Lead | null>(null);
  const canEval = roleCan.evaluate(user.role);

  const leads = useMemo(() => allLeadsFor(data, eff, rangeOf(eff)).filter((l) => l.valid), [data, eff]);
  const ls = leadStats(leads);

  const grouped = useMemo(() => {
    const camps = new Map(data.campaigns.map((c) => [c.id, c]));
    const ads = new Map(data.ads.map((a) => [a.id, a]));
    const keyOf = (l: Lead): [string, string] => {
      const ad = l.adId ? ads.get(l.adId) : null; const c = ad ? camps.get(ad.campaignId) : null;
      if (dim === "campaign") return [c?.id ?? "none", c?.name ?? "Unattributed"];
      if (dim === "ad") return [ad?.id ?? "none", ad ? `${ad.id}` : "Unattributed"];
      if (dim === "agency") { const a = data.agencies.find((x) => x.id === c?.agencyId); return [a?.id ?? "none", a?.name.replace(" (Demo)", "") ?? "Unattributed"]; }
      const u = data.users.find((x) => x.id === l.repId); return [u?.id ?? "none", u?.name ?? "Unassigned"];
    };
    const m = new Map<string, { name: string; leads: Lead[] }>();
    for (const l of leads) { const [k, n] = keyOf(l); if (!m.has(k)) m.set(k, { name: n, leads: [] }); m.get(k)!.leads.push(l); }
    return [...m.values()].map((g) => { const s = leadStats(g.leads); return { name: g.name, ...Object.fromEntries(QUALITIES.map((q) => [q, s.byQuality[q]])), total: s.valid, rate: s.qualifiedRate }; })
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)).slice(0, 12);
  }, [data, leads, dim]);

  const pie = QUALITIES.map((q) => ({ name: q, value: ls.byQuality[q] })).filter((p) => p.value > 0);
  const reviewable = leads.filter((l) => !l.dropped).sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt));
  const lastEval = (id: string) => data.evaluations.find((e) => e.leadId === id);
  const nameOf = (id: string) => data.users.find((u) => u.id === id)?.name ?? id;

  const cols: Column<Lead>[] = [
    { key: "id", header: "Lead", sort: (l) => l.id, render: (l) => <div><span className="font-medium">{l.name}</span><span className="block text-xs text-muted">{l.id} · {l.adId ?? "no ad"}</span></div> },
    { key: "q", header: "Quality", sort: (l) => QUALITIES.indexOf(l.quality), render: (l) => <StatusBadge status={l.quality} /> },
    { key: "r", header: "Salesperson", sort: (l) => nameOf(l.repId ?? ""), render: (l) => l.repId ? nameOf(l.repId) : <span className="text-gray-400">Unassigned</span> },
    { key: "e", header: "Last review", render: (l) => { const e = lastEval(l.id); return e ? <span className="text-xs">{nameOf(e.reviewerId)}<br /><span className="text-muted">{fmtDateTime(e.at)}</span></span> : <span className="text-xs text-gray-400">Not reviewed</span>; } },
    { key: "a", header: "", render: (l) => <Btn size="sm" onClick={() => setTarget(l)}>{canEval ? "Review" : "View"}</Btn> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><h1 className="text-xl font-semibold">Quality</h1></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Valid leads" value={String(ls.valid)} sub={ls.total - ls.valid ? `${ls.total - ls.valid} excluded as invalid` : undefined} />
        <KpiCard label="Qualified lead rate" value={fmtPct(ls.qualifiedRate)} tip="Qualified + Appointment Booked + Connection Created ÷ valid leads" />
        <KpiCard label="Not responded" value={String(ls.byQuality["Not Responded"])} sub={fmtPct(ls.valid ? (ls.byQuality["Not Responded"] / ls.valid) * 100 : null) + " of leads"} />
        <KpiCard label="Reviews this session" value={String(data.evaluations.length)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <ChartCard title="Lead quality distribution" subtitle="Filters from the Dashboard (page / agency / etc.) apply">
          <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} isAnimationActive={false}>{pie.map((p) => <Cell key={p.name} fill={STATUS_COLOR[p.name as LeadQuality]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, background: "var(--color-surface)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>
        </ChartCard>
        <ChartCard title="Quality breakdown" subtitle="Share of each grade, sorted by qualified rate" right={<Select value={dim} onChange={(v) => setDim(v as typeof dim)} options={[{ value: "campaign", label: "By campaign" }, { value: "ad", label: "By advertisement" }, { value: "rep", label: "By salesperson" }]} />}>
          <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={grouped} layout="vertical" margin={{ left: 10, right: 10 }} stackOffset="expand">
            <CartesianGrid stroke="var(--color-line)" horizontal={false} /><XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, background: "var(--color-surface)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }} />
            {QUALITIES.map((q) => <Bar key={q} dataKey={q} stackId="a" fill={STATUS_COLOR[q]} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></div>
          <table className="mt-2 w-full text-xs"><tbody>{grouped.slice(0, 6).map((g) => <tr key={g.name} className="border-t border-line"><td className="py-1">{g.name}</td><td className="text-right tabnum">{g.total} leads</td><td className="text-right font-semibold tabnum">{fmtPct(g.rate)} qualified</td></tr>)}</tbody></table>
        </ChartCard>
      </div>

      <Card title="Quality definitions" tip="Used by the Board, Inbox, Ads & Chat and this page so every screen grades leads the same way.">
        <dl className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{QUALITIES.map((q) => <div key={q} className="rounded-xl border border-line p-3"><dt><StatusBadge status={q} /></dt><dd className="mt-1 text-sm text-muted">{DEFS[q]}</dd></div>)}</dl>
      </Card>

      <Card title="Conversation review" subtitle={canEval ? "Open a lead, score the conversation and confirm or change its quality." : "Read-only for your role. Sales Managers and Administrators can evaluate."}>
        <DataTable columns={cols} rows={reviewable} rowKey={(l) => l.id} searchText={(l) => `${l.name} ${l.id} ${l.adId ?? ""}`} searchPlaceholder="Search lead…" defaultSort={{ key: "q", dir: "asc" }} pageSize={8} emptyTitle="No leads to review" caption="Leads available for quality review" />
      </Card>

      <Card title="Evaluation log" subtitle="Who reviewed what, when, and why quality changed.">
        {data.evaluations.length === 0 ? <EmptyState title="No evaluations yet" hint="Reviews you submit appear here." /> : (
          <ul className="divide-y divide-line text-sm">{data.evaluations.slice(0, 20).map((e: Evaluation) => (
            <li key={e.id} className="py-2"><b>{data.leads.find((l) => l.id === e.leadId)?.name}</b> <span className="text-muted">({e.leadId})</span> · <StatusBadge status={e.previousQuality} /> → <StatusBadge status={e.quality} />
              <span className="block text-xs text-muted">{nameOf(e.reviewerId)} · {fmtDateTime(e.at)}{e.reason ? ` · Reason: ${e.reason}` : ""}{e.notes ? ` · ${e.notes}` : ""}</span></li>))}</ul>)}
      </Card>

      <EvalModal lead={target} onClose={() => setTarget(null)} canEval={canEval} onSubmit={(e) => { addEvaluation(e); toast("Evaluation saved"); setTarget(null); }} />
      <span className="hidden"><InfoTip text="" /></span>
    </div>
  );
}

function EvalModal({ lead, onClose, canEval, onSubmit }: { lead: Lead | null; onClose: () => void; canEval: boolean; onSubmit: (e: Omit<Evaluation, "id" | "at" | "reviewerId" | "previousQuality">) => void }) {
  const [scores, setScores] = useState({ responsiveness: 3, needIdentified: 3, intent: 3, contactCaptured: 3 });
  const [quality, setQuality] = useState<LeadQuality | "">("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const q: LeadQuality = (quality || lead?.quality) as LeadQuality;
  const downgrade = lead ? QUALITIES.indexOf(q) < QUALITIES.indexOf(lead.quality) : false;
  const save = () => {
    if (!lead) return;
    if (downgrade && reason.trim().length < 3) { setErr("A reason is required when downgrading or rejecting."); return; }
    onSubmit({ leadId: lead.id, quality: q, scores, notes: notes.trim(), reason: downgrade ? reason.trim() : undefined });
    setQuality(""); setNotes(""); setReason(""); setErr("");
  };
  return (
    <Modal open={!!lead} onClose={onClose} title={lead ? `Review · ${lead.name}` : ""} width={640}
      footer={<><Btn onClick={onClose}>Close</Btn>{canEval && <Btn variant="primary" onClick={save}>Save evaluation</Btn>}</>}>
      {lead && (<div className="space-y-4">
        <ConversationView leadId={lead.id} height={200} />
        {canEval ? (<>
          <div className="grid gap-3 sm:grid-cols-2">{CRITERIA.map((c) => (
            <label key={c.key} className="text-xs font-medium text-muted">{c.label} · <b className="text-ink">{scores[c.key]}/5</b><span className="block font-normal">{c.hint}</span>
              <input type="range" min={1} max={5} value={scores[c.key]} onChange={(e) => setScores((s) => ({ ...s, [c.key]: Number(e.target.value) }))} className="mt-1 w-full accent-[#087a58]" /></label>))}</div>
          <Select label={`Quality status (current: ${lead.quality})`} value={q} onChange={(v) => setQuality(v as LeadQuality)} options={QUALITIES.map((x) => ({ value: x, label: x }))} />
          <p className="text-xs text-muted">{DEFS[q]}</p>
          {downgrade && <TextArea label="Reason for rejection or downgrade *" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={err} />}
          <TextArea label="Evaluation notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </>) : <p className="text-sm text-muted">Your role can view conversations but not submit evaluations.</p>}
      </div>)}
    </Modal>
  );
}
