"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDash } from "@/lib/useDash";
import { fmtHrs, fmtInt, fmtMins, fmtPct, pctChange, salesRows, SalesRow } from "@/lib/metrics";
import { Avatar, Badge, Card, Column, DataTable, Drawer, KpiCard, Skeleton, useBrief } from "@/components/ui";
import { ChartCard, TimeChart } from "@/components/charts";
import { fmtShort } from "@/lib/dates";
import { Trophy } from "lucide-react";

export default function Sales() {
  const D = useDash();
  const loading = useBrief();
  const [openRep, setOpenRep] = useState<string | null>(null);
  const reps = D.data.users.filter((u) => u.role === "Sales Representative");
  const repIds = reps.map((r) => r.id);

  const rows = useMemo(() => salesRows(D.leads, repIds), [D.leads]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevRows = useMemo(() => salesRows(D.leadsPrev, repIds), [D.leadsPrev]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (rs: SalesRow[], k: keyof SalesRow) => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const avg = (rs: SalesRow[], k: "avgResponseMin" | "avgFollowUpHrs") => { const v = rs.map((r) => r[k]).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  const tot = { assigned: sum(rows, "assigned"), responded: sum(rows, "responded"), qualified: sum(rows, "qualified"), appts: sum(rows, "appointments"), conv: sum(rows, "converted") };
  const prv = { assigned: sum(prevRows, "assigned"), responded: sum(prevRows, "responded"), qualified: sum(prevRows, "qualified"), appts: sum(prevRows, "appointments"), conv: sum(prevRows, "converted") };
  const convRate = tot.qualified ? (tot.conv / tot.qualified) * 100 : null;
  const convRatePrev = prv.qualified ? (prv.conv / prv.qualified) * 100 : null;
  const nameOf = (id: string) => reps.find((r) => r.id === id)?.name ?? id;
  const hueOfRep = (id: string) => reps.find((r) => r.id === id)?.hue ?? 160;

  const cols: Column<SalesRow>[] = [
    { key: "rep", header: "Salesperson", sticky: true, minW: 190, sort: (r) => nameOf(r.repId), render: (r) => (
      <div className="flex items-center gap-2">{r.rank > 0 && r.rank <= 3 ? <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${r.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{r.rank}</span> : <span className="w-6 text-center text-xs text-gray-400">{r.rank || "–"}</span>}
        <Avatar name={nameOf(r.repId)} hue={hueOfRep(r.repId)} size={28} /><span className="font-medium">{nameOf(r.repId)}</span></div>) },
    { key: "as", header: "Assigned Leads", align: "right", sort: (r) => r.assigned, render: (r) => r.assigned },
    { key: "re", header: "Responded", align: "right", sort: (r) => r.responded, render: (r) => r.responded },
    { key: "nr", header: "Not Responded", align: "right", sort: (r) => r.notResponded, render: (r) => <span className={r.notResponded > r.assigned * 0.2 ? "font-semibold text-red-500" : ""}>{r.notResponded}</span> },
    { key: "q", header: "Qualified", align: "right", sort: (r) => r.qualified, render: (r) => r.qualified },
    { key: "ap", header: "Appointments", align: "right", sort: (r) => r.appointments, render: (r) => r.appointments },
    { key: "cv", header: "Converted", align: "right", sort: (r) => r.converted, render: (r) => r.converted },
    { key: "cr", header: "Conversion Rate", align: "right", tip: "Converted ÷ Qualified × 100", sort: (r) => r.conversionRate, render: (r) => fmtPct(r.conversionRate) },
    { key: "rt", header: "Avg Response Time", align: "right", tip: "Average time to first reply among responded leads", sort: (r) => r.avgResponseMin, render: (r) => fmtMins(r.avgResponseMin) },
    { key: "fr", header: "Follow-up Rate", align: "right", tip: "Share of responded leads that received at least one follow-up", sort: (r) => r.followUpRate, render: (r) => fmtPct(r.followUpRate, 0) },
    { key: "sc", header: "Performance Score", tip: "0–100. 30% conversion, 25% qualified rate, 20% response speed, 15% follow-up rate, 10% workload. Needs ≥3 assigned leads. Volume alone never ranks anyone.", sort: (r) => r.score, minW: 150,
      render: (r) => r.score == null ? <Badge>Not enough data</Badge> : (
        <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full" style={{ width: `${r.score}%`, background: r.score >= 60 ? "#10b981" : r.score >= 40 ? "#e0a431" : "#dc6b6b" }} /></div><b className="tabnum">{r.score}</b></div>) },
  ];

  const compare = rows.filter((r) => r.assigned > 0).map((r) => ({ name: nameOf(r.repId).split(" ")[0], Qualified: r.qualified, Converted: r.converted, Appointments: r.appointments }));

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Assigned Leads" value={fmtInt(tot.assigned)} delta={pctChange(tot.assigned, prv.assigned)} />
        <KpiCard label="Total Responded Leads" value={fmtInt(tot.responded)} delta={pctChange(tot.responded, prv.responded)} />
        <KpiCard label="Qualified Leads" value={fmtInt(tot.qualified)} delta={pctChange(tot.qualified, prv.qualified)} />
        <KpiCard label="Appointments Booked" value={fmtInt(tot.appts)} delta={pctChange(tot.appts, prv.appts)} />
        <KpiCard label="Converted Customers" value={fmtInt(tot.conv)} delta={pctChange(tot.conv, prv.conv)} />
        <KpiCard label="Conversion Rate" value={fmtPct(convRate)} delta={pctChange(convRate, convRatePrev)} tip="Converted ÷ Qualified × 100" />
        <KpiCard label="Avg First Response Time" value={fmtMins(avg(rows, "avgResponseMin"))} delta={pctChange(avg(rows, "avgResponseMin"), avg(prevRows, "avgResponseMin"))} lowerIsBetter />
        <KpiCard label="Avg Follow-up Time" value={fmtHrs(avg(rows, "avgFollowUpHrs"))} delta={pctChange(avg(rows, "avgFollowUpHrs"), avg(prevRows, "avgFollowUpHrs"))} lowerIsBetter />
      </div>

      <Card title="Salesperson performance" subtitle="Ranked by Performance Score, not by raw lead volume. Click a row for details." right={<span className="flex items-center gap-1 text-xs text-muted"><Trophy size={14} className="text-amber-500" /> Ranking = score</span>}>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.repId} defaultSort={{ key: "sc", dir: "desc" }} onRowClick={(r) => setOpenRep(r.repId)} caption="Salesperson performance" emptyTitle="No assigned leads in range" />
      </Card>

      <ChartCard title="Individual comparison" subtitle="Qualified, appointments and converted leads per salesperson">
        <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={compare} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
          <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, background: "var(--color-surface)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }} />
          <Bar dataKey="Qualified" fill="#10b981" radius={[3, 3, 0, 0]} isAnimationActive={false} /><Bar dataKey="Appointments" fill="#3b82f6" radius={[3, 3, 0, 0]} isAnimationActive={false} /><Bar dataKey="Converted" fill="#087a58" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>
      </ChartCard>

      <Drawer open={!!openRep} onClose={() => setOpenRep(null)} title={openRep ? nameOf(openRep) : ""}>
        {openRep && <RepDetail repId={openRep} row={rows.find((r) => r.repId === openRep)!} />}
      </Drawer>
    </div>
  );
}

function RepDetail({ repId, row }: { repId: string; row: SalesRow }) {
  const D = useDash();
  const mine = D.leads.filter((l) => l.repId === repId && l.valid);
  const trend = D.days.map((d) => {
    const day = mine.filter((l) => l.createdAt === d);
    return { label: fmtShort(d), assigned: day.length, converted: day.filter((l) => l.status === "Converted").length };
  });
  // weekly buckets keep the chart readable on long ranges
  const bucket = D.days.length > 31;
  const data = bucket ? trend.reduce<{ label: string; assigned: number; converted: number }[]>((acc, t, i) => { if (i % 7 === 0) acc.push({ ...t }); else { const a = acc[acc.length - 1]; a.assigned += t.assigned; a.converted += t.converted; } return acc; }, []) : trend;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[["Assigned", row.assigned], ["Responded", row.responded], ["Not responded", row.notResponded], ["Qualified", row.qualified], ["Converted", row.converted], ["Score", row.score ?? "—"]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg bg-gray-50 p-2.5"><div className="text-xs text-muted">{k}</div><div className="text-lg font-semibold tabnum">{v}</div></div>))}
      </div>
      <p className="text-sm text-muted">Avg response {fmtMins(row.avgResponseMin)} · Follow-up rate {fmtPct(row.followUpRate, 0)} · Conversion {fmtPct(row.conversionRate)} · Rank {row.rank || "–"}</p>
      <ChartCard title={bucket ? "Weekly trend" : "Daily trend"}><TimeChart data={data} height={220} series={[{ key: "assigned", name: "Assigned", type: "bar", color: "#a7d9c6" }, { key: "converted", name: "Converted", color: "#087a58" }]} /></ChartCard>
      <div><h4 className="mb-1 text-sm font-semibold">Recent activity</h4>
        <ul className="divide-y divide-line text-sm">{[...mine].sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt)).slice(0, 6).map((l) => <li key={l.id} className="flex justify-between py-1.5"><span>{l.name} <span className="text-xs text-muted">{l.id}</span></span><Badge>{l.status}</Badge></li>)}</ul></div>
    </div>
  );
}
