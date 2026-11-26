import assert from "node:assert/strict";
import { test } from "node:test";
import type { Channel } from "./channels";
import { emptyDataset } from "./dataset";
import { buildWrites, type FbEvent } from "./fbWebhook";
import type { Lead } from "./types";

const channel: Channel = {
  channelId: "facebook:page-1", channel: "facebook", accountId: "page-1", name: "Test Page",
  accessToken: "test-only-token", appSecret: "test-only-secret", verifyToken: "test-only-token", sheetPageId: "PG-1",
  forceSheetPage: false, active: true, updatedAt: "2026-03-04",
};
const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: "FB-customer-1", name: "Customer", phone: "", email: "", pageId: "PG-1", adId: null, repId: null,
  status: "Converted", quality: "Qualified", valid: true, createdAt: "2026-03-01", lastContactAt: "2026-03-04T06:00:00",
  lastMessage: "newer summary", unread: false, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null,
  history: [], dropped: null, source: "import", channel: "facebook", fbUserId: "customer-1", ...overrides,
} as Lead);
const event = (mid: string, text: string, at: string, out = false): FbEvent => ({
  pageId: "page-1", customerId: "customer-1", mid, text, at: Date.parse(at), out,
});

test("a replayed Facebook message cannot regress a newer lead summary", async () => {
  let profileLookups = 0;
  const replay = event("M-REPLAY", "old message", "2026-03-04T05:00:00Z");
  const result = await buildWrites([replay], channel, { ...emptyDataset(), leads: [lead()] }, "UTC", async () => {
    profileLookups++;
    return "Customer";
  }, new Set([replay.mid]));
  assert.equal(profileLookups, 0);
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.newLeads, []);
  assert.deepEqual(result.leadUpdates, []);
});

test("a known Facebook message repairs a missing summary without resetting sales status or quality", async () => {
  const replay = event("M-PARTIAL", "persisted message", "2026-03-04T05:00:00Z");
  const existing = lead({ createdAt: "2026-03-04", lastContactAt: "2026-03-04T09:00:00", lastMessage: "", status: "Converted", quality: "Appointment Booked" });
  const result = await buildWrites([replay], channel, { ...emptyDataset(), leads: [existing] }, "UTC", async () => "", new Set([replay.mid]));
  assert.deepEqual(result.leadUpdates, [{
    lead_id: existing.id, last_contact_at: "2026-03-04 05:00", last_message: "persisted message", unread: true,
  }]);
  assert.equal("status" in result.leadUpdates[0], false);
  assert.equal("quality" in result.leadUpdates[0], false);
});

test("a fresh Facebook message in the same stored minute still updates the summary", async () => {
  const fresh = event("M-FRESH", "latest message", "2026-03-04T06:00:30Z");
  const result = await buildWrites([fresh], channel, { ...emptyDataset(), leads: [lead()] }, "UTC", async () => "");
  assert.deepEqual(result.leadUpdates, [{
    lead_id: "FB-customer-1", last_contact_at: "2026-03-04 06:00", last_message: "latest message", unread: true,
  }]);
});
