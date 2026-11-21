// Pull ads + daily results straight from a Meta ad account (Marketing API) and turn them into sheet rows.
// Pure apart from the injected fetch. One call = one small batch (Vercel time limits).
import { FbError, graph, metaAdsFetch, type FetchFn, type Graph } from "./fbSync";
import type { SyncWrite } from "./fbSync";

export type AdsPhase = "ads" | "insights" | "done";
/** tier = level of detail of the ad list; win = which 30-day window of the daily results; lim = rows per page of the daily results (smaller after Meta says "too much data"). */
export interface AdsState { phase: AdsPhase; after?: string; fallback?: boolean; tier?: number; win?: number; lim?: number }
export interface AdsCounts { ads: number; campaigns: number; rows: number }
/** pageMap: Facebook page id → page id in the system. An ad account can serve several pages, so each ad's page comes from the page its creative posts as.
 *  knownCampaignPages: the page each campaign is filed under in the sheet already — used when this batch cannot tell, so a lighter pull never moves a campaign somewhere else.
 *  knownCreativeUrls: ads whose picture link was pasted by a person (not a Meta link) — the admin's own link wins and is never
 *  overwritten by the sync, which is what makes the Google Drive option in the creative editor actually stick. */
export interface AdsInput { accountId: string; token: string; sheetPageId: string; days: number; state: AdsState; now?: Date; fetchFn?: FetchFn; base?: string; pageMap?: Record<string, string>; pageNames?: Record<string, string>; knownCampaignPages?: Record<string, string>; knownCreativeUrls?: Record<string, string>; resolvePages?: (fbPageIds: string[]) => Promise<Record<string, string>> }
export interface AdsOutput { next: AdsState; writes: SyncWrite[]; counts: AdsCounts; warnings?: string[]; byPage?: Record<string, number> }

const ADS_PER_CALL = Number(process.env.ADS_PAGE_SIZE) || 40, INSIGHT_LIMITS = [200, 100, 50, 25], WINDOW_DAYS = 30;
/** One request to our own route must finish inside the platform limit (60 s). Past this many ms no further fallback is attempted: fail with a clear message instead. */
const BUDGET_MS = Number(process.env.ADS_BUDGET_MS) || 35000;
/** How much of that budget the picture lookups may still use. They only ever add image quality, so they are the first thing to be cut — and the reason a pull can end with small pictures instead of no pictures at all. */
/** The picture lookups may keep working a little past the main deadline — they only ever add image quality, and the route still
 *  has to answer inside its own time limit, so this stays below maxDuration (60 s) with room for the sheet writes. */
const MEDIA_BUDGET_MS = Number(process.env.ADS_MEDIA_BUDGET_MS) || 45000;
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
    /** Where the picture really lives when the creative itself only carries a 64×64 cut-out: the Instagram media, or a hash into the account's image library. */
    effective_instagram_media_id?: string; image_hash?: string;
    asset_feed_spec?: { images?: { hash?: string; url?: string }[]; videos?: { thumbnail_url?: string }[] };
    object_story_spec?: {
      page_id?: string;
      instagram_actor_id?: string;
      link_data?: { message?: string; name?: string; description?: string; picture?: string; image_hash?: string; child_attachments?: { picture?: string; image_hash?: string }[] };
      video_data?: { message?: string; title?: string; link_description?: string; image_url?: string };
      photo_data?: { caption?: string; url?: string };
    };
  };
}
interface RawInsight { ad_id?: string; date_start?: string; spend?: string; reach?: string; impressions?: string; inline_link_clicks?: string; actions?: Action[] }

/* ------------------------------------------------------------------ picture quality ---------------------------------------------------------------- */

/**
 * Meta hands out several links for the same picture and they are not equally good.
 * `creative.thumbnail_url` (and `link_data.picture`) is a small cut-out — its URL says so in the crop directive
 * (`_p64x64`, `stp=c0.5000x0.5000f_…`): 349 of the reference account's 708 ads are page-post ("STATUS") creatives
 * that answer nothing but that crop. `0` = no link, `1` = a crop small enough to look wrong in the dashboard's
 * 16:9 preview, `2` = a full-size picture.
 */
export function sharpness(url: string | undefined): 0 | 1 | 2 {
  if (!url) return 0;
  const m = /_p(\d{1,4})x\1(?![\d])/i.exec(url); // _p64x64, _p120x120 …
  if (m && Number(m[1]) <= 320) return 1;
  if (/[?&]stp=c\d/i.test(url)) return 1; // a crop directive without an explicit size
  return 2;
}

/** Meta sometimes answers an object or a string where a list was asked for (and a field it refused can come back as
 *  anything); a creative shape we did not expect must never break a pull. */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The best link Meta gives inside the creative itself, sharpest first (an earlier candidate wins a tie: it is the more authoritative field). */
function bestCreativeUrl(c: NonNullable<RawAd["creative"]>): { url: string; sharp: 0 | 1 | 2 } {
  const spec = c.object_story_spec, link = spec?.link_data, child = list<{ picture?: string; image_hash?: string }>(link?.child_attachments)[0];
  const cands = [c.image_url, list<{ url?: string }>(c.asset_feed_spec?.images).find((x) => x.url)?.url, child?.picture, c.thumbnail_url, link?.picture, spec?.video_data?.image_url, spec?.photo_data?.url, list<{ thumbnail_url?: string }>(c.asset_feed_spec?.videos).find((x) => x.thumbnail_url)?.thumbnail_url];
  let best = "", sharp = 0 as 0 | 1 | 2;
  for (const u of cands) {
    const s = sharpness(u);
    if (s > sharp) { sharp = s; best = u ?? ""; }
  }
  return { url: best, sharp: sharp as 0 | 1 | 2 };
}

/** `true` when `next` is a better picture link than the one we already hold. */
const better = (next: string | undefined, have: string | undefined) => !!next && sharpness(next) > sharpness(have);

/**
 * A short, stable description of where Meta keeps this ad's picture. The CDN links themselves are signed and stop
 * answering after a few days (`…&oe=6B05D2FB` is the expiry), while these ids do not change — so the sheet stores both,
 * and the dashboard asks for a fresh link when the stored one has aged out.
 */
export function creativeRef(a: RawAd): string {
  const c = a.creative ?? {}, spec = c.object_story_spec, link = spec?.link_data, child = link?.child_attachments?.[0];
  const out: string[] = [];
  const story = c.effective_object_story_id || c.object_story_id;
  if (story) out.push(`s:${story}`);
  if (c.video_id) out.push(`v:${c.video_id}`);
  if (c.effective_instagram_media_id) out.push(`i:${c.effective_instagram_media_id}`);
  const hash = c.image_hash || link?.image_hash || child?.image_hash || list<{ hash?: string }>(c.asset_feed_spec?.images).find((x) => x.hash)?.hash;
  if (hash) out.push(`h:${hash}`);
  return out.join(",");
}
export interface CreativeRef { story?: string; video?: string; ig?: string; hash?: string }
export function parseCreativeRef(ref: string | undefined): CreativeRef {
  const out: CreativeRef = {};
  for (const part of (ref ?? "").split(",")) {
    const i = part.indexOf(":"); if (i < 1) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim(); if (!v) continue;
    if (k === "s") out.story = v; else if (k === "v") out.video = v; else if (k === "i") out.ig = v; else if (k === "h") out.hash = v;
  }
  return out;
}

/* ----------------------------------------------------------------------- the ads ladder ----------------------------------------------------------------------- */

export async function adsStep(i: AdsInput): Promise<AdsOutput> {
  const f = i.fetchFn ?? metaAdsFetch, base = i.base ?? "https://graph.facebook.com";
  const acct = actId(i.accountId), now = i.now ?? new Date(), t0 = Date.now();
  const overBudget = () => Date.now() - t0 > BUDGET_MS;
  const mediaBudgetOk = () => Date.now() - t0 < MEDIA_BUDGET_MS;
  const counts: AdsCounts = { ads: 0, campaigns: 0, rows: 0 }, writes: SyncWrite[] = [];

  if (i.state.phase === "ads") {
    /* Detail levels, richest first. When Meta rejects one (code 100 invalid parameter, or 1/2 "unexpected error" for too much
     * data — which is also how a too-slow answer surfaces inside our own timeout) the next lighter one is tried, and later
     * batches stay on the level that worked — so a single bad field costs only that field, not the whole ad list.
     * Two rules the ladder used to break, and the dashboard symptoms they caused:
     *  - every level asks for the picture links (thumbnail_url/image_url) and the story ids, because those are the cheap
     *    fields; the heavy ones are the nested ad text. The old last level asked for neither picture field, so a slow
     *    account came back with 700 ads and zero images.
     *  - the last level drops object_story_spec as well, because that nested field is the one Meta most often refuses;
     *    when every level still asked for it, no level could get through and the whole pull failed with "0 ads". */
    const CAMP = "campaign{id,name,objective}";
    const CAMP_LIGHT = "campaign{id,name}";
    // The ad set names the Page its ads are delivered for. It answers the ads whose creative has no Page at all (catalogue, dynamic),
    // and it is a second, independent source when a creative's Page came back empty.
    const ADSET = "adset{id,name,promoted_object{page_id}}";
    // Every level keeps the creative's Page: page mapping is what files an ad under the right page, so dropping it while Meta
    // refuses heavier fields would send the whole campaign to the default page. Both story-id fields are asked for on every level
    // too: page-post creatives often have no object_story_spec, and the media lookup needs the story id to read the post's picture.
    const STORY_ID = "effective_object_story_id,object_story_id";
    // The picture, at every level: what the ad carries itself, plus the two ids the lookups below need to reach the real file.
    const MEDIA = `thumbnail_url,image_url,video_id,object_type,effective_instagram_media_id,image_hash,${STORY_ID}`;
    // Ad copy from the underlying post. Kept from level 0 down to 2, dropped after that: it is the heaviest part of the query
    // and the only fields that ever made Meta refuse a whole page of ads.
    const COPY = `body,title,object_story_spec{page_id,instagram_actor_id,link_data{message,name,picture,child_attachments{picture}},video_data{message,title,image_url},photo_data{caption,url}}`;
    const PAGE_ONLY = `object_story_spec{page_id,instagram_actor_id}`;
    const TIERS = [
      { fields: `id,name,effective_status,updated_time,${CAMP},${ADSET},creative{${MEDIA},${COPY},asset_feed_spec{images{hash,url},videos{thumbnail_url}}}`, filter: true, limit: ADS_PER_CALL, note: "" },
      { fields: `id,name,effective_status,updated_time,${CAMP},${ADSET},creative{${MEDIA},body,title,${PAGE_ONLY}}`, filter: true, limit: ADS_PER_CALL, note: "ไม่ดึงข้อความและรูปจากโพสต์ต้นทาง" },
      { fields: `id,name,effective_status,updated_time,${CAMP_LIGHT},creative{${MEDIA},body,title,${PAGE_ONLY}}`, filter: true, limit: 25, note: "ไม่ดึงวัตถุประสงค์แคมเปญและชุดโฆษณา" },
      { fields: `id,name,effective_status,updated_time,${CAMP_LIGHT},creative{${MEDIA},${PAGE_ONLY}}`, filter: false, limit: 25, note: "ไม่ดึงข้อความโฆษณา" },
      { fields: `id,name,effective_status,updated_time,${CAMP_LIGHT},creative{thumbnail_url,image_url,${STORY_ID}}`, filter: false, limit: 25, note: "ดึงเฉพาะชื่อแคมเปญและรูปโฆษณา" },
      // The way out when Meta refuses the picture fields themselves: names and statuses still land. Because a field Meta did
      // not answer is left out of the write (never written blank), the pictures an earlier richer pull stored stay in the sheet.
      { fields: `id,name,effective_status,updated_time,${CAMP_LIGHT}`, filter: false, limit: 25, note: "ดึงเฉพาะชื่อโฆษณา (Meta ไม่ยอมรับฟิลด์รูปภาพ) — รูปเดิมที่ยังอยู่ใน Sheet ไม่ถูกลบ" },
    ];
    // A heavy query that Meta refused (or that timed out) is not repeated: the next lighter level is tried at once. Only the lightest level may repeat once.
    const fetchAds = (t: number) => graph(`${acct}/ads`, {
      fields: TIERS[t].fields, ...(TIERS[t].filter ? { effective_status: ALL_STATUS } : {}), limit: String(TIERS[t].limit), ...(i.state.after ? { after: i.state.after } : {}),
    }, i.token, f, base, 900, t >= TIERS.length - 1 ? 1 : 0);
    let tier = Math.min(TIERS.length - 1, Math.max(0, i.state.tier ?? (i.state.fallback ? TIERS.length - 1 : 0)));
    let j: Graph | undefined, lastErr: FbError | undefined;
    for (; tier < TIERS.length; tier++) {
      if (tier > 0 && overBudget()) break; // do not start another heavy page when the route has seconds left
      try { j = await fetchAds(tier); break; }
      catch (e) {
        if (!(e instanceof FbError)) throw e;
        lastErr = e;
        if (e.rateLimited || (e.code !== 100 && e.code !== 1 && e.code !== 2) || i.state.after) break; // only the first batch can change level (a paging cursor belongs to its query)
      }
    }
    // The budget ran out halfway down the ladder. Asking for the lightest level is still worth one try: it is the query
    // Meta always answers, and "names + a small picture" beats "nothing at all" for the dashboard.
    if (!j && !lastErr?.rateLimited && !i.state.after && tier < TIERS.length - 1) {
      tier = TIERS.length - 1;
      try { j = await fetchAds(tier); lastErr = undefined; } catch (e) { if (e instanceof FbError) lastErr = e; else throw e; }
    }
    if (!j) throw new FbError(`ดึงรายการโฆษณาไม่สำเร็จ${tier > 0 ? ` (ลองลดรายละเอียดแล้ว ${Math.min(tier + 1, TIERS.length)} ระดับ)` : ""}: ${lastErr?.message ?? "ไม่ทราบสาเหตุ"}`, lastErr?.rateLimited ?? false, lastErr?.code);
    const ads = (j.data ?? []) as RawAd[];
    const camps = new Map<string, Record<string, string>>(), adRows: SyncWrite["rows"] = [], unmapped = new Set<string>();
    // Ads whose picture is not a full-size file yet (page-post, catalogue, dynamic, Instagram-only): the picture lives on the
    // underlying post, in the account's image library, or on the Instagram media node.
    const needMedia: { row: SyncWrite["rows"][number]; story?: string; video?: string; ig?: string; hash?: string; weak: boolean }[] = [];
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
      // The ad's own picture, as sharp as the creative itself allows. Anything short of a full-size file is looked up below.
      const pic = bestCreativeUrl(c);
      // A link someone pasted themselves (Google Drive, their own server) stays theirs: no Meta picture, no ref, no media lookups.
      const mine = i.knownCreativeUrls?.[a.id];
      // Prefer the creative's Page ID; otherwise use a unique Page-name match in the ad/campaign name.
      const nameHit = Object.entries(i.pageNames ?? {}).filter(([, name]) => name.trim().length >= 3 && `${a.campaign?.name ?? ""} ${a.name ?? ""}`.toLowerCase().includes(name.trim().toLowerCase()));
      const viaMap = fbPage ? (i.pageMap?.[fbPage] ?? extra[fbPage]) : undefined;
      // a freshly created page is not in pageNames yet, so its own id from `extra` is proof that it exists
      const mapped = (viaMap && (!i.pageNames || i.pageNames[viaMap] || extra[fbPage] === viaMap ? viaMap : undefined)) ?? (nameHit.length === 1 ? nameHit[0][0] : undefined);
      if (fbPage && !mapped) unmapped.add(fbPage); // the mapper would drop a campaign whose page does not exist, so fall back to the account's default page
      else if (!fbPage && !mapped) noPage++;
      if (mapped) mappedAds++;
      // A campaign's Page is only ever re-decided from positive evidence: an ad that names its page, or (for a campaign seen
      // for the first time) the page this ad account belongs to. Without that rule a lighter pull — which may not ask for the
      // ad set at all — moved campaigns that were filed correctly back onto the account's default page.
      const campPage = mapped ?? camps.get(cid)?.page_id ?? i.knownCampaignPages?.[cid] ?? "";
      const campObjective = a.campaign?.objective || camps.get(cid)?.objective || "";
      camps.set(cid, { campaign_id: cid, name: a.campaign?.name || cid, page_id: campPage || i.sheetPageId, ...(campObjective ? { objective: campObjective } : {}) });
      // The ad's own page (when known) wins on the dashboard, so one campaign can serve several pages.
      const row: SyncWrite["rows"][number] = { ad_id: a.id, name: a.name || a.id, campaign_id: cid, ...(mapped ? { page_id: mapped } : {}), status: adStatus(a.effective_status), creative_type: video ? "Video" : "Image",
        updated_at: (a.updated_time ?? "").slice(0, 10) || day(now),
        // A field Meta did not answer at this detail level is left out of the write instead of written blank, so it cannot
        // erase a value an earlier (richer) pull already stored. Blank ad text used to wipe good pictures and copy.
        ...(mine ? {} : pic.url ? { creative_url: pic.url } : {}), ...(c.video_id ? { video_url: `https://www.facebook.com/watch/?v=${c.video_id}` } : {}),
        ...(!mine && (storyId || c.video_id || c.effective_instagram_media_id) ? { creative_ref: creativeRef(a) } : {}),
        ...(caption ? { caption: caption.slice(0, 4000) } : {}), ...(headline ? { headline: headline.slice(0, 300) } : {}) };
      adRows.push(row);
      const rowPage = mapped ?? camps.get(cid)!.page_id;
      byPage[rowPage] = (byPage[rowPage] ?? 0) + 1;
      if (!mine && pic.sharp < 2) needMedia.push({ row, story: storyId, video: c.video_id, ig: c.effective_instagram_media_id, hash: c.image_hash || story.link_data?.image_hash, weak: pic.sharp === 1 });
      // also ads with neither story nor video (Instagram-only, dynamic, image-hash creatives)
    }
    // One batched lookup per kind (not one request per ad) keeps this inside the route budget.
    const mediaWarning = needMedia.length && mediaBudgetOk() ? await fillCreativeMedia(needMedia, i.token, f, base, mediaBudgetOk, acct) : (needMedia.length ? `${needMedia.length} โฆษณายังใช้รูปขนาดเล็ก/ไม่มีรูป — หมดเวลาประมวลผลของคำขอนี้ กดดึงซ้ำจะได้รูปเต็ม` : null);
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
    // Link Clicks are the dashboard's canonical metric: ask for inline_link_clicks in every tier and never substitute clicks (all).
    // If Meta refuses that metric, fail clearly rather than silently changing its definition. The fallback only drops reach.
    // date_start is named on purpose: with time_increment Meta also returns it by itself, but a row whose date is missing is
    // dropped by the sheet mapper, so asking for it costs nothing and cannot lose a day of results.
    const FULL = "ad_id,date_start,spend,reach,impressions,inline_link_clicks,actions", CORE = "ad_id,date_start,spend,impressions,inline_link_clicks,actions";
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
    let missingLinkClicks = 0;
    for (const r of (j.data ?? []) as RawInsight[]) {
      if (!r.ad_id || !r.date_start) continue;
      if (r.inline_link_clicks == null) missingLinkClicks++;
      rows.push({ date: r.date_start, ad_id: r.ad_id, spend: num(r.spend), ...(r.reach != null ? { reach: num(r.reach) } : {}), impressions: num(r.impressions), ...(r.inline_link_clicks != null ? { clicks: num(r.inline_link_clicks) } : {}),
        messages: act(r.actions, ["onsite_conversion.messaging_conversation_started_7d"]), purchases: act(r.actions, ["omni_purchase", "purchase"]) });
    }
    counts.rows = rows.length;
    if (rows.length) writes.push({ tab: "ad_performance", keyCols: ["date", "ad_id"], rows, mode: "upsert" });
    const more = !!j.paging?.next && !!j.paging.cursors?.after, carry = { ...(core ? { fallback: true } : {}), ...(lim > 0 ? { lim } : {}) };
    const next: AdsState = more ? { phase: "insights", after: j.paging!.cursors!.after, win, ...carry } : win + 1 < windows ? { phase: "insights", win: win + 1, ...carry } : { phase: "done" };
    const notes: string[] = [];
    if (core) notes.push("Meta ไม่ให้ฟิลด์ Reach ในคำขอแบบเต็ม ระบบจึงดึงแบบสำรอง โดยยังใช้ Link Clicks เท่านั้นและคง Reach เดิมใน Sheet (ไม่เขียน 0 ทับ)");
    if (missingLinkClicks) notes.push(`Meta ไม่ได้ส่ง Link Clicks กลับมา ${missingLinkClicks} แถว — ไม่ได้นำ Clicks (all) มาแทน; ค่าที่มีอยู่ใน Sheet จะไม่ถูกเขียนทับ`);
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

type MediaNode = { full_picture?: string; message?: string; attachments?: { data?: { media_type?: string; target?: { id?: string } }[] }; picture?: string | { data?: { url?: string } }; error?: { message?: string } };
type CreativeExtra = { effective_instagram_media_id?: string; image_hash?: string; asset_feed_spec?: { images?: { hash?: string; url?: string }[]; videos?: { thumbnail_url?: string }[] }; object_story_spec?: { link_data?: { image_hash?: string; child_attachments?: { picture?: string; image_hash?: string }[] } } };
/** Everything Meta knows about one ad's picture, from the four places it can be. */
export interface MediaSources { post?: MediaNode; cover?: string; hashUrl?: string; direct?: string }

/**
 * Where an ad's picture really lives. Creatives with no image of their own (page-post, catalogue, dynamic) — and the many
 * that only carry Meta's 64×64 cut-out — point at the post, the video, the Instagram media node or the account's image library.
 * One batched request per kind, so 40 ads cost two or three calls. A refusal (usually a token without pages_read_engagement)
 * only loses the picture, never the ad row.
 */
async function readMediaSources(picks: (CreativeRef & { key: string })[], token: string, f: FetchFn, base: string, acct: string | undefined, stillOk: () => boolean): Promise<{ byKey: Map<string, MediaSources>; errors: string[] }> {
  const errors: string[] = [];
  /** Later field lists exist for a request Meta refused: the post lookup asks for attachments last, so a rejection still returns the picture. */
  const batch = async (ids: (string | undefined)[], fieldLists: string[]): Promise<Record<string, unknown>> => {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))].slice(0, 50);
    if (!uniq.length) return {};
    let last: FbError | undefined;
    for (const fields of fieldLists) {
      try { return (await graph("", { ids: uniq.join(","), fields }, token, f, base, 900, 0)) as unknown as Record<string, unknown>; }
      catch (e) { if (!(e instanceof FbError)) throw e; last = e; if (e.rateLimited) break; }
    }
    if (last) errors.push(last.message);
    return {};
  };
  const byKey = new Map<string, MediaSources>();
  const put = (key: string, v: MediaSources) => byKey.set(key, { ...(byKey.get(key) ?? {}), ...v });

  const posts = await batch(picks.map((p) => p.story), ["full_picture,message,attachments{media_type,target{id}}", "full_picture,message"]);
  const covers = stillOk() ? await batch(picks.map((p) => p.video), ["picture"]) : {};
  for (const p of picks) {
    const post = p.story ? posts[p.story] as MediaNode | undefined : undefined;
    if (post && !post.error) put(p.key, { post });
    const cover = p.video ? covers[p.video] as MediaNode | undefined : undefined;
    const coverUrl = typeof cover?.picture === "string" ? cover.picture : cover?.picture?.data?.url;
    if (coverUrl) put(p.key, { cover: coverUrl });
  }
  // Last resort for ads still without a full-size picture (Instagram-only, dynamic / flexible, carousel, image-hash creatives):
  // one extra batched read of those ads' creatives, then the library / Instagram lookups it points at.
  const open = picks.filter((p) => { const s = byKey.get(p.key); return !better(s?.post?.full_picture, undefined) && !better(s?.cover, undefined) && !s?.direct; });
  if (open.length && stillOk()) {
    const extras = await batch(open.map((p) => p.key), [
      "creative{effective_instagram_media_id,image_hash,asset_feed_spec{images{hash,url},videos{thumbnail_url}},object_story_spec{link_data{image_hash,child_attachments{picture,image_hash}}}}",
      "creative{effective_instagram_media_id,image_hash}",
    ]) as unknown as Record<string, { creative?: CreativeExtra }>;
    const hashes = new Set<string>(), igIds = new Set<string>(), found = new Map<string, { hash?: string; ig?: string }>();
    for (const p of open) {
      const c = (p.key ? extras[p.key]?.creative : undefined) ?? (p.ig || p.hash ? { effective_instagram_media_id: p.ig, image_hash: p.hash } : undefined);
      if (!c) continue;
      const af = c.asset_feed_spec, link = c.object_story_spec?.link_data, child = list<{ picture?: string; image_hash?: string }>(link?.child_attachments)[0];
      const direct = list<{ url?: string }>(af?.images).find((x) => x.url)?.url || child?.picture || list<{ thumbnail_url?: string }>(af?.videos).find((x) => x.thumbnail_url)?.thumbnail_url;
      if (direct) put(p.key, { direct });
      const hash = c.image_hash || link?.image_hash || child?.image_hash || list<{ hash?: string }>(af?.images)[0]?.hash;
      if (hash) hashes.add(hash);
      if (c.effective_instagram_media_id) igIds.add(c.effective_instagram_media_id);
      found.set(p.key, { hash, ig: c.effective_instagram_media_id });
    }
    // image hash → hosted image URL (the account's image library)
    const urlByHash = new Map<string, string>();
    if (acct && hashes.size && stillOk()) {
      try {
        const r = await graph(`${acct}/adimages`, { hashes: JSON.stringify([...hashes].slice(0, 50)), fields: "hash,url" }, token, f, base, 900, 0);
        for (const x of (r.data ?? []) as { hash?: string; url?: string }[]) if (x.hash && x.url) urlByHash.set(x.hash, x.url);
      } catch (e) { if (e instanceof FbError) errors.push(e.message); else throw e; }
    }
    const igMedia = igIds.size && stillOk() ? await batch([...igIds], ["media_url,thumbnail_url", "thumbnail_url"]) as unknown as Record<string, { media_url?: string; thumbnail_url?: string }> : {};
    for (const p of open) {
      const hit = found.get(p.key); if (!hit) continue;
      const ig = hit.ig ? igMedia[hit.ig] : undefined;
      // The Instagram media node is the file that actually delivered the ad, so it wins over the account's image library
      // (usually the same picture, but the library can hold an older cut of it).
      const url = ig?.media_url || ig?.thumbnail_url || (hit.hash ? urlByHash.get(hit.hash) : undefined);
      if (url) put(p.key, { hashUrl: url });
    }
  }
  return { byKey, errors };
}

/** Picks every link Meta found for these ads and keeps the sharpest one, then the ad text the post carries. */
function applyMediaSources(picks: { row: SyncWrite["rows"][number]; story?: string; video?: string; ig?: string; hash?: string; weak?: boolean }[], src: Map<string, MediaSources>) {
  for (const p of picks) {
    const key = String(p.row.ad_id ?? "");
    const s = src.get(key); if (!s) continue;
    const candidates = [s.post?.full_picture, s.hashUrl, s.direct, s.cover].filter((x): x is string => !!x);
    for (const u of candidates) if (better(u, p.row.creative_url as string | undefined)) p.row.creative_url = u;
    const post = p.story ? s.post : undefined;
    if (post && !post.error) {
      if (!p.row.caption && post.message) p.row.caption = String(post.message).slice(0, 4000);
      // A lighter ad tier drops video_id: the post's own video attachment still gives the id, so the player keeps working.
      const videoTarget = list<{ media_type?: string; target?: { id?: string } }>(post.attachments?.data).find((x) => x.media_type === "video" && x.target?.id)?.target?.id;
      if (videoTarget && !p.row.video_url) { p.row.video_url = `https://www.facebook.com/watch/?v=${videoTarget}`; p.row.creative_type = "Video"; }
    }
  }
}

/** One batched lookup per kind (not one request per ad) keeps this inside the 40 s route budget. A refusal only costs the picture. */
async function fillCreativeMedia(picks: { row: SyncWrite["rows"][number]; story?: string; video?: string; ig?: string; hash?: string; weak: boolean }[], token: string, f: FetchFn, base: string, stillOk: () => boolean, acct?: string): Promise<string | null> {
  const { byKey, errors } = await readMediaSources(picks.map((p) => ({ key: String(p.row.ad_id ?? ""), story: p.story, video: p.video, ig: p.ig, hash: p.hash })), token, f, base, acct, stillOk);
  applyMediaSources(picks, byKey);
  const missing = picks.filter((p) => sharpness(p.row.creative_url as string | undefined) < 2).length;
  const none = picks.filter((p) => !p.row.creative_url).length;
  if (!missing) return null;
  if (errors.length) return `${missing} โฆษณาไม่ได้รูปเต็มความละเอียด — Meta ไม่ให้ดึงรูปจากโพสต์หรือคลังรูปโฆษณา (${errors[0]}) — โทเคนต้องมีสิทธิ์ ads_read และ pages_read_engagement และต้องเป็นโทเคนของเพจที่ลงโฆษณา`;
  return none ? `${none} โฆษณายังไม่มีรูปจาก Meta — โพสต์อาจถูกลบ หรือเป็นโฆษณาแบบไดนามิกที่ไม่มีภาพเดียว; ซิงก์ใหม่ภายหลังได้`
    : `${missing} โฆษณาใช้รูปขนาดจิ๋วที่ Meta ตอบกลับมา (crop 64×64) และหาต้นฉบับไม่เจอ — กดดึงซ้ำหรือรีเฟรชรูปที่หน้า Upload`;
}

/**
 * Fresh picture links for ads already in the sheet, straight from their stored creative_ref. Meta's CDN links are signed
 * and stop answering after a few days, which is what makes saved ad images break; the ids do not expire, so the
 * dashboard asks for this when a link it holds has aged out.
 */
export async function resolveCreativeLinks(ads: { adId: string; ref?: string; url?: string }[], token: string, f: FetchFn, base: string, acct?: string): Promise<Record<string, { url: string; video?: string }>> {
  const picks = ads.map((a) => ({ key: a.adId, ...parseCreativeRef(a.ref) }));
  const { byKey } = await readMediaSources(picks, token, f, base, acct, () => true);
  const out: Record<string, { url: string; video?: string }> = {};
  for (const a of ads) {
    const s = byKey.get(a.adId);
    const cands = [s?.post?.full_picture, s?.hashUrl, s?.direct, s?.cover].filter((x): x is string => !!x);
    let url = sharpness(a.url) === 2 ? a.url ?? "" : "";
    for (const u of cands) if (better(u, url)) url = u;
    const videoTarget = list<{ media_type?: string; target?: { id?: string } }>(s?.post?.attachments?.data).find((x) => x.media_type === "video" && x.target?.id)?.target?.id;
    if (url) out[a.adId] = { url, ...(videoTarget ? { video: `https://www.facebook.com/watch/?v=${videoTarget}` } : {}) };
  }
  return out;
}
