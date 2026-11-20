// Pull ads + daily results straight from a Meta ad account (Marketing API) and turn them into sheet rows.
// Pure apart from the injected fetch. One call = one small batch (Vercel time limits).
import { FbError, graph, metaFetch, type FetchFn, type Graph } from "./fbSync";
import type { SyncWrite } from "./fbSync";

export type AdsPhase = "ads" | "insights" | "done";
/** tier = level of detail of the ad list; win = which 30-day window of the daily results; lim = rows per page of the daily results (smaller after Meta says "too much data"). */
export interface AdsState { phase: AdsPhase; after?: string; fallback?: boolean; tier?: number; win?: number; lim?: number }
export interface AdsCounts { ads: number; campaigns: number; rows: number }
/** pageMap: Facebook page id → page id in the system. An ad account can serve several pages, so each ad's page comes from the page its creative posts as. */
export interface AdsInput { accountId: string; token: string; sheetPageId: string; days: number; state: AdsState; now?: Date; fetchFn?: FetchFn; base?: string; pageMap?: Record<string, string>; pageNames?: Record<string, string>; resolvePages?: (fbPageIds: string[]) => Promise<Record<string, string>> }
export interface AdsOutput { next: AdsState; writes: SyncWrite[]; counts: AdsCounts; warnings?: string[]; byPage?: Record<string, number> }

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

interface RawAd {
  id: string; name?: string; effective_status?: string; updated_time?: string; campaign?: { id?: string; name?: string; objective?: string };
  /** Some creatives carry no Page at all (catalogue / dynamic ads); the ad set then names the Page its ads are delivered for. */
  adset?: { id?: string; name?: string; promoted_object?: { page_id?: string } };
  creative?: {
    thumbnail_url?: string; image_url?: string; video_id?: string; object_type?: string; effective_object_story_id?: string; object_story_id?: string; body?: string; title?: string;
    object_story_spec?: {
      page_id?: string;
      instagram_actor_id?: string;
      link_data?: { message?: string; name?: string; description?: string; picture?: string };
      video_data?: { message?: string; title?: string; link_description?: string; image_url?: string };
      photo_data?: { caption?: string; url?: string };
    };
  };
}
interface RawInsight { ad_id?: string; date_start?: string; spend?: string; reach?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; actions?: Action[] }

export async function adsStep(i: AdsInput): Promise<AdsOutput> {
  const f = i.fetchFn ?? metaFetch, base = i.base ?? "https://graph.facebook.com";
  const acct = actId(i.accountId), now = i.now ?? new Date(), t0 = Date.now(), overBudget = () => Date.now() - t0 > BUDGET_MS;
  const counts: AdsCounts = { ads: 0, campaigns: 0, rows: 0 }, writes: SyncWrite[] = [];

  if (i.state.phase === "ads") {
    // Detail levels, richest first. When Meta rejects one (code 100 invalid parameter, or 1/2 "unexpected error" for too much data) the next lighter one is tried,
    // and later batches stay on the level that worked — so a single bad field costs only that field, not the whole ad list.
    const CAMP = "campaign{id,name,objective}";
    // The ad set names the Page its ads are delivered for. It answers the ads whose creative has no Page at all (catalogue, dynamic),
    // and it is a second, independent source when a creative's Page came back empty.
    const ADSET = "adset{id,name,promoted_object{page_id}}";
    // Every level keeps the creative's Page: page mapping is what files an ad under the right page, so dropping it while Meta
    // refuses heavier fields would send the whole campaign to the default page. Both story-id fields are asked for on every level
    // too: page-post creatives often have no object_story_spec, and the media lookup needs the story id to read the post's picture.
    const STORY_ID = "effective_object_story_id,object_story_id";
    // Ad copy and every picture Meta has for the creative. The lightest levels leave it out.
    const COPY = `body,title,object_story_spec{page_id,instagram_actor_id,link_data{message,name,description,picture},video_data{message,title,link_description,image_url},photo_data{caption,url}}`;
    const PAGE_ONLY = `${STORY_ID},object_story_spec{page_id,instagram_actor_id}`;
    const TIERS = [
      { fields: `id,name,effective_status,updated_time,${CAMP},${ADSET},creative{thumbnail_url,image_url,video_id,object_type,${STORY_ID},${COPY}}`, filter: true, limit: ADS_PER_CALL, note: "" },
      { fields: `id,name,effective_status,updated_time,${CAMP},${ADSET},creative{thumbnail_url,image_url,video_id,object_type,${STORY_ID},${COPY}}`, filter: false, limit: 25, note: "ไม่กรองตามสถานะโฆษณา" },
      { fields: `id,name,effective_status,updated_time,${CAMP},${ADSET},creative{thumbnail_url,image_url,${STORY_ID},${COPY}}`, filter: false, limit: 25, note: "ไม่ดึงคลิปวิดีโอ" },
      { fields: `id,name,effective_status,updated_time,campaign{id,name},creative{thumbnail_url,image_url,body,title,${PAGE_ONLY}}`, filter: false, limit: 25, note: "ไม่ดึงวัตถุประสงค์แคมเปญและข้อความโพสต์" },
      { fields: `id,name,effective_status,updated_time,campaign{id,name},creative{body,title,${PAGE_ONLY}}`, filter: false, limit: 25, note: "ไม่ดึงภาพโฆษณา" },
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
    // Ads whose creative has no image of its own (page-post, catalogue, dynamic): the picture lives on the underlying post/video.
    const needMedia: { row: SyncWrite["rows"][number]; story?: string; video?: string }[] = [];
    const byPage: Record<string, number> = {};
    let noPage = 0, mappedAds = 0;
    /** The Page an ad posts as: the creative's own Page (object_story_spec, the prefix of its story id, or an Instagram actor for
     *  IG-only ads), otherwise the Page the ad set delivers for. "" when Meta names neither — it can only fall back to the account's Page. */
    const pageOf = (a: RawAd) => {
      const c = a.creative ?? {}, storyId = c.effective_object_story_id || c.object_story_id || "";
      return c.object_story_spec?.page_id || (storyId.includes("_") ? storyId.split("_")[0] : "") || c.object_story_spec?.instagram_actor_id || a.adset?.promoted_object?.page_id || "";
    };
    // A page the ads post as but that was never connected: the caller resolves it (name from Meta, one write for the whole
    // batch) so its ads show under their own page. Pages that cannot be read stay on the account's page as before.
    let extra: Record<string, string> = {};
    if (i.resolvePages) {
      const wanted = new Set<string>();
      for (const a of ads) { const id = pageOf(a); if (id && !i.pageMap?.[id]) wanted.add(id); }
      if (wanted.size) { try { extra = await i.resolvePages([...wanted].slice(0, 12)); } catch { /* keep the account's page */ } }
    }
    for (const a of ads) {
      const cid = a.campaign?.id; if (!cid) continue; // an ad without a campaign cannot be shown
      const c = a.creative ?? {}, video = c.object_type === "VIDEO" || !!c.video_id, storyId = c.effective_object_story_id || c.object_story_id || "";
      const fbPage = pageOf(a);
      // Ad copy: top-level body/title on the creative, or the text on the underlying story for page-post creatives.
      const story = c.object_story_spec ?? {};
      const caption = (c.body || story.link_data?.message || story.video_data?.message || story.photo_data?.caption || "").trim();
      const headline = (c.title || story.link_data?.name || story.video_data?.title || "").trim();
      // Prefer the creative's Page ID; otherwise use a unique Page-name match in the ad/campaign name.
      const nameHit = Object.entries(i.pageNames ?? {}).filter(([, name]) => name.trim().length >= 3 && `${a.campaign?.name ?? ""} ${a.name ?? ""}`.toLowerCase().includes(name.trim().toLowerCase()));
      const viaMap = fbPage ? (i.pageMap?.[fbPage] ?? extra[fbPage]) : undefined;
      // a freshly created page is not in pageNames yet, so its own id from `extra` is proof that it exists
      const mapped = (viaMap && (!i.pageNames || i.pageNames[viaMap] || extra[fbPage] === viaMap) ? viaMap : undefined) ?? (nameHit.length === 1 ? nameHit[0][0] : undefined);
      if (fbPage && !mapped) unmapped.add(fbPage); // the mapper would drop a campaign whose page does not exist, so fall back to the account's default page
      else if (!fbPage && !mapped) noPage++;
      if (mapped) mappedAds++;
      camps.set(cid, { campaign_id: cid, name: a.campaign?.name || cid, page_id: mapped ?? camps.get(cid)?.page_id ?? i.sheetPageId, objective: a.campaign?.objective || camps.get(cid)?.objective || "" });
      // The ad's own page (when known) wins on the dashboard, so one campaign can serve several pages.
      const row: SyncWrite["rows"][number] = { ad_id: a.id, name: a.name || a.id, campaign_id: cid, ...(mapped ? { page_id: mapped } : {}), status: adStatus(a.effective_status), creative_type: video ? "Video" : "Image",
        updated_at: (a.updated_time ?? "").slice(0, 10) || day(now), creative_url: c.image_url || c.thumbnail_url || story.link_data?.picture || story.video_data?.image_url || story.photo_data?.url || "",
        video_url: c.video_id ? `https://www.facebook.com/watch/?v=${c.video_id}` : "",
        // Blank copy is left out so a lighter tier (or Meta returning no text) does not erase text already in the sheet.
        ...(caption ? { caption: caption.slice(0, 4000) } : {}), ...(headline ? { headline: headline.slice(0, 300) } : {}) };
      adRows.push(row);
      const rowPage = mapped ?? camps.get(cid)!.page_id;
      byPage[rowPage] = (byPage[rowPage] ?? 0) + 1;
      if (!row.creative_url) needMedia.push({ row, story: storyId, video: c.video_id }); // also ads with neither story nor video (Instagram-only, dynamic, image-hash creatives)
    }
    // One batched lookup per kind (not one request per ad) keeps this inside the 40 s route budget.
    const mediaWarning = needMedia.length && !overBudget() ? await fillCreativeMedia(needMedia, i.token, f, base, overBudget, acct) : null;
    counts.ads = adRows.length; counts.campaigns = camps.size;
    if (camps.size) writes.push({ tab: "campaigns", keyCols: ["campaign_id"], rows: [...camps.values()], mode: "upsert" });
    if (adRows.length) writes.push({ tab: "ads", keyCols: ["ad_id"], rows: adRows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    const notes: string[] = [];
    if (tier > 0) notes.push(`Meta ไม่ให้ข้อมูลครบตามที่ขอ ระบบจึงดึงแบบเบาลง: ${TIERS[tier].note} — ข้อมูลที่ได้ยังใช้ได้ตามปกติ`);
    if (mediaWarning) notes.push(mediaWarning);
    if (!ads.length && !i.state.after) notes.push(await emptyAccountWhy(acct, i.token, f, base)); // Meta answered "no ads": tell the admin which of the usual reasons applies
    else if (ads.length && !adRows.length && !i.state.after) notes.push("Meta ส่งโฆษณามาแต่ทุกตัวไม่มีแคมเปญ จึงไม่มีอะไรให้แสดง");
    const links = [...unmapped].slice(0, 3).map((id) => `facebook.com/${id}`).join(", ");
    if (unmapped.size && !i.state.after) notes.push(`เพจที่ลงโฆษณายังไม่ได้ผูกกับเพจในระบบ: ${links}${unmapped.size > 3 ? " …" : ""} — โฆษณาของเพจนั้นถูกนับไว้ใต้เพจหลักของบัญชี; เปิดลิงก์เพื่อดูว่าเป็นเพจไหน แล้วเชื่อมเพจนั้นที่หน้า Upload → เชื่อมช่องทางแชท (หรือให้โทเคนมีสิทธิ์ pages_read_engagement เพื่อให้ระบบสร้างเพจให้เอง)`);
    else if (noPage && !i.state.after) notes.push(`${noPage} โฆษณาไม่ได้บอกว่าโพสต์จากเพจไหน — ระบบจึงนับไว้ใต้เพจหลักของบัญชี; ดึงซ้ำภายหลังถ้า Meta ส่งข้อมูลมาเพิ่ม`);
    // Every ad on the fallback page is the symptom the dashboard shows as "มีข้อมูลแค่เพจเดียว": say it in one line, with the fix.
    if (adRows.length && !mappedAds && !i.state.after) notes.push(unmapped.size
      ? `สรุป: โฆษณาทั้ง ${adRows.length} ตัวในชุดนี้ถูกนับไว้ใต้เพจ "${i.pageNames?.[i.sheetPageId] ?? i.sheetPageId}" เพราะเพจต้นทาง (${links}) ยังไม่ได้ผูกกับเพจในระบบ และระบบอ่านชื่อเพจไม่ได้ — เชื่อมเพจนั้นที่หน้า Upload → เชื่อมช่องทางแชท แล้วดึงซ้ำ`
      : `สรุป: โฆษณาทั้ง ${adRows.length} ตัวถูกนับไว้ใต้เพจ "${i.pageNames?.[i.sheetPageId] ?? i.sheetPageId}" เพราะ Meta ไม่ได้บอกเพจของ creative หรือชุดโฆษณาเลย — ตรวจว่าโทเคนที่ดึงโฆษณามีสิทธิ์ ads_read และ pages_read_engagement และเป็นโทเคนของผู้ใช้ที่ดูแลทุกเพจ แล้วกดดึงข้อมูลโฆษณาซ้ำ`);
    return {
      next: more ? { phase: "ads", after: j.paging!.cursors!.after, ...(tier > 0 ? { tier } : {}) } : { phase: "insights" },
      writes,
      counts, byPage,
      ...(notes.length ? { warnings: notes } : {}),
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
    if (core) notes.push("Meta ไม่ให้ฟิลด์ reach/คลิกลิงก์ ระบบจึงดึงสถิติแบบพื้นฐาน (ค่า Reach อาจเป็น 0)");
    if (lim > 0) notes.push(`Meta ตอบว่าข้อมูลเยอะเกินไป ระบบจึงดึงทีละ ${INSIGHT_LIMITS[lim]} แถว (ยอดรวมยังครบ)`);
    return { next, writes, counts, ...(notes.length ? { warnings: notes } : {}) };
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

export interface AdAccountInfo { id: string; name: string; status?: number; currency?: string }
/** Ad accounts a (user) token can see, every page: lets one pasted token connect the pages AND the ad accounts, and lets the admin
 *  pick from a real list instead of typing an id. Disabled / closed accounts are left out. */
export async function listAdAccounts(token: string, f: FetchFn, base: string): Promise<AdAccountInfo[]> {
  const seen = new Map<string, AdAccountInfo>();
  const collect = (data: unknown[] | undefined) => {
    for (const a of (data ?? []) as { account_id?: string; id?: string; name?: string; account_status?: number; currency?: string }[]) {
      if ([2, 101].includes(Number(a.account_status))) continue;
      const id = String(a.account_id ?? a.id ?? "").replace(/\D/g, "");
      if (id.length >= 5 && !seen.has(id)) seen.set(id, { id, name: a.name ?? "", status: a.account_status != null ? Number(a.account_status) : undefined, currency: a.currency });
    }
  };
  let j = await graph("me/adaccounts", { fields: "account_id,name,account_status,currency", limit: "50" }, token, f, base);
  collect(j.data);
  for (let page = 0; page < 3 && seen.size < 200; page++) {
    const next = j.paging?.next; if (!next) break;
    const r = await f(next, { headers: { Authorization: `Bearer ${token}` } });
    const k = ((await r.json().catch(() => ({}))) ?? {}) as Graph;
    if (!r.ok || k.error) throw new FbError(`Meta ตอบ ${r.status}: ${k.error?.message ?? "อ่านรายการบัญชีโฆษณาไม่สำเร็จ"}`, false, k.error?.code);
    collect(k.data); j = k;
  }
  return [...seen.values()];
}

const ACCOUNT_STATUS: Record<number, string> = { 1: "ใช้งานปกติ", 2: "ถูกปิดใช้งาน", 3: "มียอดค้างชำระ", 7: "รอตรวจสอบความเสี่ยง", 8: "รอชำระเงิน", 9: "อยู่ในช่วงผ่อนผัน", 100: "รอชำระเงิน", 101: "ปิดบัญชีแล้ว", 201: "ใช้งานอยู่", 202: "ปิดแล้ว" };
/** Meta returned an empty ad list. That is not an error, so say what the usual causes are (and the account's own status) instead of silently reporting 0. */
async function emptyAccountWhy(acct: string, token: string, f: FetchFn, base: string): Promise<string> {
  let who = acct;
  try {
    const a = (await graph(acct, { fields: "name,account_status" }, token, f, base, 900, 0)) as unknown as { name?: string; account_status?: number };
    who = `${a.name || acct}${a.account_status != null ? ` (สถานะบัญชี: ${ACCOUNT_STATUS[a.account_status] ?? a.account_status})` : ""}`;
  } catch (e) { if (e instanceof FbError) who = `${acct} (เปิดข้อมูลบัญชีไม่ได้: ${e.message.slice(0, 90)})`; }
  return `Meta ไม่ส่งโฆษณาของบัญชี ${who} กลับมาเลย — สาเหตุที่พบบ่อย: (1) เลือกบัญชีโฆษณาผิดบัญชี (2) คนที่ออกโทเคนยังไม่ได้ถูกเพิ่มเข้าบัญชีนี้ — เพิ่มที่ Business Settings → Ad accounts → Add people (ให้สิทธิ์ ads_read อย่างเดียวไม่พอ ถ้าไม่ใช่คนในบัญชี Meta จะตอบว่ารายการว่างโดยไม่แจ้ง error) (3) บัญชีนี้ไม่มีโฆษณาจริง`;
}

type CreativeExtra = {
  effective_instagram_media_id?: string; image_hash?: string;
  asset_feed_spec?: { images?: { hash?: string; url?: string }[]; videos?: { thumbnail_url?: string }[] };
  object_story_spec?: { link_data?: { image_hash?: string; child_attachments?: { picture?: string; image_hash?: string }[] } };
};
type MediaNode = { full_picture?: string; message?: string; attachments?: { data?: { media_type?: string; target?: { id?: string } }[] }; picture?: string | { data?: { url?: string } }; error?: { message?: string } };

/** Creatives with no image of their own (page-post, catalogue, dynamic) only point at the post. Read the post's real picture and the
 *  video cover — one batched request per kind, so 40 ads cost two calls. A refusal (usually a token without pages_read_engagement)
 *  only loses the picture, never the ad row. */
async function fillCreativeMedia(picks: { row: SyncWrite["rows"][number]; story?: string; video?: string }[], token: string, f: FetchFn, base: string, overBudget: () => boolean, acct?: string): Promise<string | null> {
  const errors: string[] = [];
  /** Later field lists exist for a request Meta refused: the post lookup asks for attachments last, so a rejection still returns the picture. */
  const batch = async (ids: (string | undefined)[], fieldLists: string[]): Promise<Record<string, MediaNode>> => {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))].slice(0, 50);
    if (!uniq.length) return {};
    let last: FbError | undefined;
    for (const fields of fieldLists) {
      try { return (await graph("", { ids: uniq.join(","), fields }, token, f, base, 900, 0)) as unknown as Record<string, MediaNode>; }
      catch (e) { if (!(e instanceof FbError)) throw e; last = e; if (e.rateLimited) break; }
    }
    if (last) errors.push(last.message);
    return {};
  };
  const posts = await batch(picks.map((p) => p.story), ["full_picture,message,attachments{media_type,target{id}}", "full_picture,message"]);
  const covers = overBudget() ? {} : await batch(picks.map((p) => p.video), ["picture"]);
  for (const p of picks) {
    const post = p.story ? posts[p.story] : undefined;
    if (post && !post.error) {
      if (post.full_picture && !p.row.creative_url) p.row.creative_url = post.full_picture;
      if (!p.row.caption && post.message) p.row.caption = String(post.message).slice(0, 4000);
      // A lighter ad tier drops video_id: the post's own video attachment still gives the id, so the player keeps working.
      const videoTarget = post.attachments?.data?.find((x) => x.media_type === "video" && x.target?.id)?.target?.id;
      if (videoTarget && !p.row.video_url) { p.row.video_url = `https://www.facebook.com/watch/?v=${videoTarget}`; p.row.creative_type = "Video"; }
    }
    const cover = p.video ? covers[p.video] : undefined;
    const url = typeof cover?.picture === "string" ? cover.picture : cover?.picture?.data?.url ?? "";
    if (url && !p.row.creative_url) p.row.creative_url = url;
  }
  // Last resort for ads still without a picture (Instagram-only, dynamic / flexible, carousel, image-hash creatives). One extra batched
  // read of those ads' creatives; every step is best-effort, so a refusal only costs the picture.
  const bare = picks.filter((p) => !p.row.creative_url && p.row.ad_id);
  if (bare.length && !overBudget()) {
    const ads = await batch(bare.map((p) => String(p.row.ad_id)), [
      "creative{effective_instagram_media_id,image_hash,asset_feed_spec{images{hash,url},videos{thumbnail_url}},object_story_spec{link_data{image_hash,child_attachments{picture,image_hash}}}}",
      "creative{effective_instagram_media_id,image_hash}",
    ]) as unknown as Record<string, { creative?: CreativeExtra; error?: unknown }>;
    const hashes = new Set<string>(), igIds = new Set<string>(), found = new Map<string, { hash?: string; ig?: string }>();
    for (const p of bare) {
      const c = ads[String(p.row.ad_id)]?.creative; if (!c) continue;
      const af = c.asset_feed_spec, link = c.object_story_spec?.link_data, child = link?.child_attachments?.[0];
      const direct = af?.images?.find((x) => x.url)?.url || child?.picture || af?.videos?.find((x) => x.thumbnail_url)?.thumbnail_url;
      if (direct) { p.row.creative_url = direct; continue; }
      const hash = c.image_hash || link?.image_hash || child?.image_hash || af?.images?.[0]?.hash;
      if (hash) hashes.add(hash);
      if (c.effective_instagram_media_id) igIds.add(c.effective_instagram_media_id);
      found.set(String(p.row.ad_id), { hash, ig: c.effective_instagram_media_id });
    }
    // image hash → hosted image URL (the account's image library)
    const urlByHash = new Map<string, string>();
    if (acct && hashes.size && !overBudget()) {
      try {
        const r = await graph(`${acct}/adimages`, { hashes: JSON.stringify([...hashes].slice(0, 50)), fields: "hash,url" }, token, f, base, 900, 0);
        for (const x of (r.data ?? []) as { hash?: string; url?: string }[]) if (x.hash && x.url) urlByHash.set(x.hash, x.url);
      } catch (e) { if (e instanceof FbError) errors.push(e.message); else throw e; }
    }
    const igMedia = igIds.size && !overBudget() ? await batch([...igIds], ["media_url,thumbnail_url", "thumbnail_url"]) as unknown as Record<string, { media_url?: string; thumbnail_url?: string }> : {};
    for (const p of bare) {
      if (p.row.creative_url) continue;
      const hit = found.get(String(p.row.ad_id)); if (!hit) continue;
      const ig = hit.ig ? igMedia[hit.ig] : undefined;
      p.row.creative_url = (hit.hash && urlByHash.get(hit.hash)) || ig?.media_url || ig?.thumbnail_url || "";
    }
  }
  const missing = picks.filter((p) => !p.row.creative_url).length;
  if (!missing) return null;
  return errors.length
    ? `${missing} โฆษณาไม่มีรูป — Meta ไม่ให้ดึงรูปจากโพสต์หรือคลังรูปโฆษณา (${errors[0]}) — โทเคนต้องมีสิทธิ์ ads_read และ pages_read_engagement และต้องเป็นโทเคนของเพจที่ลงโฆษณา`
    : `${missing} โฆษณายังไม่มีรูปจาก Meta — โพสต์อาจถูกลบ หรือเป็นโฆษณาแบบไดนามิกที่ไม่มีภาพเดียว; ซิงก์ใหม่ภายหลังได้`;
}
