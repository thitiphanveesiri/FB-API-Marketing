// Pull chats + comments straight from a Facebook Page (Graph API) and turn them into sheet rows.
// Pure apart from the injected fetch, so it can be tested without Meta. One call = one small batch (Vercel time limits).
import type { Dataset } from "./dataset";
import type { UpsertMode } from "./sheetOps";

export interface FbPageCfg { fbPageId: string; token: string; sheetPageId?: string }
export type Phase = "chats" | "comments" | "done";
export interface SyncState { phase: Phase; after?: string }
export interface SyncCounts { chats: number; newLeads: number; messages: number; comments: number }
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
export interface Graph { data?: unknown[]; paging?: { next?: string; cursors?: { after?: string } }; error?: { message?: string; code?: number } }

export async function graph(path: string, params: Record<string, string>, token: string, f: FetchFn, base: string): Promise<Graph> {
  const r = await f(`${base}/v21.0/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
  const j = ((await r.json().catch(() => ({}))) ?? {}) as Graph;
  if (r.ok && !j.error) return j;
  const code = j.error?.code; const rate = code != null && ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)); // 800xx = Marketing API call limits
  throw new FbError(rate ? "Meta ขอให้รอสักครู่ (ถูกจำกัดจำนวนครั้ง)" : `Meta ตอบ ${r.status}: ${clean(j.error?.message ?? "ไม่ทราบสาเหตุ")}`, rate, code);
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
interface FbPost { id: string; permalink_url?: string }

export interface SyncInput { cfg: FbPageCfg; sheetPageId: string; days: number; state: SyncState; ds: Dataset; tz: string; now?: Date; fetchFn?: FetchFn; base?: string }
export interface SyncOutput { next: SyncState; writes: SyncWrite[]; counts: SyncCounts }

const CHATS_PER_CALL = 8, POSTS_PER_CALL = 4, MSG_PAGES = 5;

export async function syncStep(i: SyncInput): Promise<SyncOutput> {
  const f = i.fetchFn ?? ((u: string) => fetch(u, { cache: "no-store" }) as ReturnType<FetchFn>), base = i.base ?? "https://graph.facebook.com";
  const now = i.now ?? new Date(), since = now.getTime() - i.days * 86400000, tok = i.cfg.token;
  // Ask Meta which page this token belongs to: catches the two usual set-up mistakes (a user token instead of a Page token, or the wrong FB_PAGE_ID)
  const who = (await graph("me", { fields: "id,name,category" }, tok, f, base).catch((e) => { if (e instanceof FbError && e.code === 100 && /category/i.test(e.message)) throw new FbError("โทเคนนี้เป็นโทเคนของผู้ใช้ ไม่ใช่ของเพจ — เชื่อมเพจใหม่ที่หน้า Upload (วางโทเคนผู้ใช้ได้ ระบบจะแลกเป็นโทเคนเพจให้) หรือใช้ me/accounts ใน Graph API Explorer เพื่อเอา access_token ของเพจ", false, 100); if (e instanceof FbError && !e.rateLimited) throw new FbError(`โทเคนใช้ไม่ได้: ${e.message} — สร้างโทเคนเพจใหม่`, false, e.code); throw e; })) as unknown as { id?: string; name?: string; category?: string };
  if (!who.id || !who.category) throw new FbError(`FB_PAGE_TOKEN เป็นโทเคนของผู้ใช้${who.name ? ` (${who.name})` : ""} ไม่ใช่โทเคนของเพจ — ใน Graph API Explorer รัน me/accounts แล้วคัดลอก access_token ของเพจที่ต้องการมาใช้แทน`);
  const fb = who.id; // always the page the token really belongs to (a mismatched FB_PAGE_ID is harmless then)
  const counts: SyncCounts = { chats: 0, newLeads: 0, messages: 0, comments: 0 };
  const writes: SyncWrite[] = [];
  const ms = (iso: string) => new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")).getTime();

  if (i.state.phase === "chats") {
    const j = await graph(`${fb}/conversations`, { platform: "messenger", fields: "id,updated_time,participants", limit: String(CHATS_PER_CALL), ...(i.state.after ? { after: i.state.after } : {}) }, tok, f, base);
    const convs = (j.data ?? []) as FbConv[];
    const fresh = convs.filter((c) => ms(c.updated_time) >= since);
    const cutoff = fresh.length < convs.length; // list is newest-first: an old one means the rest is older still

    const mine = i.ds.leads.filter((l) => l.pageId === i.sheetPageId);
    const byId = new Set(mine.map((l) => l.id));
    const byName = new Map<string, string | null>(); // lower-cased name → lead id (null when two leads share the name)
    for (const l of mine) { const k = l.name.trim().toLowerCase(); if (k) byName.set(k, byName.has(k) ? null : l.id); }

    const leadRows: SyncWrite["rows"] = []; const msgRows: SyncWrite["rows"] = []; const psidRows = new Map<string, SyncWrite["rows"][number]>();
    const lists = await Promise.all(fresh.map(async (c) => {
      const all: FbMsg[] = []; let after: string | undefined;
      for (let p = 0; p < MSG_PAGES; p++) {
        const m = await graph(`${c.id}/messages`, { fields: "id,message,from,created_time,attachments", limit: "100", ...(after ? { after } : {}) }, tok, f, base);
        all.push(...((m.data ?? []) as FbMsg[]));
        if (!m.paging?.next) break; after = m.paging.cursors?.after; if (!after) break;
      }
      return all.sort((a, b) => a.created_time.localeCompare(b.created_time));
    }));
    fresh.forEach((c, n) => {
      const list = lists[n].filter((m) => ms(m.created_time) >= since); if (!list.length) return;
      counts.chats++;
      const customer = (c.participants?.data ?? []).find((p) => p.id !== fb);
      const name = customer?.name?.trim() || "ลูกค้า Facebook";
      let leadId = byId.has(c.id) ? c.id : byName.get(name.toLowerCase()) ?? "";
      if (!leadId) {
        leadId = c.id; byId.add(leadId); counts.newLeads++;
        const last = list[list.length - 1], repliedByPage = list.some((m) => m.from?.id === fb);
        leadRows.push({ lead_id: leadId, name, page_id: i.sheetPageId, ad_id: "", assigned_to: "", status: repliedByPage ? "Average" : "Not Responded", quality: repliedByPage ? "Average" : "Not Responded", valid: true,
          created_at: localStamp(list[0].created_time, i.tz).slice(0, 10), last_contact_at: localStamp(last.created_time, i.tz), last_message: (last.message || "[ไฟล์แนบ]").slice(0, 300), phone: "", email: "", unread: false, channel: "facebook", fb_user_id: customer?.id ?? "" });
      } else if (customer?.id && !mine.find((l) => l.id === leadId)?.fbUserId) psidRows.set(leadId, { lead_id: leadId, fb_user_id: customer.id, channel: "facebook" }); // older lead: remember who to message
      for (const m of list) msgRows.push({ message_id: m.id, lead_id: leadId, direction: m.from?.id === fb ? "out" : "in", text: (m.message || (m.attachments ? "[ไฟล์แนบ]" : "")).slice(0, 2000), sent_at: localStamp(m.created_time, i.tz), attachment_name: "" });
    });
    counts.messages = msgRows.length;
    if (leadRows.length) writes.push({ tab: "leads", keyCols: ["lead_id"], rows: leadRows, mode: "insert" });
    if (msgRows.length) writes.push({ tab: "messages", keyCols: ["message_id"], rows: msgRows, mode: "insert" });
    if (psidRows.size) writes.push({ tab: "leads", keyCols: ["lead_id"], rows: [...psidRows.values()], mode: "updateOnly" });
    const more = !cutoff && !!j.paging?.next && !!j.paging.cursors?.after;
    return { next: more ? { phase: "chats", after: j.paging!.cursors!.after } : { phase: "comments" }, writes, counts };
  }

  if (i.state.phase === "comments") {
    // posts are filtered by their own date, so look back a bit further to catch fresh comments on slightly older posts
    const j = await graph(`${fb}/feed`, { fields: "id,permalink_url", since: String(Math.floor((since - 14 * 86400000) / 1000)), limit: String(POSTS_PER_CALL), ...(i.state.after ? { after: i.state.after } : {}) }, tok, f, base);
    const rows: SyncWrite["rows"] = [];
    for (const p of (j.data ?? []) as FbPost[]) {
      let after: string | undefined;
      for (let pg = 0; pg < 3; pg++) {
        const c = await graph(`${p.id}/comments`, { filter: "toplevel", order: "chronological", fields: "id,from,message,created_time,comments.limit(50){from,message,created_time}", limit: "100", ...(after ? { after } : {}) }, tok, f, base);
        for (const x of (c.data ?? []) as FbComment[]) {
          if (x.from?.id === fb || ms(x.created_time) < since) continue; // the page's own comments aren't customers
          const reply = (x.comments?.data ?? []).filter((r) => r.from?.id === fb).sort((a, b) => a.created_time.localeCompare(b.created_time))[0];
          rows.push({ comment_id: x.id, page_id: i.sheetPageId, post_id: p.permalink_url || p.id, commenter: x.from?.name ?? "", text: (x.message ?? "").slice(0, 1000), commented_at: localStamp(x.created_time, i.tz), replied_at: reply ? localStamp(reply.created_time, i.tz) : "", replied_by: "" });
        }
        if (!c.paging?.next) break; after = c.paging.cursors?.after; if (!after) break;
      }
    }
    counts.comments = rows.length;
    if (rows.length) writes.push({ tab: "post_comments", keyCols: ["comment_id"], rows, mode: "upsert" }); // upsert: a reply that arrives later fills in replied_at
    const more = !!j.paging?.next && !!j.paging.cursors?.after;
    return { next: more ? { phase: "comments", after: j.paging!.cursors!.after } : { phase: "done" }, writes, counts };
  }
  return { next: { phase: "done" }, writes, counts };
}
