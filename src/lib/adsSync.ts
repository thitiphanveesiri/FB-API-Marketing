// Pull ads + daily results straight from a Meta ad account (Marketing API) and turn them into sheet rows.
// Pure apart from the injected fetch. One call = one small batch (Vercel time limits).
import { FbError, graph, type FetchFn, type Graph } from "./fbSync";
import type { SyncWrite } from "./fbSync";

export type AdsPhase = "ads" | "insights" | "done";
export interface AdsState { phase: AdsPhase; after?: string; fallback?: boolean; tier?: number }
export interface AdsCounts { ads: number; campaigns: number; rows: number }
/** pageMap: Facebook page id → page id in the system. An ad account can serve several pages, so each ad's page comes from the page its creative posts as. */
export interface AdsInput { accountId: string; token: string; sheetPageId: string; days: number; state: AdsState; now?: Date; fetchFn?: FetchFn; base?: string; pageMap?: Record<string, string>; pageNames?: Record<string, string> }
export interface AdsOutput { next: AdsState; writes: SyncWrite[]; counts: AdsCounts; warning?: string; byPage?: Record<string, number> }

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

interface RawAd { id: string; name?: string; effective_status?: string; updated_time?: string; campaign?: { id?: string; name?: string; objective?: string }; creative?: { thumbnail_url?: string; image_url?: string; video_id?: string; object_type?: string; effective_object_story_id?: string; object_story_spec?: { page_id?: string } } }
interface RawInsight { ad_id?: string; date_start?: string; spend?: string; reach?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; actions?: Action[] }

export async function adsStep(i: AdsInput): Promise<AdsOutput> {
  const f = i.fetchFn ?? ((u: string) => fetch(u, { cache: "no-store" }) as ReturnType<FetchFn>), base = i.base ?? "https://graph.facebook.com";
  const acct = actId(i.accountId), now = i.now ?? new Date();
  const counts: AdsCounts = { ads: 0, campaigns: 0, rows: 0 }, writes: SyncWrite[] = [];

  if (i.state.phase === "ads") {
    // Detail levels, richest first. When Meta rejects one (code 100 invalid parameter, or 1/2 "unexpected error" for too much data) the next lighter one is tried,
    // and later batches stay on the level that worked — so a single bad field costs only that field, not the whole ad list.
    const CAMP = "campaign{id,name,objective}";
    const TIERS = [
      { fields: `id,name,effective_status,updated_time,${CAMP},creative{thumbnail_url,image_url,video_id,object_type,effective_object_story_id,object_story_spec{page_id}}`, filter: true, limit: ADS_PER_CALL, note: "" },
      { fields: `id,name,effective_status,updated_time,${CAMP},creative{thumbnail_url,image_url,video_id,object_type,effective_object_story_id,object_story_spec{page_id}}`, filter: false, limit: 25, note: "ไม่ใช้ตัวกรองสถานะ" },
      { fields: `id,name,effective_status,updated_time,${CAMP},creative{thumbnail_url,image_url,effective_object_story_id}`, filter: false, limit: 25, note: "ไม่ดึงข้อมูลวิดีโอ" },
      { fields: "id,name,effective_status,updated_time,campaign{id,name},creative{thumbnail_url,image_url}", filter: false, limit: 25, note: "ไม่ดึงวัตถุประสงค์แคมเปญและการจับคู่เพจจากตัวโฆษณา" },
      { fields: "id,name,effective_status,updated_time,campaign{id,name}", filter: false, limit: 25, note: "ไม่ดึงภาพโฆษณาและการจับคู่เพจจากตัวโฆษณา" },
    ];
    const fetchAds = (t: number) => graph(`${acct}/ads`, {
      fields: TIERS[t].fields, ...(TIERS[t].filter ? { effective_status: ALL_STATUS } : {}), limit: String(TIERS[t].limit), ...(i.state.after ? { after: i.state.after } : {}),
    }, i.token, f, base);
    let tier = Math.min(TIERS.length - 1, Math.max(0, i.state.tier ?? (i.state.fallback ? TIERS.length - 1 : 0)));
    let j: Graph | undefined, lastErr: FbError | undefined;
    for (; tier < TIERS.length; tier++) {
      try { j = await fetchAds(tier); break; }
      catch (e) {
        if (!(e instanceof FbError)) throw e;
        lastErr = e;
        if (e.rateLimited || (e.code !== 100 && e.code !== 1 && e.code !== 2) || i.state.after) break; // only the first batch can change level (a paging cursor belongs to its query)
      }
    }
    if (!j) throw new FbError(`ดึงรายการโฆษณาไม่สำเร็จ${tier > 0 ? ` (ลองลดรายละเอียดแล้ว ${Math.min(tier + 1, TIERS.length)} ระดับ)` : ""}: ${lastErr?.message ?? "ไม่ทราบสาเหตุ"}`, lastErr?.rateLimited ?? false, lastErr?.code);
    const ads = (j.data ?? []) as RawAd[];
    const camps = new Map<string, Record<string, string>>(), adRows: SyncWrite["rows"] = [];
    for (const a of ads) {
      const cid = a.campaign?.id; if (!cid) continue; // an ad without a campaign cannot be shown
      const c = a.creative ?? {}, video = c.object_type === "VIDEO" || !!c.video_id;
      const fbPage = c.object_story_spec?.page_id || c.effective_object_story_id?.split("_")[0] || "";
      // Prefer the creative's Page ID; otherwise use a unique Page-name match in the ad/campaign name.
      const nameHit = Object.entries(i.pageNames ?? {}).filter(([, name]) => name.trim().length >= 3 && `${a.campaign?.name ?? ""} ${a.name ?? ""}`.toLowerCase().includes(name.trim().toLowerCase()));
      const mapped = (fbPage ? i.pageMap?.[fbPage] : undefined) ?? (nameHit.length === 1 ? nameHit[0][0] : undefined);
      camps.set(cid, { campaign_id: cid, name: a.campaign?.name || cid, page_id: mapped ?? camps.get(cid)?.page_id ?? i.sheetPageId, objective: a.campaign?.objective || camps.get(cid)?.objective || "" });
      adRows.push({ ad_id: a.id, name: a.name || a.id, campaign_id: cid, status: adStatus(a.effective_status), creative_type: video ? "Video" : "Image",
        updated_at: (a.updated_time ?? "").slice(0, 10) || day(now), creative_url: c.image_url || c.thumbnail_url || "", video_url: c.video_id ? `https://www.facebook.com/watch/?v=${c.video_id}` : "" });
    }
    counts.ads = adRows.length; counts.campaigns = camps.size;
    const byPage: Record<string, number> = {};
    for (const campaign of camps.values()) byPage[campaign.page_id] = (byPage[campaign.page_id] ?? 0) + 1;
    if (camps.size) writes.push({ tab: "campaigns", keyCols: ["campaign_id"], rows: [...camps.values()], mode: "upsert" });
    if (adRows.length) writes.push({ tab: "ads", keyCols: ["ad_id"], rows: adRows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    return {
      next: more ? { phase: "ads", after: j.paging!.cursors!.after, ...(tier > 0 ? { tier } : {}) } : { phase: "insights" },
      writes,
      counts, byPage,
      ...(tier > 0 ? { warning: `Meta ปฏิเสธคำขอแบบละเอียด จึงลดรายละเอียดลง: ${TIERS[tier].note} (ระดับ ${tier + 1}/${TIERS.length})` } : {}),
    };
  }

  if (i.state.phase === "insights") {
    const since = day(new Date(now.getTime() - i.days * 86400000)), until = day(now);
    // Full field list first; if Meta rejects it (code 100) the same query is retried with the core fields only, and later batches keep using them.
    const FULL = "ad_id,spend,reach,impressions,clicks,inline_link_clicks,actions", CORE = "ad_id,spend,impressions,clicks,actions";
    const insights = (fields: string) => graph(`${acct}/insights`, { level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }), fields, limit: String(INSIGHT_ROWS_PER_CALL), ...(i.state.after ? { after: i.state.after } : {}) }, i.token, f, base);
    let j: Graph, core = i.state.fallback === true;
    try {
      try { j = await insights(core ? CORE : FULL); }
      catch (e) { if (core || !(e instanceof FbError) || e.code !== 100 || i.state.after) throw e; core = true; j = await insights(CORE); }
    } catch (e) { if (e instanceof FbError) throw new FbError(`ดึงสถิติรายวันไม่สำเร็จ: ${e.message}`, e.rateLimited, e.code); throw e; }
    const rows: SyncWrite["rows"] = [];
    for (const r of (j.data ?? []) as RawInsight[]) {
      if (!r.ad_id || !r.date_start) continue;
      rows.push({ date: r.date_start, ad_id: r.ad_id, spend: num(r.spend), reach: num(r.reach), impressions: num(r.impressions), clicks: num(r.inline_link_clicks ?? r.clicks),
        messages: act(r.actions, ["onsite_conversion.messaging_conversation_started_7d"]), purchases: act(r.actions, ["omni_purchase", "purchase"]) });
    }
    counts.rows = rows.length;
    if (rows.length) writes.push({ tab: "ad_performance", keyCols: ["date", "ad_id"], rows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    return { next: more ? { phase: "insights", after: j.paging!.cursors!.after, ...(core ? { fallback: true } : {}) } : { phase: "done" }, writes, counts, ...(core ? { warning: "Meta ปฏิเสธฟิลด์ reach/คลิกลิงก์ จึงดึงสถิติแบบพื้นฐาน (รีชอาจเป็น 0)" } : {}) };
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

/** Ad accounts a (user) token can see: lets one pasted token connect the pages AND the ad accounts. Disabled / closed accounts are left out. */
export async function listAdAccounts(token: string, f: FetchFn, base: string): Promise<{ id: string; name: string }[]> {
  const j = await graph("me/adaccounts", { fields: "account_id,name,account_status", limit: "50" }, token, f, base);
  return ((j.data ?? []) as { account_id?: string; id?: string; name?: string; account_status?: number }[])
    .filter((a) => ![2, 101].includes(Number(a.account_status)))
    .map((a) => ({ id: String(a.account_id ?? a.id ?? "").replace(/\D/g, ""), name: a.name ?? "" }))
    .filter((a) => a.id.length >= 5);
}
