// Pull ads + daily results straight from a Meta ad account (Marketing API) and turn them into sheet rows.
// Pure apart from the injected fetch. One call = one small batch (Vercel time limits).
import { FbError, graph, type FetchFn } from "./fbSync";
import type { SyncWrite } from "./fbSync";

export type AdsPhase = "ads" | "insights" | "done";
export interface AdsState { phase: AdsPhase; after?: string }
export interface AdsCounts { ads: number; campaigns: number; rows: number }
export interface AdsInput { accountId: string; token: string; sheetPageId: string; days: number; state: AdsState; now?: Date; fetchFn?: FetchFn; base?: string }
export interface AdsOutput { next: AdsState; writes: SyncWrite[]; counts: AdsCounts }

const ADS_PER_CALL = 40, INSIGHT_ROWS_PER_CALL = 200;
const ALL_STATUS = JSON.stringify(["ACTIVE", "PAUSED", "DELETED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ARCHIVED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"]);

export const actId = (raw: string) => "act_" + raw.replace(/\D/g, "");
export function adStatus(effective: string | undefined): "Active" | "Paused" | "Ended" {
  const s = (effective ?? "").toUpperCase();
  if (s === "ACTIVE") return "Active";
  if (s === "PAUSED" || s === "CAMPAIGN_PAUSED" || s === "ADSET_PAUSED" || s === "IN_PROCESS" || s === "PENDING_REVIEW" || s === "PREAPPROVED") return "Paused";
  return "Ended";
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
type Action = { action_type?: string; value?: string };
const act = (a: Action[] | undefined, types: string[]) => (a ?? []).filter((x) => x.action_type && types.includes(x.action_type)).reduce((s, x) => Math.max(s, num(x.value)), 0);

interface RawAd { id: string; name?: string; effective_status?: string; updated_time?: string; campaign?: { id?: string; name?: string; objective?: string }; creative?: { thumbnail_url?: string; image_url?: string; video_id?: string; object_type?: string } }
interface RawInsight { ad_id?: string; date_start?: string; spend?: string; reach?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; actions?: Action[] }

export async function adsStep(i: AdsInput): Promise<AdsOutput> {
  const f = i.fetchFn ?? ((u: string) => fetch(u, { cache: "no-store" }) as ReturnType<FetchFn>), base = i.base ?? "https://graph.facebook.com";
  const acct = actId(i.accountId), now = i.now ?? new Date();
  const counts: AdsCounts = { ads: 0, campaigns: 0, rows: 0 }, writes: SyncWrite[] = [];

  if (i.state.phase === "ads") {
    const j = await graph(`${acct}/ads`, { fields: "id,name,effective_status,updated_time,campaign{id,name,objective},creative{thumbnail_url,image_url,video_id,object_type}", effective_status: ALL_STATUS, limit: String(ADS_PER_CALL), ...(i.state.after ? { after: i.state.after } : {}) }, i.token, f, base);
    const ads = (j.data ?? []) as RawAd[];
    const camps = new Map<string, Record<string, string>>(), adRows: SyncWrite["rows"] = [];
    for (const a of ads) {
      const cid = a.campaign?.id; if (!cid) continue; // an ad without a campaign cannot be shown
      camps.set(cid, { campaign_id: cid, name: a.campaign?.name || cid, page_id: i.sheetPageId, objective: a.campaign?.objective || camps.get(cid)?.objective || "" });
      const c = a.creative ?? {}, video = c.object_type === "VIDEO" || !!c.video_id;
      adRows.push({ ad_id: a.id, name: a.name || a.id, campaign_id: cid, status: adStatus(a.effective_status), creative_type: video ? "Video" : "Image",
        updated_at: (a.updated_time ?? "").slice(0, 10) || day(now), creative_url: c.image_url || c.thumbnail_url || "", video_url: c.video_id ? `https://www.facebook.com/watch/?v=${c.video_id}` : "" });
    }
    counts.ads = adRows.length; counts.campaigns = camps.size;
    if (camps.size) writes.push({ tab: "campaigns", keyCols: ["campaign_id"], rows: [...camps.values()], mode: "upsert" });
    if (adRows.length) writes.push({ tab: "ads", keyCols: ["ad_id"], rows: adRows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    return { next: more ? { phase: "ads", after: j.paging!.cursors!.after } : { phase: "insights" }, writes, counts };
  }

  if (i.state.phase === "insights") {
    const since = day(new Date(now.getTime() - i.days * 86400000)), until = day(now);
    const j = await graph(`${acct}/insights`, { level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }), fields: "ad_id,spend,reach,impressions,clicks,inline_link_clicks,actions", limit: String(INSIGHT_ROWS_PER_CALL), ...(i.state.after ? { after: i.state.after } : {}) }, i.token, f, base);
    const rows: SyncWrite["rows"] = [];
    for (const r of (j.data ?? []) as RawInsight[]) {
      if (!r.ad_id || !r.date_start) continue;
      rows.push({ date: r.date_start, ad_id: r.ad_id, spend: num(r.spend), reach: num(r.reach), impressions: num(r.impressions), clicks: num(r.inline_link_clicks ?? r.clicks),
        messages: act(r.actions, ["onsite_conversion.messaging_conversation_started_7d"]), purchases: act(r.actions, ["omni_purchase", "purchase"]) });
    }
    counts.rows = rows.length;
    if (rows.length) writes.push({ tab: "ad_performance", keyCols: ["date", "ad_id"], rows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    return { next: more ? { phase: "insights", after: j.paging!.cursors!.after } : { phase: "done" }, writes, counts };
  }
  return { next: { phase: "done" }, writes, counts };
}

/** Checks the token + account before saving anything. */
export async function checkAdAccount(accountId: string, token: string, f: FetchFn, base: string): Promise<{ name: string; currency: string; timezone: string }> {
  const j = (await graph(actId(accountId), { fields: "name,currency,timezone_name,account_status" }, token, f, base).catch((e) => {
    if (e instanceof FbError && !e.rateLimited) throw new FbError(`เข้าถึงบัญชีโฆษณาไม่ได้: ${e.message} — ตรวจว่า Ad Account ID ถูกต้อง โทเคนมีสิทธิ์ ads_read และคุณเป็นผู้ดูแลบัญชีโฆษณานี้`, false, e.code);
    throw e;
  })) as unknown as { name?: string; currency?: string; timezone_name?: string };
  return { name: j.name ?? "", currency: j.currency ?? "", timezone: j.timezone_name ?? "" };
}
