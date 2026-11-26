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
  const columns = new Map(SHEET_TABS.map((spec) => [spec.tab, spec.cols.map((col) => col.name)]));
  const push = (tab: string, values: Record<string, unknown>) => {
    const names = columns.get(tab);
    if (!names) throw new Error(`Unknown sheet tab ${tab}`);
    t[tab].push(names.map((name) => s(values[name])));
  };

  d.pages.forEach((p) => push("pages", {
    page_id: p.id, name: p.name, agency_id: p.agencyId, active: String(p.active).toUpperCase(),
    sales_team: p.teamIds.join(","),
  }));
  d.agencies.forEach((a) => push("agencies", {
    agency_id: a.id, name: a.name, contact: a.contact, email: a.email, active: String(a.active).toUpperCase(),
  }));
  d.users.forEach((u) => push("users", {
    user_id: u.id, name: u.name, email: u.email, role: u.role, agency_id: u.agencyId, active: String(u.active).toUpperCase(),
  }));
  d.campaigns.forEach((c) => push("campaigns", {
    campaign_id: c.id, name: c.name, page_id: c.pageId, agency_id: c.agencyId, objective: c.objective,
  }));
  d.ads.forEach((a) => push("ads", {
    ad_id: a.id, name: a.name, campaign_id: a.campaignId, status: a.status, creative_type: a.creative.type, updated_at: a.updatedAt,
    creative_url: a.creative.url, video_url: a.creative.video, caption: a.caption, headline: a.headline, page_id: a.pageId, creative_ref: a.creative.ref,
  }));
  d.perf.forEach((p) => push("ad_performance", {
    date: p.date, ad_id: p.adId, spend: p.spend, reach: p.reach, impressions: p.impressions,
    clicks: p.clicks, clicks_all: p.clicksAll, messages: p.messages, purchases: p.purchases,
  }));
  d.leads.forEach((l) => push("leads", {
    lead_id: l.id, name: l.name, page_id: l.pageId, ad_id: l.adId, assigned_to: l.repId, status: l.status, quality: l.quality,
    valid: String(l.valid).toUpperCase(), created_at: l.createdAt, last_contact_at: l.lastContactAt.replace("T", " ").slice(0, 16),
    last_message: l.lastMessage, follow_up_date: l.followUpDate, phone: l.phone, email: l.email, phone2: l.phone2, whatsapp: l.whatsapp,
    lead_source: l.leadSource, form: l.form, labels: l.labels, first_response_min: l.firstResponseMin, follow_ups: l.followUps,
    avg_follow_up_hrs: l.avgFollowUpHrs, unread: String(l.unread).toUpperCase(), drop_reason: l.dropped?.reason, dropped_at: l.dropped?.at,
    previous_status: l.dropped?.previousStatus, recovery_status: l.dropped?.recovery, last_activity: l.dropped?.lastActivity,
    channel: l.channel, fb_user_id: l.fbUserId,
  }));
  Object.values(d.messages).flat().forEach((m) => push("messages", {
    message_id: m.id, lead_id: m.leadId, direction: m.direction, text: m.text, sent_at: m.at.replace("T", " ").slice(0, 16),
    attachment_name: m.attachment?.name, sent_by: m.sentBy, sender_type: m.senderType, sender_app: m.senderApp,
  }));
  return t;
}
