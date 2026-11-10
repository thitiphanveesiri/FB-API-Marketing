// Pure import logic: column auto-mapping, row validation, dedupe. No React, no store.
import { ImportDataType, DailyPerf, Lead, LeadStatus, QUALITIES, LeadQuality, PageInsight, PostComment, parseStatus } from "./types";
import { ANCHOR } from "./dates";

export interface FieldDef { key: string; label: string; required: boolean; kind: "text" | "date" | "number" | "int"; synonyms: string[] }

const F = (key: string, label: string, required: boolean, kind: FieldDef["kind"], synonyms: string[]): FieldDef => ({ key, label, required, kind, synonyms });

const AD_FIELDS: FieldDef[] = [
  F("date", "Date", true, "date", ["day", "date", "reporting starts", "reporting_starts", "start date"]),
  F("campaignName", "Campaign name", true, "text", ["campaign name", "campaign"]),
  F("adId", "Ad ID", true, "text", ["ad id", "ad_id", "adid"]),
  F("adName", "Ad name", false, "text", ["ad name", "ad"]),
  F("spend", "Amount spent", true, "number", ["amount spent", "amount spent (thb)", "spend", "cost", "amount spent (usd)"]),
  F("reach", "Reach", false, "int", ["reach"]),
  F("impressions", "Impressions", true, "int", ["impressions"]),
  F("clicks", "Clicks", false, "int", ["clicks", "link clicks", "clicks (all)"]),
  F("messages", "Messaging conversations started", false, "int", ["messaging conversations started", "messages", "results", "new messaging contacts"]),
  F("purchases", "Purchases", false, "int", ["purchases", "website purchases", "purchase"]),
];
const CAMPAIGN_FIELDS = AD_FIELDS.map((f) => (f.key === "adId" ? { ...f, required: false } : f));

const LEAD_FIELDS: FieldDef[] = [
  F("leadId", "Lead ID", false, "text", ["lead id", "lead_id", "id"]),
  F("name", "Customer name", true, "text", ["name", "customer name", "customer", "full name", "full_name", "ชื่อ", "ชื่อลูกค้า"]),
  F("adId", "Source Ad ID", false, "text", ["ad id", "source ad", "source ad id", "ad_id", "adid"]),
  F("date", "Created date", true, "date", ["date", "created", "created date", "created at", "created_time", "created time", "วันที่"]),
  F("status", "Lead status", false, "text", ["status", "lead status", "stage", "lead_status", "สถานะ"]),
  F("phone", "Phone", false, "text", ["phone", "mobile", "tel", "phone_number", "phone number", "เบอร์", "เบอร์โทร"]),
  F("repName", "Salesperson", false, "text", ["salesperson", "sales rep", "assigned to", "rep"]),
];
const INBOX_FIELDS: FieldDef[] = [
  F("name", "Customer name", true, "text", ["name", "customer name", "customer", "full name", "contact", "contact name", "sender", "ชื่อ", "ชื่อลูกค้า"]),
  F("date", "First contact date", true, "date", ["date", "created", "created date", "first contact", "first message", "first message date", "started", "conversation started", "วันที่"]),
  F("leadId", "Conversation / Lead ID", false, "text", ["lead id", "lead_id", "id", "conversation id", "thread id"]),
  F("lastMessage", "Last message", false, "text", ["last message", "latest message", "message", "ข้อความล่าสุด"]),
  F("lastContactAt", "Last message date", false, "date", ["last message date", "last message time", "last contact", "last activity", "updated", "updated time", "วันที่ล่าสุด"]),
  F("adId", "Source Ad ID", false, "text", ["ad id", "ad_id", "source ad", "source ad id", "referral ad id"]),
  F("phone", "Phone", false, "text", ["phone", "mobile", "tel", "phone number", "เบอร์", "เบอร์โทร"]),
  F("status", "Chat type / status", false, "text", ["status", "stage", "label", "labels", "chat type", "สถานะ", "ประเภท"]),
  F("repName", "Salesperson", false, "text", ["salesperson", "sales rep", "assigned to", "rep", "assignee"]),
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
  F("leadId", "Lead / Conversation ID", false, "text", ["lead id", "lead_id", "conversation id", "thread id", "id"]),
  F("name", "Customer name", false, "text", ["customer name", "customer", "name", "contact", "ชื่อลูกค้า", "ชื่อ"]),
  F("direction", "Who sent (customer / staff)", true, "text", ["direction", "sender type", "from", "sender", "type", "ผู้ส่ง", "ทิศทาง"]),
  F("sentAt", "Sent at (date & time)", true, "text", ["sent at", "sent_at", "time", "timestamp", "datetime", "date time", "created time", "เวลา", "วันที่เวลา"]),
  F("text", "Message text", false, "text", ["text", "message", "content", "ข้อความ"]),
];
const COMMENT_FIELDS: FieldDef[] = [
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F ()_]/g, "").trim(); // keep Thai letters so Thai headers can match

/** Best-effort mapping of file headers to system fields. Returns field.key -> header ("" = unmapped). */
export function autoMap(headers: string[], fields: FieldDef[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const f of fields) {
    const hit = headers.find((h) => !used.has(h) && f.synonyms.includes(norm(h)));
    out[f.key] = hit ?? "";
    if (hit) used.add(hit);
  }
  return out;
}

export function parseNumber(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/[฿$,\s]/g, "");
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
export function parseDate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; } // D/M/YYYY (Ads Manager TH/EU locale)
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso;
}

/** "2026-11-01 14:05", "01/11/2026 14:05", "2026-11-01T14:05:00", "2:05 PM" → "YYYY-MM-DDTHH:MM:00" (local, no timezone shift). Date without time → null. */
export function parseDateTime(raw: string): string | null {
  const s = String(raw ?? "").trim(); const d = parseDate(s.split(/[T\s]/)[0]); if (!d) return null;
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
  messages: { id: string; leadId: string; direction: "in" | "out"; text: string; at: string }[];
  comments: PostComment[];
  replaceInsightKeys: Set<string>;
  newAdIds: { adId: string; adName: string; campaignName: string }[];
  replaceKeys: Set<string>; // existing ad|date keys that a "replace" import would overwrite
  periodStart: string | null;
  periodEnd: string | null;
  salesPatches: { leadId: string; repName: string; firstResponseMin: number | null; followUps: number | null }[];
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
  leadIdByName?: Map<string, string>; // lower-case customer name → lead id (this page)
  existingMessageIds?: Set<string>;
  existingCommentIds?: Set<string>;
  pageId: string;
  repsByName: Map<string, string>;
  nextLeadNo: number;
}

export function validate(ctx: ValidateCtx): ValidationResult {
  const fields = FIELDS[ctx.type];
  const res: ValidationResult = { total: ctx.rows.length, ok: 0, failed: 0, duplicates: 0, warnings: 0, issues: [], perf: [], leads: [], insights: [], messages: [], comments: [], replaceInsightKeys: new Set(), newAdIds: [], replaceKeys: new Set(), periodStart: null, periodEnd: null, salesPatches: [] };
  const get = (row: Record<string, string>, key: string) => { const h = ctx.mapping[key]; return h ? String(row[h] ?? "").trim() : ""; };
  const seen = new Set<string>();
  const campByAd = new Map<string, string>();
  const newAds = new Map<string, { adId: string; adName: string; campaignName: string }>();
  let leadNo = ctx.nextLeadNo;

  ctx.rows.forEach((row, i) => {
    const n = i + 2; // spreadsheet row number (header = 1)
    const errs: string[] = [];
    const vals: Record<string, string> = {};
    for (const f of fields) {
      const v = get(row, f.key);
      vals[f.key] = v;
      if (!v) { if (f.required) errs.push(`Missing required field "${f.label}"`); continue; }
      if (f.kind === "date" && !parseDate(v)) errs.push(`Invalid date "${v}" in "${f.label}" (use YYYY-MM-DD or DD/MM/YYYY)`);
      if ((f.kind === "number" || f.kind === "int") && parseNumber(v) == null) errs.push(`Incorrect number format "${v}" in "${f.label}"`);
      if (f.kind === "int" && parseNumber(v) != null && !Number.isInteger(parseNumber(v))) errs.push(`"${f.label}" must be a whole number, got "${v}"`);
      if ((f.kind === "number" || f.kind === "int") && (parseNumber(v) ?? 0) < 0) errs.push(`Negative value "${v}" in "${f.label}"`);
    }
    if (isAdsType(ctx.type)) {
      const date = parseDate(vals.date);
      if (date && date > ANCHOR) errs.push(`Date ${date} is in the future`);
      if (!vals.adId && ctx.type !== "Campaign Performance" && !errs.some((e) => e.includes("Ad ID"))) errs.push("Missing Ad ID");
      const imp = parseNumber(vals.impressions), clk = parseNumber(vals.clicks);
      if (imp != null && clk != null && clk > imp) errs.push("Clicks exceed impressions");
    }
    if (errs.length) { res.failed++; res.issues.push(...errs.map((m) => ({ row: n, message: m, level: "error" as const }))); return; }

    if (isAdsType(ctx.type)) {
      const date = parseDate(vals.date)!;
      // Campaign-level files have no Ad ID: use a synthetic stable key per campaign
      const adId = vals.adId || `CMP-${vals.campaignName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 24)}`;
      const key = `${adId}|${date}`;
      if (seen.has(key)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate row inside the file: ${adId} on ${date}`, level: "duplicate" }); return; }
      seen.add(key);
      const exists = ctx.existingPerfKeys.has(key);
      if (exists && ctx.mode === "incremental") { res.duplicates++; res.issues.push({ row: n, message: `Already imported: ${adId} on ${date} (skipped in incremental mode)`, level: "duplicate" }); return; }
      if (exists) res.replaceKeys.add(key);
      const prev = campByAd.get(adId);
      if (prev && prev !== vals.campaignName) { res.warnings++; res.issues.push({ row: n, message: `Inconsistent campaign name for ${adId}: "${vals.campaignName}" vs "${prev}" — using "${prev}"`, level: "warning" }); }
      else if (!prev) campByAd.set(adId, vals.campaignName);
      if (!ctx.existingAdIds.has(adId) && !newAds.has(adId)) newAds.set(adId, { adId, adName: vals.adName || adId, campaignName: campByAd.get(adId)! });
      res.perf.push({ adId, date, spend: parseNumber(vals.spend)!, reach: parseNumber(vals.reach) ?? 0, impressions: parseNumber(vals.impressions)!, clicks: parseNumber(vals.clicks) ?? 0, messages: parseNumber(vals.messages) ?? 0, purchases: parseNumber(vals.purchases) ?? 0, source: "import", importId: ctx.importId });
      if (!res.periodStart || date < res.periodStart) res.periodStart = date;
      if (!res.periodEnd || date > res.periodEnd) res.periodEnd = date;
      res.ok++;
    } else if (ctx.type === "Lead Data" || ctx.type === "Inbox Conversations") {
      const id = vals.leadId || "";
      if (id && (ctx.existingLeadIds.has(id) || seen.has(id))) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate Lead ID ${id}`, level: "duplicate" }); return; }
      if (id) seen.add(id);
      const date = parseDate(vals.date)!;
      const st = parseStatus(vals.status);
      if (vals.status && !st) { res.issues.push({ row: n, message: `Unknown status "${vals.status}" — set to Not Responded`, level: "warning" }); res.warnings++; }
      const status: LeadStatus = st ?? "Not Responded";
      const quality: LeadQuality = (QUALITIES as readonly string[]).includes(status) ? (status as LeadQuality) : "Qualified";
      const repId = vals.repName ? ctx.repsByName.get(vals.repName.toLowerCase()) ?? null : null;
      if (vals.repName && !repId) { res.issues.push({ row: n, message: `Salesperson "${vals.repName}" not found — left unassigned`, level: "warning" }); res.warnings++; }
      const leadId = id || `L-I${String(leadNo++).padStart(5, "0")}`;
      res.leads.push({
        id: leadId, name: vals.name, phone: vals.phone, email: "", pageId: ctx.pageId, adId: vals.adId || null, repId, status, quality, valid: true, createdAt: date,
        lastContactAt: `${parseDate(vals.lastContactAt || "") ?? date}T09:00:00`, lastMessage: vals.lastMessage || "(imported lead — no messages)", followUpDate: null, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null, unread: false,
        history: [{ at: `${date}T09:00:00`, from: null, to: status, by: "Import", note: "Imported from file" }], dropped: null, source: "import",
      });
      res.ok++;
    } else if (ctx.type === "Chat Messages") {
      const at = parseDateTime(vals.sentAt); const dir = parseDirection(vals.direction);
      if (!at) { res.failed++; res.issues.push({ row: n, message: `Invalid date & time "${vals.sentAt}" — the time of day is required (e.g. 2026-11-01 14:05)`, level: "error" }); return; }
      if (!dir) { res.failed++; res.issues.push({ row: n, message: `Cannot tell who sent "${vals.direction}" — use customer/staff (ลูกค้า/เพจ)`, level: "error" }); return; }
      const leadId = vals.leadId && ctx.existingLeadIds.has(vals.leadId) ? vals.leadId : ctx.leadIdByName?.get(vals.name.toLowerCase()) ?? "";
      if (!leadId) { res.failed++; res.issues.push({ row: n, message: `Chat not found for "${vals.leadId || vals.name || "—"}" — upload the Inbox conversations first, or fix the ID/name`, level: "error" }); return; }
      const id = `MSG-${leadId}-${at.replace(/\D/g, "")}-${dir}`;
      if (seen.has(id) || ctx.existingMessageIds?.has(id)) { res.duplicates++; res.issues.push({ row: n, message: `Already have this ${dir === "in" ? "customer" : "staff"} message at ${at.replace("T", " ").slice(0, 16)}`, level: "duplicate" }); return; }
      seen.add(id); res.messages.push({ id, leadId, direction: dir, text: vals.text, at });
      const d = at.slice(0, 10); if (!res.periodStart || d < res.periodStart) res.periodStart = d; if (!res.periodEnd || d > res.periodEnd) res.periodEnd = d;
      res.ok++;
    } else if (ctx.type === "Post Comments") {
      const at = parseDateTime(vals.commentedAt); const rep = vals.repliedAt ? parseDateTime(vals.repliedAt) : null;
      if (!at) { res.failed++; res.issues.push({ row: n, message: `Invalid date & time "${vals.commentedAt}" — the time of day is required`, level: "error" }); return; }
      if (vals.repliedAt && !rep) { res.failed++; res.issues.push({ row: n, message: `Invalid reply time "${vals.repliedAt}"`, level: "error" }); return; }
      if (rep && rep < at) { res.failed++; res.issues.push({ row: n, message: "Reply time is earlier than the comment time", level: "error" }); return; }
      const id = vals.commentId || `CM-${ctx.pageId}-${at.replace(/\D/g, "")}-${vals.commenter.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "").slice(0, 12)}`;
      if (seen.has(id) || ctx.existingCommentIds?.has(id)) { res.duplicates++; res.issues.push({ row: n, message: `Duplicate comment ${id}`, level: "duplicate" }); return; }
      seen.add(id); res.comments.push({ id, pageId: ctx.pageId, postId: vals.postId, commenter: vals.commenter, text: vals.text, at, repliedAt: rep, repliedBy: vals.repliedBy });
      const d = at.slice(0, 10); if (!res.periodStart || d < res.periodStart) res.periodStart = d; if (!res.periodEnd || d > res.periodEnd) res.periodEnd = d;
      res.ok++;
    } else if (ctx.type === "Page Insights") {
      const date = parseDate(vals.date)!;
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
      const rep = ctx.repsByName.get(vals.repName.toLowerCase());
      if (!rep) { res.failed++; res.issues.push({ row: n, message: `Salesperson "${vals.repName}" not found`, level: "error" }); return; }
      res.salesPatches.push({ leadId: id, repName: rep, firstResponseMin: parseNumber(vals.firstResponseMin), followUps: parseNumber(vals.followUps) });
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
