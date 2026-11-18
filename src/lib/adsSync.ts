// Pull ads + daily results straight from a Meta ad account (Marketing API) and turn them into sheet rows.
// Pure apart from the injected fetch. One call = one small batch (Vercel time limits).
import { FbError, graph, metaFetch, type FetchFn, type Graph } from "./fbSync";
import type { SyncWrite } from "./fbSync";

export type AdsPhase = "ads" | "insights" | "done";
/** tier = level of detail of the ad list; win = which 30-day window of the daily results; lim = rows per page of the daily results (smaller after Meta says "too much data"). */
export interface AdsState { phase: AdsPhase; after?: string; fallback?: boolean; tier?: number; win?: number; lim?: number }
export interface AdsCounts { ads: number; campaigns: number; rows: number }
/** pageMap: Facebook page id → page id in the system. An ad account can serve several pages, so each ad's page comes from the page its creative posts as. */
export interface AdsInput { accountId: string; token: string; sheetPageId: string; days: number; state: AdsState; now?: Date; fetchFn?: FetchFn; base?: string; pageMap?: Record<string, string>; pageNames?: Record<string, string> }
export interface AdsOutput { next: AdsState; writes: SyncWrite[]; counts: AdsCounts; warning?: string; byPage?: Record<string, number> }

const ADS_PER_CALL = 40, INSIGHT_LIMITS = [200, 100, 50, 25], WINDOW_DAYS = 30;
/** One request to our own route must finish inside the platform limit (60 s). Past this many ms no further fallback is attempted: fail with a clear message instead. */
const BUDGET_MS = 40000;
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
  const f = i.fetchFn ?? metaFetch, base = i.base ?? "https://graph.facebook.com";
  const acct = actId(i.accountId), now = i.now ?? new Date(), t0 = Date.now(), overBudget = () => Date.now() - t0 > BUDGET_MS;
  const counts: AdsCounts = { ads: 0, campaigns: 0, rows: 0 }, writes: SyncWrite[] = [];

  if (i.state.phase === "ads") {
    // Detail levels, richest first. When Meta rejects one (code 100 invalid parameter, or 1/2 "unexpected error" for too much data) the next lighter one is tried,
    // and later batches stay on the level that worked — so a single bad field costs only that field, not the whole ad list.
    const CAMP = "campaign{id,name,objective}";
    // Every level keeps the creative's Page (object_story_spec / effective_object_story_id): page mapping is what files an ad
    // under the right page, so dropping it while Meta refuses heavier fields would send the whole campaign to the default page.
    const PAGE = "effective_object_story_id,object_story_spec{page_id}";
    const TIERS = [
      { fields: `id,name,effective_status,updated_time,${CAMP},creative{thumbnail_url,image_url,video_id,object_type,${PAGE}}`, filter: true, limit: ADS_PER_CALL, note: "" },
      { fields: `id,name,effective_status,updated_time,${CAMP},creative{thumbnail_url,image_url,video_id,object_type,${PAGE}}`, filter: false, limit: 25, note: "ไม่ใช้ตัวกรองสถานะ" },
      { fields: `id,name,effective_status,updated_time,${CAMP},creative{thumbnail_url,image_url,${PAGE}}`, filter: false, limit: 25, note: "ไม่ดึงข้อมูลวิดีโอ" },
      { fields: `id,name,effective_status,updated_time,campaign{id,name},creative{thumbnail_url,image_url,${PAGE}}`, filter: false, limit: 25, note: "ไม่ดึงวัตถุประสงค์แคมเปญ" },
      { fields: `id,name,effective_status,updated_time,campaign{id,name},creative{${PAGE}}`, filter: false, limit: 25, note: "ไม่ดึงภาพโฆษณา" },
    ];
    // A heavy query that Meta refused (or that timed out) is not repeated: the next lighter level is tried at once. Only the lightest level may repeat once.
    const fetchAds = (t: number) => graph(`${acct}/ads`, {
      fields: TIERS[t].fields, ...(TIERS[t].filter ? { effective_status: ALL_STATUS } : {}), limit: String(TIERS[t].limit), ...(i.state.after ? { after: i.state.after } : {}),
    }, i.token, f, base, 900, t >= TIERS.length - 1 ? 1 : 0);
    let tier = Math.min(TIERS.length - 1, Math.max(0, i.state.tier ?? (i.state.fallback ? TIERS.length - 1 : 0)));
    let j: Graph | undefined, lastErr: FbError | undefined;
    for (; tier < TIERS.length; tier++) {
      try { j = await fetchAds(tier); break; }
      catch (e) {
        if (!(e instanceof FbError)) throw e;
        lastErr = e;
        if (e.rateLimited || (e.code !== 100 && e.code !== 1 && e.code !== 2) || i.state.after || overBudget()) break; // only the first batch can change level (a paging cursor belongs to its query)
      }
    }
    if (!j) throw new FbError(`ดึงรายการโฆษณาไม่สำเร็จ${tier > 0 ? ` (ลองลดรายละเอียดแล้ว ${Math.min(tier + 1, TIERS.length)} ระดับ)` : ""}: ${lastErr?.message ?? "ไม่ทราบสาเหตุ"}`, lastErr?.rateLimited ?? false, lastErr?.code);
    const ads = (j.data ?? []) as RawAd[];
    const camps = new Map<string, Record<string, string>>(), adRows: SyncWrite["rows"] = [], unmapped = new Set<string>();
    let noPage = 0;
    for (const a of ads) {
      const cid = a.campaign?.id; if (!cid) continue; // an ad without a campaign cannot be shown
      const c = a.creative ?? {}, video = c.object_type === "VIDEO" || !!c.video_id;
      const fbPage = c.object_story_spec?.page_id || c.effective_object_story_id?.split("_")[0] || "";
      // Prefer the creative's Page ID; otherwise use a unique Page-name match in the ad/campaign name.
      const nameHit = Object.entries(i.pageNames ?? {}).filter(([, name]) => name.trim().length >= 3 && `${a.campaign?.name ?? ""} ${a.name ?? ""}`.toLowerCase().includes(name.trim().toLowerCase()));
      const viaMap = fbPage ? i.pageMap?.[fbPage] : undefined;
      const mapped = (viaMap && (!i.pageNames || i.pageNames[viaMap]) ? viaMap : undefined) ?? (nameHit.length === 1 ? nameHit[0][0] : undefined);
      if (fbPage && !mapped) unmapped.add(fbPage); // the mapper would drop a campaign whose page does not exist, so fall back to the account's default page
      else if (!fbPage && !mapped) noPage++;
      camps.set(cid, { campaign_id: cid, name: a.campaign?.name || cid, page_id: mapped ?? camps.get(cid)?.page_id ?? i.sheetPageId, objective: a.campaign?.objective || camps.get(cid)?.objective || "" });
      // The ad's own page (when known) wins on the dashboard, so one campaign can serve several pages.
      adRows.push({ ad_id: a.id, name: a.name || a.id, campaign_id: cid, ...(mapped ? { page_id: mapped } : {}), status: adStatus(a.effective_status), creative_type: video ? "Video" : "Image",
        updated_at: (a.updated_time ?? "").slice(0, 10) || day(now), creative_url: c.image_url || c.thumbnail_url || "", video_url: c.video_id ? `https://www.facebook.com/watch/?v=${c.video_id}` : "" });
    }
    counts.ads = adRows.length; counts.campaigns = camps.size;
    const byPage: Record<string, number> = {};
    for (const campaign of camps.values()) byPage[campaign.page_id] = (byPage[campaign.page_id] ?? 0) + 1;
    if (camps.size) writes.push({ tab: "campaigns", keyCols: ["campaign_id"], rows: [...camps.values()], mode: "upsert" });
    if (adRows.length) writes.push({ tab: "ads", keyCols: ["ad_id"], rows: adRows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    const notes: string[] = [];
    if (tier > 0) notes.push(`Meta ปฏิเสธคำขอแบบละเอียด จึงลดรายละเอียดลง: ${TIERS[tier].note} (ระดับ ${tier + 1}/${TIERS.length})`);
    if (!ads.length && !i.state.after) notes.push(await emptyAccountWhy(acct, i.token, f, base)); // Meta answered "no ads": tell the admin which of the usual reasons applies
    else if (ads.length && !adRows.length && !i.state.after) notes.push("Meta ส่งโฆษณามาแต่ทุกตัวไม่มีแคมเปญ จึงไม่มีอะไรให้แสดง");
    if (unmapped.size && !i.state.after) notes.push(`เพจที่โฆษณาใช้ลงประกาศยังไม่ได้ผูกกับเพจในระบบ (${[...unmapped].slice(0, 3).join(", ")}${unmapped.size > 3 ? " …" : ""}) — แคมเปญถูกนับเข้ากับเพจหลักของบัญชีโฆษณา; ผูกเพจนั้นที่หน้า Upload → เชื่อมช่องทางแชท`);
    else if (noPage && !i.state.after) notes.push(`${noPage} โฆษณาไม่ได้ระบุเพจต้นทางใน creative — แสดงใต้เพจเริ่มต้นของบัญชี; ดึงซ้ำภายหลังถ้า Meta ส่งข้อมูล creative ครบ`);
    return {
      next: more ? { phase: "ads", after: j.paging!.cursors!.after, ...(tier > 0 ? { tier } : {}) } : { phase: "insights" },
      writes,
      counts, byPage,
      ...(notes.length ? { warning: notes.join(" · ") } : {}),
    };
  }

  if (i.state.phase === "insights") {
    // Daily results are fetched in 30-day windows (newest first), and with fewer rows per page whenever Meta says it is too much data. One huge
    // 90-day ad-level query is what a big account cannot answer.
    const windows = Math.max(1, Math.ceil(i.days / WINDOW_DAYS)), win = Math.min(windows - 1, Math.max(0, i.state.win ?? 0));
    const untilD = new Date(now.getTime() - win * WINDOW_DAYS * 86400000), sinceD = new Date(Math.max(now.getTime() - i.days * 86400000, untilD.getTime() - (WINDOW_DAYS - 1) * 86400000));
    const since = day(sinceD), until = day(untilD);
    // Full field list first; if Meta rejects it (code 100) the same query is retried with the core fields only, and later batches keep using them.
    const FULL = "ad_id,spend,reach,impressions,clicks,inline_link_clicks,actions", CORE = "ad_id,spend,impressions,clicks,actions";
    let lim = Math.min(INSIGHT_LIMITS.length - 1, Math.max(0, i.state.lim ?? 0)), core = i.state.fallback === true, j: Graph | undefined;
    const insights = (fields: string) => graph(`${acct}/insights`, { level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }), fields, limit: String(INSIGHT_LIMITS[lim]), ...(i.state.after ? { after: i.state.after } : {}) },
      i.token, f, base, 900, lim >= INSIGHT_LIMITS.length - 1 ? 1 : 0);
    for (;;) {
      try { j = await insights(core ? CORE : FULL); break; }
      catch (e) {
        if (!(e instanceof FbError)) throw e;
        if (e.code === 100 && !core && !i.state.after) { core = true; continue; }
        if ((e.code === 1 || e.code === 2) && lim < INSIGHT_LIMITS.length - 1 && !overBudget()) { lim++; continue; } // too much data / timeout → smaller pages
        throw new FbError(`ดึงสถิติรายวันไม่สำเร็จ (ช่วง ${since} ถึง ${until}): ${e.message}`, e.rateLimited, e.code);
      }
    }
    const rows: SyncWrite["rows"] = [];
    for (const r of (j.data ?? []) as RawInsight[]) {
      if (!r.ad_id || !r.date_start) continue;
      rows.push({ date: r.date_start, ad_id: r.ad_id, spend: num(r.spend), reach: num(r.reach), impressions: num(r.impressions), clicks: num(r.inline_link_clicks ?? r.clicks),
        messages: act(r.actions, ["onsite_conversion.messaging_conversation_started_7d"]), purchases: act(r.actions, ["omni_purchase", "purchase"]) });
    }
    counts.rows = rows.length;
    if (rows.length) writes.push({ tab: "ad_performance", keyCols: ["date", "ad_id"], rows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after, carry = { ...(core ? { fallback: true } : {}), ...(lim > 0 ? { lim } : {}) };
    const next: AdsState = more ? { phase: "insights", after: j.paging!.cursors!.after, win, ...carry } : win + 1 < windows ? { phase: "insights", win: win + 1, ...carry } : { phase: "done" };
    const notes: string[] = [];
    if (core) notes.push("Meta ปฏิเสธฟิลด์ reach/คลิกลิงก์ จึงดึงสถิติแบบพื้นฐาน (รีชอาจเป็น 0)");
    if (lim > 0) notes.push(`Meta ตอบว่าข้อมูลมากเกินไป จึงดึงทีละน้อยลง (${INSIGHT_LIMITS[lim]} แถว/ครั้ง)`);
    return { next, writes, counts, ...(notes.length ? { warning: notes.join(" · ") } : {}) };
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

const ACCOUNT_STATUS: Record<number, string> = { 1: "ใช้งานปกติ", 2: "ถูกปิดใช้งาน", 3: "มียอดค้างชำระ", 7: "รอตรวจสอบความเสี่ยง", 8: "รอชำระเงิน", 9: "อยู่ในช่วงผ่อนผัน", 100: "รอชำระเงิน", 101: "ปิดบัญชีแล้ว", 201: "ใช้งานอยู่", 202: "ปิดแล้ว" };
/** Meta returned an empty ad list. That is not an error, so say what the usual causes are (and the account's own status) instead of silently reporting 0. */
async function emptyAccountWhy(acct: string, token: string, f: FetchFn, base: string): Promise<string> {
  let who = acct;
  try {
    const a = (await graph(acct, { fields: "name,account_status" }, token, f, base, 900, 0)) as unknown as { name?: string; account_status?: number };
    who = `${a.name || acct}${a.account_status != null ? ` (สถานะบัญชี: ${ACCOUNT_STATUS[a.account_status] ?? a.account_status})` : ""}`;
  } catch (e) { if (e instanceof FbError) who = `${acct} (เปิดข้อมูลบัญชีไม่ได้: ${e.message.slice(0, 90)})`; }
  return `Meta ไม่ส่งโฆษณาใดกลับมาจากบัญชี ${who} — ตรวจว่า (1) เลือกบัญชีโฆษณาถูกบัญชี (2) เจ้าของโทเคนถูกเพิ่มในบัญชีนี้ที่ Business Settings → Ad accounts → Add people (มีสิทธิ์ ads_read อย่างเดียวไม่พอ ถ้าไม่ได้เป็นคนที่เข้าถึงบัญชีนี้ Meta จะตอบรายการว่างโดยไม่แจ้ง error) (3) บัญชีมีโฆษณาอยู่จริง`;
}
