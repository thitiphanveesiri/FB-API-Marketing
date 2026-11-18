// Pure data-access/business logic: filters in, slices out. No React here.
import { addDays, ANCHOR, diffDays } from "./dates";
import type { Dataset } from "./dataset";
import { Ad, Campaign, DailyPerf, Lead, Role, User } from "./types";

export type Preset = "7d" | "30d" | "90d" | "custom";
export interface Filters {
  preset: Preset;
  start: string;
  end: string;
  pageId: string; // "all" or id
  campaignId: string;
  agencyId: string;
  repId: string;
  adStatus: string;
}
export const defaultFilters = (): Filters => ({
  preset: "30d",
  start: addDays(ANCHOR, -29),
  end: ANCHOR,
  pageId: "all",
  campaignId: "all",
  agencyId: "all",
  repId: "all",
  adStatus: "all",
});
export function applyPreset(f: Filters, preset: Preset): Filters {
  if (preset === "custom") return { ...f, preset };
  const n = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return { ...f, preset, start: addDays(ANCHOR, -(n - 1)), end: ANCHOR };
}
export interface Range { start: string; end: string }
export const rangeOf = (f: Filters): Range => ({ start: f.start <= f.end ? f.start : f.end, end: f.start <= f.end ? f.end : f.start });
export function previousRange(r: Range): Range {
  const len = diffDays(r.end, r.start) + 1;
  return { start: addDays(r.start, -len), end: addDays(r.start, -1) };
}
export const inRange = (d: string, r: Range) => d >= r.start && d <= r.end;

/** What a signed-in user may see. */
export function scopeFor(user: User): { agencyId?: string; repId?: string } {
  if (user.role === "Agency") return { agencyId: user.agencyId };
  if (user.role === "Sales Representative") return { repId: user.id };
  return {};
}

export function effectiveFilters(f: Filters, user: User): Filters {
  const s = scopeFor(user);
  return { ...f, agencyId: s.agencyId ?? f.agencyId, repId: s.repId ?? f.repId };
}

/** The page an ad shows under: its own page when known, otherwise its campaign's (a campaign can serve several pages). */
export const pageOfAd = (a: Ad, campaign?: Campaign) => a.pageId || campaign?.pageId || "";
/** Whether a campaign has anything on a page — the campaign's own page or at least one ad that posts as it. */
export const campaignOnPage = (c: Campaign, ads: Ad[], pageId: string) =>
  pageId === "all" || c.pageId === pageId || ads.some((a) => a.campaignId === c.id && a.pageId === pageId);

export function adsFor(d: Dataset, f: Filters): Ad[] {
  const camps = new Map(d.campaigns.map((c) => [c.id, c]));
  return d.ads.filter((a) => {
    const c = camps.get(a.campaignId);
    if (!c) return false;
    if (f.pageId !== "all" && pageOfAd(a, c) !== f.pageId) return false;
    if (f.campaignId !== "all" && c.id !== f.campaignId) return false;
    if (f.agencyId !== "all" && c.agencyId !== f.agencyId) return false;
    if (f.adStatus !== "all" && a.status !== f.adStatus) return false;
    return true;
  });
}
export function perfFor(d: Dataset, ads: Ad[], r: Range): DailyPerf[] {
  const ids = new Set(ads.map((a) => a.id));
  return d.perf.filter((p) => ids.has(p.adId) && inRange(p.date, r));
}
export function leadsFor(d: Dataset, f: Filters, r: Range | null, opts: { includeDropped?: boolean } = {}): Lead[] {
  const adIds = new Set(adsFor(d, f).map((a) => a.id));
  const adLevelFilter = f.campaignId !== "all" || f.agencyId !== "all" || f.adStatus !== "all";
  const camps = new Map(d.campaigns.map((c) => [c.id, c]));
  const ads = new Map(d.ads.map((a) => [a.id, a]));
  return d.leads.filter((l) => {
    if (!opts.includeDropped && l.dropped) return false;
    if (r && !inRange(l.createdAt, r)) return false;
    if (f.pageId !== "all" && l.pageId !== f.pageId) return false;
    if (f.repId !== "all" && l.repId !== f.repId) return false;
    if (l.adId) {
      if (!adIds.has(l.adId)) return false;
    } else if (adLevelFilter) return false; // unattributed leads can't match ad-level filters
    void camps; void ads;
    return true;
  });
}
/** All leads (incl. dropped) matching filters — used for rate calculations. */
export const allLeadsFor = (d: Dataset, f: Filters, r: Range | null) => leadsFor(d, f, r, { includeDropped: true });

export const roleCan = {
  nav(role: Role, path: string): boolean {
    const map: Record<Role, string[]> = {
      Administrator: ["dashboard", "inbox", "board", "upload", "settings", "quality", "sla", "comments", "followup", "account"],
      "Marketing Manager": ["dashboard", "upload", "quality", "comments", "account", "settings"],
      "Sales Manager": ["dashboard", "inbox", "board", "quality", "sla", "comments", "followup", "account"],
      "Sales Representative": ["dashboard", "inbox", "board", "sla", "followup", "account"],
      Agency: ["dashboard", "account"],
      Viewer: ["dashboard", "account"],
    };
    return map[role].includes(path);
  },
  moveToConverted: (r: Role) => r === "Administrator" || r === "Sales Manager",
  editLeads: (r: Role) => ["Administrator", "Sales Manager", "Sales Representative"].includes(r),
  reassign: (r: Role) => r === "Administrator" || r === "Sales Manager",
  evaluate: (r: Role) => r === "Administrator" || r === "Sales Manager",
  upload: (r: Role) => r === "Administrator" || r === "Marketing Manager",
  manageSettings: (r: Role) => r === "Administrator",
  viewAgenciesSettings: (r: Role) => r === "Administrator" || r === "Marketing Manager",
  salesTabs: (r: Role) => r !== "Agency",
};
