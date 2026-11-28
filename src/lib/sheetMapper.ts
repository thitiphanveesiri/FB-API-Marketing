// Pure: Google Sheet tabs (arrays of cell strings) -> Dataset. No network, no React.
import type { Dataset } from "./dataset";
import { isAutoReply, parseAutoRules } from "./autoReply";
import { parseDate, parseNumber } from "./importer";
import { SHEET_TABS } from "./sheetSchema";
import {
  Ad, AdStatus, Agency, Campaign, DailyPerf, DROP_REASONS, Evaluation, ImportRecord, PageInsight, PagePost, PostComment, parseStatus, LeadNote, StatusChange, ImportDataType, DropReason, FbPage, Lead, LeadQuality, LeadStatus, Message, QUALITIES, RecoveryStatus, ROLES, Role, User, parseChannel } from "./types";

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
const httpsUrl = (v: string): string | undefined => (/^https:\/\//i.test(v.trim()) ? v.trim() : undefined);
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
  // Rows that point at a page the pages tab no longer has (a page row deleted or its id retyped). They used to be dropped,
  // which silently emptied the Inbox while the sheet still held the chats. They are kept under a placeholder page instead,
  // and one warning says what to do: rename that page in Settings → Pages and save, which adds the missing row to the sheet.
  type OrphanKind = "leads" | "campaigns" | "ads" | "comments" | "insights";
  const orphans = new Map<string, Record<OrphanKind, number>>();
  const orphan = (pid: string, kind: OrphanKind) => {
    const o = orphans.get(pid) ?? { leads: 0, campaigns: 0, ads: 0, comments: 0, insights: 0 };
    o[kind]++; orphans.set(pid, o);
  };

  // campaigns
  const campaigns: Campaign[] = [];
  for (const r of tab("campaigns").rows) {
    const id = r.get("campaign_id"), name = r.get("name"), pageId = r.get("page_id");
    if (!id || !name) { warn("campaigns", r.n, "campaign_id and name are required — row skipped"); continue; }
    if (!pageId) { warn("campaigns", r.n, "page_id is required — row skipped"); continue; }
    if (!pageIds.has(pageId)) orphan(pageId, "campaigns");
    if (campaigns.some((c) => c.id === id)) { warn("campaigns", r.n, `Duplicate campaign_id ${id} — skipped`); continue; }
    const ag = r.get("agency_id") || pages.find((p) => p.id === pageId)?.agencyId || "";
    campaigns.push({ id, name, pageId, agencyId: ag, objective: r.get("objective") });
  }
  const campIds = new Set(campaigns.map((c) => c.id));

  // ads
  const ads: Ad[] = [];
  // Same policy as the orphan pages above: a missing campaign row used to drop the ad *and every performance row it owned*, which
  // is where "some of my data disappears" came from (an ad sync that ran out of time writes ads and campaigns in separate calls,
  // so the campaigns half can be missing while the ads half landed). Keep the ad under a clearly-named placeholder instead.
  const missingCamps = new Map<string, Campaign>();
  for (const r of tab("ads").rows) {
    const id = r.get("ad_id"), name = r.get("name"), cid = r.get("campaign_id");
    if (!id) { warn("ads", r.n, "ad_id is required — row skipped"); continue; }
    if (idHint(id)) warn("ads", r.n, `ad_id "${id}"${idHint(id)}`);
    const ckey = cid || "(ไม่มี campaign_id)";
    if (!campIds.has(ckey) && !missingCamps.has(ckey)) {
      const adPage = r.get("page_id");
      missingCamps.set(ckey, { id: ckey, name: `${ckey} (ไม่พบในแท็บ Campaigns)`, pageId: adPage || (pages.length === 1 ? pages[0].id : ""),
        agencyId: pages.find((p) => p.id === adPage)?.agencyId ?? "", objective: "" });
      warn("campaigns", 1, `campaign_id "${ckey}" is used by ads but is missing from the campaigns tab — the ads are shown under "${ckey} (ไม่พบในแท็บ Campaigns)". Run the Ads sync (or add the campaign row) to restore the real campaign name and page.`);
    }
    if (ads.some((a) => a.id === id)) { warn("ads", r.n, `Duplicate ad_id ${id} — skipped`); continue; }
    const st = pick<AdStatus>(["Active", "Paused", "Learning", "Ended"], r.get("status"));
    if (r.get("status") && !st) warn("ads", r.n, `Unknown status "${r.get("status")}" — set to Active`);
    const ct = pick(["Image", "Video", "Carousel"] as const, r.get("creative_type")) ?? "Image";
    const adPage = r.get("page_id");
    if (adPage && !pageIds.has(adPage)) orphan(adPage, "ads");
    const ref = r.get("creative_ref");
    ads.push({ id, name: name || id, campaignId: ckey, ...(adPage ? { pageId: adPage } : {}), status: st ?? "Active", creative: { type: ct, hue: hue(id), url: httpsUrl(r.get("creative_url")), video: httpsUrl(r.get("video_url")), ...(ref ? { ref } : {}) }, ...(r.get("caption") ? { caption: r.get("caption") } : {}), ...(r.get("headline") ? { headline: r.get("headline") } : {}), updatedAt: dateOnly(r.get("updated_at")) ?? "" });
  }
  const adIds = new Set(ads.map((a) => a.id));

  // performance
  const perf: DailyPerf[] = []; const seen = new Set<string>();
  // A performance row whose ad row is gone (a deleted ad, or an ad sync that stopped halfway) used to be dropped with it, which
  // made the dashboard's totals lower than Ads Manager. The money is real, so the row is kept under a clearly-named placeholder ad.
  let orphanPerf = 0;
  const ORPHAN_CAMP = "(no ad row)";
  for (const r of tab("ad_performance").rows) {
    const date = dateOnly(r.get("date")), adId = r.get("ad_id");
    if (!date) { warn("ad_performance", r.n, `Invalid or missing date "${r.get("date")}" — row skipped`); continue; }
    if (!adIds.has(adId)) {
      if (idHint(adId) || orphanPerf >= 500) { warn("ad_performance", r.n, `ad_id "${adId}" not found in ads — row skipped${idHint(adId)}`); continue; }
      if (!missingCamps.has(ORPHAN_CAMP)) {
        missingCamps.set(ORPHAN_CAMP, { id: ORPHAN_CAMP, name: "(ไม่พบในแท็บ Ads) โฆษณาที่ถูกลบหรือยังไม่ได้ดึง", pageId: "", agencyId: "", objective: "" });
        warn("ads", 1, `มีแถวสถิติของโฆษณาที่ไม่อยู่ในแท็บ ads — ตัวเลขยังนับรวมใน Dashboard ใต้“(ไม่พบในแท็บ Ads) โฆษณาที่ถูกลบหรือยังไม่ได้ดึง” กดดึงข้อมูลโฆษณาเพื่อเรียกชื่อและรูปของโฆษณากลับมา`);
      }
      orphanPerf++;
      ads.push({ id: adId, name: `${adId} (ไม่พบในแท็บ Ads)`, campaignId: ORPHAN_CAMP, status: "Ended", creative: { type: "Image", hue: hue(adId) }, updatedAt: "" });
      adIds.add(adId);
    }
    const spend = parseNumber(r.get("spend")), imp = parseNumber(r.get("impressions"));
    if (spend == null || imp == null) { warn("ad_performance", r.n, "spend and impressions must be numbers — row skipped"); continue; }
    const k = `${adId}|${date}`; if (seen.has(k)) { warn("ad_performance", r.n, `Duplicate ${adId} on ${date} — skipped (no double counting)`); continue; } seen.add(k);
    const n = (c: string) => parseNumber(r.get(c)) ?? 0;
    const clicksAll = parseNumber(r.get("clicks_all"));
    perf.push({ adId, date, spend, reach: n("reach"), impressions: imp, clicks: n("clicks"), ...(clicksAll != null ? { clicksAll } : {}), messages: n("messages"), purchases: n("purchases"), source: "import" });
  }
  for (const c of missingCamps.values()) if (!campaigns.some((x) => x.id === c.id)) campaigns.push(c);

  // leads
  const leads: Lead[] = []; const leadIds = new Set<string>();
  for (const r of tab("leads").rows) {
    const id = r.get("lead_id"), name = r.get("name"), pageId = r.get("page_id");
    if (!id || !name) { warn("leads", r.n, "lead_id and name are required — row skipped"); continue; }
    if (leadIds.has(id)) { warn("leads", r.n, `Duplicate lead_id ${id} — skipped`); continue; }
    if (!pageId) { warn("leads", r.n, "page_id is required — row skipped"); continue; }
    if (!pageIds.has(pageId)) orphan(pageId, "leads");
    const created = dateOnly(r.get("created_at")); if (!created) { warn("leads", r.n, `Invalid created_at "${r.get("created_at")}" — row skipped`); continue; }
    const status = parseStatus(r.get("status"));
    if (!status) warn("leads", r.n, `Unknown status "${r.get("status")}" — set to Not Responded`);
    const st: LeadStatus = status ?? "Not Responded";
    const q = pick<LeadQuality>(QUALITIES, r.get("quality")) ?? (parseStatus(r.get("quality")) as LeadQuality | undefined) ?? ((QUALITIES as readonly string[]).includes(st) ? (st as LeadQuality) : "Qualified");
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
      dropped: reason ? { reason, at: dateOnly(r.get("dropped_at")) ?? last.slice(0, 10), previousStatus: parseStatus(r.get("previous_status")) ?? st,
        recovery: (pick<RecoveryStatus>(["Not Started", "In Progress", "Recovered", "Lost"], r.get("recovery_status")) ?? "Not Started"), lastActivity: r.get("last_activity") } : null,
      source: "import", channel: parseChannel(r.get("channel")), fbUserId: r.get("fb_user_id") || undefined,
      ...(r.get("phone2") ? { phone2: r.get("phone2") } : {}), ...(r.get("whatsapp") ? { whatsapp: r.get("whatsapp") } : {}),
      ...(r.get("lead_source") ? { leadSource: r.get("lead_source") } : {}), ...(r.get("form") ? { form: r.get("form") } : {}),
      ...(r.get("labels") ? { labels: r.get("labels") } : {}),
    });
    if (rep && !userIds.has(rep)) { users.push({ id: rep, name: rep, email: "", role: "Sales Representative", active: true, hue: hue(rep) }); userIds.add(rep); }
  }

  // automatic-reply rules (tab auto_replies) — used below to tell the page's automatic messages from typed ones
  const auto = parseAutoRules(tab("auto_replies").rows);
  for (const w of auto.warnings) warn("auto_replies", w.row, w.message);

  // messages
  const messages: Record<string, Message[]> = {}; let mn = 0;
  for (const l of leads) messages[l.id] = [];
  for (const r of tab("messages").rows) {
    const lid = r.get("lead_id"); const dir = pick(["in", "out", "note"] as const, r.get("direction")); const at = dateTime(r.get("sent_at"));
    if (!leadIds.has(lid)) { warn("messages", r.n, `lead_id "${lid}" not found — row skipped`); continue; }
    if (!dir || !at) { warn("messages", r.n, "direction (in/out/note) and a valid sent_at are required — row skipped"); continue; }
    const att = r.get("attachment_name");
    const sentBy = dir === "out" ? r.get("sent_by") || undefined : undefined;
    // An explicit sender_type wins, except "unknown" (what the webhook writes for echoes) which only means "not decided yet".
    const explicit = pick(["customer", "human", "automated", "unknown"] as const, r.get("sender_type"));
    const senderApp = dir === "out" ? r.get("sender_app") || undefined : undefined;
    const senderType = explicit && explicit !== "unknown" ? explicit
      : dir === "in" ? "customer"
      : dir === "out" ? (sentBy ? "human" : isAutoReply({ text: r.get("text"), senderApp }, auto.rules) ? "automated" : "unknown")
      : "unknown";
    messages[lid].push({ id: r.get("message_id") || `${lid}-M${++mn}`, leadId: lid, direction: dir, senderType, senderApp, text: r.get("text"), at, attachment: att ? { name: att, kind: /\.(png|jpe?g|gif|webp)$/i.test(att) ? "image" : "file" } : undefined, simulated: false, sentBy });
  }
  for (const k of Object.keys(messages)) {
    messages[k].sort((a, b) => a.at.localeCompare(b.at));
    // The same message can arrive twice: from Meta (its own id) and from a CSV ("MSG-…" id). Keep the Meta one.
    const kept = new Map<string, Message>();
    for (const m of messages[k]) {
      const key = m.direction === "note" ? m.id : `${m.direction}|${m.at.slice(0, 16)}|${m.text.trim().slice(0, 40)}`;
      const old = kept.get(key);
      if (!old || (old.id.startsWith("MSG-") && !m.id.startsWith("MSG-"))) kept.set(key, m);
    }
    messages[k] = [...kept.values()];
  }

  // history + notes written by the app
  const byLead = new Map(leads.map((l) => [l.id, l]));
  const logged = new Set<string>();
  for (const r of tab("lead_log").rows) {
    const l = byLead.get(r.get("lead_id")); const at = dateTime(r.get("at"));
    if (!l || !at) { warn("lead_log", r.n, "Unknown lead_id or invalid time — row skipped"); continue; }
    if (!logged.has(l.id)) { l.history = []; logged.add(l.id); }
    if (r.get("kind").toLowerCase() === "note") l.notes.push({ at, by: r.get("by"), text: r.get("text") } as LeadNote);
    else l.history.push({ at, from: parseStatus(r.get("from")) ?? null, to: parseStatus(r.get("to")) ?? l.status, by: r.get("by"), note: r.get("text") || undefined } as StatusChange);
  }
  const evaluations: Evaluation[] = [];
  for (const r of tab("evaluations").rows) {
    const q = pick<LeadQuality>(QUALITIES, r.get("quality")); const lid = r.get("lead_id"); const at = dateTime(r.get("at"));
    if (!q || !leadIds.has(lid) || !at) { warn("evaluations", r.n, "Unknown lead_id, quality or time — row skipped"); continue; }
    const sc = (c: string) => parseNumber(r.get(c)) ?? 0;
    evaluations.push({ id: r.get("eval_id") || `EV-${evaluations.length + 1}`, leadId: lid, reviewerId: r.get("reviewer_id"), at, quality: q, previousQuality: pick<LeadQuality>(QUALITIES, r.get("previous_quality")) ?? q,
      scores: { responsiveness: sc("responsiveness"), needIdentified: sc("need_identified"), intent: sc("intent"), contactCaptured: sc("contact_captured") }, notes: r.get("notes"), reason: r.get("reason") || undefined });
  }
  evaluations.sort((a, b) => b.at.localeCompare(a.at));
  const insights: PageInsight[] = []; const seenIns = new Set<string>();
  for (const r of tab("page_insights").rows) {
    const pid = r.get("page_id"), date = dateOnly(r.get("date"));
    if (!pid || !date) { warn("page_insights", r.n, "Unknown page_id or invalid date — row skipped"); continue; }
    if (!pageIds.has(pid)) orphan(pid, "insights");
    const k = `${pid}|${date}`; if (seenIns.has(k)) { warn("page_insights", r.n, `Duplicate ${pid} on ${date} — skipped`); continue; } seenIns.add(k);
    const n = (c: string) => parseNumber(r.get(c)) ?? 0;
    insights.push({ pageId: pid, date, reach: n("reach"), views: n("views"), engagements: n("engagements"), followers: n("followers"), newFollowers: n("new_followers"), linkClicks: n("link_clicks") });
  }
  insights.sort((a, b) => a.date.localeCompare(b.date));
  const comments: PostComment[] = []; const seenCm = new Set<string>();
  for (const r of tab("post_comments").rows) {
    const pid = r.get("page_id"), at = dateTime(r.get("commented_at")), id = r.get("comment_id");
    if (!id || !pid || !at) { warn("post_comments", r.n, "comment_id, page_id and a valid commented_at are required — row skipped"); continue; }
    if (!pageIds.has(pid)) orphan(pid, "comments");
    if (seenCm.has(id)) { warn("post_comments", r.n, `Duplicate comment_id ${id} — skipped`); continue; } seenCm.add(id);
    const rep = r.get("replied_at") ? dateTime(r.get("replied_at")) : null;
    comments.push({ id, pageId: pid, postId: r.get("post_id"), commenter: r.get("commenter"), text: r.get("text"), at, repliedAt: rep, repliedBy: r.get("replied_by") });
  }
  comments.sort((a, b) => a.at.localeCompare(b.at));
  const posts: PagePost[] = []; const seenPost = new Set<string>();
  for (const r of tab("posts").rows) {
    const id = r.get("post_id"), pid = r.get("page_id");
    if (!id || !pid) { warn("posts", r.n, "post_id and page_id are required — row skipped"); continue; }
    if (seenPost.has(id)) { warn("posts", r.n, `Duplicate post_id ${id} — skipped`); continue; } seenPost.add(id);
    posts.push({ id, pageId: pid, channel: parseChannel(r.get("channel")) === "instagram" ? "instagram" : "facebook", text: r.get("text"), at: dateTime(r.get("posted_at")) ?? "", ...(r.get("graph_id") ? { graphId: r.get("graph_id") } : {}) });
  }
  // Give every orphaned page id a placeholder page so its rows are usable (and visible) instead of silently dropped.
  for (const [id, o] of orphans) {
    if (pageIds.has(id)) continue;
    pages.push({ id, name: `${id} (ไม่พบในแท็บ Pages)`, active: true, agencyId: null, teamIds: [] });
    pageIds.add(id);
    const what = [o.leads ? `${o.leads} leads` : "", o.campaigns ? `${o.campaigns} campaigns` : "", o.ads ? `${o.ads} ads` : "", o.comments ? `${o.comments} comments` : "", o.insights ? `${o.insights} insights` : ""].filter(Boolean).join(", ");
    warn("pages", 1, `page_id "${id}" is used by ${what} but is not in the pages tab — they are shown under "${id} (ไม่พบในแท็บ Pages)". Open Settings → Pages, rename that page to its real name and save: the row is then added to the sheet and the data is stored normally.`);
  }
  const imports: ImportRecord[] = [];
  for (const r of tab("import_log").rows) {
    imports.push({ id: r.get("import_id"), at: r.get("at"), pageId: r.get("page_id"), dataType: (r.get("data_type") || "Ads Performance") as ImportDataType, fileName: r.get("file_name"), mode: r.get("mode") === "replace" ? "replace" : "incremental",
      total: parseNumber(r.get("total")) ?? 0, imported: parseNumber(r.get("imported")) ?? 0, failed: parseNumber(r.get("failed")) ?? 0, duplicates: parseNumber(r.get("duplicates")) ?? 0, errors: [], by: r.get("by"), rows: [], mapping: {} });
  }
  imports.reverse();

  // make sure someone can sign in
  if (!users.some((u) => u.role === "Administrator")) users.unshift({ id: "U-SHEET-ADMIN", name: "Admin (no users tab)", email: "", role: "Administrator", active: true, hue: 160 });

  return {
    dataset: { users, pages, agencies, campaigns, ads, perf, leads, messages, evaluations, imports, insights, comments, posts },
    warnings, missingTabs,
    counts: { pages: pages.length, agencies: agencies.length, users: users.length, campaigns: campaigns.length, ads: ads.length, ad_performance: perf.length, leads: leads.length, messages: Object.values(messages).reduce((s, m) => s + m.length, 0), page_insights: insights.length, post_comments: comments.length, lead_log: logged.size },
  };
}
