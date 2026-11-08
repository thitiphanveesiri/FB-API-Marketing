"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, MessageSquareOff, TrendingDown } from "lucide-react";
import { useDash } from "@/lib/useDash";
import { aggregate, chatQuality, derive, fmtCompact, fmtInt, fmtMoney, fmtPct, leadStats, pctChange, Num } from "@/lib/metrics";
import { AdThumb, Badge, Btn, Card, ChatQualityBadge, Column, DataTable, Drawer, KpiCard, Select, Skeleton, useBrief } from "@/components/ui";
import { ChartCard, TimeChart } from "@/components/charts";
import { Ad } from "@/lib/types";
import { fmtShort, ANCHOR } from "@/lib/dates";

type MetricKey = "spend" | "reach" | "impressions" | "cpm" | "clicks" | "ctr" | "cpc" | "messages" | "cpmsg" | "purchases" | "conv" | "cpp";

interface Row {
  ad: Ad; campaign: string; page: string; reach: number; impressions: number; cpm: Num; ctr: Num; costPerMsg: Num; cqc: Num;
  purchases: number; spend: number; cpc: Num; qrate: Num; leadCount: number; quality: ReturnType<typeof chatQuality>; messages: number;
}

export default function AdsPerformance() {
  const D = useDash();
  const loading = useBrief();
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [open, setOpen] = useState<Row | null>(null);
  const [qFilter, setQFilter] = useState("all");

  const series = (fn: (day: ReturnType<typeof aggregate>) => Num) =>
    D.days.map((d) => fn(aggregate(D.perf.filter((p) => p.date === d))) ?? 0);

  const kpis = useMemo(() => {
    const c = D.agg, p = D.aggPrev, dc = D.d, dp = D.dPrev;
    const convRate = (ls: typeof D.ls) => ls.conversionRate;
    return {
      spend: { v: fmtMoney(c.spend), d: pctChange(c.spend, p.spend), s: series((a) => a.spend) },
      reach: { v: fmtCompact(c.reach), d: pctChange(c.reach, p.reach), s: series((a) => a.reach) },
      impressions: { v: fmtCompact(c.impressions), d: pctChange(c.impressions, p.impressions), s: series((a) => a.impressions) },
      cpm: { v: fmtMoney(dc.cpm, 1), d: pctChange(dc.cpm, dp.cpm), s: series((a) => derive(a).cpm) },
      clicks: { v: fmtInt(c.clicks), d: pctChange(c.clicks, p.clicks), s: series((a) => a.clicks) },
      ctr: { v: fmtPct(dc.ctr, 2), d: pctChange(dc.ctr, dp.ctr), s: series((a) => derive(a).ctr) },
      cpc: { v: fmtMoney(dc.cpc, 2), d: pctChange(dc.cpc, dp.cpc), s: series((a) => derive(a).cpc) },
      messages: { v: fmtInt(c.messages), d: pctChange(c.messages, p.messages), s: series((a) => a.messages) },
      cpmsg: { v: fmtMoney(dc.costPerMessage, 1), d: pctChange(dc.costPerMessage, dp.costPerMessage), s: series((a) => derive(a).costPerMessage) },
      purchases: { v: fmtInt(c.purchases), d: pctChange(c.purchases, p.purchases), s: series((a) => a.purchases) },
      conv: { v: fmtPct(convRate(D.ls)), d: pctChange(convRate(D.ls), convRate(D.lsPrev)), s: [] as number[] },
      cpp: { v: fmtMoney(dc.costPerPurchase, 0), d: pctChange(dc.costPerPurchase, dp.costPerPurchase), s: series((a) => derive(a).costPerPurchase) },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D]);

  const rows: Row[] = useMemo(() => {
    const camps = new Map(D.data.campaigns.map((c) => [c.id, c]));
    const pages = new Map(D.data.pages.map((p) => [p.id, p]));
    return D.ads.map((ad) => {
      const a = aggregate(D.perf.filter((p) => p.adId === ad.id));
      const d = derive(a);
      const ls = leadStats(D.leads.filter((l) => l.adId === ad.id));
      const c = camps.get(ad.campaignId)!;
      return {
        ad, campaign: c.name, page: pages.get(c.pageId)?.name ?? "", reach: a.reach, impressions: a.impressions, cpm: d.cpm, ctr: d.ctr,
        costPerMsg: d.costPerMessage, cqc: ls.qualified ? a.spend / ls.qualified : null, purchases: a.purchases, spend: a.spend, cpc: d.cpc,
        qrate: ls.qualifiedRate, leadCount: ls.valid, quality: chatQuality(ls.qualifiedRate, ls.valid), messages: a.messages,
      };
    }).filter((r) => r.spend > 0 || r.impressions > 0);
  }, [D]);

  // Outlier thresholds: > 1.5× median cost per message flags "high cost"
  const median = useMemo(() => {
    const v = rows.map((r) => r.costPerMsg).filter((x): x is number => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [rows]);
  const highCost = (r: Row) => median != null && r.costPerMsg != null && r.costPerMsg > median * 1.5;
  const lowPerf = (r: Row) => r.quality === "Poor";

  const attention = useMemo(() => {
    const myLeads = D.data.leads.filter((l) => l.valid && !l.dropped && (D.eff.pageId === "all" || l.pageId === D.eff.pageId) && (D.eff.repId === "all" || l.repId === D.eff.repId));
    return {
      highCost: rows.filter((r) => r.spend > 0 && highCost(r)).length,
      poor: rows.filter((r) => r.spend > 0 && lowPerf(r)).length,
      waiting: myLeads.filter((l) => l.quality === "Not Responded").length,
      overdue: myLeads.filter((l) => l.followUpDate && l.followUpDate < ANCHOR).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D, rows, median]);
  const anyAttention = attention.highCost + attention.poor + attention.waiting + attention.overdue > 0;

  const filtered = qFilter === "all" ? rows : qFilter === "flag" ? rows.filter((r) => highCost(r) || lowPerf(r)) : rows.filter((r) => r.quality === qFilter);

  const cols: Column<Row>[] = [
    { key: "name", header: "Campaign / Ads", sort: (r) => r.ad.name, minW: 230, sticky: true, render: (r) => (
      <div className="min-w-0"><div className="font-medium text-ink">{r.ad.name}</div><div className="text-xs text-muted">{r.campaign} · {r.ad.id}</div></div>) },
    { key: "creative", header: "Creative", render: (r) => <AdThumb hue={r.ad.creative.hue} type={r.ad.creative.type} /> },
    { key: "reach", header: "Reach", align: "right", sort: (r) => r.reach, render: (r) => fmtInt(r.reach) },
    { key: "imp", header: "Impressions", align: "right", sort: (r) => r.impressions, render: (r) => fmtInt(r.impressions) },
    { key: "cpm", header: "CPM", align: "right", tip: "Cost per 1,000 impressions = Spend ÷ Impressions × 1,000", sort: (r) => r.cpm, render: (r) => fmtMoney(r.cpm, 1) },
    { key: "ctr", header: "CTR", align: "right", tip: "Click-through rate = Clicks ÷ Impressions × 100", sort: (r) => r.ctr, render: (r) => fmtPct(r.ctr, 2) },
    { key: "cpmsg", header: "Cost / Message", align: "right", tip: "Spend ÷ messaging conversations started (Meta-reported). Red = more than 1.5× the median.", sort: (r) => r.costPerMsg,
      render: (r) => <span className={highCost(r) ? "rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-600" : ""}>{fmtMoney(r.costPerMsg, 1)}</span> },
    { key: "cqc", header: "CQC", align: "right", tip: "Cost per Qualified Chat = Spend ÷ qualified leads (from CRM lead grading)", sort: (r) => r.cqc, render: (r) => fmtMoney(r.cqc, 0) },
    { key: "pur", header: "Purchases", align: "right", tip: "Meta-reported purchases (not CRM-confirmed)", sort: (r) => r.purchases, render: (r) => fmtInt(r.purchases) },
    { key: "spend", header: "Spend", align: "right", sort: (r) => r.spend, render: (r) => fmtMoney(r.spend) },
    { key: "cpc", header: "CPC", align: "right", tip: "Cost per click = Spend ÷ Clicks", sort: (r) => r.cpc, render: (r) => fmtMoney(r.cpc, 2) },
    { key: "q", header: "Chat Quality", tip: "Based on qualified lead rate for this ad: Excellent ≥40%, Good ≥25%, Average ≥12%, Poor <12%. Needs ≥3 valid leads.", sort: (r) => r.qrate, render: (r) => <ChatQualityBadge q={r.quality} /> },
  ];

  const METRICS: { id: MetricKey; label: string; group: string; tip?: string; lowerIsBetter?: boolean; fmt: (n: number) => string }[] = [
    { id: "spend", label: "Amount Spent", group: "Cost & Visibility", fmt: (n) => fmtMoney(n) },
    { id: "reach", label: "Reach", group: "Cost & Visibility", tip: "Daily reach summed across days — approximate, since Meta de-duplicates reach only within a single reporting window.", fmt: (n) => fmtCompact(n) },
    { id: "impressions", label: "Impressions", group: "Cost & Visibility", fmt: (n) => fmtCompact(n) },
    { id: "cpm", label: "CPM", group: "Cost & Visibility", tip: "Cost per 1,000 impressions", lowerIsBetter: true, fmt: (n) => fmtMoney(n, 1) },
    { id: "clicks", label: "Clicks", group: "Acquisition", fmt: (n) => fmtInt(n) },
    { id: "ctr", label: "CTR", group: "Acquisition", tip: "Clicks ÷ Impressions × 100", fmt: (n) => fmtPct(n, 2) },
    { id: "cpc", label: "CPC", group: "Acquisition", tip: "Spend ÷ Clicks", lowerIsBetter: true, fmt: (n) => fmtMoney(n, 2) },
    { id: "messages", label: "Total Messages", group: "Conversion", tip: "Messaging conversations started, as reported by Meta", fmt: (n) => fmtInt(n) },
    { id: "cpmsg", label: "Cost per Message", group: "Conversion", lowerIsBetter: true, fmt: (n) => fmtMoney(n, 1) },
    { id: "purchases", label: "Total Purchases", group: "Conversion", tip: "Meta-reported purchases. Not the same as CRM-confirmed conversions.", fmt: (n) => fmtInt(n) },
    { id: "conv", label: "Conversion Rate", group: "Conversion", tip: "CRM-confirmed: Converted leads ÷ Qualified leads × 100", fmt: (n) => fmtPct(n) },
    { id: "cpp", label: "Cost per Purchase", group: "Conversion", tip: "Spend ÷ Meta-reported purchases", lowerIsBetter: true, fmt: (n) => fmtMoney(n, 0) },
  ];
  const groups = ["Cost & Visibility", "Acquisition", "Conversion"];
  const boxNames: Record<string, string> = { "Cost & Visibility": "Box 1 · Cost & Visibility", Acquisition: "Box 2 · Acquisition", Conversion: "Box 3 · Conversion" };
  const sel = METRICS.find((m) => m.id === metric)!;

  const chartData = useMemo(() => {
    const byDay = (days: string[], perf: typeof D.perf) => days.map((d) => aggregate(perf.filter((p) => p.date === d)));
    const cur = byDay(D.days, D.perf), prv = byDay(D.prevDays, D.perfPrev);
    const pick = (a: ReturnType<typeof aggregate>): Num => {
      const dv = derive(a);
      switch (metric) {
        case "spend": return a.spend; case "reach": return a.reach; case "impressions": return a.impressions; case "cpm": return dv.cpm;
        case "clicks": return a.clicks; case "ctr": return dv.ctr; case "cpc": return dv.cpc; case "messages": return a.messages;
        case "cpmsg": return dv.costPerMessage; case "purchases": return a.purchases; case "cpp": return dv.costPerPurchase; default: return null;
      }
    };
    return D.days.map((d, i) => ({ label: fmtShort(d), cur: pick(cur[i]), prev: prv[i] ? pick(prv[i]) : null }));
  }, [D, metric]);

  if (loading) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="col-span-full h-96" /></div>;

  const noData = D.perf.length === 0;

  const chip = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card" aria-label="Needs attention">
        <span className="flex items-center gap-1.5 text-sm font-semibold">{anyAttention ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}Needs attention</span>
        {!anyAttention && <span className="text-sm text-muted">Nothing urgent for the current filters.</span>}
        {attention.highCost > 0 && <button onClick={() => setQFilter("flag")} className={`${chip} border-red-200 bg-red-50 text-red-600 hover:opacity-80`}><TrendingDown size={14} />{attention.highCost} ad{attention.highCost > 1 ? "s" : ""} with high cost per message</button>}
        {attention.poor > 0 && <button onClick={() => setQFilter("Poor")} className={`${chip} border-amber-200 bg-amber-50 text-amber-700 hover:opacity-80`}>{attention.poor} ad{attention.poor > 1 ? "s" : ""} with Poor chat quality</button>}
        {attention.waiting > 0 && <Link href="/board" className={`${chip} border-line bg-gray-50 hover:opacity-80`}><MessageSquareOff size={14} />{attention.waiting} lead{attention.waiting > 1 ? "s" : ""} not responded</Link>}
        {attention.overdue > 0 && <Link href="/inbox" className={`${chip} border-line bg-gray-50 hover:opacity-80`}><Clock size={14} />{attention.overdue} overdue follow-up{attention.overdue > 1 ? "s" : ""}</Link>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.3fr]">
        {groups.map((g, gi) => (
          <Card key={g} title={boxNames[g]} className={gi === 2 ? "xl:order-last" : ""} bodyClass="!pt-3">
            <div className={`grid gap-3 ${g === "Conversion" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2"}`}>
              {METRICS.filter((m) => m.group === g).map((m) => {
                const k = kpis[m.id];
                return <KpiCard key={m.id} label={m.label} value={noData ? "—" : k.v} delta={noData ? null : k.d} lowerIsBetter={m.lowerIsBetter} spark={k.s.length ? k.s : undefined} tip={m.tip} active={metric === m.id} onClick={() => setMetric(m.id)} />;
              })}
            </div>
          </Card>
        ))}
      </div>

      <ChartCard title={`${sel.label} — daily`} subtitle="Click any KPI above to change this chart. Dashed line = previous period, aligned by day."
        right={<Select value={metric} onChange={(v) => setMetric(v as MetricKey)} options={METRICS.filter((m) => m.id !== "conv").map((m) => ({ value: m.id, label: m.label }))} />}>
        {metric === "conv" ? <p className="py-10 text-center text-sm text-muted">Conversion Rate is calculated from CRM lead statuses, so it has no daily Meta series. See the Trend tab for a cohort-based view.</p>
          : noData ? <p className="py-10 text-center text-sm text-muted">No performance data in this range.</p>
          : <TimeChart data={chartData} fmt={sel.fmt} series={[{ key: "cur", name: "This period", type: sel.id === "spend" || sel.id === "messages" ? "area" : "line" }, { key: "prev", name: "Previous period", dashed: true, color: "#9ca3af" }]} />}
      </ChartCard>

      <Card title="Campaign performance" subtitle={`${rows.length} ads with delivery in this range · values are Meta-reported unless noted · Demo Data`}
        right={<Select value={qFilter} onChange={setQFilter} options={[{ value: "all", label: "All chat quality" }, { value: "flag", label: "⚠ High cost / low performance" }, ...["Excellent", "Good", "Average", "Poor", "No data"].map((v) => ({ value: v, label: v }))]} />}>
        <DataTable columns={cols} rows={filtered} rowKey={(r) => r.ad.id} searchText={(r) => `${r.ad.name} ${r.campaign} ${r.ad.id}`} searchPlaceholder="Search campaign or ad…"
          defaultSort={{ key: "spend", dir: "desc" }} onRowClick={setOpen} rowClass={(r) => (lowPerf(r) ? "bg-red-50/40" : undefined)} caption="Campaign performance" emptyTitle="No ads match" emptyHint="Widen the date range or clear filters." />
        <p className="mt-2 text-xs text-muted">Red cost = more than 1.5× the median cost per message. Red row tint = Poor chat quality.</p>
      </Card>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.ad.name ?? ""}>
        {open && <CampaignDetail row={open} />}
      </Drawer>
    </div>
  );
}

function CampaignDetail({ row }: { row: Row }) {
  const D = useDash();
  const router = useRouter();
  const data = D.days.map((d) => {
    const a = aggregate(D.perf.filter((p) => p.adId === row.ad.id && p.date === d));
    return { label: fmtShort(d), spend: a.spend, messages: a.messages };
  });
  const ls = leadStats(D.leads.filter((l) => l.adId === row.ad.id));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><AdThumb hue={row.ad.creative.hue} type={row.ad.creative.type} size={56} />
        <div><p className="text-sm text-muted">{row.campaign} · {row.page}</p><div className="mt-1 flex gap-1.5"><Badge tone={row.ad.status === "Active" ? "green" : row.ad.status === "Paused" ? "amber" : "gray"}>{row.ad.status}</Badge><Badge>{row.ad.id}</Badge><ChatQualityBadge q={row.quality} /></div></div></div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {[["Spend", fmtMoney(row.spend)], ["Messages", fmtInt(row.messages)], ["Cost / msg", fmtMoney(row.costPerMsg, 1)], ["CTR", fmtPct(row.ctr, 2)], ["CPC", fmtMoney(row.cpc, 2)], ["CQC", fmtMoney(row.cqc, 0)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-gray-50 p-2.5"><div className="text-xs text-muted">{k}</div><div className="font-semibold tabnum">{v}</div></div>))}
      </div>
      <ChartCard title="Spend & messages by day"><TimeChart data={data} height={220} series={[{ key: "spend", name: "Spend", type: "bar", color: "#a7d9c6" }, { key: "messages", name: "Messages", yAxisId: "right", color: "#087a58" }]} /></ChartCard>
      <div className="rounded-xl border border-line p-3 text-sm">
        <p className="mb-1 font-semibold">Lead quality for this ad (CRM)</p>
        <p className="text-muted">{ls.valid} valid leads · {ls.qualified} qualified ({fmtPct(ls.qualifiedRate)}) · {ls.converted} converted</p>
        <p className="mt-1 text-xs text-muted">Meta-reported purchases: {fmtInt(row.purchases)} · CRM-confirmed conversions: {ls.converted}. These are different sources and are not added together.</p>
      </div>
      <Btn onClick={() => router.push("/dashboard/ads-chat")}>Open in Ads & Chat</Btn>
    </div>
  );
}
