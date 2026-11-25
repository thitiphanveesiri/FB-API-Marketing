// Pure import logic: column auto-mapping, row validation, dedupe. No React, no store.
import { ImportDataType, ChatChannel, DailyPerf, Lead, LeadStatus, QUALITIES, LeadQuality, PageInsight, PostComment, parseStatus, parseChannel } from "./types";
import { ANCHOR } from "./dates";
import { matchUser } from "./repMatch";

export interface FieldDef { key: string; label: string; required: boolean; kind: "text" | "date" | "number" | "int"; synonyms: string[] }

const F = (key: string, label: string, required: boolean, kind: FieldDef["kind"], synonyms: string[]): FieldDef => ({ key, label, required, kind, synonyms });

const AD_FIELDS: FieldDef[] = [
  F("date", "Date", true, "date", ["day", "date", "reporting starts", "reporting_starts", "start date", "วัน", "วันที่", "วันที่เริ่มรายงาน"]),
  F("campaignName", "Campaign name", false, "text", ["campaign name", "campaign", "ชื่อแคมเปญ", "แคมเปญ"]),
  F("adSetName", "Ad set name (used when there is no campaign name)", false, "text", ["ad set name", "adset name", "ชื่อชุดโฆษณา"]),
  F("dateEnd", "Reporting ends", false, "date", ["reporting ends", "reporting_ends", "วันที่สิ้นสุดรายงาน"]),
  F("adId", "Ad ID", false, "text", ["ad id", "ad_id", "adid", "รหัสโฆษณา"]),
  F("adName", "Ad name", false, "text", ["ad name", "ad", "ชื่อโฆษณา"]),
  F("spend", "Amount spent", true, "number", ["amount spent", "amount spent (thb)", "spend", "cost", "amount spent (usd)", "จำนวนเงินที่ใช้จ่าย", "ยอดใช้จ่าย"]),
  F("reach", "Reach", false, "int", ["reach", "การเข้าถึง"]),
  F("impressions", "Impressions", true, "int", ["impressions", "การแสดงผล"]),
  F("clicks", "Link Clicks", false, "int", ["link clicks", "inline link clicks", "inline_link_clicks", "การคลิกลิงก์", "คลิกลิงก์"]),
  F("messages", "Messaging conversations started", false, "int", ["messaging conversations started", "messages", "results", "new messaging contacts", "การสนทนาทางข้อความที่เริ่มต้น", "ผลลัพธ์"]),
  F("purchases", "Purchases", false, "int", ["purchases", "website purchases", "purchase", "การซื้อ"]),
];
const CAMPAIGN_FIELDS = AD_FIELDS.map((f) => (f.key === "adId" ? { ...f, required: false } : f));

const LEAD_FIELDS: FieldDef[] = [
  F("channel", "Channel (fb / ig / line / whatsapp)", false, "text", ["channel", "platform", "ช่องทาง", "แพลตฟอร์ม"]),
  F("leadId", "Lead ID", false, "text", ["lead id", "lead_id", "id"]),
  F("name", "Customer name", true, "text", ["name", "customer name", "customer", "full name", "full_name", "ชื่อ", "ชื่อลูกค้า"]),
  F("adId", "Source Ad ID", false, "text", ["ad id", "source ad", "source ad id", "ad_id", "adid"]),
  F("date", "Created date", true, "date", ["date", "created", "created date", "created at", "created_time", "created time", "วันที่"]),
  F("status", "Lead status", false, "text", ["status", "lead status", "stage", "lead_status", "สถานะ"]),
  F("phone", "Phone", false, "text", ["phone", "mobile", "tel", "phone_number", "phone number", "เบอร์", "เบอร์โทร"]),
  F("email", "Email", false, "text", ["email", "email address", "e-mail", "อีเมล"]),
  F("phone2", "Secondary phone", false, "text", ["secondary phone number", "secondary phone", "phone 2", "phone2", "other phone"]),
  F("whatsapp", "WhatsApp number", false, "text", ["whatsapp number", "whatsapp", "wa number"]),
  F("leadSource", "Source (Paid / Organic …)", false, "text", ["source", "lead source", "แหล่งที่มา"]),
  F("form", "Form / landing page", false, "text", ["form", "form name", "แบบฟอร์ม"]),
  F("repName", "Salesperson", false, "text", ["salesperson", "sales rep", "assigned to", "rep", "owner", "owner name", "เจ้าของ", "ผู้ดูแล"]),
  F("labels", "Labels / tags (Ad ID is read from here)", false, "text", ["labels", "tags", "ป้ายกำกับ", "แท็ก"]),
  F("lastMessage", "Message / Note", false, "text", ["message", "last message", "ข้อความ", "ข้อความล่าสุด"]),
];
const INBOX_FIELDS: FieldDef[] = [
  F("channel", "Channel (fb / ig / line / whatsapp)", false, "text", ["channel", "platform", "ช่องทาง", "แพลตฟอร์ม"]),
  F("name", "Customer name", true, "text", ["name", "customer name", "customer", "full name", "contact", "contact name", "sender", "ชื่อ", "ชื่อลูกค้า"]),
  F("date", "First contact date", true, "date", ["date", "created", "created date", "first contact", "first message", "first message date", "started", "conversation started", "วันที่", "วันที่ทัก"]),
  F("leadId", "Conversation / Lead ID", false, "text", ["lead id", "lead_id", "id", "conversation id", "thread id"]),
  F("lastMessage", "Last message", false, "text", ["last message", "latest message", "message", "ข้อความล่าสุด"]),
  F("lastContactAt", "Last message date", false, "date", ["last message date", "last message time", "last contact", "last activity", "updated", "updated time", "วันที่ล่าสุด", "วันที่ข้อความล่าสุด"]),
  F("adId", "Source Ad ID", false, "text", ["ad id", "ad_id", "source ad", "source ad id", "referral ad id"]),
  F("phone", "Phone", false, "text", ["phone", "mobile", "tel", "phone number", "เบอร์", "เบอร์โทร"]),
  F("email", "Email", false, "text", ["email", "email address", "e-mail", "อีเมล"]),
  F("phone2", "Secondary phone", false, "text", ["secondary phone number", "secondary phone", "phone 2", "phone2", "other phone"]),
  F("whatsapp", "WhatsApp number", false, "text", ["whatsapp number", "whatsapp", "wa number"]),
  F("leadSource", "Source (Paid / Organic …)", false, "text", ["source", "lead source", "แหล่งที่มา"]),
  F("form", "Form / landing page", false, "text", ["form", "form name", "แบบฟอร์ม"]),
  F("status", "Chat type / status", false, "text", ["status", "stage", "chat type", "สถานะ", "ประเภท"]),
  F("repName", "Salesperson", false, "text", ["salesperson", "sales rep", "assigned to", "rep", "assignee", "owner", "owner name", "เจ้าของ", "ผู้ดูแล"]),
  F("labels", "Labels / tags (Ad ID is read from here)", false, "text", ["labels", "tags", "ป้ายกำกับ", "แท็ก"]),
];
const INSIGHT_FIELDS: FieldDef[] = [
  F("date", "Date", true, "date", ["date", "day", "วันที่"]),
  F("reach", "Reach", true, "int", ["reach", "page reach", "facebook reach", "total reach", "การเข้าถึง"]),
  F("views", "Views", false, "int", ["views", "page views", "impressions", "facebook views", "การดู"]),
  F("engagements", "Engagements", false, "int", ["engagements", "post engagements", "interactions", "content interactions", "การมีส่วนร่วม"]),
  F("followers", "Followers", false, "int", ["followers", "page followers", "total followers", "ผู้ติดตาม"]),
  F("newFollowers", "New followers", false, "int", ["new followers", "follows", "page follows", "net follows", "ผู้ติดตามใหม่"]),
  F("linkClicks", "Link clicks", false, "int", ["link clicks", "clicks", "link_clicks", "การคลิกลิงก์"]),
];
const MESSAGE_FIELDS: FieldDef[] = [
  F("channel", "Channel (fb / ig / line / whatsapp)", false, "text", ["channel", "platform", "ช่องทาง", "แพลตฟอร์ม"]),
  F("leadId", "Lead / Conversation ID", false, "text", ["lead id", "lead_id", "conversation id", "thread id", "id"]),
  F("name", "Customer name", false, "text", ["customer name", "customer", "name", "contact", "ชื่อลูกค้า", "ชื่อ"]),
  F("direction", "Who sent (customer / staff)", true, "text", ["direction", "sender type", "from", "sender", "type", "ผู้ส่ง", "ทิศทาง"]),
  F("sentAt", "Sent at (date & time)", true, "text", ["sent at", "sent_at", "time", "timestamp", "datetime", "date time", "created time", "เวลา", "วันที่เวลา"]),
  F("text", "Message text", false, "text", ["text", "message", "content", "ข้อความ"]),
];
const COMMENT_FIELDS: FieldDef[] = [
  F("channel", "Channel (fb / ig)", false, "text", ["channel", "platform", "ช่องทาง", "แพลตฟอร์ม"]),
  F("commentId", "Comment ID", false, "text", ["comment id", "comment_id", "id"]),
  F("postId", "Post ID / link", false, "text", ["post id", "post_id", "post", "post link", "โพสต์"]),
  F("commenter", "Customer name", false, "text", ["commenter", "customer", "name", "from", "ชื่อลูกค้า", "ชื่อ"]),
  F("text", "Comment text", false, "text", ["comment", "text", "message", "content", "ความคิดเห็น", "คอมเมนต์"]),
  F("commentedAt", "Commented at (date & time)", true, "text", ["commented at", "commented_at", "created time", "created_time", "time", "timestamp", "date", "เวลาคอมเมนต์", "วันที่เวลา"]),
  F("repliedAt", "Replied at (date & time)", false, "text", ["replied at", "replied_at", "reply time", "first reply time", "response time", "เวลาตอบ", "เวลาที่เพจตอบ", "ตอบเมื่อ"]),
  F("repliedBy", "Replied by", false, "text", ["replied by", "replied_by", "responder", "ผู้ตอบ"]),
];
const SALES_FIELDS: FieldDef[] = [
  F("leadId", "Lead ID", true, "text", ["lead id", "lead_id", "id"]),
  F("repName", "Salesperson", true, "text", ["salesperson", "sales rep", "assigned to", "rep"]),
  F("firstResponseMin", "First response (minutes)", false, "number", ["first response", "first response (min)", "response minutes", "first response minutes"]),
  F("followUps", "Follow-ups", false, "int", ["follow-ups", "followups", "follow ups"]),
];

export const FIELDS: Record<ImportDataType, FieldDef[]> = {
  "Ads Performance": AD_FIELDS,
  "Campaign Performance": CAMPAIGN_FIELDS,
  "Ad-Level Performance": AD_FIELDS,
  "Lead Data": LEAD_FIELDS,
  "Inbox Conversations": INBOX_FIELDS,
  "Page Insights": INSIGHT_FIELDS,
  "Chat Messages": MESSAGE_FIELDS,
  "Post Comments": COMMENT_FIELDS,
  "Sales Performance": SALES_FIELDS,
};
export const isAdsType = (t: ImportDataType) => t === "Ads Performance" || t === "Campaign Performance" || t === "Ad-Level Performance";

/** Customer names are compared the way the Facebook sync links a chat to a lead: case and extra spaces ignored. */
export const leadNameKey = (name: string) => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F ()_]/g, "").trim(); // keep Thai letters so Thai headers can match

// Compare headers loosely: "Lead_Status", "lead-status" and "lead status" are the same.
const key = (s: string) => norm(s).replace(/[_\-\s]+/g, " ").trim();

/** Best-effort mapping of file headers to system fields. Returns field.key -> header ("" = unmapped).
 *  Pass 1: exact match on a known synonym. Pass 2: the header merely *contains* a known synonym (length >= 4),
 *  e.g. "Amount spent (THB) - total" -> spend. Pass 2 only fills fields and headers that pass 1 left unused. */
export function autoMap(headers: string[], fields: FieldDef[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  const hk = new Map(headers.map((h) => [h, key(h)]));
  for (const f of fields) {
    const syn = new Set(f.synonyms.map(key));
    const hit = headers.find((h) => !used.has(h) && syn.has(hk.get(h)!));
    out[f.key] = hit ?? "";
    if (hit) used.add(hit);
  }
  for (const f of fields) {
    if (out[f.key]) continue;
    const syn = f.synonyms.map(key).filter((x) => x.length >= 4);
    let best = ""; let bestLen = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      for (const x of syn) if (hk.get(h)!.includes(x) && x.length > bestLen) { best = h; bestLen = x.length; }
    }
    if (best) { out[f.key] = best; used.add(best); }
  }
  return out;
}

// Ads Performance shares the Ad-Level fields; prefer the specific label when both match.
const DETECT_ORDER: ImportDataType[] = ["Ad-Level Performance", "Ads Performance", "Campaign Performance", "Lead Data", "Inbox Conversations", "Page Insights", "Chat Messages", "Post Comments", "Sales Performance"];

/** Guess the file type from its headers. A type qualifies only if every required field maps; the best share of mapped fields wins
 *  (ties go to DETECT_ORDER). Returns null when nothing qualifies, so the caller can ask the person to choose. */
export function detectType(headers: string[]): { type: ImportDataType; mapping: Record<string, string> } | null {
  let best: { type: ImportDataType; mapping: Record<string, string>; score: number } | null = null;
  const hasAdSpend = !!autoMap(headers, FIELDS["Ad-Level Performance"]).spend;
  for (const type of DETECT_ORDER) {
    const fields = FIELDS[type];
    const mapping = autoMap(headers, fields);
    if (fields.some((f) => f.required && !mapping[f.key])) continue;
    const hasAdDimension = !!(mapping.adId || mapping.adName);
    const hasCampaignDimension = !!(mapping.campaignName || mapping.adSetName);
    if (type === "Page Insights" && hasAdSpend) continue;
    if (type === "Campaign Performance" && hasAdDimension) continue;
    if ((type === "Ad-Level Performance" || type === "Ads Performance") && hasCampaignDimension && !hasAdDimension) continue;
    const score = fields.filter((f) => mapping[f.key]).length / fields.length;
    if (!best || score > best.score) best = { type, mapping, score };
  }
  return best ? { type: best.type, mapping: best.mapping } : null;
}

export function parseNumber(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/[฿$,\s]/g, "");
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
/** Meta Business Suite writes the source ad into Labels, e.g. "Oct 31 ad id 120252274822160116". */
export const adIdFromLabels = (labels: string): string => (String(labels ?? "").match(/ad[\s_-]*id[\s:_-]*(\d{6,})/i) ?? [])[1] ?? "";
/** Stable id for a salesperson created from a name in a file (same name → same id on every upload). */
export const repIdFor = (name: string): string => { let h = 5381; for (const ch of name.trim().toLowerCase()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return `U-S${h.toString(36).toUpperCase()}`; };
export type DateOrder = "dmy" | "mdy";
const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s,].*)?$/;
/** 31/12/2026 vs 12/31/2026: a value whose first part is > 12 can only be D/M, whose second part is > 12 can only be M/D.
 *  Ambiguous values (e.g. 03/04/2026) follow `order`, which validate() decides for the whole file with detectDateOrder. */
export function parseDate(raw: string, order: DateOrder = "dmy"): string | null {
  const s = String(raw ?? "").trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(SLASH))) {
    const a = +mt[1], b = +mt[2]; y = +mt[3];
    const mdy = a > 12 ? false : b > 12 ? true : order === "mdy";
    if (mdy) { m = a; d = b; } else { d = a; m = b; }
  }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Look at every slash date in a file. Any "25/10/2026" proves D/M, any "10/25/2026" proves M/D. If nothing proves it,
 *  a 12-hour clock with am/pm (how Meta's US-style exports write "10/03/2026 9:09pm") means M/D, otherwise D/M (Thai/EU Ads Manager). */
export function detectDateOrder(values: string[]): DateOrder {
  let ampm = false;
  for (const v of values) {
    const mt = String(v ?? "").trim().match(SLASH); if (!mt) continue;
    if (+mt[1] > 12) return "dmy";
    if (+mt[2] > 12) return "mdy";
    if (/\d\s*[ap]m\b/i.test(v)) ampm = true;
  }
  return ampm ? "mdy" : "dmy";
}

/** "2026-11-01 14:05", "01/11/2026 14:05", "2026-11-01T14:05:00", "2:05 PM" → "YYYY-MM-DDTHH:MM:00" (local, no timezone shift). Date without time → null. */
export function parseDateTime(raw: string, order: DateOrder = "dmy"): string | null {
  const s = String(raw ?? "").trim(); const d = parseDate(s.split(/[T\s]/)[0], order); if (!d) return null;
  const m = s.match(/[T\s](\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/); if (!m) return null;
  let h = +m[1]; const mi = +m[2]; if (m[3]) { const pm = /p/i.test(m[3]); if (h < 1 || h > 12) return null; h = (h % 12) + (pm ? 12 : 0); }
  if (h > 23 || mi > 59) return null;
  return `${d}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;
}
const parseDirection = (v: string): "in" | "out" | null => {
  const t = v.trim().toLowerCase();
  if (/^(in|inbound|customer|client|user|received|ลูกค้า|รับ)$/.test(t)) return "in";
  if (/^(out|outbound|staff|page|agent|admin|sales|rep|sent|เซลล์|เพจ|แอดมิน|ส่ง|ตอบ)$/.test(t)) return "out";
  return null;
};

export interface RowIssue { row: number; message: string; level: "error" | "warning" | "duplicate" }
export interface ValidationResult {
  total: number;
  ok: number;
  failed: number;
  duplicates: number;
  warnings: number;
  issues: RowIssue[];
  perf: DailyPerf[];
  leads: Lead[];
  insights: PageInsight[];
  newReps: { id: string; name: string }[];
  messages: { id: string; leadId: string; direction: "in" | "out"; text: string; at: string }[];
  comments: PostComment[];
  replaceInsightKeys: Set<string>;
  newAdIds: { adId: string; adName: string; campaignName: string }[];
  replaceKeys: Set<string>; // existing ad|date keys that a "replace" import would overwrite
  periodStart: string | null;
  periodEnd: string | null;
  salesPatches: { leadId: string; repName: string; firstResponseMin: number | null; followUps: number | null }[];
  /** Rows that matched a lead already in the sheet (pulled from Facebook): they update that lead instead of adding a duplicate. */
  leadPatches: { leadId: string; set: Record<string, string> }[];
  merged: number;
}

export interface ValidateCtx {
  type: ImportDataType;
  mapping: Record<string, string>;
  rows: Record<string, string>[];
  mode: "incremental" | "replace";
  importId: string;
  existingPerfKeys: Set<string>;
  existingAdIds: Set<string>;
  existingLeadIds: Set<string>;
  existingInsightKeys: Set<string>;
  /** Leads already in the sheet for this page — what an upload may match and update (id, or a unique customer name). */
  existingLeads?: Lead[];
  leadIdByName?: Map<string, string | null>; // lower-case customer name → lead id on this page; null when two leads share the name
  existingMessageIds?: Set<string>;
  existingCommentIds?: Set<string>;
  pageId: string;
  /** Per-channel destination page (e.g. instagram → the "… (Instagram)" page). A missing channel stays on `pageId`. */
  channelPageIds?: Partial<Record<ChatChannel, string>>;
  /** Every lead grouped by page id: rows routed to a different page still match/link that page's own leads. */
  leadsByPage?: Map<string, Lead[]>;
  repsByName: Map<string, string>;
  /** Sales Representatives from Settings, so a name that differs slightly (คุณ / missing surname / typo) still matches. */
  reps?: { id: string; name: string }[];
  nextLeadNo: number;
}

export function validate(ctx: ValidateCtx): ValidationResult {
  const fields = FIELDS[ctx.type];
  const res: ValidationResult = { total: ctx.rows.length, ok: 0, failed: 0, duplicates: 0, warnings: 0, issues: [], perf: [], leads: [], insights: [], newReps: [], messages: [], comments: [], replaceInsightKeys: new Set(), newAdIds: [], replaceKeys: new Set(), periodStart: null, periodEnd: null, salesPatches: [], leadPatches: [], merged: 0 };
  const get = (row: Record<string, string>, key: string) => { const h = ctx.mapping[key]; return h ? String(row[h] ?? "").trim() : ""; };
  // One date order for the whole file, decided from all mapped date columns (see detectDateOrder).
  const dateKeys = fields.filter((f) => f.kind === "date" || ["sentAt", "commentedAt", "repliedAt"].includes(f.key)).map((f) => ctx.mapping[f.key]).filter(Boolean);
  const order = detectDateOrder(ctx.rows.flatMap((r) => dateKeys.map((h) => String(r[h] ?? ""))));
  const pd = (v: string) => parseDate(v, order);
  const pdt = (v: string) => parseDateTime(v, order);
  const seen = new Set<string>();
  let aggregateWarned = false;
  const newReps = new Map<string, { id: string; name: string }>(); // salespeople named in the file but not in the users tab → created on commit
  // Exact name first, then a close name from Settings ("คุณบดินทร์" / "บดินทร์" / one typo) so no duplicate rep is created.
  const findRep = (name: string) => {
    const exact = ctx.repsByName.get(name.toLowerCase());
    if (exact) return { id: exact, name, exact: true };
    const hit = ctx.reps ? matchUser(name, ctx.reps) : null;
    return hit ? { id: hit.id, name: hit.name, exact: false } : null;
  };
  const campByAd = new Map<string, string>();
  const newAds = new Map<string, { adId: string; adName: string; campaignName: string }>();
  let leadNo = ctx.nextLeadNo;
  // A row whose Channel column says Instagram may belong on the page's separate Instagram page;
  // matching then only looks at that page's chats, so an IG chat never overwrites a Facebook chat with the same name.
  const pageLeadsOf = (pid: string): Lead[] | undefined => (pid === ctx.pageId ? ctx.existingLeads : ctx.leadsByPage?.get(pid));
  const nameMapCache = new Map<string, Map<string, string | null>>();
  const namesOf = (pid: string): Map<string, string | null> | undefined => {
    if (pid === ctx.pageId) return ctx.leadIdByName;
    if (!ctx.leadsByPage) return undefined;
    let m = nameMapCache.get(pid);
    if (!m) { m = new Map(); for (const l of ctx.leadsByPage.get(pid) ?? []) { const k = leadNameKey(l.name); m.set(k, m.has(k) ? null : l.id); } nameMapCache.set(pid, m); }
    return m;
  };
  /** A chat name that exists exactly once across all pages (used by message imports, which carry no channel). */
  const anyPageLead = (name: string): string => {
    if (!ctx.leadsByPage) return "";
    const k = leadNameKey(name); if (!k) return "";
    const ids = new Set<string>();
    for (const list of ctx.leadsByPage.values()) for (const l of list) if (leadNameKey(l.name) === k) ids.add(l.id);
    return ids.size === 1 ? [...ids][0] : "";
  };

  ctx.rows.forEach((row, i) => {
    const n = i + 2; // spreadsheet row number (header = 1)
    const errs: string[] = [];
    const vals: Record<string, string> = {};
    for (const f of fields) {
      const v = get(row, f.key);
      vals[f.key] = v;
      if (!v) { if (f.required) errs.push(`Missing required field "${f.label}"`); continue; }
      if (f.kind === "date" && !pd(v)) errs.push(`Invalid date "${v}" in "${f.label}" (use YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY)`);
      if ((f.kind === "number" || f.kind === "int") && parseNumber(v) == null) errs.push(`Incorrect number format "${v}" in "${f.label}"`);
      if (f.kind === "int" && parseNumber(v) != null && !Number.isInteger(parseNumber(v))) errs.push(`"${f.label}" must be a whole number, got "${v}"`);
      if ((f.kind === "number" || f.kind === "int") && (parseNumber(v) ?? 0) < 0) errs.push(`Negative value "${v}" in "${f.label}"`);
    }
    if (isAdsType(ctx.type)) {
      const date = pd(vals.date);
      if (date && date > ANCHOR) errs.push(`Date ${date} is in the future`);
      if (!vals.adId && !vals.adName && ctx.type !== "Campaign Performance") errs.push("Need an Ad ID or an Ad name to tell the ads apart");
      const imp = parseNumber(vals.impressions), clk = parseNumber(vals.clicks);
      if (imp != null && clk != null && clk > imp) errs.push("Clicks exceed impressions");
    }
    if (errs.length) { res.failed++; res.issues.push(...errs.map((m) => ({ row: n, message: m, level: "error" as const }))); return; }

    if (isAdsType(ctx.type)) {
      const date = pd(vals.date)!;
      // Campaign-level files have no Ad ID: use a synthetic stable key per campaign
      const campaign = vals.campaignName || vals.adSetName || "ไม่ระบุแคมเปญ";
      const slug = (x: string) => x.toUpperCase().replace(/[^A-Z0-9\u0E00-\u0E7F]+/g, "-").slice(0, 40);
      // No Ad ID in the file: a stable key from the ad name (ad-level) or the campaign name (campaign-level)
      const adId = vals.adId || (vals.adName ? `AD-${slug(vals.adName)}` : `CMP-${slug(campaign)}`);
      if (vals.dateEnd && pd(vals.dateEnd) && pd(vals.dateEnd) !== date && !aggregateWarned) { aggregateWarned = true; res.warnings++; res.issues.push({ row: n, message: `This file is one total for the whole period (${date} → ${pd(vals.dateEnd)}), not one row per day. Every row will be saved on ${date}, so daily charts will be wrong. For daily data, re-export from Ads Manager with Breakdown → Time → Day.`, level: "warning" }); }
      const key = `${adId}|${date}`;
      if (seen.has(key)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate row inside the file: ${adId} on ${date}`, level: "duplicate" }); return; }
      seen.add(key);
      const exists = ctx.existingPerfKeys.has(key);
      if (exists && ctx.mode === "incremental") { res.duplicates++; res.issues.push({ row: n, message: `Already imported: ${adId} on ${date} (skipped in incremental mode)`, level: "duplicate" }); return; }
      if (exists) res.replaceKeys.add(key);
      const prev = campByAd.get(adId);
      if (prev && prev !== campaign) { res.warnings++; res.issues.push({ row: n, message: `Inconsistent campaign name for ${adId}: "${campaign}" vs "${prev}" — using "${prev}"`, level: "warning" }); }
      else if (!prev) campByAd.set(adId, campaign);
      if (!ctx.existingAdIds.has(adId) && !newAds.has(adId)) newAds.set(adId, { adId, adName: vals.adName || adId, campaignName: campByAd.get(adId)! });
      res.perf.push({ adId, date, spend: parseNumber(vals.spend)!, reach: parseNumber(vals.reach) ?? 0, impressions: parseNumber(vals.impressions)!, clicks: parseNumber(vals.clicks) ?? 0, messages: parseNumber(vals.messages) ?? 0, purchases: parseNumber(vals.purchases) ?? 0, source: "import", importId: ctx.importId });
      if (!res.periodStart || date < res.periodStart) res.periodStart = date;
      if (!res.periodEnd || date > res.periodEnd) res.periodEnd = date;
      res.ok++;
    } else if (ctx.type === "Lead Data" || ctx.type === "Inbox Conversations") {
      const id = vals.leadId || "";
      if (id && seen.has(id)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate Lead ID ${id}`, level: "duplicate" }); return; }
      const date = pd(vals.date)!;
      const st = parseStatus(vals.status);
      if (vals.status && !st) { res.issues.push({ row: n, message: `Unknown status "${vals.status}" — set to Not Responded`, level: "warning" }); res.warnings++; }
      const status: LeadStatus = st ?? "Not Responded";
      const quality: LeadQuality = (QUALITIES as readonly string[]).includes(status) ? (status as LeadQuality) : "Qualified";
      const repHit = vals.repName ? findRep(vals.repName) : null;
      let repId = repHit?.id ?? null;
      if (vals.repName && !repHit) {
        const k = vals.repName.toLowerCase(); let nr = newReps.get(k);
        if (!nr) { nr = { id: repIdFor(vals.repName), name: vals.repName }; newReps.set(k, nr); res.newReps.push(nr); res.issues.push({ row: n, message: `New salesperson "${vals.repName}" will be added (name only — add an email in Settings if they need to sign in)`, level: "warning" }); res.warnings++; }
        repId = nr.id;
      } else if (repHit && !repHit.exact) {
        res.warnings++;
        res.issues.push({ row: n, message: `Salesperson "${vals.repName}" matched to "${repHit.name}" in Settings — fix the spelling in the file if that is wrong`, level: "warning" });
      }
      // The Facebook sync already created this customer: match by Lead/Conversation ID first, then by one unique name on this page
      // (the same rule the sync uses), then by the phone/email the form file adds — so the uploaded row fills in that lead
      // instead of showing up twice on the Board. Extra spaces in the file must not rewrite an existing name that only differs in whitespace.
      const name = String(vals.name ?? "").trim().replace(/\s+/g, " ");
      const channel = parseChannel(vals.channel);
      const targetPageId = ctx.channelPageIds?.[channel] ?? ctx.pageId;
      const pageLeads = pageLeadsOf(targetPageId);
      const byNameId = name ? namesOf(targetPageId)?.get(leadNameKey(name)) ?? null : null;
      const phoneKey = (v: string) => String(v ?? "").replace(/\D/g, "").replace(/^66/, "0");
      const mail = (v: string) => String(v ?? "").trim().toLowerCase();
      const byContactId = !id && !byNameId && (vals.phone || vals.email)
        ? pageLeads?.find((l) => (!!vals.email && mail(l.email) === mail(vals.email))
          || (phoneKey(vals.phone).length >= 7 && phoneKey(l.phone) === phoneKey(vals.phone)))?.id ?? null
        : null;
      const existing = id
        ? pageLeads?.find((l) => l.id === id)
        : byNameId ? pageLeads?.find((l) => l.id === byNameId)
          : byContactId ? pageLeads?.find((l) => l.id === byContactId) : undefined;
      if (existing) {
        if (seen.has(existing.id)) { res.duplicates++; res.issues.push({ row: n, message: `Lead ${existing.id} was already updated from another row in this file`, level: "duplicate" }); return; }
        seen.add(existing.id);
        const set: Record<string, string> = {};
        // a row linked only by phone/email fills the contact details but never renames the chat's own name
        if (name && name !== existing.name && existing.id !== byContactId) set.name = name;
        if (vals.phone && vals.phone !== existing.phone) set.phone = vals.phone;
        if (vals.email && vals.email !== existing.email) set.email = vals.email;
        if (vals.phone2 && vals.phone2 !== (existing.phone2 ?? "")) set.phone2 = vals.phone2;
        if (vals.whatsapp && vals.whatsapp !== (existing.whatsapp ?? "")) set.whatsapp = vals.whatsapp;
        if (vals.leadSource && vals.leadSource !== (existing.leadSource ?? "")) set.lead_source = vals.leadSource;
        if (vals.form && vals.form !== (existing.form ?? "")) set.form = vals.form;
        if (vals.labels && vals.labels !== (existing.labels ?? "")) set.labels = vals.labels;
        const ad = vals.adId || adIdFromLabels(vals.labels);
        if (ad && ad !== (existing.adId ?? "")) set.ad_id = ad;
        if (vals.repName && (repId ?? "") !== (existing.repId ?? "")) set.assigned_to = repId ?? "";
        if (st && st !== existing.status) { set.status = st; if ((QUALITIES as readonly string[]).includes(st)) set.quality = st; }
        if (vals.channel && parseChannel(vals.channel) !== (existing.channel ?? "facebook")) set.channel = parseChannel(vals.channel);
        if (ctx.type === "Inbox Conversations" || ctx.type === "Lead Data") {
          const at = `${pd(vals.lastContactAt || "") ?? date}T09:00:00`;
          if (at > existing.lastContactAt) set.last_contact_at = at.replace("T", " ").slice(0, 16);
          if (vals.lastMessage && at >= existing.lastContactAt && vals.lastMessage !== existing.lastMessage) set.last_message = vals.lastMessage;
          if (vals.lastMessage) {
            const msgId = `MSG-${existing.id}-${at.replace(/\D/g, "")}-in`;
            if (!seen.has(msgId) && !ctx.existingMessageIds?.has(msgId)) {
              seen.add(msgId);
              res.messages.push({ id: msgId, leadId: existing.id, direction: "in", text: vals.lastMessage, at });
            }
          }
        }
        if (!Object.keys(set).length) { res.duplicates++; res.issues.push({ row: n, message: `${existing.name} (${existing.id}) already has everything this row contains`, level: "duplicate" }); return; }
        res.leadPatches.push({ leadId: existing.id, set });
        res.merged++; res.ok++;
        return;
      }
      // A Lead ID that exists on another page belongs to that page: never move or overwrite it from here.
      if (id && ctx.existingLeadIds.has(id)) {
        res.duplicates++;
        const otherPage = [...(ctx.leadsByPage ?? new Map<string, Lead[]>()).entries()].find(([pid, ls]) => pid !== targetPageId && ls.some((l) => l.id === id))?.[0] ?? "";
        res.issues.push({ row: n, level: "duplicate", message: otherPage
          ? `Lead ID ${id} already belongs to another page (${otherPage}) — an upload never moves a lead between pages`
          : `Duplicate Lead ID ${id}` });
        return;
      }
      if (id) seen.add(id);
      const leadId = id || `L-I${String(leadNo++).padStart(5, "0")}`;
      const msgAt = `${pd(vals.lastContactAt || "") ?? date}T09:00:00`;
      res.leads.push({
        id: leadId, name, phone: vals.phone, email: vals.email, pageId: targetPageId, adId: vals.adId || adIdFromLabels(vals.labels) || null, repId, status, quality, valid: true, createdAt: date,
        ...(vals.phone2 ? { phone2: vals.phone2 } : {}), ...(vals.whatsapp ? { whatsapp: vals.whatsapp } : {}), ...(vals.leadSource ? { leadSource: vals.leadSource } : {}),
        ...(vals.form ? { form: vals.form } : {}), ...(vals.labels ? { labels: vals.labels } : {}),
        lastContactAt: msgAt, lastMessage: vals.lastMessage || "(imported lead — no messages)", followUpDate: null, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null, unread: false,
        history: [{ at: `${date}T09:00:00`, from: null, to: status, by: "Import", note: "Imported from file" }], dropped: null, channel, source: "import",
      });
      if (vals.lastMessage) {
        const msgId = `MSG-${leadId}-${msgAt.replace(/\D/g, "")}-in`;
        if (!seen.has(msgId) && !ctx.existingMessageIds?.has(msgId)) {
          seen.add(msgId);
          res.messages.push({ id: msgId, leadId, direction: "in", text: vals.lastMessage, at: msgAt });
        }
      }
      res.ok++;
    } else if (ctx.type === "Chat Messages") {
      const at = pdt(vals.sentAt); const dir = parseDirection(vals.direction);
      if (!at) { res.failed++; res.issues.push({ row: n, message: `Invalid date & time "${vals.sentAt}" — the time of day is required (e.g. 2026-11-01 14:05)`, level: "error" }); return; }
      if (!dir) { res.failed++; res.issues.push({ row: n, message: `Cannot tell who sent "${vals.direction}" — use customer/staff (ลูกค้า/เพจ)`, level: "error" }); return; }
      // Find the chat by ID first, then by name on the page its Channel points to (Instagram chats live on the "… (Instagram)" page), then anywhere (a unique name).
      const msgPage = ctx.channelPageIds?.[parseChannel(vals.channel)] ?? ctx.pageId;
      const leadId = vals.leadId && ctx.existingLeadIds.has(vals.leadId)
        ? vals.leadId
        : (namesOf(msgPage)?.get(leadNameKey(vals.name)) ?? "") || anyPageLead(vals.name);
      if (!leadId) { res.failed++; res.issues.push({ row: n, message: `Chat not found for "${vals.leadId || vals.name || "—"}" — upload the Inbox conversations first, or fix the ID/name`, level: "error" }); return; }
      const id = `MSG-${leadId}-${at.replace(/\D/g, "")}-${dir}`;
      if (seen.has(id) || ctx.existingMessageIds?.has(id)) { res.duplicates++; res.issues.push({ row: n, message: `Already have this ${dir === "in" ? "customer" : "staff"} message at ${at.replace("T", " ").slice(0, 16)}`, level: "duplicate" }); return; }
      seen.add(id); res.messages.push({ id, leadId, direction: dir, text: vals.text, at });
      const d = at.slice(0, 10); if (!res.periodStart || d < res.periodStart) res.periodStart = d; if (!res.periodEnd || d > res.periodEnd) res.periodEnd = d;
      res.ok++;
    } else if (ctx.type === "Post Comments") {
      const at = pdt(vals.commentedAt); const rep = vals.repliedAt ? pdt(vals.repliedAt) : null;
      if (!at) { res.failed++; res.issues.push({ row: n, message: `Invalid date & time "${vals.commentedAt}" — the time of day is required`, level: "error" }); return; }
      if (vals.repliedAt && !rep) { res.failed++; res.issues.push({ row: n, message: `Invalid reply time "${vals.repliedAt}"`, level: "error" }); return; }
      if (rep && rep < at) { res.failed++; res.issues.push({ row: n, message: "Reply time is earlier than the comment time", level: "error" }); return; }
      const commentPageId = ctx.channelPageIds?.[parseChannel(vals.channel)] ?? ctx.pageId;
      const id = vals.commentId || `CM-${commentPageId}-${at.replace(/\D/g, "")}-${vals.commenter.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "").slice(0, 12)}`;
      if (seen.has(id) || ctx.existingCommentIds?.has(id)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate comment ${id}`, level: "duplicate" }); return; }
      seen.add(id); res.comments.push({ id, pageId: commentPageId, postId: vals.postId, commenter: vals.commenter, text: vals.text, at, repliedAt: rep, repliedBy: vals.repliedBy });
      const d = at.slice(0, 10); if (!res.periodStart || d < res.periodStart) res.periodStart = d; if (!res.periodEnd || d > res.periodEnd) res.periodEnd = d;
      res.ok++;
    } else if (ctx.type === "Page Insights") {
      const date = pd(vals.date)!;
      if (date > ANCHOR) { res.failed++; res.issues.push({ row: n, message: `Date ${date} is in the future`, level: "error" }); return; }
      const key = `${ctx.pageId}|${date}`;
      if (seen.has(key)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate date ${date} in file`, level: "duplicate" }); return; }
      seen.add(key);
      const exists = ctx.existingInsightKeys.has(key);
      if (exists && ctx.mode === "incremental") { res.duplicates++; res.issues.push({ row: n, message: `Already imported: ${date} (skipped in incremental mode)`, level: "duplicate" }); return; }
      if (exists) res.replaceInsightKeys.add(key);
      const num = (k: string) => parseNumber(vals[k]) ?? 0;
      res.insights.push({ pageId: ctx.pageId, date, reach: num("reach"), views: num("views"), engagements: num("engagements"), followers: num("followers"), newFollowers: num("newFollowers"), linkClicks: num("linkClicks") });
      if (!res.periodStart || date < res.periodStart) res.periodStart = date;
      if (!res.periodEnd || date > res.periodEnd) res.periodEnd = date;
      res.ok++;
    } else {
      const id = vals.leadId;
      if (!ctx.existingLeadIds.has(id)) { res.failed++; res.issues.push({ row: n, message: `Lead ID ${id} does not exist`, level: "error" }); return; }
      if (seen.has(id)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate Lead ID ${id} in file`, level: "duplicate" }); return; }
      seen.add(id);
      const rep = findRep(vals.repName);
      if (!rep) { res.failed++; res.issues.push({ row: n, message: `Salesperson "${vals.repName}" not found`, level: "error" }); return; }
      res.salesPatches.push({ leadId: id, repName: rep.id, firstResponseMin: parseNumber(vals.firstResponseMin), followUps: parseNumber(vals.followUps) });
      res.ok++;
    }
  });
  res.newAdIds = [...newAds.values()];
  return res;
}

export function errorsToCsv(issues: RowIssue[]): string {
  const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  return ["Row,Level,Description", ...issues.map((i) => [i.row, i.level, esc(i.message)].map((x, k) => (k === 2 ? x : String(x))).join(","))].join("\n");
}
