// Pure: turns a client "op" into sheet writes after checking the caller's role. The server never trusts the client for
// who/when (those are filled in here) or for which columns may be written (whitelist from the sheet schema).
import type { Dataset } from "./dataset";
import type { Obj, UpsertMode } from "./sheetOps";
import { SHEET_TABS } from "./sheetSchema";
import { roleCan } from "./queries";
import { QUALITIES, STATUSES, User } from "./types";

export interface Write { tab: string; keyCols: string[]; rows: Obj[]; mode: UpsertMode }
export class Denied extends Error { constructor(public status: number, msg: string) { super(msg); } }

const cols = (tab: string) => new Set(SHEET_TABS.find((t) => t.tab === tab)!.cols.map((c) => c.name));
const LEAD_SETTABLE = ["status", "quality", "assigned_to", "follow_up_date", "unread", "last_message", "last_contact_at", "first_response_min", "follow_ups", "avg_follow_up_hrs", "valid",
  "drop_reason", "dropped_at", "previous_status", "recovery_status", "last_activity"];
const MAX_ROWS = 20000;

function clean(tab: string, row: unknown, allowed?: string[]): Obj {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Denied(400, "Bad row");
  const ok = allowed ? new Set(allowed) : cols(tab); const out: Obj = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (!ok.has(k)) throw new Denied(400, `Column "${k}" is not allowed in ${tab}`);
    if (v === null || v === undefined) out[k] = ""; else if (["string", "number", "boolean"].includes(typeof v)) out[k] = typeof v === "string" ? v.slice(0, 2000) : (v as number | boolean); else throw new Denied(400, "Bad value");
  }
  return out;
}
const str = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) throw new Denied(400, `${name} is required`); return v.trim(); };

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
  const checkSet = (set: Record<string, unknown>) => {
    if ("assigned_to" in set && !roleCan.reassign(me.role)) {
      // a rep may only keep it assigned to themselves
      if (!(me.role === "Sales Representative" && set.assigned_to === me.id)) throw new Denied(403, "Only a Sales Manager or Administrator can reassign leads");
    }
    if (set.status === "Converted" && !roleCan.moveToConverted(me.role)) throw new Denied(403, "Only a Sales Manager or Administrator can mark a lead Converted");
    if (set.status != null && set.status !== "" && !(STATUSES as readonly string[]).includes(String(set.status))) throw new Denied(400, "Unknown status");
    if (set.quality != null && set.quality !== "" && !(QUALITIES as readonly string[]).includes(String(set.quality))) throw new Denied(400, "Unknown quality");
  };

  switch (op.t) {
    case "lead.set": {
      const l = editable(str(op.id, "id")); checkSet(op.set ?? {});
      const writes: Write[] = [{ tab: "leads", keyCols: ["lead_id"], mode: "updateOnly", rows: [{ lead_id: l.id, ...clean("leads", op.set, LEAD_SETTABLE) }] }];
      if (op.log) writes.push({ tab: "lead_log", keyCols: [], mode: "upsert", rows: [{ lead_id: l.id, at: now, kind: "status", from: String(op.log.from ?? "").slice(0, 80), to: String(op.log.to ?? "").slice(0, 80), by: me.name, text: String(op.log.text ?? "").slice(0, 500) }] });
      return writes;
    }
    case "lead.note": {
      const l = editable(str(op.id, "id"));
      return [{ tab: "lead_log", keyCols: [], mode: "upsert", rows: [{ lead_id: l.id, at: now, kind: "note", by: me.name, text: str(op.text, "text").slice(0, 2000) }] }];
    }
    case "eval.add": {
      if (!roleCan.evaluate(me.role)) throw new Denied(403, "Your role cannot review quality");
      const row = clean("evaluations", op.row); lead(String(row.lead_id));
      return [{ tab: "evaluations", keyCols: ["eval_id"], mode: "insert", rows: [{ ...row, reviewer_id: me.id, at: now }] }];
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
      if (!(op.tab in keys)) throw new Denied(400, "Tab not editable");
      const row = clean(op.tab, op.row); str(row[keys[op.tab]], keys[op.tab]);
      return [{ tab: op.tab, keyCols: [keys[op.tab]], mode: "upsert", rows: [row] }];
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
      for (const a of [op.perf, op.leads, op.ads, op.campaigns, op.insights, op.messages ?? [], op.comments ?? []]) if (!Array.isArray(a) || a.length > MAX_ROWS) throw new Denied(400, `Too many rows (max ${MAX_ROWS} per upload)`);
      const m = (tab: string, rows: unknown[]) => rows.map((r) => clean(tab, r));
      const w: Write[] = [];
      // Salespeople named in the file: created as name-only Sales Representatives (no email → cannot sign in)
      if (op.users?.length) w.push({ tab: "users", keyCols: ["user_id"], mode: "insert", rows: op.users.slice(0, 200).map((u) => ({ user_id: str(u.user_id, "user_id"), name: str(u.name, "name").slice(0, 120), email: "", role: "Sales Representative", agency_id: "", active: true })) });
      if (op.campaigns.length) w.push({ tab: "campaigns", keyCols: ["campaign_id"], mode: "insert", rows: m("campaigns", op.campaigns) });
      if (op.ads.length) w.push({ tab: "ads", keyCols: ["ad_id"], mode: "insert", rows: m("ads", op.ads) });
      if (op.perf.length) w.push({ tab: "ad_performance", keyCols: ["ad_id", "date"], mode: op.replace ? "upsert" : "insert", rows: m("ad_performance", op.perf) });
      if (op.leads.length) w.push({ tab: "leads", keyCols: ["lead_id"], mode: "insert", rows: m("leads", op.leads) });
      if (op.insights.length) w.push({ tab: "page_insights", keyCols: ["page_id", "date"], mode: op.replace ? "upsert" : "insert", rows: m("page_insights", op.insights) });
      if (op.messages?.length) w.push({ tab: "messages", keyCols: ["message_id"], mode: "insert", rows: m("messages", op.messages) });
      if (op.comments?.length) w.push({ tab: "post_comments", keyCols: ["comment_id"], mode: "insert", rows: m("post_comments", op.comments) });
      if (op.patches?.length) w.push({ tab: "leads", keyCols: ["lead_id"], mode: "updateOnly", rows: op.patches.map((p) => ({ lead_id: str(p.lead_id, "lead_id"), ...clean("leads", p.set, [...LEAD_SETTABLE, "name", "phone", "email", "phone2", "whatsapp", "lead_source", "form", "labels", "ad_id", "channel"]) })) });
      w.push({ tab: "import_log", keyCols: ["import_id"], mode: "insert", rows: [{ ...clean("import_log", op.record), by: me.name, at: now }] });
      return w;
    }
    default: throw new Denied(400, "Unknown operation");
  }
}
