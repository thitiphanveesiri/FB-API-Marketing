"use client";
import { useMemo, useState } from "react";
import { useDash } from "@/lib/useDash";
import { aggregate, derive, fmtMoney, fmtInt, fmtPct, leadStats, Num } from "@/lib/metrics";
import { ChartCard, TimeChart } from "@/components/charts";
import { Skeleton, useBrief, Btn } from "@/components/ui";
import { fmtShort, monthStart, weekStart } from "@/lib/dates";
import { DailyPerf, Lead } from "@/lib/types";

type Gran = "day" | "week" | "month";
const keyOf = (d: string, g: Gran) => (g === "day" ? d : g === "week" ? weekStart(d) : monthStart(d));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labelOf = (k: string, g: Gran) => (g === "month" ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : g === "week" ? `Wk ${fmtShort(k)}` : fmtShort(k));

export default function Trend() {
  const D = useDash();
  const loading = useBrief();
  const [gran, setGran] = useState<Gran>("day");
  const [compare, setCompare] = useState(true);

  const build = (days: string[], perf: DailyPerf[], leads: Lead[]) => {
    const keys = [...new Set(days.map((d) => keyOf(d, gran)))];
    return keys.map((k) => {
      const p = aggregate(perf.filter((x) => keyOf(x.date, gran) === k));
      const ls = leadStats(leads.filter((l) => keyOf(l.createdAt, gran) === k));
      const dv = derive(p);
      return { key: k, spend: p.spend, messages: p.messages, cpm: dv.costPerMessage, qualified: ls.qualified, purchases: p.purchases, conv: ls.conversionRate, converted: ls.converted, valid: ls.valid };
    });
  };
  const cur = useMemo(() => build(D.days, D.perf, D.leads), [D, gran]); // eslint-disable-line react-hooks/exhaustive-deps
  const prv = useMemo(() => build(D.prevDays, D.perfPrev, D.leadsPrev), [D, gran]); // eslint-disable-line react-hooks/exhaustive-deps

  const mk = (field: "spend" | "messages" | "cpm" | "qualified" | "purchases" | "conv") =>
    cur.map((c, i) => ({ label: labelOf(c.key, gran), cur: c[field] as Num, prev: compare ? ((prv[i]?.[field] as Num) ?? null) : null }));
  const prevSeries = { key: "prev", name: "Previous period", dashed: true, color: "#9ca3af" };
  const toggle = compare;

  // Sales trend: converted + qualified per rep (top reps)
  const reps = D.data.users.filter((u) => u.role === "Sales Representative");
  const salesData = useMemo(() => {
    const keys = [...new Set(D.days.map((d) => keyOf(d, gran)))];
    return keys.map((k) => {
      const row: Record<string, number | string> = { label: labelOf(k, gran) };
      for (const r of reps) row[r.id] = D.leads.filter((l) => l.valid && l.repId === r.id && keyOf(l.createdAt, gran) === k && ["Qualified", "Appointment Booked", "Connection Created"].includes(l.quality)).length;
      return row;
    });
  }, [D, gran]); // eslint-disable-line react-hooks/exhaustive-deps

  // Agency comparison (bar) — spend vs qualified leads
  const agencyData = useMemo(() => D.data.agencies.map((a) => {
    const adIds = new Set(D.ads.filter((ad) => D.data.campaigns.find((c) => c.id === ad.campaignId)?.agencyId === a.id).map((x) => x.id));
    const p = aggregate(D.perf.filter((x) => adIds.has(x.adId)));
    const ls = leadStats(D.leads.filter((l) => l.adId && adIds.has(l.adId)));
    return { name: a.name.replace(" (Demo)", ""), spend: p.spend, qualified: ls.qualified, cpq: ls.qualified ? p.spend / ls.qualified : null, rate: ls.qualifiedRate };
  }).filter((a) => a.spend > 0), [D]);

  if (loading) return <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>;
  if (D.perf.length === 0) return <p className="py-16 text-center text-sm text-muted">No data in this range. Widen the date range or reset the filters.</p>;

  const sales = reps.filter((r) => salesData.some((d) => Number(d[r.id]) > 0));
  const colors = ["#087a58", "#3b82f6", "#e0a431", "#8b5cf6", "#dc6b6b"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Granularity">
          {(["day", "week", "month"] as Gran[]).map((g) => (
            <button key={g} aria-pressed={gran === g} onClick={() => setGran(g)} className={`h-9 px-4 text-sm capitalize ${gran === g ? "bg-brand text-white" : "bg-surface hover:bg-gray-50"} border-r border-line last:border-r-0`}>{g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="h-4 w-4 accent-[#087a58]" /> Compare with previous period</label>
        <span className="text-xs text-muted">Date range and other filters are set above. Previous period is aligned bucket-by-bucket.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Daily advertising spend" subtitle="Area · volume"><TimeChart data={mk("spend")} fmt={(n) => fmtMoney(n)} series={[{ key: "cur", name: "Spend", type: "area" }, ...(toggle ? [prevSeries] : [])]} /></ChartCard>
        <ChartCard title="Daily message volume" subtitle="Area · Meta-reported conversations started"><TimeChart data={mk("messages")} fmt={fmtInt as (n: number) => string} series={[{ key: "cur", name: "Messages", type: "area", color: "#3b82f6" }, ...(toggle ? [prevSeries] : [])]} /></ChartCard>
        <ChartCard title="Cost per message trend" subtitle="Line · lower is better"><TimeChart data={mk("cpm")} fmt={(n) => fmtMoney(n, 1)} series={[{ key: "cur", name: "Cost / message" }, ...(toggle ? [prevSeries] : [])]} /></ChartCard>
        <ChartCard title="Qualified lead trend" subtitle="Line · CRM lead grading, by lead creation date"><TimeChart data={mk("qualified")} series={[{ key: "cur", name: "Qualified leads", color: "#10b981" }, ...(toggle ? [prevSeries] : [])]} /></ChartCard>
        <ChartCard title="Purchase trend" subtitle="Line · Meta-reported purchases"><TimeChart data={mk("purchases")} series={[{ key: "cur", name: "Purchases", color: "#8b5cf6" }, ...(toggle ? [prevSeries] : [])]} /></ChartCard>
        <ChartCard title="Conversion rate trend" subtitle="Line · Converted ÷ Qualified (leads created in the bucket)"><TimeChart data={mk("conv")} fmt={(n) => fmtPct(n, 0)} series={[{ key: "cur", name: "Conversion rate", color: "#e0a431" }, ...(toggle ? [prevSeries] : [])]} /></ChartCard>
        <ChartCard title="Sales performance trend" subtitle="Bars · qualified leads per salesperson">
          {sales.length === 0 ? <p className="py-10 text-center text-sm text-muted">No qualified leads in range.</p> : <TimeChart data={salesData} stacked series={sales.map((r, i) => ({ key: r.id, name: r.name.split(" ")[0], type: "bar" as const, color: colors[i % colors.length] }))} />}
        </ChartCard>
        <ChartCard title="Agency performance" subtitle="Bars · spend vs qualified leads (selected range)">
          {agencyData.length === 0 ? <p className="py-10 text-center text-sm text-muted">No agency data.</p> : (
            <>
              <TimeChart data={agencyData} xKey="name" series={[{ key: "spend", name: "Spend", type: "bar", color: "#a7d9c6" }, { key: "qualified", name: "Qualified leads", type: "bar", yAxisId: "right", color: "#087a58" }]} fmt={(n) => fmtMoney(n)} fmtRight={(n) => String(n)} />
              <table className="mt-2 w-full text-xs"><tbody>{agencyData.map((a) => <tr key={a.name} className="border-t border-line"><td className="py-1">{a.name}</td><td className="text-right tabnum">Cost/qualified {fmtMoney(a.cpq, 0)}</td><td className="text-right tabnum">Qualified rate {fmtPct(a.rate)}</td></tr>)}</tbody></table>
            </>
          )}
        </ChartCard>
      </div>
      <Btn variant="ghost" size="sm" onClick={() => setGran("day")}>Reset to daily</Btn>
    </div>
  );
}
