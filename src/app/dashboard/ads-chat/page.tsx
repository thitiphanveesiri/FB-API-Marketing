"use client";
import { useMemo, useState } from "react";
import { useDash } from "@/lib/useDash";
import { fmtPct, leadStats } from "@/lib/metrics";
import { Badge, Card, Column, DataTable, Drawer, Select, StatusBadge, Avatar, hueOf, InfoTip, Skeleton, useBrief } from "@/components/ui";
import { ChatQualityBadge } from "@/components/ui";
import { chatQuality } from "@/lib/metrics";
import LeadDrawer from "@/components/LeadDrawer";
import { Ad, Lead, LeadStatus } from "@/lib/types";
import { fmtDate } from "@/lib/dates";

type ColKey = "Not Responded" | "Very Poor" | "Average" | "Qualified" | "Appointment Booked" | "Connection Created" | "New" | "In-Process" | "Converted" | "Intake";
interface Row { ad: Ad; campaign: string; page: string; leads: Lead[]; rate: number | null; valid: number; counts: Record<string, number>; unattributed?: boolean }

export default function AdsChat() {
  const D = useDash();
  const loading = useBrief();
  const [statusF, setStatusF] = useState("all");
  const [listFor, setListFor] = useState<{ title: string; leads: Lead[] } | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => {
    const camps = new Map(D.data.campaigns.map((c) => [c.id, c]));
    const pages = new Map(D.data.pages.map((p) => [p.id, p.name]));
    return D.ads.map((ad) => {
      // each lead has exactly one adId, so a lead can only ever be counted under a single ad row
      const leads = D.leads.filter((l) => l.adId === ad.id && l.valid);
      const ls = leadStats(leads);
      const c = camps.get(ad.campaignId)!;
      return { ad, campaign: c.name, page: pages.get(c.pageId) ?? "", leads, rate: ls.qualifiedRate, valid: ls.valid, counts: { ...ls.byStatus } };
    }).filter((r) => r.valid > 0 && (statusF === "all" || r.ad.status === statusF));
  }, [D, statusF]);

  const unattributed = D.leads.filter((l) => !l.adId && l.valid).length;

  const num = (r: Row, k: ColKey): Column<Row> => ({
    key: k, header: k, align: "right", sort: (x) => x.counts[k] ?? 0,
    render: (x) => {
      const n = x.counts[k] ?? 0;
      return n ? <button className="rounded px-1.5 font-medium text-brand underline-offset-2 hover:bg-brand-soft hover:underline" onClick={(e) => { e.stopPropagation(); setListFor({ title: `${x.ad.id} · ${k}`, leads: x.leads.filter((l) => l.status === k) }); }}>{n}</button> : <span className="text-gray-300">0</span>;
    },
  });
  void num;
  const colKeys: ColKey[] = ["Not Responded", "Very Poor", "Average", "Qualified", "Appointment Booked", "Connection Created", "New", "Converted", "In-Process", "Intake"];
  const cols: Column<Row>[] = [
    { key: "ad", header: "Ad ID", sort: (r) => r.ad.id, sticky: true, minW: 150, render: (r) => (
      <button className="text-left" onClick={(e) => { e.stopPropagation(); setListFor({ title: `${r.ad.id} · all conversations`, leads: r.leads }); }}>
        <span className="font-semibold text-brand hover:underline">{r.ad.id}</span><span className="block max-w-[200px] truncate text-xs text-muted">{r.ad.name}</span></button>) },
    { key: "status", header: "Status", sort: (r) => r.ad.status, render: (r) => <Badge tone={r.ad.status === "Active" ? "green" : r.ad.status === "Paused" ? "amber" : r.ad.status === "Learning" ? "blue" : "gray"}>{r.ad.status}</Badge> },
    { key: "upd", header: "Last Updated", sort: (r) => r.ad.updatedAt, render: (r) => <span className="whitespace-nowrap">{fmtDate(r.ad.updatedAt)}</span> },
    { key: "rate", header: "Leads Qualified Rate", tip: "Qualified (incl. Appointment Booked & Connection Created) ÷ valid leads × 100. Invalid/spam leads are excluded.", sort: (r) => r.rate, minW: 170,
      render: (r) => (
        <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-2" style={{ width: `${Math.min(100, r.rate ?? 0)}%` }} /></div>
          <span className="w-12 font-semibold tabnum">{fmtPct(r.rate)}</span><ChatQualityBadge q={chatQuality(r.rate, r.valid)} /></div>) },
    ...colKeys.map((k) => ({
      key: k, header: k === "Appointment Booked" ? "Appointment Booked" : k, align: "right" as const, sort: (x: Row) => x.counts[k] ?? 0,
      render: (x: Row) => {
        const n = x.counts[k] ?? 0;
        return n ? <button className="rounded px-1.5 font-medium text-brand hover:bg-brand-soft hover:underline" onClick={(e) => { e.stopPropagation(); setListFor({ title: `${x.ad.id} · ${k}`, leads: x.leads.filter((l) => l.status === (k as LeadStatus)) }); }}>{n}</button> : <span className="text-gray-300">0</span>;
      },
    })),
  ];
  // exact requested order: ... Converted, In-Process, Intake — already matches colKeys.

  const funnel = useMemo(() => {
    const ls = leadStats(D.leads);
    return [
      { label: "Valid leads", n: ls.valid },
      { label: "Qualified", n: ls.qualified },
      { label: "Converted", n: ls.converted },
    ];
  }, [D.leads]);

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {funnel.map((f, i) => (
          <div key={f.label} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-xs font-medium text-muted">{f.label}{i > 0 && <span className="ml-1">· {fmtPct(funnel[0].n ? (f.n / funnel[0].n) * 100 : null)} of valid</span>}</p>
            <p className="text-2xl font-semibold tabnum">{f.n}</p>
            <div className="mt-2 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-2" style={{ width: `${funnel[0].n ? (f.n / funnel[0].n) * 100 : 0}%` }} /></div>
          </div>
        ))}
      </div>
      <Card title="Ads & Chat" subtitle="Which ads bring valuable conversations — not just volume. Each lead is counted once, under its single source ad." tip="One conversation = one Lead ID = at most one Ad ID, so leads are never double-counted across ads."
        right={<div className="flex items-center gap-2"><Select value={statusF} onChange={setStatusF} options={[{ value: "all", label: "All ad status" }, ...["Active", "Paused", "Learning", "Ended"].map((s) => ({ value: s, label: s }))]} /></div>}>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.ad.id} searchText={(r) => `${r.ad.id} ${r.ad.name}`} searchPlaceholder="Search Ad ID…" defaultSort={{ key: "rate", dir: "desc" }}
          onRowClick={(r) => setListFor({ title: `${r.ad.id} · all conversations`, leads: r.leads })} caption="Ads and chat quality" emptyTitle="No ads with leads in this range" />
        <p className="mt-2 text-xs text-muted">Click an Ad ID to see its conversations; click a number to list those customers. {unattributed > 0 && `${unattributed} valid lead(s) in this range have no source Ad ID and are excluded from the table (kept in the funnel above).`} Filters for Page, Campaign and Status are in the top bar.</p>
      </Card>

      <Drawer open={!!listFor} onClose={() => setListFor(null)} title={listFor?.title ?? ""} width={520}>
        {listFor && (
          <ul className="divide-y divide-line">
            {listFor.leads.length === 0 && <li className="py-8 text-center text-sm text-muted">No customers.</li>}
            {listFor.leads.map((l) => (
              <li key={l.id}>
                <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50" onClick={() => setLeadId(l.id)}>
                  <Avatar name={l.name} hue={hueOf(l.name)} size={34} />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{l.name} <span className="text-xs font-normal text-muted">{l.id}</span></span><span className="block truncate text-xs text-muted">{l.lastMessage}</span></span>
                  <StatusBadge status={l.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
      <LeadDrawer leadId={leadId} onClose={() => setLeadId(null)} />
      <span className="hidden"><InfoTip text="" /></span>
    </div>
  );
}
