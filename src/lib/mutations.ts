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
  | { t: "settings.upsert"; tab: string; row: Record<string, unknown> }
  | { t: "import.commit"; record: Record<string, unknown>; replace: boolean; perf: unknown[]; leads: unknown[]; ads: unknown[]; campaigns: unknown[]; insights: unknown[]; messages?: unknown[]; comments?: unknown[]; patches: { lead_id: string; set: Record<string, unknown> }[] };

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
    case "settings.upsert": {
      if (!roleCan.manageSettings(me.role)) throw new Denied(403, "Only an Administrator can change settings");
      const keys: Record<string, string> = { users: "user_id", pages: "page_id", agencies: "agency_id", campaigns: "campaign_id" };
      if (!(op.tab in keys)) throw new Denied(400, "Tab not editable");
      const row = clean(op.tab, op.row); str(row[keys[op.tab]], keys[op.tab]);
      return [{ tab: op.tab, keyCols: [keys[op.tab]], mode: "upsert", rows: [row] }];
    }
    case "import.commit": {
      if (!roleCan.upload(me.role)) throw new Denied(403, "Your role cannot upload data");
      for (const a of [op.perf, op.leads, op.ads, op.campaigns, op.insights, op.messages ?? [], op.comments ?? []]) if (!Array.isArray(a) || a.length > MAX_ROWS) throw new Denied(400, `Too many rows (max ${MAX_ROWS} per upload)`);
      const m = (tab: string, rows: unknown[]) => rows.map((r) => clean(tab, r));
      const w: Write[] = [];
      if (op.campaigns.length) w.push({ tab: "campaigns", keyCols: ["campaign_id"], mode: "insert", rows: m("campaigns", op.campaigns) });
      if (op.ads.length) w.push({ tab: "ads", keyCols: ["ad_id"], mode: "insert", rows: m("ads", op.ads) });
      if (op.perf.length) w.push({ tab: "ad_performance", keyCols: ["ad_id", "date"], mode: op.replace ? "upsert" : "insert", rows: m("ad_performance", op.perf) });
      if (op.leads.length) w.push({ tab: "leads", keyCols: ["lead_id"], mode: "insert", rows: m("leads", op.leads) });
      if (op.insights.length) w.push({ tab: "page_insights", keyCols: ["page_id", "date"], mode: op.replace ? "upsert" : "insert", rows: m("page_insights", op.insights) });
      if (op.messages?.length) w.push({ tab: "messages", keyCols: ["message_id"], mode: "insert", rows: m("messages", op.messages) });
      if (op.comments?.length) w.push({ tab: "post_comments", keyCols: ["comment_id"], mode: "insert", rows: m("post_comments", op.comments) });
      if (op.patches?.length) w.push({ tab: "leads", keyCols: ["lead_id"], mode: "updateOnly", rows: op.patches.map((p) => ({ lead_id: str(p.lead_id, "lead_id"), ...clean("leads", p.set, ["assigned_to", "first_response_min", "follow_ups"]) })) });
      w.push({ tab: "import_log", keyCols: ["import_id"], mode: "insert", rows: [{ ...clean("import_log", op.record), by: me.name, at: now }] });
      return w;
    }
    default: throw new Denied(400, "Unknown operation");
  }
}
