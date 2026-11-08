// Pure: Google Sheet tabs (arrays of cell strings) -> Dataset. No network, no React.
import { Dataset } from "./seed";
import { parseDate, parseNumber } from "./importer";
import { SHEET_TABS } from "./sheetSchema";
import {
  Ad, AdStatus, Agency, Campaign, DailyPerf, DROP_REASONS, DropReason, FbPage, Lead, LeadQuality, LeadStatus, Message, QUALITIES, RecoveryStatus, ROLES, Role, STATUSES, User,
} from "./types";

export type RawTabs = Record<string, string[][]>;
export interface SheetWarning { tab: string; row: number; message: string }
export interface MapResult { dataset: Dataset; warnings: SheetWarning[]; counts: Record<string, number>; missingTabs: string[] }

const key = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const bool = (v: string, dflt: boolean) => { const t = v.trim().toLowerCase(); if (!t) return dflt; if (["true", "yes", "y", "1", "ใช่"].includes(t)) return true; if (["false", "no", "n", "0", "ไม่"].includes(t)) return false; return dflt; };
const pick = <T extends string>(list: readonly T[], v: string): T | undefined => list.find((x) => x.toLowerCase() === v.trim().toLowerCase());
// Google Sheets returns dates as serial numbers (days since 1899-12-30) when read unformatted — unambiguous across locales.
const SERIAL = /^\d{5}(\.\d+)?$/;
function serialParts(t: string): { date: string; hh: number; mm: number } | null {
  if (!SERIAL.test(t)) return null;
  const n = Number(t); if (n < 20000 || n > 80000) return null;
  const ms = Math.round(n * 86400000); const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return { date: d.toISOString().slice(0, 10), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const dateOnly = (v: string) => { const t = v.trim(); if (!t) return null; const sp = serialParts(t); return sp ? sp.date : parseDate(t); };
/** Large IDs typed as numbers in Sheets get rounded (e.g. 1.2021E+17). Detect that so the user can fix the column. */
const idHint = (v: string) => (/^\d(\.\d+)?e\+?\d+$/i.test(v.trim()) ? " — it looks like a rounded number; format the ID columns as Plain text (Format → Number → Plain text) and paste again" : "");
function dateTime(v: string): string | null {
  const t = v.trim(); if (!t) return null;
  const sp = serialParts(t);
  if (sp) return `${sp.date}T${String(sp.hh).padStart(2, "0")}:${String(sp.mm).padStart(2, "0")}:00`;
  const d = parseDate(t); if (!d) return null;
  const m = t.match(/[T ](\d{1,2}):(\d{2})/);
  return `${d}T${m ? `${m[1].padStart(2, "0")}:${m[2]}` : "09:00"}:00`;
}

interface Table { rows: { n: number; get: (c: string) => string }[]; headers: Set<string> }
function table(raw: string[][] | undefined): Table {
  if (!raw || raw.length === 0) return { rows: [], headers: new Set() };
  const headers = raw[0].map(key);
  const idx = new Map<string, number>(); headers.forEach((h, i) => { if (h && !idx.has(h)) idx.set(h, i); });
  const rows = raw.slice(1).map((r, i) => ({ r, n: i + 2 })).filter(({ r }) => r.some((c) => String(c ?? "").trim() !== ""))
    .map(({ r, n }) => ({ n, get: (c: string) => { const i = idx.get(c); return i == null ? "" : String(r[i] ?? "").trim(); } }));
  return { rows, headers: new Set(headers) };
}

export function mapSheets(tabs: RawTabs): MapResult {
  const warnings: SheetWarning[] = [];
  const warn = (tab: string, row: number, message: string) => { if (warnings.length < 500) warnings.push({ tab, row, message }); };
  const T = Object.fromEntries(Object.keys(tabs).map((k) => [key(k), table(tabs[k])])) as Record<string, Table>;
  const missingTabs = SHEET_TABS.filter((t) => t.required && !(t.tab in T)).map((t) => t.tab);
  const tab = (n: string): Table => T[n] ?? { rows: [], headers: new Set() };

  // header check: required columns present?
  for (const spec of SHEET_TABS) {
    if (!(spec.tab in T)) continue;
    const missing = spec.cols.filter((c) => c.required && !T[spec.tab].headers.has(c.name)).map((c) => c.name);
    if (missing.length) warn(spec.tab, 1, `Missing required column(s): ${missing.join(", ")}`);
  }

  // agencies
  const agencies: Agency[] = [];
  for (const r of tab("agencies").rows) { const id = r.get("agency_id"), name = r.get("name"); if (!id || !name) { warn("agencies", r.n, "agency_id and name are required — row skipped"); continue; }
    agencies.push({ id, name, contact: r.get("contact"), email: r.get("email"), active: bool(r.get("active"), true) }); }
  const agencyIds = new Set(agencies.map((a) => a.id));

  // users
  const users: User[] = [];
  for (const r of tab("users").rows) {
    const id = r.get("user_id"), name = r.get("name"); const role = pick<Role>(ROLES, r.get("role"));
    if (!id || !name) { warn("users", r.n, "user_id and name are required — row skipped"); continue; }
    if (!role) { warn("users", r.n, `Unknown role "${r.get("role")}" — set to Viewer`); }
    const agencyId = r.get("agency_id") || undefined;
    if ((role ?? "Viewer") === "Agency" && !(agencyId && agencyIds.has(agencyId))) warn("users", r.n, "Agency users need a valid agency_id");
    users.push({ id, name, email: r.get("email"), role: role ?? "Viewer", active: bool(r.get("active"), true), agencyId, hue: hue(id) });
  }
  const userIds = new Set(users.map((u) => u.id));

  // pages
  const pages: FbPage[] = [];
  for (const r of tab("pages").rows) {
    const id = r.get("page_id"), name = r.get("name"); if (!id || !name) { warn("pages", r.n, "page_id and name are required — row skipped"); continue; }
    if (pages.some((p) => p.id === id)) { warn("pages", r.n, `Duplicate page_id ${id} — skipped`); continue; }
    const ag = r.get("agency_id"); if (ag && !agencyIds.has(ag)) warn("pages", r.n, `agency_id ${ag} not found in agencies`);
    pages.push({ id, name, active: bool(r.get("active"), true), agencyId: ag || null, teamIds: r.get("sales_team").split(/[,;]/).map((x) => x.trim()).filter(Boolean) });
  }
  const pageIds = new Set(pages.map((p) => p.id));

  // campaigns
  const campaigns: Campaign[] = [];
  for (const r of tab("campaigns").rows) {
    const id = r.get("campaign_id"), name = r.get("name"), pageId = r.get("page_id");
    if (!id || !name) { warn("campaigns", r.n, "campaign_id and name are required — row skipped"); continue; }
    if (!pageIds.has(pageId)) { warn("campaigns", r.n, `page_id "${pageId}" not found in pages — row skipped`); continue; }
    if (campaigns.some((c) => c.id === id)) { warn("campaigns", r.n, `Duplicate campaign_id ${id} — skipped`); continue; }
    const ag = r.get("agency_id") || pages.find((p) => p.id === pageId)?.agencyId || "";
    campaigns.push({ id, name, pageId, agencyId: ag, objective: r.get("objective") });
  }
  const campIds = new Set(campaigns.map((c) => c.id));

  // ads
  const ads: Ad[] = [];
  for (const r of tab("ads").rows) {
    const id = r.get("ad_id"), name = r.get("name"), cid = r.get("campaign_id");
    if (!id) { warn("ads", r.n, "ad_id is required — row skipped"); continue; }
    if (idHint(id)) warn("ads", r.n, `ad_id "${id}"${idHint(id)}`);
    if (!campIds.has(cid)) { warn("ads", r.n, `campaign_id "${cid}" not found — row skipped`); continue; }
    if (ads.some((a) => a.id === id)) { warn("ads", r.n, `Duplicate ad_id ${id} — skipped`); continue; }
    const st = pick<AdStatus>(["Active", "Paused", "Learning", "Ended"], r.get("status"));
    if (r.get("status") && !st) warn("ads", r.n, `Unknown status "${r.get("status")}" — set to Active`);
    const ct = pick(["Image", "Video", "Carousel"] as const, r.get("creative_type")) ?? "Image";
    ads.push({ id, name: name || id, campaignId: cid, status: st ?? "Active", creative: { type: ct, hue: hue(id) }, updatedAt: dateOnly(r.get("updated_at")) ?? "" });
  }
  const adIds = new Set(ads.map((a) => a.id));

  // performance
  const perf: DailyPerf[] = []; const seen = new Set<string>();
  for (const r of tab("ad_performance").rows) {
    const date = dateOnly(r.get("date")), adId = r.get("ad_id");
    if (!date) { warn("ad_performance", r.n, `Invalid or missing date "${r.get("date")}" — row skipped`); continue; }
    if (!adIds.has(adId)) { warn("ad_performance", r.n, `ad_id "${adId}" not found in ads — row skipped${idHint(adId)}`); continue; }
    const spend = parseNumber(r.get("spend")), imp = parseNumber(r.get("impressions"));
    if (spend == null || imp == null) { warn("ad_performance", r.n, "spend and impressions must be numbers — row skipped"); continue; }
    const k = `${adId}|${date}`; if (seen.has(k)) { warn("ad_performance", r.n, `Duplicate ${adId} on ${date} — skipped (no double counting)`); continue; } seen.add(k);
    const n = (c: string) => parseNumber(r.get(c)) ?? 0;
    perf.push({ adId, date, spend, reach: n("reach"), impressions: imp, clicks: n("clicks"), messages: n("messages"), purchases: n("purchases"), source: "import" });
  }

  // leads
  const leads: Lead[] = []; const leadIds = new Set<string>();
  for (const r of tab("leads").rows) {
    const id = r.get("lead_id"), name = r.get("name"), pageId = r.get("page_id");
    if (!id || !name) { warn("leads", r.n, "lead_id and name are required — row skipped"); continue; }
    if (leadIds.has(id)) { warn("leads", r.n, `Duplicate lead_id ${id} — skipped`); continue; }
    if (!pageIds.has(pageId)) { warn("leads", r.n, `page_id "${pageId}" not found — row skipped`); continue; }
    const created = dateOnly(r.get("created_at")); if (!created) { warn("leads", r.n, `Invalid created_at "${r.get("created_at")}" — row skipped`); continue; }
    const status = pick<LeadStatus>(STATUSES, r.get("status"));
    if (!status) warn("leads", r.n, `Unknown status "${r.get("status")}" — set to Not Responded`);
    const st: LeadStatus = status ?? "Not Responded";
    const q = pick<LeadQuality>(QUALITIES, r.get("quality")) ?? ((QUALITIES as readonly string[]).includes(st) ? (st as LeadQuality) : "Qualified");
    let adId: string | null = r.get("ad_id") || null; if (adId && !adIds.has(adId)) { warn("leads", r.n, `ad_id "${adId}" not found — lead kept without source ad${idHint(adId)}`); adId = null; }
    const rep: string | null = r.get("assigned_to") || null; if (rep && !userIds.has(rep)) { warn("leads", r.n, `assigned_to "${rep}" not in users — treated as a salesperson id`); }
    const reason = pick<DropReason>(DROP_REASONS, r.get("drop_reason"));
    if (r.get("drop_reason") && !reason) warn("leads", r.n, `Unknown drop_reason "${r.get("drop_reason")}" — lead not marked dropped`);
    const last = dateTime(r.get("last_contact_at")) ?? `${created}T09:00:00`;
    const num = (c: string) => { const v = r.get(c); return v === "" ? null : parseNumber(v); };
    leadIds.add(id);
    leads.push({
      id, name, phone: r.get("phone"), email: r.get("email"), pageId, adId, repId: rep, status: st, quality: q, valid: bool(r.get("valid"), true), createdAt: created,
      lastContactAt: last, lastMessage: r.get("last_message"), followUpDate: dateOnly(r.get("follow_up_date")), notes: [],
      firstResponseMin: num("first_response_min"), followUps: num("follow_ups") ?? 0, avgFollowUpHrs: num("avg_follow_up_hrs"), unread: bool(r.get("unread"), false),
      history: [{ at: `${created}T09:00:00`, from: null, to: st, by: "Google Sheet", note: "Loaded from sheet" }],
      dropped: reason ? { reason, at: dateOnly(r.get("dropped_at")) ?? last.slice(0, 10), previousStatus: pick<LeadStatus>(STATUSES, r.get("previous_status")) ?? st,
        recovery: (pick<RecoveryStatus>(["Not Started", "In Progress", "Recovered", "Lost"], r.get("recovery_status")) ?? "Not Started"), lastActivity: r.get("last_activity") } : null,
      source: "import",
    });
    if (rep && !userIds.has(rep)) { users.push({ id: rep, name: rep, email: "", role: "Sales Representative", active: true, hue: hue(rep) }); userIds.add(rep); }
  }

  // messages
  const messages: Record<string, Message[]> = {}; let mn = 0;
  for (const l of leads) messages[l.id] = [];
  for (const r of tab("messages").rows) {
    const lid = r.get("lead_id"); const dir = pick(["in", "out", "note"] as const, r.get("direction")); const at = dateTime(r.get("sent_at"));
    if (!leadIds.has(lid)) { warn("messages", r.n, `lead_id "${lid}" not found — row skipped`); continue; }
    if (!dir || !at) { warn("messages", r.n, "direction (in/out/note) and a valid sent_at are required — row skipped"); continue; }
    const att = r.get("attachment_name");
    messages[lid].push({ id: r.get("message_id") || `${lid}-M${++mn}`, leadId: lid, direction: dir, text: r.get("text"), at, attachment: att ? { name: att, kind: /\.(png|jpe?g|gif|webp)$/i.test(att) ? "image" : "file" } : undefined, simulated: false });
  }
  for (const k of Object.keys(messages)) messages[k].sort((a, b) => a.at.localeCompare(b.at));

  // make sure someone can sign in
  if (!users.some((u) => u.role === "Administrator")) users.unshift({ id: "U-SHEET-ADMIN", name: "Admin (no users tab)", email: "", role: "Administrator", active: true, hue: 160 });

  return {
    dataset: { users, pages, agencies, campaigns, ads, perf, leads, messages, evaluations: [], imports: [] },
    warnings, missingTabs,
    counts: { pages: pages.length, agencies: agencies.length, users: users.length, campaigns: campaigns.length, ads: ads.length, ad_performance: perf.length, leads: leads.length, messages: Object.values(messages).reduce((s, m) => s + m.length, 0) },
  };
}
