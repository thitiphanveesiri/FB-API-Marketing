import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import { buildInstagramWrites, instagramRecipientFor, instagramRecipientOf, parseInstagramEvents } from "./instagramWebhook";
import type { Lead } from "./types";

test("parses Instagram messages separately from Facebook page events", () => {
  const events = parseInstagramEvents({
    object: "instagram",
    entry: [{ id: "ig-business", messaging: [
      { sender: { id: "12345", username: "customer" }, recipient: { id: "ig-business" }, timestamp: 1000, message: { mid: "in-1", text: "hello", referral: { ad_id: "7890" } } },
      { sender: { id: "ig-business" }, recipient: { id: "12345" }, timestamp: 2000, message: { mid: "out-1", text: "reply", is_echo: true } },
      { sender: { id: "12345" }, recipient: { id: "ig-business" }, timestamp: 3000, message: { mid: "deleted", is_deleted: true } },
    ] }],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].customerId, "12345");
  assert.equal(events[0].username, "customer");
  assert.equal(events[0].adId, "7890");
  assert.equal(events[1].customerId, "12345");
  assert.equal(events[1].out, true);
  assert.equal(events.length, 2);
  assert.deepEqual(parseInstagramEvents({ object: "page", entry: [] }), []);
});

test("creates channel-specific leads without storing Instagram IDs as Facebook PSIDs", () => {
  const events = parseInstagramEvents({
    object: "instagram",
    entry: [{ id: "ig-business", messaging: [
      { sender: { id: "12345", username: "customer" }, recipient: { id: "ig-business" }, timestamp: 1000, message: { mid: "in-1", text: "hello", referral: { ad_id: "7890" } } },
      { sender: { id: "ig-business" }, recipient: { id: "12345" }, timestamp: 2000, message: { mid: "out-1", text: "reply", is_echo: true } },
    ] }],
  });
  const writes = buildInstagramWrites(events, { accountId: "ig-business", sheetPageId: "PG-1" }, emptyDataset(), "UTC");
  assert.equal(writes.newLeads.length, 1);
  assert.equal(writes.newLeads[0].lead_id, "IG-ig-business-12345");
  assert.equal(writes.newLeads[0].channel, "instagram");
  assert.equal(writes.newLeads[0].ad_id, "7890");
  assert.equal("fb_user_id" in writes.newLeads[0], false);
  assert.equal(writes.messages[1].sender_type, "unknown");
  assert.equal(instagramRecipientOf("IG-ig-business-12345", "ig-business"), "12345");
  assert.equal(instagramRecipientOf("FB-12345", "ig-business"), null);
});

test("replies to Instagram leads made by the history sync through their stored customer id", () => {
  assert.equal(instagramRecipientFor({ id: "IG-111-222333" }, "111"), "222333");
  assert.equal(instagramRecipientFor({ id: "aWdfZAG1f", fbUserId: "17841400000" }, "111"), "17841400000");
  assert.equal(instagramRecipientFor({ id: "aWdfZAG1f" }, "111"), null);
  assert.equal(instagramRecipientFor({ id: "aWdfZAG1f", fbUserId: "111" }, "111"), null);
});

const instagramLead = (overrides: Partial<Lead> = {}): Lead => ({
  id: "IG-ig-business-12345", name: "Instagram Customer", phone: "", email: "", pageId: "PG-IG", adId: null, repId: null,
  status: "Converted", quality: "Qualified", valid: true, createdAt: "2026-03-01", lastContactAt: "2026-03-04T06:00:00",
  lastMessage: "newer summary", unread: false, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null,
  history: [], dropped: null, source: "import", channel: "instagram", ...overrides,
} as Lead);
const instagramEvent = (mid: string, text: string, at: number) => ({ accountId: "ig-business", customerId: "12345", mid, text, at, out: false });

test("Instagram replays do not regress summaries but known messages repair partial persistence", () => {
  const replay = instagramEvent("IG-M-1", "persisted message", Date.parse("2026-03-04T05:00:00Z"));
  const olderReplay = buildInstagramWrites([replay], { accountId: "ig-business", sheetPageId: "PG-IG" }, {
    ...emptyDataset(), leads: [instagramLead()],
  }, "UTC", new Set([replay.mid]));
  assert.deepEqual(olderReplay.leadUpdates, []);

  const partial = buildInstagramWrites([replay], { accountId: "ig-business", sheetPageId: "PG-IG" }, {
    ...emptyDataset(), leads: [instagramLead({ createdAt: "2026-03-04", lastContactAt: "2026-03-04T09:00:00", lastMessage: "" })],
  }, "UTC", new Set([replay.mid]));
  assert.deepEqual(partial.leadUpdates, [{
    lead_id: "IG-ig-business-12345", last_contact_at: "2026-03-04 05:00", last_message: "persisted message", unread: true,
  }]);
});
