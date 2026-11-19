// Dataset -> sheet rows. Used to generate the sample workbook and to round-trip-test the mapper.
import type { Dataset } from "./dataset";
import { RawTabs } from "./sheetMapper";
import { SHEET_TABS } from "./sheetSchema";

export function headersOnly(): RawTabs {
  return Object.fromEntries(SHEET_TABS.map((t) => [t.tab, [t.cols.map((c) => c.name)]]));
}
export function datasetToTabs(d: Dataset): RawTabs {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const t = headersOnly();
  d.pages.forEach((p) => t.pages.push([p.id, p.name, s(p.agencyId), String(p.active).toUpperCase(), p.teamIds.join(",")]));
  d.agencies.forEach((a) => t.agencies.push([a.id, a.name, a.contact, a.email, String(a.active).toUpperCase()]));
  d.users.forEach((u) => t.users.push([u.id, u.name, u.email, u.role, s(u.agencyId), String(u.active).toUpperCase()]));
  d.campaigns.forEach((c) => t.campaigns.push([c.id, c.name, c.pageId, c.agencyId, c.objective]));
  d.ads.forEach((a) => t.ads.push([a.id, a.name, a.campaignId, a.status, a.creative.type, a.updatedAt, a.creative.url ?? "", a.creative.video ?? "", a.caption ?? "", a.headline ?? "", a.pageId ?? ""]));
  d.perf.forEach((p) => t.ad_performance.push([p.date, p.adId, s(p.spend), s(p.reach), s(p.impressions), s(p.clicks), s(p.messages), s(p.purchases)]));
  d.leads.forEach((l) => t.leads.push([l.id, l.name, l.pageId, s(l.adId), s(l.repId), l.status, l.quality, String(l.valid).toUpperCase(), l.createdAt,
    l.lastContactAt.replace("T", " ").slice(0, 16), l.lastMessage, s(l.followUpDate), l.phone, l.email, s(l.firstResponseMin), s(l.followUps), s(l.avgFollowUpHrs), String(l.unread).toUpperCase(),
    s(l.dropped?.reason), s(l.dropped?.at), s(l.dropped?.previousStatus), s(l.dropped?.recovery), s(l.dropped?.lastActivity)]));
  Object.values(d.messages).flat().forEach((m) => t.messages.push([m.id, m.leadId, m.direction, m.text, m.at.replace("T", " ").slice(0, 16), m.attachment?.name ?? ""]));
  return t;
}
