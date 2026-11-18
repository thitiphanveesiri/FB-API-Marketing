// Pull chats + comments straight from a Facebook Page (Graph API) and turn them into sheet rows.
// Pure apart from the injected fetch, so it can be tested without Meta. One call = one small batch (Vercel time limits).
import type { Dataset } from "./dataset";
import type { UpsertMode } from "./sheetOps";
import { metaApiVersion } from "./metaApi";

export interface FbPageCfg { fbPageId: string; token: string; sheetPageId?: string; name?: string }
export type Phase = "chats" | "comments" | "done";
export interface CommentPostState { id: string; url?: string; after?: string; basic?: boolean }
export interface SyncState {
  phase: Phase;
  after?: string;
  chatList?: "light" | "no-platform";
  commentBatch?: CommentPostState[];
  commentPostId?: string;
  commentPostUrl?: string;
  commentAfter?: string;
  commentsFeedDone?: boolean;
  commentBasic?: boolean;
}
export interface SyncCounts {
  chats: number;
  newLeads: number;
  messages: number;
  comments: number;
  posts?: number;
  postsWithReportedComments: number;
  postsWithoutCommentSummary: number;
  commentPagesRead: number;
  commentItemsReceived: number;
  commentsOutsideRange: number;
  pageCommentsSkipped: number;
}
export interface SyncWrite { tab: string; keyCols: string[]; rows: Record<string, string | number | boolean>[]; mode: UpsertMode }

export class FbError extends Error { constructor(msg: string, public rateLimited = false, public code?: number) { super(msg); } }
const clean = (s: string) => s.replace(/access_token=[^&\s"']+/gi, "access_token=…").replace(/EAA[\w-]{20,}/g, "…");

/** FB_PAGES='[{"fbPageId":"123","token":"EAA…","sheetPageId":"PG-1"}]'  or  FB_PAGE_ID + FB_PAGE_TOKEN (+ FB_SHEET_PAGE_ID). */
export function fbConfigs(env: Record<string, string | undefined> = process.env): FbPageCfg[] {
  try {
    if (env.FB_PAGES) { const a = JSON.parse(env.FB_PAGES); if (Array.isArray(a)) return a.filter((x) => x && x.fbPageId && x.token).map((x) => ({ fbPageId: String(x.fbPageId), token: String(x.token), sheetPageId: x.sheetPageId ? String(x.sheetPageId) : undefined })); }
  } catch { /* fall through to the single-page variables */ }
  return env.FB_PAGE_ID && env.FB_PAGE_TOKEN ? [{ fbPageId: env.FB_PAGE_ID, token: env.FB_PAGE_TOKEN, sheetPageId: env.FB_SHEET_PAGE_ID }] : [];
}

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export interface Graph { data?: unknown[]; paging?: { next?: string; cursors?: { after?: string } }; error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; fbtrace_id?: string } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Meta's own hiccups (HTTP 5xx, code 1 "unknown" / 2 "unexpected error") are usually gone a moment later: retry twice before giving up. */
const transient = (status: number, code?: number) => status >= 500 || code === 1 || code === 2;

/** fetch for Meta that gives up after `ms` instead of hanging until the platform kills the whole request. A timeout looks like
 *  Meta's own "code 1" (too much data) so callers can fall back to a lighter query right away. */
export const metaFetchWith = (ms: number): FetchFn => async (u) => {
  try { return (await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(Math.max(3000, ms)) })) as Awaited<ReturnType<FetchFn>>; }
  catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, status: 504, json: async () => ({ error: { code: 1, message: `Meta ตอบช้าเกิน ${Math.round(Math.max(3000, ms) / 1000)} วินาที` } }) };
    throw e;
  }
};
/** Default timeout: META_TIMEOUT_MS (default 12 s). */
export const metaFetch: FetchFn = (u) => metaFetchWith(Number(process.env.META_TIMEOUT_MS) || 12000)(u);

/** `retries`: how many times the SAME request is repeated on Meta's transient errors. Use 0 when a lighter query is the better answer (a heavy query that
 *  failed once will fail again, and every repeat eats the time budget). */
export async function graph(path: string, params: Record<string, string>, token: string, f: FetchFn, base: string, retryMs = 900, retries = 2): Promise<Graph> {
  for (let attempt = 0; ; attempt++) {
    const r = await f(`${base}/${metaApiVersion()}/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
    const j = ((await r.json().catch(() => ({}))) ?? {}) as Graph;
    if (r.ok && !j.error) return j;
    const code = j.error?.code;
    if (transient(r.status, code) && attempt < retries) { await sleep(retryMs * (attempt + 1)); continue; }
    const rate = code != null && ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)); // 800xx = Marketing API call limits
    throw new FbError(rate ? `Meta ขอให้รอสักครู่ (ถูกจำกัดจำนวนครั้ง) — code ${code}${j.error?.error_subcode ? `/${j.error.error_subcode}` : ""}: ${clean(j.error?.message ?? "")}`.slice(0, 260) : `Meta ตอบ ${r.status}: ${clean(j.error?.message ?? "ไม่ทราบสาเหตุ")}${j.error?.error_user_msg ? ` — ${clean(j.error.error_user_msg)}` : ""}${code != null ? ` (code ${code}${j.error?.error_subcode ? `/${j.error.error_subcode}` : ""}${j.error?.fbtrace_id ? `, trace ${j.error.fbtrace_id}` : ""})` : ""}`, rate, code);
  }
}

/** "2026-11-01T03:05:00+0000" (UTC) → "2026-11-01 10:05" in the business time zone. */
export function localStamp(iso: string, tz: string): string {
  const d = new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

interface FbPerson { id?: string; name?: string }
interface FbMsg { id: string; message?: string; from?: FbPerson; created_time: string; attachments?: unknown }
interface FbConv { id: string; updated_time: string; participants?: { data?: FbPerson[] } }
interface FbComment { id: string; from?: FbPerson; message?: string; created_time: string; comments?: { data?: { from?: FbPerson; created_time: string }[] } }
interface FbPost { id: string; permalink_url?: string; comments?: { summary?: { total_count?: number } } }

export interface SyncInput { channel?: "instagram"; igId?: string; legacyPageId?: string; cfg: FbPageCfg; sheetPageId: string; days: number; state: SyncState; ds: Dataset; tz: string; now?: Date; fetchFn?: FetchFn; base?: string }
export interface SyncOutput { next: SyncState; writes: SyncWrite[]; counts: SyncCounts; warning?: string }

export const MAX_COMMENT_POSTS_PER_BATCH = 50;
const CHATS_PER_CALL = 3, MSG_PAGES = 5, POSTS_PER_BATCH = MAX_COMMENT_POSTS_PER_BATCH, COMMENT_PARALLEL = 5;
/** Instagram conversations are much slower to list than Messenger: ask for fewer chats and fewer message pages, with a longer per-request timeout. */
const IG_CHATS_PER_CALL = 2, IG_MSG_PAGES = 2, IG_MSG_LIMIT = 50, IG_MIN_TIMEOUT_MS = 25000, IG_MAX_TIMEOUT_MS = 25000, IG_TIME_BUDGET_MS = 35000;

/** Meta's inbox edges fail for reasons that are not the token: a 500 on the page's conversation list, or "Object does not exist / missing
 *  permissions" (code 100) when the app may not read that inbox. Say which one it is — both otherwise look like a plain sync failure. */
export function inboxHint(e: FbError, isIg: boolean): string | null {
  if (e.rateLimited) return null;
  if (e.code === 100) return isIg
    ? "อ่านกล่องข้อความ Instagram ของเพจนี้ไม่ได้ — ตรวจ 3 อย่าง: (1) IG ยังผูกกับเพจนี้อยู่ (Business Suite) (2) แอป Meta มีสิทธิ์ instagram_manage_messages และแอปอยู่โหมด Live หรือบัญชีนี้เป็นผู้ดูแลแอป (3) ในแอป Instagram → Settings → Messages and story replies → Connected tools → เปิด Allow access to messages"
    : "อ่านกล่องข้อความ Messenger ของเพจนี้ไม่ได้ — ตรวจว่าเพจยังผูกกับแอป Meta และโทเคนมีสิทธิ์ pages_messaging";
  if (e.code === 1 || e.code === 2) return "Meta ขัดข้องตอนอ่านรายการแชทของเพจนี้ (ฝั่ง Meta ไม่ใช่โทเคนหรือ Google Sheet) — ลองดึงซ้ำภายหลัง หรือลดช่วงย้อนหลังเหลือ 3 วัน ถ้าซ้ำที่เพจเดิมทุกครั้ง ให้เปิดกล่องข้อความของเพจใน Business Suite และตรวจว่าแอปมีสิทธิ์ pages_messaging";
  return null;
}
const inboxError = (e: unknown, isIg: boolean): unknown => {
  const hint = e instanceof FbError ? inboxHint(e, isIg) : null;
  return hint ? new FbError(`${(e as FbError).message} — ${hint}`, false, (e as FbError).code) : e;
};

export async function syncStep(i: SyncInput): Promise<SyncOutput> {
  const isIg = i.channel === "instagram";
  const timeoutMs = Number(process.env.META_TIMEOUT_MS) || 12000;
  const f = i.fetchFn ?? (isIg ? metaFetchWith(Math.min(IG_MAX_TIMEOUT_MS, Math.max(timeoutMs, IG_MIN_TIMEOUT_MS))) : metaFetch), base = i.base ?? "https://graph.facebook.com";
  const t0 = Date.now();
  const now = i.now ?? new Date(), since = now.getTime() - i.days * 86400000, tok = i.cfg.token;
  // Ask Meta which page this token belongs to: catches the two usual set-up mistakes (a user token instead of a Page token, or the wrong FB_PAGE_ID)
  const who = (await graph("me", { fields: "id,name,category" }, tok, f, base, 900, 0).catch((e) => { if (e instanceof FbError && e.code === 100 && /category/i.test(e.message)) throw new FbError("โทเคนนี้เป็นโทเคนของผู้ใช้ ไม่ใช่ของเพจ — เชื่อมเพจใหม่ที่หน้า Upload (วางโทเคนผู้ใช้ได้ ระบบจะแลกเป็นโทเคนเพจให้) หรือใช้ me/accounts ใน Graph API Explorer เพื่อเอา access_token ของเพจ", false, 100); if (e instanceof FbError && !e.rateLimited) throw new FbError(`โทเคนใช้ไม่ได้: ${e.message} — สร้างโทเคนเพจใหม่`, false, e.code); throw e; })) as unknown as { id?: string; name?: string; category?: string };
  if (!who.id || !who.category) throw new FbError(`FB_PAGE_TOKEN เป็นโทเคนของผู้ใช้${who.name ? ` (${who.name})` : ""} ไม่ใช่โทเคนของเพจ — ใน Graph API Explorer รัน me/accounts แล้วคัดลอก access_token ของเพจที่ต้องการมาใช้แทน`);
  const self = isIg ? (i.igId ?? "") : who.id; // Instagram chats: the business side is the Instagram account, not the Page
  const fb = who.id; // always the page the token really belongs to (a mismatched FB_PAGE_ID is harmless then)
  const counts: SyncCounts = {
    chats: 0,
    newLeads: 0,
    messages: 0,
    comments: 0,
    posts: 0,
    postsWithReportedComments: 0,
    postsWithoutCommentSummary: 0,
    commentPagesRead: 0,
    commentItemsReceived: 0,
    commentsOutsideRange: 0,
    pageCommentsSkipped: 0,
  };
  const writes: SyncWrite[] = [];
  const ms = (iso: string) => new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")).getTime();

  if (i.state.phase === "chats") {
    // Meta sometimes answers 500 "unexpected error" (code 1/2) for the full conversation list: retry with lighter requests (no participant details, then without the platform filter)
    const convQuery = (fields: string, platform: boolean) => graph(`${fb}/conversations`, { ...(platform ? { platform: isIg ? "instagram" : "messenger" } : {}), fields, limit: String(isIg ? IG_CHATS_PER_CALL : CHATS_PER_CALL), ...(i.state.after ? { after: i.state.after } : {}) }, tok, f, base, 900, 0);
    const isTransient = (e: unknown) => e instanceof FbError && (e.code === 1 || e.code === 2);
    let j: Graph, chatList = i.state.chatList;
    if (chatList === "no-platform" && !isIg) j = await convQuery("id,updated_time", false);
    else if (chatList === "light") {
      try { j = await convQuery("id,updated_time", true); }
      catch (e) { if (!isTransient(e)) throw e; if (isIg) throw e; j = await convQuery("id,updated_time", false); chatList = "no-platform"; }
    } else if (isIg) {
      // participants makes Meta very slow on big Instagram inboxes; the customer is read from the messages instead
      try { j = await convQuery("id,updated_time", true); }
      catch (e) { throw inboxError(e, true); }
    } else {
      try { j = await convQuery("id,updated_time,participants", true); }
      catch (e) {
        if (!isTransient(e)) throw inboxError(e, false);
        chatList = "light";
        try { j = await convQuery("id,updated_time", true); }
        catch (e2) {
          if (!isTransient(e2)) throw inboxError(e2, false);
          try { j = await convQuery("id,updated_time", false); chatList = "no-platform"; }
          catch (e3) { throw inboxError(e3, false); }
        }
      }
    }
    let skippedChats = 0, partialChats = 0, budgetCuts = 0;
    const convs = (j.data ?? []) as FbConv[];
    const fresh = convs.filter((c) => ms(c.updated_time) >= since);
    const cutoff = fresh.length < convs.length; // list is newest-first: an old one means the rest is older still

    const mine = i.ds.leads.filter((l) => l.pageId === i.sheetPageId);
    const byId = new Set(mine.map((l) => l.id));
    const byName = new Map<string, string | null>(); // lower-cased name → lead id (null when two leads share the name)
    if (!isIg) for (const l of mine) { const k = l.name.trim().toLowerCase(); if (k) byName.set(k, byName.has(k) ? null : l.id); } // Instagram chats are never merged by name (the same person may also write on Facebook)

    // Instagram used to be filed under the Facebook page: on the first pull into the Instagram page, re-home those leads
    // so the conversation moves with its messages instead of being duplicated.
    const elsewhere = isIg ? new Map(i.ds.leads.map((l) => [l.id, l])) : null;
    const movedRows = new Map<string, SyncWrite["rows"][number]>();
    // every Instagram lead that still sits on the paired Facebook page moves over (also older chats outside the pull window)
    if (isIg && i.legacyPageId && i.legacyPageId !== i.sheetPageId) {
      for (const l of i.ds.leads) if (l.pageId === i.legacyPageId && l.channel === "instagram") movedRows.set(l.id, { lead_id: l.id, page_id: i.sheetPageId });
    }
    const leadRows: SyncWrite["rows"] = []; const msgRows: SyncWrite["rows"] = []; const psidRows = new Map<string, SyncWrite["rows"][number]>();
    const lists = await Promise.all(fresh.map(async (c) => {
      const all: FbMsg[] = []; let after: string | undefined;
      try {
      for (let p = 0; p < (isIg ? IG_MSG_PAGES : MSG_PAGES); p++) {
        // Instagram threads can be very long: stop before the route hits the 60 s platform limit; the newest messages are already saved
        if (p > 0 && isIg && Date.now() - t0 > IG_TIME_BUDGET_MS) { budgetCuts++; break; }
        // a heavy page of messages (many attachments) can make Meta answer 500: ask again for fewer messages without the attachment details
        const m = await graph(`${c.id}/messages`, { fields: "id,message,from,created_time,attachments", limit: isIg ? String(IG_MSG_LIMIT) : "100", ...(after ? { after } : {}) }, tok, f, base, 900, 0)
          .catch((e) => { if (!(e instanceof FbError) || (e.code !== 1 && e.code !== 2)) throw e; if (isIg && Date.now() - t0 > 30000) throw e; return graph(`${c.id}/messages`, { fields: "id,message,from,created_time", limit: "25", ...(after ? { after } : {}) }, tok, f, base, 900, 0); });
        all.push(...((m.data ?? []) as FbMsg[]));
        if (!m.paging?.next) break; after = m.paging.cursors?.after; if (!after) break;
      }
      } catch (e) {
        if (!isTransient(e)) throw e;
        if (all.length) partialChats++; else skippedChats++;
      } // one chat Meta cannot serve must not stop the whole page: report skipped or partial history
      return all.sort((a, b) => a.created_time.localeCompare(b.created_time));
    }));
    fresh.forEach((c, n) => {
      const list = lists[n].filter((m) => ms(m.created_time) >= since); if (!list.length) return;
      counts.chats++;
      const customer = (c.participants?.data ?? []).find((p) => p.id !== self && p.id !== fb) ?? list.find((m) => m.from?.id && m.from.id !== self && m.from.id !== fb)?.from;
      const name = customer?.name?.trim() || list.find((m) => m.from?.id && m.from.id !== self && m.from.id !== fb)?.from?.name?.trim() || (isIg ? "ลูกค้า Instagram" : "ลูกค้า Facebook");
      let leadId = byId.has(c.id) ? c.id : byName.get(name.toLowerCase()) ?? "";
      const found = !leadId ? elsewhere?.get(c.id) : undefined;
      const moved = found?.channel === "instagram" ? found : undefined;
      if (moved) {
        leadId = moved.id; byId.add(leadId);
        if (moved.pageId !== i.sheetPageId) movedRows.set(leadId, { lead_id: leadId, page_id: i.sheetPageId });
      }
      if (!leadId) {
        leadId = c.id; byId.add(leadId); counts.newLeads++;
        const last = list[list.length - 1], repliedByPage = list.some((m) => m.from?.id === self);
        leadRows.push({ lead_id: leadId, name, page_id: i.sheetPageId, ad_id: "", assigned_to: "", status: repliedByPage ? "Average" : "Not Responded", quality: repliedByPage ? "Average" : "Not Responded", valid: true,
          created_at: localStamp(list[0].created_time, i.tz).slice(0, 10), last_contact_at: localStamp(last.created_time, i.tz), last_message: (last.message || "[ไฟล์แนบ]").slice(0, 300), phone: "", email: "", unread: false, channel: isIg ? "instagram" : "facebook", fb_user_id: customer?.id ?? "" });
      } else if (customer?.id && !mine.find((l) => l.id === leadId)?.fbUserId) psidRows.set(leadId, { lead_id: leadId, fb_user_id: customer.id, channel: isIg ? "instagram" : "facebook" }); // older lead: remember who to message
      for (const m of list) msgRows.push({ message_id: m.id, lead_id: leadId, direction: m.from?.id === self ? "out" : "in", text: (m.message || (m.attachments ? "[ไฟล์แนบ]" : "")).slice(0, 2000), sent_at: localStamp(m.created_time, i.tz), attachment_name: "" });
    });
    counts.messages = msgRows.length;
    if (leadRows.length) writes.push({ tab: "leads", keyCols: ["lead_id"], rows: leadRows, mode: "insert" });
    if (msgRows.length) writes.push({ tab: "messages", keyCols: ["message_id"], rows: msgRows, mode: "insert" });
    if (psidRows.size) writes.push({ tab: "leads", keyCols: ["lead_id"], rows: [...psidRows.values()], mode: "updateOnly" });
    if (movedRows.size) writes.push({ tab: "leads", keyCols: ["lead_id"], rows: [...movedRows.values()], mode: "updateOnly" });
    const more = !cutoff && !!j.paging?.next && !!j.paging.cursors?.after;
    const warning = [skippedChats ? `ข้าม ${skippedChats} แชทที่ Meta ส่งข้อความให้ไม่ได้ (500) — ดึงซ้ำภายหลังจะได้เพิ่ม` : "", partialChats ? `ดึงประวัติได้ไม่ครบ ${partialChats} แชท (500) — ข้อมูลบางส่วนถูกบันทึกแล้ว ลองดึงซ้ำภายหลัง` : "", budgetCuts ? `หยุดดึงประวัติ ${budgetCuts} แชทที่ยาวมากเพราะใช้เวลาเกิน ${Math.round(IG_TIME_BUDGET_MS / 1000)} วินาที — ลดจำนวนวันย้อนหลังแล้วดึงซ้ำ` : "", chatList ? "Meta ปฏิเสธรายการแชทแบบละเอียด จึงดึงแบบย่อ (ชื่อลูกค้าอ่านจากข้อความ)" : ""].filter(Boolean).join(" · ");
    return { next: more ? { phase: "chats", after: j.paging!.cursors!.after, ...(chatList ? { chatList } : {}) } : { phase: isIg ? "done" : "comments" }, writes, counts, ...(warning ? { warning } : {}) };
  }

  if (i.state.phase === "comments") {
    // posts are filtered by their own date, so look back a bit further to catch fresh comments on slightly older posts
    // Comments need the pages_read_engagement permission (and pages_read_user_content for the commenters). A token without them must not sink the chats that were already pulled.
    const noPerm = (e: unknown) => e instanceof FbError && (e.code === 10 || e.code === 200);
    const skip = (): SyncOutput => ({ next: { phase: "done" }, writes, counts, warning: "ข้ามคอมเมนต์: โทเคนของเพจไม่มีสิทธิ์ pages_read_engagement / pages_read_user_content (สร้างโทเคนใหม่โดยติ๊กสิทธิ์เหล่านี้ แล้วเชื่อมเพจใหม่)" });
    const transientOrUnsupported = (e: unknown) => e instanceof FbError && (e.code === 1 || e.code === 2 || e.code === 100);
    let feedAfter = i.state.after;
    let feedDone = i.state.commentsFeedDone === true;
    let batch = i.state.commentBatch ?? (i.state.commentPostId
      ? [{ id: i.state.commentPostId, url: i.state.commentPostUrl, after: i.state.commentAfter, basic: i.state.commentBasic }]
      : []);
    let lighter = false;

    if (!batch.length) {
      if (feedDone) return { next: { phase: "done" }, writes, counts };
      const feedParams = {
        since: String(Math.floor((since - 14 * 86400000) / 1000)),
        limit: String(POSTS_PER_BATCH),
        ...(feedAfter ? { after: feedAfter } : {}),
      };
      let feed: Graph;
      try {
        try {
          feed = await graph(`${fb}/feed`, { ...feedParams, fields: "id,permalink_url,comments.filter(toplevel).limit(0).summary(true)" }, tok, f, base, 900, 0);
        } catch (e) {
          if (!transientOrUnsupported(e)) throw e;
          try {
            feed = await graph(`${fb}/feed`, { ...feedParams, fields: "id,permalink_url,comments.limit(0).summary(true)" }, tok, f, base, 900, 0);
          } catch (e2) {
            if (!transientOrUnsupported(e2)) throw e2;
            feed = await graph(`${fb}/feed`, { ...feedParams, fields: "id,permalink_url" }, tok, f, base, 900, 0);
          }
        }
      } catch (e) { if (noPerm(e)) return skip(); throw e; }

      const posts = ((feed.data ?? []) as FbPost[]).filter((post) => !!post.id);
      counts.posts = posts.length;
      counts.postsWithReportedComments = posts.filter((post) => (post.comments?.summary?.total_count ?? 0) > 0).length;
      counts.postsWithoutCommentSummary = posts.filter((post) => post.comments?.summary?.total_count == null).length;
      batch = posts
        .filter((post) => (post.comments?.summary?.total_count ?? 1) > 0)
        .map((post) => ({ id: post.id, url: post.permalink_url || post.id }));
      feedAfter = feed.paging?.next ? feed.paging.cursors?.after : undefined;
      feedDone = !feedAfter;
      if (!batch.length) return { next: feedDone ? { phase: "done" } : { phase: "comments", after: feedAfter }, writes, counts };
    }

    const rows: SyncWrite["rows"] = [];
    const pending: CommentPostState[] = [];
    const activeBatch = batch.slice(0, COMMENT_PARALLEL);
    const waitingBatch = batch.slice(COMMENT_PARALLEL);
    const pullPost = async (post: CommentPostState) => {
      const fetchComments = (light: boolean) => graph(`${post.id}/comments`, {
        filter: "toplevel",
        order: "chronological",
        fields: light ? "id,from,message,created_time" : "id,from,message,created_time,comments.limit(50){from,message,created_time}",
        limit: light ? "25" : "100",
        ...(post.after ? { after: post.after } : {}),
      }, tok, f, base, 900, 0);
      let comments: Graph, basic = post.basic === true;
      try { comments = await fetchComments(basic); counts.commentPagesRead++; }
      catch (e) {
        if (noPerm(e)) throw e;
        if (!basic && transientOrUnsupported(e)) {
          basic = true;
          comments = await fetchComments(true);
          counts.commentPagesRead++;
          lighter = true;
        } else throw e;
      }

      const received = (comments.data ?? []) as FbComment[];
      counts.commentItemsReceived += received.length;
      for (const x of received) {
        if (x.from?.id === fb) { counts.pageCommentsSkipped++; continue; }
        if (ms(x.created_time) < since) { counts.commentsOutsideRange++; continue; }
        const reply = (x.comments?.data ?? []).filter((r) => r.from?.id === fb).sort((a, b) => a.created_time.localeCompare(b.created_time))[0];
        rows.push({ comment_id: x.id, page_id: i.sheetPageId, post_id: post.url || post.id, commenter: x.from?.name ?? "", text: (x.message ?? "").slice(0, 1000), commented_at: localStamp(x.created_time, i.tz), replied_at: reply ? localStamp(reply.created_time, i.tz) : "", replied_by: "" });
      }
      const nextAfter = comments.paging?.next ? comments.paging.cursors?.after : undefined;
      if (nextAfter) pending.push({ ...post, after: nextAfter, ...(basic ? { basic: true } : {}) });
    };

    try {
      await Promise.all(activeBatch.map(pullPost));
    } catch (e) { if (noPerm(e)) return skip(); throw e; }

    counts.comments = rows.length;
    if (rows.length) writes.push({ tab: "post_comments", keyCols: ["comment_id"], rows, mode: "upsert" });
    const remaining = [...pending, ...waitingBatch];
    const next: SyncState = remaining.length
      ? { phase: "comments", ...(feedAfter ? { after: feedAfter } : {}), commentsFeedDone: feedDone, commentBatch: remaining }
      : feedDone ? { phase: "done" } : { phase: "comments", after: feedAfter };
    return { next, writes, counts, ...(lighter ? { warning: "Meta ตอบข้อมูลการตอบกลับแบบละเอียดไม่ทัน จึงดึงเฉพาะข้อความคอมเมนต์ (รายละเอียดการตอบกลับจากเพจอาจไม่ครบ)" } : {}) };
  }
  return { next: { phase: "done" }, writes, counts };
}
