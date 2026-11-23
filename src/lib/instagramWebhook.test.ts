import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import { buildInstagramWrites, instagramRecipientFor, instagramRecipientOf, parseInstagramEvents } from "./instagramWebhook";

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
