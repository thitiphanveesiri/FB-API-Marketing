import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import { Denied, planOp, type Op } from "./mutations";
import type { Dataset } from "./dataset";
import type { Lead, User } from "./types";

const user = (id: string, role: User["role"], agencyId?: string): User => ({ id, name: id, email: `${id}@example.test`, role, active: true, agencyId, hue: 0 });
const admin = user("U-ADMIN", "Administrator");
const manager = user("U-SM", "Sales Manager");
const rep = user("U-REP", "Sales Representative");
const marketing = user("U-MM", "Marketing Manager");
const lead: Lead = {
  id: "L-1", name: "Customer", phone: "0812345678", email: "customer@example.test", pageId: "PG-1", adId: "AD-1", repId: rep.id,
  status: "Not Responded", quality: "Not Responded", valid: true, createdAt: "2026-11-01", lastContactAt: "2026-11-01T09:00:00",
  lastMessage: "hello", followUpDate: null, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null, unread: true, history: [], dropped: null, source: "import",
};
const dataset = (): Dataset => ({
  ...emptyDataset(), users: [admin, manager, rep, marketing], pages: [{ id: "PG-1", name: "Page", active: true, agencyId: null, teamIds: [rep.id] }],
  agencies: [{ id: "AG-1", name: "Agency", contact: "", email: "", active: true }],
  campaigns: [{ id: "CP-1", name: "Campaign", pageId: "PG-1", agencyId: "", objective: "Messages" }],
  ads: [{ id: "AD-1", name: "Ad", campaignId: "CP-1", status: "Active", creative: { type: "Image", hue: 0 }, updatedAt: "2026-11-01" }], leads: [lead],
});
const importOp = (overrides: Partial<Extract<Op, { t: "import.commit" }>> = {}): Extract<Op, { t: "import.commit" }> => ({
  t: "import.commit", replace: false,
  record: { import_id: "IMP-1", page_id: "PG-1", data_type: "Ads Performance", file_name: "ads.csv", mode: "incremental", total: 1, imported: 1, failed: 0, duplicates: 0 },
  perf: [{ ad_id: "AD-1", date: "2026-11-01", spend: 10, impressions: 100 }], leads: [], ads: [], campaigns: [], insights: [], messages: [], comments: [], users: [], patches: [], ...overrides,
});
const denied = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof Denied && e.status === status);

test("Sales Representatives cannot move a lead out of Converted", () => {
  const ds = dataset(); ds.leads[0] = { ...lead, status: "Converted", quality: "Qualified" };
  denied(() => planOp({ t: "lead.set", id: lead.id, set: { status: "Average" } }, rep, ds, "2026-11-25 10:00"), 403);
  assert.equal(planOp({ t: "lead.set", id: lead.id, set: { status: "Average" } }, manager, ds, "2026-11-25 10:00").length, 2);
});

test("status audit values come from the stored lead, not the client", () => {
  const writes = planOp({ t: "lead.set", id: lead.id, set: { status: "Average" }, log: { from: "Converted", to: "Intake", text: "updated" } }, rep, dataset(), "2026-11-25 10:00");
  const audit = writes.find((w) => w.tab === "lead_log")!.rows[0];
  assert.equal(audit.from, "Not Responded");
  assert.equal(audit.to, "Average");
  assert.equal(audit.by, rep.name);
  assert.equal(audit.at, "2026-11-25 10:00");
});

test("status changes without a client log still create an audit row", () => {
  const writes = planOp({ t: "lead.set", id: lead.id, set: { status: "Qualified" } }, rep, dataset(), "2026-11-25 10:00");
  assert.equal(writes.filter((w) => w.tab === "lead_log").length, 1);
});

test("evaluations derive reviewer and previous quality and validate scores", () => {
  const row = { eval_id: "EV-1", lead_id: lead.id, quality: "Average", previous_quality: "Connection Created", reviewer_id: admin.id, at: "forged", responsiveness: 3, need_identified: 4, intent: 5, contact_captured: 2, notes: "ok", reason: "" };
  const writes = planOp({ t: "eval.add", row }, manager, dataset(), "2026-11-25 10:00");
  assert.equal(writes[0].rows[0].reviewer_id, manager.id);
  assert.equal(writes[0].rows[0].previous_quality, lead.quality);
  assert.equal(writes[0].rows[0].at, "2026-11-25 10:00");
  denied(() => planOp({ t: "eval.add", row: { ...row, responsiveness: 6 } }, manager, dataset(), "now"), 400);
  const qualified = dataset(); qualified.leads[0] = { ...lead, quality: "Qualified", status: "Qualified" };
  denied(() => planOp({ t: "eval.add", row: { ...row, quality: "Average" } }, manager, qualified, "now"), 400);
});

test("Marketing Managers cannot create users, import conversations or patch leads", () => {
  const ds = dataset();
  denied(() => planOp(importOp({ users: [{ user_id: "U-NEW", name: "New Rep" }] }), marketing, ds, "now"), 403);
  denied(() => planOp(importOp({ leads: [{ lead_id: "L-2", name: "New", page_id: "PG-1", status: "New", created_at: "2026-11-01" }] }), marketing, ds, "now"), 403);
  denied(() => planOp(importOp({ patches: [{ lead_id: lead.id, set: { assigned_to: rep.id } }] }), marketing, ds, "now"), 403);
  denied(() => planOp(importOp({ replace: true }), marketing, ds, "now"), 403);
  assert.equal(planOp(importOp(), marketing, ds, "now").length, 2);
});

test("imports reject unknown references and duplicate batch keys before writing", () => {
  const ds = dataset();
  denied(() => planOp(importOp({ perf: [{ ad_id: "MISSING", date: "2026-11-01", spend: 1, impressions: 1 }] }), admin, ds, "now"), 400);
  denied(() => planOp(importOp({ perf: [{ ad_id: "AD-1", date: "2026-11-01", spend: 1, impressions: 1 }, { ad_id: "AD-1", date: "2026-11-01", spend: 2, impressions: 2 }] }), admin, ds, "now"), 400);
  denied(() => planOp(importOp({ perf: [{ ad_id: "AD-1", date: "2026-11-01", spend: Number.NaN, impressions: 1 }] }), admin, ds, "now"), 400);
});

test("administrator imports create name-only sales representatives and force audit ownership", () => {
  const op = importOp({
    record: { import_id: "IMP-2", page_id: "PG-1", data_type: "Lead Data", file_name: "leads.csv", mode: "incremental", total: 1, imported: 1, failed: 0, duplicates: 0, by: "forged", at: "forged" },
    perf: [], users: [{ user_id: "U-NEW", name: "New Rep" }],
    leads: [{ lead_id: "L-2", name: "New Customer", page_id: "PG-1", assigned_to: "U-NEW", status: "New", quality: "Qualified", created_at: "2026-11-01" }],
  });
  const writes = planOp(op, admin, dataset(), "2026-11-25 10:00");
  assert.deepEqual(writes.find((w) => w.tab === "users")!.rows[0], { user_id: "U-NEW", name: "New Rep", email: "", role: "Sales Representative", agency_id: "", active: true });
  const log = writes.find((w) => w.tab === "import_log")!.rows[0];
  assert.equal(log.by, admin.name); assert.equal(log.at, "2026-11-25 10:00");
});

test("settings validate agency membership and sales teams", () => {
  const ds = dataset();
  denied(() => planOp({ t: "settings.upsert", tab: "users", row: { user_id: "U-AG", name: "Agency User", email: "agency@example.test", role: "Agency", agency_id: "", active: true } }, admin, ds, "now"), 400);
  denied(() => planOp({ t: "settings.upsert", tab: "pages", row: { page_id: "PG-1", name: "Page", sales_team: "U-ADMIN" } }, admin, ds, "now"), 400);
  assert.equal(planOp({ t: "settings.upsert", tab: "users", row: { user_id: "U-AG", name: "Agency User", email: "agency@example.test", role: "Agency", agency_id: "AG-1", active: true } }, admin, ds, "now").length, 1);
});

test("Sales Representatives cannot change protected lead fields or take another lead", () => {
  const ds = dataset();
  for (const field of ["valid", "first_response_min", "avg_follow_up_hrs", "drop_reason", "dropped_at", "previous_status", "recovery_status", "last_activity"]) {
    denied(() => planOp({ t: "lead.set", id: lead.id, set: { [field]: field === "valid" ? false : "" } }, rep, ds, "now"), 403);
  }
  const otherRep = user("U-REP-2", "Sales Representative");
  ds.users.push(otherRep);
  denied(() => planOp({ t: "lead.set", id: lead.id, set: { assigned_to: otherRep.id } }, rep, ds, "now"), 403);
  denied(() => planOp({ t: "lead.set", id: lead.id, set: { assigned_to: manager.id } }, rep, ds, "now"), 400);
  const other = dataset(); other.leads[0] = { ...lead, repId: manager.id };
  denied(() => planOp({ t: "lead.set", id: lead.id, set: { unread: false } }, rep, other, "now"), 403);
  const unassigned = dataset(); unassigned.leads[0] = { ...lead, repId: null };
  assert.deepEqual(planOp({ t: "lead.set", id: lead.id, set: { assigned_to: rep.id } }, rep, unassigned, "now")[0].rows[0], { lead_id: lead.id, assigned_to: rep.id });
  denied(() => planOp({ t: "lead.set", id: lead.id, set: { assigned_to: rep.id, unread: false } }, rep, unassigned, "now"), 403);
  denied(() => planOp({ t: "lead.set", id: lead.id, set: { assigned_to: "" } }, rep, unassigned, "now"), 403);
  assert.equal(planOp({ t: "lead.set", id: lead.id, set: { status: "Average", quality: "Average", follow_up_date: "2026-11-26", unread: false } }, rep, ds, "now").length, 2);
  assert.equal(planOp({ t: "lead.set", id: lead.id, set: { valid: false } }, manager, ds, "now").length, 1);
});

test("user settings keep login emails unique and immutable", () => {
  const ds = dataset();
  denied(() => planOp({ t: "settings.upsert", tab: "users", row: { user_id: "U-NEW", name: "Duplicate", email: "U-REP@example.test", role: "Viewer", active: true } }, admin, ds, "now"), 400);
  denied(() => planOp({ t: "settings.upsert", tab: "users", row: { user_id: rep.id, email: "new-rep@example.test" } }, admin, ds, "now"), 400);
  denied(() => planOp({ t: "settings.upsert", tab: "users", row: { user_id: "U-NEW", name: "No Email", email: "", role: "Viewer", active: true } }, admin, ds, "now"), 400);
  assert.equal(planOp({ t: "settings.upsert", tab: "users", row: { user_id: "U-NEW", name: "Viewer", email: "viewer@example.test", role: "Viewer", active: true } }, admin, ds, "now").length, 1);
});

test("settings cannot disable or demote the last active Administrator", () => {
  const ds = dataset();
  denied(() => planOp({ t: "settings.upsert", tab: "users", row: { user_id: admin.id, active: false } }, admin, ds, "now"), 400);
  denied(() => planOp({ t: "settings.upsert", tab: "users", row: { user_id: admin.id, role: "Viewer" } }, admin, ds, "now"), 400);
  ds.users.push(user("U-ADMIN-2", "Administrator"));
  assert.equal(planOp({ t: "settings.upsert", tab: "users", row: { user_id: admin.id, active: false } }, admin, ds, "now").length, 1);
});

test("usernames are validated, unique, and cannot be removed; password_hash is not writable from the client", () => {
  const ds = dataset();
  const base = { user_id: "U-NEW", name: "Ann", email: "ann@example.test", role: "Viewer", active: true };
  const up = (extra: object) => planOp({ t: "settings.upsert", tab: "users", row: { ...base, ...extra } }, admin, ds, "now");
  assert.equal((up({ username: "Ann.Lee" })[0].rows[0] as { username: string }).username, "ann.lee");
  denied(() => up({ username: "a b" }), 400);
  denied(() => up({ password_hash: "scrypt$x$y" }), 400);
});
