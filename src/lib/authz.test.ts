import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeDataset } from "./authz";
import { emptyDataset } from "./dataset";
import type { Dataset } from "./dataset";
import type { Lead, Message, User } from "./types";

const admin: User = { id: "U-A", name: "Admin", email: "admin@example.test", role: "Administrator", active: true, hue: 0 };
const rep: User = { id: "U-R", name: "Rep", email: "rep@example.test", role: "Sales Representative", active: true, hue: 0 };
const other: User = { id: "U-O", name: "Other", email: "other@example.test", role: "Sales Representative", active: true, hue: 0 };
const viewer: User = { ...admin, id: "U-V", role: "Viewer" };
const agencyUser: User = { ...admin, id: "U-AG", role: "Agency", agencyId: "AG-1" };
const lead = (id: string, repId: string | null, adId: string | null): Lead => ({
  id, name: `Customer ${id}`, phone: "0812345678", phone2: "0899999999", whatsapp: "0812345678", email: `${id}@example.test`, fbUserId: `psid-${id}`,
  pageId: "PG-1", adId, repId, status: "Average", quality: "Average", valid: true, createdAt: "2026-11-01", lastContactAt: "2026-11-01T09:00:00",
  lastMessage: "private message", followUpDate: null, notes: [{ at: "2026-11-01T09:00:00", by: "Rep", text: "private note" }], firstResponseMin: 1, followUps: 0,
  avgFollowUpHrs: null, unread: true, history: [{ at: "2026-11-01T09:00:00", from: null, to: "Average", by: "Rep", note: "private history" }],
  dropped: { reason: "Postponed", at: "2026-11-01", previousStatus: "Average", recovery: "Not Started", lastActivity: "private activity" },
  source: "import", leadSource: "private source", form: "private form", labels: "private label",
});
const message = (id: string, leadId: string): Message => ({ id, leadId, direction: "in", text: "private chat", at: "2026-11-01T09:00:00", simulated: false });
const dataset = (): Dataset => ({
  ...emptyDataset(), users: [admin, rep, other, viewer, agencyUser], pages: [{ id: "PG-1", name: "Page", active: true, agencyId: null, teamIds: [rep.id, other.id] }],
  agencies: [{ id: "AG-1", name: "Agency", contact: "Private contact", email: "agency@example.test", active: true }],
  campaigns: [{ id: "CP-1", name: "Campaign", pageId: "PG-1", agencyId: "AG-1", objective: "Messages" }],
  ads: [{ id: "AD-1", name: "Ad", campaignId: "CP-1", status: "Active", creative: { type: "Image", hue: 0 }, updatedAt: "2026-11-01" }],
  perf: [{ adId: "AD-1", date: "2026-11-01", spend: 1, reach: 1, impressions: 1, clicks: 0, messages: 1, purchases: 0, source: "import" }],
  leads: [lead("L-R", rep.id, "AD-1"), lead("L-O", other.id, "AD-1"), lead("L-N", null, null)],
  messages: { "L-R": [message("M-R", "L-R")], "L-O": [message("M-O", "L-O")], "L-N": [message("M-N", "L-N")] },
  insights: [{ pageId: "PG-1", date: "2026-11-01", reach: 1, views: 1, engagements: 1, followers: 1, newFollowers: 0, linkClicks: 0 }],
  comments: [{ id: "C-1", pageId: "PG-1", postId: "private-post", commenter: "Private name", text: "Private comment", at: "2026-11-01T09:00:00", repliedAt: null, repliedBy: "Rep" }],
});

test("Sales Representatives receive only their leads and messages, without broad marketing data", () => {
  const scoped = scopeDataset(dataset(), rep);
  assert.deepEqual(scoped.leads.map((l) => l.id), ["L-R"]);
  assert.deepEqual(Object.keys(scoped.messages), ["L-R"]);
  assert.equal(scoped.perf.length, 0); assert.equal(scoped.insights.length, 0); assert.equal(scoped.imports.length, 0);
  assert.equal(scoped.comments[0].text, ""); assert.equal(scoped.comments[0].commenter, ""); assert.equal(scoped.posts.length, 0);
  assert.equal(scoped.users.find((u) => u.id === other.id)!.email, "");
});

test("Viewer lead redaction clears contact fields, message text, notes and dropped free text", () => {
  const scoped = scopeDataset(dataset(), viewer), l = scoped.leads[0];
  for (const value of [l.phone, l.phone2, l.whatsapp, l.email, l.fbUserId, l.lastMessage, l.leadSource, l.form, l.labels, l.dropped?.lastActivity]) assert.ok(!value);
  assert.equal(l.notes.length, 0); assert.equal(l.history[0].note, undefined); assert.deepEqual(scoped.messages, {}); assert.equal(scoped.comments.length, 0);
});

test("redacted lead IDs do not expose phone numbers embedded in provider IDs", () => {
  const phone = "66812345678";
  const source = dataset();
  source.leads = [lead(`WA-phone-1-${phone}`, null, "AD-1")];
  for (const me of [viewer, agencyUser]) {
    const scoped = scopeDataset(source, me);
    const serialized = JSON.stringify(scoped.leads);
    assert.equal(serialized.includes(phone), false);
    assert.match(scoped.leads[0].id, /^LEAD-[a-f0-9]{24}$/);
    assert.equal(scoped.leads[0].name.includes(phone), false);
  }
});

test("Agency users stay inside their agency and receive anonymized leads only", () => {
  const scoped = scopeDataset(dataset(), agencyUser);
  assert.deepEqual(scoped.campaigns.map((c) => c.id), ["CP-1"]); assert.equal(scoped.perf.length, 1);
  assert.equal(scoped.leads.length, 2); assert.ok(scoped.leads.every((l) => !l.phone && !l.email && !l.lastMessage && l.repId === null));
  assert.deepEqual(scoped.messages, {}); assert.equal(scoped.users.length, 1);
});
