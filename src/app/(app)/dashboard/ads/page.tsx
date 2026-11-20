"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, MessageSquareOff, TrendingDown } from "lucide-react";
import { useDash } from "@/lib/useDash";
import { aggregate, chatQuality, derive, fmtCompact, fmtInt, fmtMoney, fmtPct, leadStats, pctChange, Num } from "@/lib/metrics";
import CreativeCell from "@/components/CreativeCell";
import AdPreview from "@/components/AdPreview";
import { Badge, Btn, Card, ChatQualityBadge, Column, DataTable, Drawer, HoverPreview, KpiCard, Select, Skeleton, useBrief } from "@/components/ui";
import { ChartCard, TimeChart } from "@/components/charts";
import { Ad } from "@/lib/types";
import { fmtShort, ANCHOR } from "@/lib/dates";
import { pageOfAd } from "@/lib/queries";

type MetricKey = "spend" | "reach" | "impressions" | "cpm" | "clicks" | "ctr" | "cpc" | "messages" | "cpmsg" | "purchases" | "conv" | "cpp";

interface Row {
  ad: Ad; campaign: string; page: string; reach: number; impressions: number; cpm: Num; ctr: Num; costPerMsg: Num; cqc: Num;
  purchases: number; spend: number; cpc: Num; qrate: Num; leadCount: number; quality: ReturnType<typeof chatQuality>; messages: number;
}
/** One campaign on one page: every ad of that campaign whose creative posts as that page. */
interface PageRow {
  key: string; campaignId: string; campaign: string; pageId: string; page: string; ads: Ad[]; adCount: number;
  spend: number; spendShare: Num; messages: number; msgShare: Num; costPerMsg: Num; reach: number; impressions: number;
  ctr: Num; cpc: Num; purchases: number; valid: number; qrate: Num; quality: ReturnType<typeof chatQuality>; cqc: Num;
}

export default function AdsPerformance() {
  const D = useDash();
  const loading = useBrief();
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [open, setOpen] = useState<Row | null>(null);
  const [qFilter, setQFilter] = useState("all");
  const [view, setView] = useState<"ads" | "pages">("ads");
  const [openGroup, setOpenGroup] = useState<PageRow | null>(null);

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
        ad, campaign: c.name, page: pages.get(pageOfAd(ad, c))?.name ?? "", reach: a.reach, impressions: a.impressions, cpm: d.cpm, ctr: d.ctr,
        costPerMsg: d.costPerMessage, cqc: ls.qualified ? a.spend / ls.qualified : null, purchases: a.purchases, spend: a.spend, cpc: d.cpc,
        qrate: ls.qualifiedRate, leadCount: ls.valid, quality: chatQuality(ls.qualifiedRate, ls.valid), messages: a.messages,
      };
    }).filter((r) => r.spend > 0 || r.impressions > 0);
  }, [D]);

  // Meta reports daily results per ad, and each ad's Page comes from its creative: grouping those same rows by campaign + Page
  // answers "this campaign runs on several pages — how did each page do" without asking Meta for a Page breakdown (it has none).
  const pageRows: PageRow[] = useMemo(() => {
    const camps = new Map(D.data.campaigns.map((c) => [c.id, c]));
    const pageNames = new Map(D.data.pages.map((p) => [p.id, p.name]));
    const campaignOf = new Map(D.data.ads.map((a) => [a.id, a.campaignId]));
    // Share is measured against the whole campaign (every page), so it stays correct while a Page filter is on.
    const totals = new Map<string, { spend: number; messages: number }>();
    for (const p of D.data.perf) {
      if (p.date < D.range.start || p.date > D.range.end) continue;
      const cid = campaignOf.get(p.adId);
      if (!cid || !camps.has(cid)) continue;
      const t = totals.get(cid) ?? { spend: 0, messages: 0 };
      t.spend += p.spend; t.messages += p.messages; totals.set(cid, t);
    }
    const perfByAd = new Map<string, typeof D.perf>();
    for (const p of D.perf) {
      const list = perfByAd.get(p.adId);
      if (list) list.push(p); else perfByAd.set(p.adId, [p]);
    }
    const groups = new Map<string, Ad[]>();
    for (const ad of D.ads) {
      const c = camps.get(ad.campaignId); if (!c) continue;
      const key = `${ad.campaignId}|${pageOfAd(ad, c)}`;
      const list = groups.get(key);
      if (list) list.push(ad); else groups.set(key, [ad]);
    }
    const out: PageRow[] = [];
    for (const [key, list] of groups) {
      const ids = new Set(list.map((a) => a.id));
      const perf = list.flatMap((a) => perfByAd.get(a.id) ?? []);
      if (!perf.length) continue;
      const a = aggregate(perf), d = derive(a);
      if (a.spend <= 0 && a.impressions <= 0) continue;
      const c = camps.get(list[0].campaignId)!;
      const pid = pageOfAd(list[0], c);
      const ls = leadStats(D.leads.filter((l) => !!l.adId && ids.has(l.adId)));
      const t = totals.get(c.id);
      out.push({
        key, campaignId: c.id, campaign: c.name, pageId: pid, page: pageNames.get(pid) ?? (pid || "—"), ads: list, adCount: list.length,
        spend: a.spend, spendShare: t && t.spend > 0 ? (a.spend / t.spend) * 100 : null,
        messages: a.messages, msgShare: t && t.messages > 0 ? (a.messages / t.messages) * 100 : null,
        costPerMsg: d.costPerMessage, reach: a.reach, impressions: a.impressions, ctr: d.ctr, cpc: d.cpc, purchases: a.purchases,
        valid: ls.valid, qrate: ls.qualifiedRate, quality: chatQuality(ls.qualifiedRate, ls.valid), cqc: ls.qualified ? a.spend / ls.qualified : null,
      });
    }
    return out.sort((x, y) => y.spend - x.spend);
  }, [D]);

  // Outlier thresholds: > 1.5× median cost per message flags "high cost"
  const median = useMemo(() => {
    const v = rows.map((r) => r.costPerMsg).filter((x): x is number => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [rows]);
  const highCost = (r: Row) => median != null && r.costPerMsg != null && r.costPerMsg > median * 1.5;
  const lowPerf = (r: Row) => r.quality === "Poor";
  const pageMedian = useMemo(() => {
    const v = pageRows.map((r) => r.costPerMsg).filter((x): x is number => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [pageRows]);
  const pageHighCost = (r: PageRow) => pageMedian != null && r.costPerMsg != null && r.costPerMsg > pageMedian * 1.5;

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
      <HoverPreview content={<AdPreview ad={r.ad} summary={<AdSummary row={r} />} />} className="w-full" focusable>
        <span className="block min-w-0"><span className="block font-medium text-ink">{r.ad.name}</span><span className="block text-xs text-muted">{r.campaign} · {r.ad.id}</span></span>
      </HoverPreview>) },
    { key: "creative", header: "Creative", render: (r) => <CreativeCell ad={r.ad} preview={<AdPreview ad={r.ad} summary={<AdSummary row={r} />} />} /> },
    { key: "page", header: "Page", minW: 150, sort: (r) => r.page, render: (r) => <span className="text-sm">{r.page || "—"}</span> },
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

  const pageCols: Column<PageRow>[] = [
    { key: "name", header: "Campaign / Page", minW: 240, sticky: true, sort: (r) => `${r.campaign} ${r.page}`, render: (r) => (
      <span className="block min-w-0">
        <span className="block font-medium text-ink">{r.campaign}</span>
        <span className="block text-xs text-muted">{r.page} · {r.adCount} โฆษณา</span>
      </span>) },
    { key: "spend", header: "Spend", align: "right", tip: "ยอดใช้จ่ายของโฆษณาในแคมเปญนี้ที่ลงประกาศจากเพจนี้", sort: (r) => r.spend, render: (r) => (
      <span className="tabnum">{fmtMoney(r.spend)}{r.spendShare != null && <span className="block text-xs text-muted">{fmtPct(r.spendShare, 0)} ของแคมเปญ</span>}</span>) },
    { key: "msg", header: "Messages", align: "right", tip: "Messaging conversations started ตามที่ Meta รายงาน", sort: (r) => r.messages, render: (r) => (
      <span className="tabnum">{fmtInt(r.messages)}{r.msgShare != null && <span className="block text-xs text-muted">{fmtPct(r.msgShare, 0)} ของแคมเปญ</span>}</span>) },
    { key: "cpmsg", header: "Cost / Message", align: "right", tip: "Spend ÷ Messages. Red = more than 1.5× the median of these page rows.", sort: (r) => r.costPerMsg,
      render: (r) => <span className={pageHighCost(r) ? "rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-600" : ""}>{fmtMoney(r.costPerMsg, 1)}</span> },
    { key: "reach", header: "Reach", align: "right", sort: (r) => r.reach, render: (r) => fmtInt(r.reach) },
    { key: "imp", header: "Impressions", align: "right", sort: (r) => r.impressions, render: (r) => fmtInt(r.impressions) },
    { key: "ctr", header: "CTR", align: "right", sort: (r) => r.ctr, render: (r) => fmtPct(r.ctr, 2) },
    { key: "cpc", header: "CPC", align: "right", sort: (r) => r.cpc, render: (r) => fmtMoney(r.cpc, 2) },
    { key: "leads", header: "Leads (CRM)", align: "right", tip: "Valid leads ที่มาจากแคมเปญนี้และเพจนี้ ในช่วงที่เลือก", sort: (r) => r.valid, render: (r) => fmtInt(r.valid) },
    { key: "cqc", header: "CQC", align: "right", tip: "Cost per Qualified Chat = Spend ÷ qualified leads (จาก CRM)", sort: (r) => r.cqc, render: (r) => fmtMoney(r.cqc, 0) },
    { key: "q", header: "Chat Quality", sort: (r) => r.qrate, render: (r) => <ChatQualityBadge q={r.quality} /> },
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

      <Card title="Campaign performance"
        subtitle={view === "ads"
          ? `${rows.length} ads with delivery in this range · hover the ad name or creative to preview the image, copy and results`
          : `${pageRows.length} แถว แคมเปญ × เพจ · เลือกแคมเปญในตัวกรองด้านบนเพื่อเทียบเฉพาะแคมเปญนั้น · กดที่แถวเพื่อดูรายโฆษณา`}
        right={<div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex gap-1">
            <Btn size="sm" variant={view === "ads" ? "primary" : "secondary"} onClick={() => setView("ads")}>รายโฆษณา</Btn>
            <Btn size="sm" variant={view === "pages" ? "primary" : "secondary"} onClick={() => setView("pages")}>แยกตามเพจ</Btn>
          </div>
          {view === "ads" && <Select value={qFilter} onChange={setQFilter} options={[{ value: "all", label: "All chat quality" }, { value: "flag", label: "⚠ High cost / low performance" }, ...["Excellent", "Good", "Average", "Poor", "No data"].map((v) => ({ value: v, label: v }))]} />}
        </div>}>
        {view === "ads" ? <>
          <DataTable columns={cols} rows={filtered} rowKey={(r) => r.ad.id} searchText={(r) => `${r.ad.name} ${r.campaign} ${r.ad.id}`} searchPlaceholder="Search campaign or ad…"
            defaultSort={{ key: "spend", dir: "desc" }} onRowClick={setOpen} rowClass={(r) => (lowPerf(r) ? "bg-red-50/40" : undefined)} caption="Campaign performance" emptyTitle="No ads match" emptyHint="Widen the date range or clear filters." />
          <p className="mt-2 text-xs text-muted">Red cost = more than 1.5× the median cost per message. Red row tint = Poor chat quality.</p>
        </> : <>
          <DataTable columns={pageCols} rows={pageRows} rowKey={(r) => r.key} searchText={(r) => `${r.campaign} ${r.page}`} searchPlaceholder="ค้นหาแคมเปญหรือเพจ…"
            defaultSort={{ key: "spend", dir: "desc" }} onRowClick={setOpenGroup} caption="Campaign by page" exportName="campaign-by-page" pageSize={12}
            emptyTitle="ไม่มีผลรายเพจในช่วงนี้" emptyHint="ลองขยายช่วงวันที่ หรือตรวจว่าซิงก์โฆษณาแล้วและโฆษณามีเพจใน creative" />
          <p className="mt-2 text-xs text-muted">Meta รายงานสถิติรายโฆษณา ไม่ได้แยกตามเพจ — แถวเหล่านี้จึงรวมโฆษณาของแคมเปญเดียวกันที่ลงประกาศจากเพจนั้น (เพจอ่านจาก creative ของแต่ละโฆษณา) โฆษณาที่ creative ไม่ระบุเพจจะถูกนับใต้เพจหลักของแคมเปญตามที่แจ้งในหมายเหตุตอนซิงก์</p>
        </>}
      </Card>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.ad.name ?? ""}>
        {open && <CampaignDetail row={open} />}
      </Drawer>
      <Drawer open={!!openGroup} onClose={() => setOpenGroup(null)} title={openGroup ? `${openGroup.campaign} · ${openGroup.page}` : ""} width={560}>
        {openGroup && <PageGroupDetail group={openGroup} />}
      </Drawer>
    </div>
  );
}

/** The ads behind one campaign-on-one-page row: which creative carries that page, and what each costs. */
function PageGroupDetail({ group }: { group: PageRow }) {
  const D = useDash();
  const ads = useMemo(() => group.ads.map((ad) => {
    const a = aggregate(D.perf.filter((p) => p.adId === ad.id));
    const d = derive(a);
    const ls = leadStats(D.leads.filter((l) => l.adId === ad.id));
    return { ad, spend: a.spend, messages: a.messages, costPerMsg: d.costPerMessage, quality: chatQuality(ls.qualifiedRate, ls.valid) };
  }).filter((r) => r.spend > 0 || r.messages > 0).sort((a, b) => b.spend - a.spend), [D, group]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {[["Spend", fmtMoney(group.spend)], ["Messages", fmtInt(group.messages)], ["Cost / msg", fmtMoney(group.costPerMsg, 1)],
          ["CTR", fmtPct(group.ctr, 2)], ["Leads (CRM)", fmtInt(group.valid)], ["CQC", fmtMoney(group.cqc, 0)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-gray-50 p-2.5"><div className="text-xs text-muted">{k}</div><div className="font-semibold tabnum">{v}</div></div>))}
      </div>
      <p className="text-xs text-muted">
        เพจนี้ใช้ {group.spendShare != null ? fmtPct(group.spendShare, 0) : "—"} ของงบแคมเปญ และได้ {group.msgShare != null ? fmtPct(group.msgShare, 0) : "—"} ของข้อความที่เริ่มในแคมเปญ
      </p>
      <div>
        <p className="mb-1 text-sm font-semibold">โฆษณาของเพจนี้ในแคมเปญ ({ads.length})</p>
        <ul className="divide-y divide-line">
          {ads.length === 0 && <li className="py-6 text-center text-sm text-muted">ไม่มีโฆษณาที่มีผลในช่วงนี้</li>}
          {ads.map((r) => (
            <li key={r.ad.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.ad.name}</span>
                <span className="block text-xs text-muted">{r.ad.id} · {r.ad.status}</span>
              </span>
              <span className="text-right text-sm tabnum">
                <span className="block font-semibold">{fmtMoney(r.spend)}</span>
                <span className="block text-xs text-muted">{fmtInt(r.messages)} msg · {fmtMoney(r.costPerMsg, 1)}/msg</span>
              </span>
              <ChatQualityBadge q={r.quality} />
            </li>
          ))}
        </ul>
      </div>
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
      <div className="flex items-center gap-3"><CreativeCell ad={row.ad} size={56} />
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

/** Compact results shown inside the hover preview. */
function AdSummary({ row }: { row: Row }) {
  const items: [string, string][] = [
    ["Spend", fmtMoney(row.spend)], ["Messages", fmtInt(row.messages)], ["Cost / msg", fmtMoney(row.costPerMsg, 1)],
    ["CTR", fmtPct(row.ctr, 2)], ["CQC", fmtMoney(row.cqc, 0)], ["Purchases", fmtInt(row.purchases)],
  ];
  return (
    <div className="space-y-1.5 border-t border-line pt-2">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-md bg-gray-50 px-1.5 py-1"><div className="text-[10px] text-muted">{k}</div><div className="text-xs font-semibold tabnum">{v}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted"><ChatQualityBadge q={row.quality} />{row.campaign} · {row.page}</div>
    </div>
  );
}
