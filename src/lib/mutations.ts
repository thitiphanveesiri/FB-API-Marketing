// Pure: turns a client "op" into sheet writes after checking the caller's role. The server never trusts the client for
// who/when (those are filled in here) or for which columns may be written (whitelist from the sheet schema).
import type { Dataset } from "./dataset";
import type { Obj, UpsertMode } from "./sheetOps";
import { SHEET_TABS } from "./sheetSchema";
import { roleCan } from "./queries";
import { CHANNELS, DROP_REASONS, ImportDataType, QUALITIES, ROLES, STATUSES, User } from "./types";
import type { Lead } from "./types";

export interface Write { tab: string; keyCols: string[]; rows: Obj[]; mode: UpsertMode }
export class Denied extends Error { constructor(public status: number, msg: string) { super(msg); } }

const cols = (tab: string) => new Set(SHEET_TABS.find((t) => t.tab === tab)!.cols.map((c) => c.name));
const LEAD_SETTABLE = ["status", "quality", "assigned_to", "follow_up_date", "unread", "last_message", "last_contact_at", "first_response_min", "follow_ups", "avg_follow_up_hrs", "valid",
  "drop_reason", "dropped_at", "previous_status", "recovery_status", "last_activity"];
const LEAD_REP_SETTABLE = ["status", "quality", "assigned_to", "follow_up_date", "unread", "last_message", "last_contact_at", "follow_ups"];
const LEAD_IMPORT_SETTABLE = [...LEAD_SETTABLE, "name", "phone", "email", "phone2", "whatsapp", "lead_source", "form", "labels", "ad_id", "channel"];
const leadFieldsFor = (role: User["role"]) => role === "Sales Representative" ? LEAD_REP_SETTABLE : LEAD_SETTABLE;
const IMPORT_TYPES: ImportDataType[] = ["Ads Performance", "Campaign Performance", "Ad-Level Performance", "Lead Data", "Inbox Conversations", "Page Insights", "Chat Messages", "Post Comments", "Sales Performance"];
const MAX_ROWS = 20000;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function clean(tab: string, row: unknown, allowed?: string[]): Obj {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Denied(400, "Bad row");
  const ok = allowed ? new Set(allowed) : cols(tab); const out: Obj = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (!ok.has(k)) throw new Denied(400, `Column "${k}" is not allowed in ${tab}`);
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "number" && !Number.isFinite(v)) throw new Denied(400, `Column "${k}" must be a finite number`);
    else if (["string", "number", "boolean"].includes(typeof v)) out[k] = typeof v === "string" ? v.slice(0, 2000) : v as number | boolean;
    else throw new Denied(400, "Bad value");
  }
  return out;
}
const str = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) throw new Denied(400, `${name} is required`); return v.trim(); };
const text = (v: unknown) => String(v ?? "").trim();
const oneOf = (v: unknown, values: readonly string[], name: string, blank = false) => {
  const s = text(v); if (!s && blank) return ""; if (!values.includes(s)) throw new Denied(400, `Unknown ${name}`); return s;
};
const boolValue = (v: unknown, name: string, fallback = false) => {
  if (v === "" || v == null) return fallback;
  if (typeof v === "boolean") return v;
  const s = text(v).toLowerCase();
  if (["true", "1", "yes", "y", "ใช่"].includes(s)) return true;
  if (["false", "0", "no", "n", "ไม่"].includes(s)) return false;
  throw new Denied(400, `${name} must be true or false`);
};
const numberValue = (v: unknown, name: string, min = 0, integer = false, blank = false) => {
  if ((v === "" || v == null) && blank) return "";
  const n = typeof v === "number" ? v : Number(text(v));
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw new Denied(400, `${name} is invalid`);
  return n;
};
const validDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const dateValue = (v: unknown, name: string, blank = true) => {
  const s = text(v); if (!s && blank) return ""; if (!validDate(s)) throw new Denied(400, `${name} must be a valid YYYY-MM-DD date`); return s;
};
const dateTimeValue = (v: unknown, name: string, blank = true) => {
  const s = text(v); if (!s && blank) return "";
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m || !validDate(m[1]) || +m[2] > 23 || +m[3] > 59) throw new Denied(400, `${name} must be a valid date and time`);
  return s;
};
const listValue = (v: unknown, name: string, optional = false): unknown[] => {
  if (v == null && optional) return [];
  if (!Array.isArray(v) || v.length > MAX_ROWS) throw new Denied(400, `${name} must be an array of at most ${MAX_ROWS} rows`);
  return v;
};
const unique = (values: string[], name: string) => { if (new Set(values).size !== values.length) throw new Denied(400, `Duplicate ${name} in upload`); };

function normalizeLeadSet(input: unknown, allowed: string[], ds: Dataset, repIds: Set<string>, current?: Lead, me?: User): Obj {
  const out = clean("leads", input, allowed);
  if (has(out, "status")) out.status = oneOf(out.status, STATUSES, "status");
  if (has(out, "quality")) out.quality = oneOf(out.quality, QUALITIES, "quality", true);
  if (has(out, "previous_status")) out.previous_status = oneOf(out.previous_status, STATUSES, "previous status", true);
  if (has(out, "drop_reason")) out.drop_reason = oneOf(out.drop_reason, DROP_REASONS, "drop reason", true);
  if (has(out, "recovery_status")) out.recovery_status = oneOf(out.recovery_status, ["Not Started", "In Progress", "Recovered", "Lost"], "recovery status", true);
  if (has(out, "channel")) out.channel = oneOf(out.channel, CHANNELS.map((c) => c.id), "channel", true);
  if (has(out, "follow_up_date")) out.follow_up_date = dateValue(out.follow_up_date, "follow_up_date");
  if (has(out, "dropped_at")) out.dropped_at = dateValue(out.dropped_at, "dropped_at");
  if (has(out, "last_contact_at")) out.last_contact_at = dateTimeValue(out.last_contact_at, "last_contact_at");
  if (has(out, "unread")) out.unread = boolValue(out.unread, "unread");
  if (has(out, "valid")) out.valid = boolValue(out.valid, "valid", true);
  if (has(out, "first_response_min")) out.first_response_min = numberValue(out.first_response_min, "first_response_min", 0, false, true);
  if (has(out, "follow_ups")) out.follow_ups = numberValue(out.follow_ups, "follow_ups", 0, true, true);
  if (has(out, "avg_follow_up_hrs")) out.avg_follow_up_hrs = numberValue(out.avg_follow_up_hrs, "avg_follow_up_hrs", 0, false, true);
  if (has(out, "assigned_to")) {
    const id = text(out.assigned_to);
    if (id && !repIds.has(id)) throw new Denied(400, "assigned_to must be an active Sales Representative");
    out.assigned_to = id;
    if (current && me && !roleCan.reassign(me.role) && !(me.role === "Sales Representative" && id === me.id)) throw new Denied(403, "Only a Sales Manager or Administrator can reassign leads");
  }
  if (current && me && current.status === "Converted" && has(out, "status") && !roleCan.moveToConverted(me.role)) throw new Denied(403, "Only a Sales Manager or Administrator can change a Converted lead");
  if (current && me && out.status === "Converted" && !roleCan.moveToConverted(me.role)) throw new Denied(403, "Only a Sales Manager or Administrator can mark a lead Converted");
  return out;
}

export type Op =
  | { t: "lead.set"; id: string; set: Record<string, unknown>; log?: { from?: string; to?: string; text?: string } }
  | { t: "lead.note"; id: string; text: string }
  | { t: "eval.add"; row: Record<string, unknown> }
  | { t: "ad.creative"; id: string; image: string; video: string }
  | { t: "settings.upsert"; tab: string; row: Record<string, unknown> }
  | { t: "pages.merge"; from: string; to: string }
  | { t: "import.commit"; record: Record<string, unknown>; replace: boolean; perf: unknown[]; leads: unknown[]; ads: unknown[]; campaigns: unknown[]; insights: unknown[]; messages?: unknown[]; comments?: unknown[]; users?: { user_id: string; name: string }[]; patches: { lead_id: string; set: Record<string, unknown> }[] };

export function planOp(op: Op, me: User, ds: Dataset, now: string): Write[] {
  const lead = (id: string) => { const l = ds.leads.find((x) => x.id === id); if (!l) throw new Denied(404, `Lead ${id} not found`); return l; };
  const editable = (id: string) => {
    if (!roleCan.editLeads(me.role)) throw new Denied(403, "Your role cannot edit leads");
    const l = lead(id);
    if (me.role === "Sales Representative" && l.repId !== me.id) throw new Denied(403, "This lead is not assigned to you");
    return l;
  };
  const repIds = new Set(ds.users.filter((u) => u.active && u.role === "Sales Representative").map((u) => u.id));

  switch (op.t) {
    case "lead.set": {
      const l = lead(str(op.id, "id"));
      if (!roleCan.editLeads(me.role)) throw new Denied(403, "Your role cannot edit leads");
      const claiming = me.role === "Sales Representative" && l.repId == null && op.set && typeof op.set === "object" && !Array.isArray(op.set) &&
        Object.keys(op.set).length === 1 && op.set.assigned_to === me.id;
      if (!claiming && me.role === "Sales Representative" && l.repId !== me.id)
        throw new Denied(403, "This lead is not assigned to you");
      const allowed = leadFieldsFor(me.role);
      if (op.set && typeof op.set === "object" && !Array.isArray(op.set)) {
        const forbidden = Object.keys(op.set).find((field) => !allowed.includes(field));
        if (forbidden) throw new Denied(403, `Your role cannot change lead field "${forbidden}"`);
      }
      const set = normalizeLeadSet(op.set, allowed, ds, repIds, l, me);
      const writes: Write[] = [{ tab: "leads", keyCols: ["lead_id"], mode: "updateOnly", rows: [{ lead_id: l.id, ...set }] }];
      if (op.log || (has(set, "status") && set.status !== l.status)) writes.push({ tab: "lead_log", keyCols: [], mode: "upsert", rows: [{ lead_id: l.id, at: now, kind: "status", from: l.status, to: has(set, "status") ? set.status : l.status, by: me.name, text: String(op.log?.text ?? "").slice(0, 500) }] });
      return writes;
    }
    case "lead.note": {
      const l = editable(str(op.id, "id"));
      return [{ tab: "lead_log", keyCols: [], mode: "upsert", rows: [{ lead_id: l.id, at: now, kind: "note", by: me.name, text: str(op.text, "text").slice(0, 2000) }] }];
    }
    case "eval.add": {
      if (!roleCan.evaluate(me.role)) throw new Denied(403, "Your role cannot review quality");
      const row = clean("evaluations", op.row), l = lead(str(row.lead_id, "lead_id"));
      const quality = oneOf(row.quality, QUALITIES, "quality");
      const score = (name: string) => { const n = Number(numberValue(row[name], name, 1, true)); if (n > 5) throw new Denied(400, `${name} must be between 1 and 5`); return n; };
      const rank = (q: string) => (QUALITIES as readonly string[]).indexOf(q);
      if (rank(quality) < rank(l.quality) && !text(row.reason)) throw new Denied(400, "A reason is required when lowering quality");
      return [{ tab: "evaluations", keyCols: ["eval_id"], mode: "insert", rows: [{
        eval_id: str(row.eval_id, "eval_id"), lead_id: l.id, quality, previous_quality: l.quality,
        responsiveness: score("responsiveness"), need_identified: score("need_identified"), intent: score("intent"), contact_captured: score("contact_captured"),
        notes: String(row.notes ?? "").slice(0, 2000), reason: String(row.reason ?? "").slice(0, 2000), reviewer_id: me.id, at: now,
      }] }];
    }
    case "ad.creative": {
      if (!roleCan.upload(me.role)) throw new Denied(403, "Your role cannot change ad creatives");
      const ad = ds.ads.find((a) => a.id === str(op.id, "id")); if (!ad) throw new Denied(404, "Ad not found");
      const url = (v: unknown, what: string) => { const s = String(v ?? "").trim(); if (s && (!/^https:\/\//i.test(s) || s.length > 800)) throw new Denied(400, `${what} must be a full https:// link`); return s; };
      // Clearing creative_ref is what makes a pasted link stick: with no ref there is nothing left to auto-refresh, and the ad
      // sync keeps this link (knownCreativeUrls in lib/adsSync.ts) instead of writing Meta's expiring one back over it.
      return [{ tab: "ads", keyCols: ["ad_id"], mode: "updateOnly", rows: [{ ad_id: ad.id, creative_url: url(op.image, "Image link"), video_url: url(op.video, "Video link"), creative_ref: "" }] }];
    }
    case "settings.upsert": {
      if (!roleCan.manageSettings(me.role)) throw new Denied(403, "Only an Administrator can change settings");
      const keys: Record<string, string> = { users: "user_id", pages: "page_id", agencies: "agency_id", campaigns: "campaign_id" };
      if (!has(keys, op.tab)) throw new Denied(400, "Tab not editable");
      const key = keys[op.tab], row = clean(op.tab, op.row), id = str(row[key], key);
      const agencyIds = new Set(ds.agencies.filter((a) => a.active).map((a) => a.id));
      const checkAgency = (v: unknown, name: string) => { const agency = text(v); if (agency && !agencyIds.has(agency)) throw new Denied(400, `${name} was not found`); return agency; };
      if (op.tab === "users") {
        const old = ds.users.find((u) => u.id === id);
        const name = has(row, "name") ? str(row.name, "name") : old?.name;
        const role = has(row, "role") ? oneOf(row.role, ROLES, "role") : old?.role;
        const agencyId = has(row, "agency_id") ? checkAgency(row.agency_id, "agency_id") : old?.agencyId ?? "";
        if (!name || !role) throw new Denied(400, "name and role are required");
        if (role === "Agency" && !agencyId) throw new Denied(400, "Agency users need an agency_id");
        if (has(row, "active")) row.active = boolValue(row.active, "active", true);
        const active = has(row, "active") ? row.active === true : old?.active ?? true;
        const oldEmail = old?.email.trim().toLowerCase() ?? "";
        const email = has(row, "email") ? text(row.email).toLowerCase() : oldEmail;
        if (oldEmail && email !== oldEmail) throw new Denied(400, "An existing sign-in email cannot be changed here; create a new user for a different sign-in identity and disable the old account");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Denied(400, "email must be a valid email address");
        if (role !== "Sales Representative" && !email) throw new Denied(400, "This role needs an email address");
        if (email && ds.users.some((u) => u.id !== id && u.email.trim().toLowerCase() === email)) throw new Denied(400, "Email already in use");
        if (old?.active && old.role === "Administrator" && !(active && role === "Administrator") &&
          !ds.users.some((u) => u.id !== id && u.active && u.role === "Administrator"))
          throw new Denied(400, "At least one active Administrator is required");
        if (has(row, "email")) row.email = email;
        row.agency_id = agencyId;
      } else if (op.tab === "pages") {
        const old = ds.pages.find((p) => p.id === id);
        const name = has(row, "name") ? str(row.name, "name") : old?.name;
        if (!name) throw new Denied(400, "name is required");
        if (has(row, "agency_id")) row.agency_id = checkAgency(row.agency_id, "agency_id");
        if (has(row, "active")) row.active = boolValue(row.active, "active", true);
        if (has(row, "sales_team")) {
          const team = text(row.sales_team).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
          if (team.some((uid) => !repIds.has(uid))) throw new Denied(400, "sales_team must contain active Sales Representatives");
          row.sales_team = [...new Set(team)].join(",");
        }
      } else if (op.tab === "agencies") {
        const old = ds.agencies.find((a) => a.id === id);
        const name = has(row, "name") ? str(row.name, "name") : old?.name;
        if (!name) throw new Denied(400, "name is required");
        if (has(row, "active")) row.active = boolValue(row.active, "active", true);
      } else {
        const old = ds.campaigns.find((c) => c.id === id);
        const name = has(row, "name") ? str(row.name, "name") : old?.name;
        const pageId = has(row, "page_id") ? str(row.page_id, "page_id") : old?.pageId;
        if (!name || !pageId || !ds.pages.some((p) => p.id === pageId)) throw new Denied(400, "A campaign needs a name and an existing page_id");
        if (has(row, "agency_id")) row.agency_id = checkAgency(row.agency_id, "agency_id");
      }
      return [{ tab: op.tab, keyCols: [key], mode: "upsert", rows: [row] }];
    }
    case "pages.merge": {
      // Data that points at a page row the pages tab no longer has (typically after a page id was retyped) is moved onto
      // a page that exists, so the chats and campaigns show up again instead of being skipped by the sheet mapper.
      if (!roleCan.manageSettings(me.role)) throw new Denied(403, "Only an Administrator can move data between pages");
      const from = str(op.from, "from"), to = str(op.to, "to");
      if (from === to) throw new Denied(400, "Choose two different pages");
      if (!ds.pages.some((p) => p.id === to)) throw new Denied(404, "The target page was not found");
      const writes: Write[] = [];
      const leads = ds.leads.filter((l) => l.pageId === from).map((l) => ({ lead_id: l.id, page_id: to }));
      if (leads.length) writes.push({ tab: "leads", keyCols: ["lead_id"], rows: leads, mode: "updateOnly" });
      const camps = ds.campaigns.filter((c) => c.pageId === from).map((c) => ({ campaign_id: c.id, page_id: to }));
      if (camps.length) writes.push({ tab: "campaigns", keyCols: ["campaign_id"], rows: camps, mode: "updateOnly" });
      const ads = ds.ads.filter((a) => a.pageId === from).map((a) => ({ ad_id: a.id, page_id: to }));
      if (ads.length) writes.push({ tab: "ads", keyCols: ["ad_id"], rows: ads, mode: "updateOnly" });
      const comments = ds.comments.filter((c) => c.pageId === from).map((c) => ({ comment_id: c.id, page_id: to }));
      if (comments.length) writes.push({ tab: "post_comments", keyCols: ["comment_id"], rows: comments, mode: "updateOnly" });
      const posts = ds.posts.filter((x) => x.pageId === from).map((x) => ({ post_id: x.id, page_id: to }));
      if (posts.length) writes.push({ tab: "posts", keyCols: ["post_id"], rows: posts, mode: "updateOnly" });
      // insert (not upsert) keeps the target page's own figures when both pages have a row for the same day
      const insights = ds.insights.filter((x) => x.pageId === from).map((x) => ({ page_id: to, date: x.date, reach: x.reach, views: x.views, engagements: x.engagements, followers: x.followers, new_followers: x.newFollowers, link_clicks: x.linkClicks }));
      if (insights.length) writes.push({ tab: "page_insights", keyCols: ["page_id", "date"], rows: insights, mode: "insert" });
      if (!writes.length) throw new Denied(400, "No rows use that page");
      return writes;
    }
    case "import.commit": {
      if (!roleCan.upload(me.role)) throw new Denied(403, "Your role cannot upload data");
      if (typeof op.replace !== "boolean") throw new Denied(400, "replace must be true or false");
      const perf = listValue(op.perf, "perf"), leads = listValue(op.leads, "leads"), ads = listValue(op.ads, "ads"), campaigns = listValue(op.campaigns, "campaigns");
      const insights = listValue(op.insights, "insights"), messages = listValue(op.messages, "messages", true), comments = listValue(op.comments, "comments", true);
      const users = listValue(op.users, "users", true), patches = listValue(op.patches, "patches", true);
      if (users.length > 200) throw new Denied(400, "Too many users (max 200 per upload)");
      const record = clean("import_log", op.record), dataType = oneOf(record.data_type, IMPORT_TYPES, "import type");
      if (me.role !== "Administrator") {
        if (op.replace || leads.length || messages.length || users.length || patches.length) throw new Denied(403, "Marketing Managers can upload marketing data only");
        if (!["Ads Performance", "Campaign Performance", "Ad-Level Performance", "Page Insights", "Post Comments"].includes(dataType)) throw new Denied(403, "This import type requires an Administrator");
      }
      record.import_id = str(record.import_id, "import_id");
      record.data_type = dataType;
      record.mode = oneOf(record.mode, ["incremental", "replace"], "import mode");
      if (text(record.page_id) && !ds.pages.some((p) => p.id === text(record.page_id))) throw new Denied(400, "page_id was not found");
      for (const name of ["total", "imported", "failed", "duplicates"] as const) record[name] = numberValue(record[name], name, 0, true);
      const m = (tab: string, rows: unknown[]) => rows.map((r) => clean(tab, r));
      const checkBatch = (tab: string, rows: Obj[], keys: string[], required: string[] = keys) => {
        for (const row of rows) for (const name of required) if (!text(row[name])) throw new Denied(400, `${tab}.${name} is required`);
        unique(rows.map((row) => keys.map((k) => text(row[k])).join("\u0001")), `${tab} key`);
      };
      const userRows: Obj[] = users.map((u) => {
        if (!u || typeof u !== "object" || Array.isArray(u)) throw new Denied(400, "Bad user");
        const row = u as Record<string, unknown>;
        return { user_id: str(row.user_id, "user_id"), name: str(row.name, "name").slice(0, 120), email: "", role: "Sales Representative", agency_id: "", active: true };
      });
      checkBatch("users", userRows, ["user_id"]);
      if (userRows.some((u) => ds.users.some((x) => x.id === text(u.user_id)))) throw new Denied(400, "An imported user_id already exists");
      const allRepIds = new Set([...repIds, ...userRows.map((u) => text(u.user_id))]);
      const campaignRows = m("campaigns", campaigns); checkBatch("campaigns", campaignRows, ["campaign_id"], ["campaign_id", "name", "page_id"]);
      const pageIds = new Set(ds.pages.map((p) => p.id));
      for (const row of campaignRows) {
        if (!pageIds.has(text(row.page_id))) throw new Denied(400, "Campaign page_id was not found");
        if (text(row.agency_id) && !ds.agencies.some((a) => a.id === text(row.agency_id))) throw new Denied(400, "Campaign agency_id was not found");
      }
      const campaignIds = new Set([...ds.campaigns.map((c) => c.id), ...campaignRows.map((r) => text(r.campaign_id))]);
      const adRows = m("ads", ads); checkBatch("ads", adRows, ["ad_id"], ["ad_id", "name", "campaign_id"]);
      for (const row of adRows) {
        if (!campaignIds.has(text(row.campaign_id))) throw new Denied(400, "Ad campaign_id was not found");
        if (text(row.page_id) && !pageIds.has(text(row.page_id))) throw new Denied(400, "Ad page_id was not found");
        if (has(row, "status")) row.status = oneOf(row.status, ["Active", "Paused", "Learning", "Ended"], "ad status");
        if (has(row, "creative_type")) row.creative_type = oneOf(row.creative_type, ["Image", "Video", "Carousel"], "creative type");
        if (has(row, "updated_at")) row.updated_at = dateValue(row.updated_at, "updated_at");
      }
      const adIds = new Set([...ds.ads.map((a) => a.id), ...adRows.map((r) => text(r.ad_id))]);
      const perfRows = m("ad_performance", perf); checkBatch("ad_performance", perfRows, ["ad_id", "date"], ["ad_id", "date", "spend", "impressions"]);
      for (const row of perfRows) {
        row.date = dateValue(row.date, "date", false);
        if (!adIds.has(text(row.ad_id))) throw new Denied(400, "Performance ad_id was not found");
        for (const name of ["spend", "reach", "impressions", "clicks", "clicks_all", "messages", "purchases"]) if (has(row, name)) row[name] = numberValue(row[name], name, 0, false, true);
      }
      const leadRows = leads.map((r) => normalizeLeadSet(r, [...cols("leads")], ds, allRepIds));
      checkBatch("leads", leadRows, ["lead_id"], ["lead_id", "name", "page_id", "status", "created_at"]);
      const leadIds = new Set([...ds.leads.map((l) => l.id), ...leadRows.map((r) => text(r.lead_id))]);
      for (const row of leadRows) {
        row.created_at = dateValue(row.created_at, "created_at", false);
        if (!pageIds.has(text(row.page_id))) throw new Denied(400, "Lead page_id was not found");
        if (text(row.ad_id) && !adIds.has(text(row.ad_id))) throw new Denied(400, "Lead ad_id was not found");
      }
      const insightRows = m("page_insights", insights); checkBatch("page_insights", insightRows, ["page_id", "date"]);
      for (const row of insightRows) {
        row.date = dateValue(row.date, "date", false);
        if (!pageIds.has(text(row.page_id))) throw new Denied(400, "Insight page_id was not found");
        for (const name of ["reach", "views", "engagements", "followers", "new_followers", "link_clicks"]) if (has(row, name)) row[name] = numberValue(row[name], name, 0, false, true);
      }
      const messageRows = m("messages", messages); checkBatch("messages", messageRows, ["message_id"], ["message_id", "lead_id", "direction", "sent_at"]);
      for (const row of messageRows) {
        if (!leadIds.has(text(row.lead_id))) throw new Denied(400, "Message lead_id was not found");
        row.direction = oneOf(row.direction, ["in", "out", "note"], "message direction");
        row.sent_at = dateTimeValue(row.sent_at, "sent_at", false);
      }
      const commentRows = m("post_comments", comments); checkBatch("post_comments", commentRows, ["comment_id"], ["comment_id", "page_id", "commented_at"]);
      for (const row of commentRows) {
        if (!pageIds.has(text(row.page_id))) throw new Denied(400, "Comment page_id was not found");
        row.commented_at = dateTimeValue(row.commented_at, "commented_at", false);
        if (has(row, "replied_at")) row.replied_at = dateTimeValue(row.replied_at, "replied_at");
      }
      const patchRows: Obj[] = patches.map((p) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) throw new Denied(400, "Bad lead patch");
        const patch = p as { lead_id?: unknown; set?: unknown }, l = lead(str(patch.lead_id, "lead_id"));
        return { lead_id: l.id, ...normalizeLeadSet(patch.set, LEAD_IMPORT_SETTABLE, ds, allRepIds) };
      });
      checkBatch("lead patches", patchRows, ["lead_id"]);
      for (const row of patchRows) if (text(row.ad_id) && !adIds.has(text(row.ad_id))) throw new Denied(400, "Lead patch ad_id was not found");
      const w: Write[] = [];
      if (userRows.length) w.push({ tab: "users", keyCols: ["user_id"], mode: "insert", rows: userRows });
      if (campaignRows.length) w.push({ tab: "campaigns", keyCols: ["campaign_id"], mode: "insert", rows: campaignRows });
      if (adRows.length) w.push({ tab: "ads", keyCols: ["ad_id"], mode: "insert", rows: adRows });
      if (perfRows.length) w.push({ tab: "ad_performance", keyCols: ["ad_id", "date"], mode: op.replace ? "upsert" : "insert", rows: perfRows });
      if (leadRows.length) w.push({ tab: "leads", keyCols: ["lead_id"], mode: "insert", rows: leadRows });
      if (insightRows.length) w.push({ tab: "page_insights", keyCols: ["page_id", "date"], mode: op.replace ? "upsert" : "insert", rows: insightRows });
      if (messageRows.length) w.push({ tab: "messages", keyCols: ["message_id"], mode: "insert", rows: messageRows });
      if (commentRows.length) w.push({ tab: "post_comments", keyCols: ["comment_id"], mode: "insert", rows: commentRows });
      if (patchRows.length) w.push({ tab: "leads", keyCols: ["lead_id"], mode: "updateOnly", rows: patchRows });
      w.push({ tab: "import_log", keyCols: ["import_id"], mode: "insert", rows: [{ ...record, by: me.name, at: now }] });
      return w;
    }
    default: throw new Denied(400, "Unknown operation");
  }
}
