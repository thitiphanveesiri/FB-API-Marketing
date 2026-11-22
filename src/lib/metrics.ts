import { Ad, Lead, DailyPerf, LeadQuality, LeadStatus, QUALIFIED_QUALITIES, QUALITIES, STATUSES } from "./types";

export type Num = number | null; // null = unavailable (distinct from 0)

export const CURRENCY = "฿";

export const safeDiv = (a: number, b: number): Num => (b > 0 ? a / b : null);

export const fmtInt = (n: Num) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtCompact = (n: Num) =>
  n == null ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const fmtMoney = (n: Num, d = 0) =>
  n == null ? "—" : `${CURRENCY}${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const fmtPct = (n: Num, d = 1) => (n == null ? "—" : `${n.toFixed(d)}%`);
export const fmtDec = (n: Num, d = 2) => (n == null ? "—" : n.toFixed(d));
export const fmtMins = (n: Num) => {
  if (n == null) return "—";
  if (n < 60) return `${Math.round(n)} min`;
  const h = n / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
};
export const fmtHrs = (n: Num) => (n == null ? "—" : n < 48 ? `${n.toFixed(1)} h` : `${(n / 24).toFixed(1)} d`);

export interface PerfAgg {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  clicksAll: number;
  /** rows that carried clicks (all): tells "not synced" from a real zero */
  clicksAllRows: number;
  messages: number;
  purchases: number;
  rows: number;
}
export const emptyAgg = (): PerfAgg => ({ spend: 0, reach: 0, impressions: 0, clicks: 0, clicksAll: 0, clicksAllRows: 0, messages: 0, purchases: 0, rows: 0 });

export function aggregate(rows: DailyPerf[]): PerfAgg {
  const a = emptyAgg();
  for (const r of rows) {
    a.spend += r.spend;
    a.reach += r.reach; // NOTE: Meta reach is not additive across days; summed here as an approximation.
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    if (r.clicksAll != null) { a.clicksAll += r.clicksAll; a.clicksAllRows++; }
    a.messages += r.messages;
    a.purchases += r.purchases;
    a.rows++;
  }
  return a;
}

export interface Derived {
  cpm: Num;
  ctr: Num;
  cpc: Num;
  ctrAll: Num;
  cpcAll: Num;
  costPerMessage: Num;
  costPerPurchase: Num;
}
export function derive(a: PerfAgg): Derived {
  return {
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    ctr: safeDiv(a.clicks, a.impressions) == null ? null : (a.clicks / a.impressions) * 100,
    cpc: safeDiv(a.spend, a.clicks),
    ctrAll: a.clicksAllRows > 0 && a.impressions > 0 ? (a.clicksAll / a.impressions) * 100 : null,
    cpcAll: a.clicksAllRows > 0 ? safeDiv(a.spend, a.clicksAll) : null,
    costPerMessage: safeDiv(a.spend, a.messages),
    costPerPurchase: safeDiv(a.spend, a.purchases),
  };
}

export interface LeadStats {
  total: number;
  valid: number;
  byQuality: Record<LeadQuality, number>;
  byStatus: Record<LeadStatus, number>;
  qualified: number;
  converted: number;
  qualifiedRate: Num; // Qualified / valid * 100
  conversionRate: Num; // Converted / qualified * 100
}
export function leadStats(leads: Lead[]): LeadStats {
  const byQuality = Object.fromEntries(QUALITIES.map((q) => [q, 0])) as Record<LeadQuality, number>;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  let valid = 0, qualified = 0, converted = 0;
  for (const l of leads) {
    if (!l.valid) continue; // invalid / spam leads are excluded everywhere (no double counting)
    valid++;
    byQuality[l.quality]++;
    byStatus[l.status]++;
    if (QUALIFIED_QUALITIES.includes(l.quality)) qualified++;
    if (l.status === "Converted") converted++;
  }
  return {
    total: leads.length,
    valid,
    byQuality,
    byStatus,
    qualified,
    converted,
    qualifiedRate: valid ? (qualified / valid) * 100 : null,
    conversionRate: qualified ? (converted / qualified) * 100 : null,
  };
}

export const pctChange = (cur: Num, prev: Num): Num =>
  cur == null || prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

export type ChatQuality = "Excellent" | "Good" | "Average" | "Poor" | "No data";
export function chatQuality(rate: Num, leadCount: number): ChatQuality {
  if (rate == null || leadCount < 3) return "No data"; // too few leads to grade fairly
  if (rate >= 40) return "Excellent";
  if (rate >= 25) return "Good";
  if (rate >= 12) return "Average";
  return "Poor";
}

export interface SalesRow {
  repId: string;
  assigned: number;
  responded: number;
  notResponded: number;
  qualified: number;
  appointments: number;
  converted: number;
  conversionRate: Num;
  qualifiedRate: Num;
  avgResponseMin: Num;
  avgFollowUpHrs: Num;
  followUpRate: Num;
  score: number | null;
  rank: number;
}
/**
 * Performance score (0–100): balances outcome, quality, speed, diligence and load.
 *   30% conversion (25% conv. = full marks) · 25% qualified rate (50% = full)
 *   20% first-response speed (≤5 min full, ≥120 min zero) · 15% follow-up rate
 *   10% workload (assigned vs team average, capped at 1)
 * Raw lead volume alone never ranks anyone.
 */
export function salesRows(leads: Lead[], repIds: string[]): SalesRow[] {
  const valid = leads.filter((l) => l.valid);
  const rows: SalesRow[] = repIds.map((repId) => {
    const mine = valid.filter((l) => l.repId === repId);
    const responded = mine.filter((l) => l.firstResponseMin != null);
    const qualified = mine.filter((l) => QUALIFIED_QUALITIES.includes(l.quality));
    const converted = mine.filter((l) => l.status === "Converted");
    const withFollow = responded.filter((l) => l.followUps > 0);
    const fu = mine.filter((l) => l.avgFollowUpHrs != null);
    return {
      repId,
      assigned: mine.length,
      responded: responded.length,
      notResponded: mine.length - responded.length,
      qualified: qualified.length,
      appointments: mine.filter((l) => l.quality === "Appointment Booked" || l.quality === "Connection Created").length,
      converted: converted.length,
      conversionRate: qualified.length ? (converted.length / qualified.length) * 100 : null,
      qualifiedRate: mine.length ? (qualified.length / mine.length) * 100 : null,
      avgResponseMin: responded.length ? responded.reduce((s, l) => s + (l.firstResponseMin ?? 0), 0) / responded.length : null,
      avgFollowUpHrs: fu.length ? fu.reduce((s, l) => s + (l.avgFollowUpHrs ?? 0), 0) / fu.length : null,
      followUpRate: responded.length ? (withFollow.length / responded.length) * 100 : null,
      score: null,
      rank: 0,
    };
  });
  const active = rows.filter((r) => r.assigned > 0);
  const avgAssigned = active.length ? active.reduce((s, r) => s + r.assigned, 0) / active.length : 0;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  for (const r of rows) {
    if (r.assigned < 3) continue; // not enough volume to score fairly
    const conv = clamp((r.conversionRate ?? 0) / 25);
    const qual = clamp((r.qualifiedRate ?? 0) / 50);
    const speed = r.avgResponseMin == null ? 0 : clamp(1 - (r.avgResponseMin - 5) / 115);
    const fol = clamp((r.followUpRate ?? 0) / 100);
    const load = avgAssigned ? clamp(r.assigned / avgAssigned) : 0;
    r.score = Math.round((0.3 * conv + 0.25 * qual + 0.2 * speed + 0.15 * fol + 0.1 * load) * 100);
  }
  const ranked = [...rows].filter((r) => r.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  ranked.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function adById(ads: Ad[]): Map<string, Ad> {
  return new Map(ads.map((a) => [a.id, a]));
}
