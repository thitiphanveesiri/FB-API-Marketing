import assert from "node:assert/strict";
import { test } from "node:test";
import { writeWebhookWrites, type WebhookRow, type WebhookRowWriter, type WebhookWrites } from "./webhookWrites";

const writes = (): WebhookWrites => ({
  newLeads: [{ lead_id: "L-1", status: "Not Responded", quality: "Not Responded" }],
  messages: [
    { message_id: "M-1", lead_id: "L-1", direction: "in", text: "first" },
    { message_id: "M-1", lead_id: "L-1", direction: "in", text: "first" },
    { message_id: "M-2", lead_id: "L-1", direction: "in", text: "second" },
  ],
  leadUpdates: [{ lead_id: "L-1", last_contact_at: "2026-03-04 10:00", last_message: "second", unread: true }],
});

test("webhook message IDs become known only after every write succeeds", async () => {
  const known = new Set(["M-OLD"]);
  const calls: string[] = [];
  const writer: WebhookRowWriter = async (tab, _keys, rows, mode) => {
    calls.push(`${tab}:${mode}`);
    if (tab === "messages") assert.deepEqual(rows.map((row) => row.message_id), ["M-1", "M-2"]);
    return {};
  };
  const result = await writeWebhookWrites(writes(), known, writer);
  assert.deepEqual(calls, ["leads:insert", "messages:insert", "leads:updateOnly"]);
  assert.deepEqual(result.map((message) => message.message_id), ["M-1", "M-2"]);
  assert.deepEqual([...known], ["M-OLD", "M-1", "M-2"]);
});

test("a failed summary write leaves message IDs unknown for a durable retry", async () => {
  const known = new Set(["M-OLD"]);
  const calls: string[] = [];
  const writer: WebhookRowWriter = async (tab, _keys, _rows, mode) => {
    calls.push(`${tab}:${mode}`);
    if (tab === "leads" && mode === "updateOnly") throw new Error("summary write failed");
    return {};
  };
  await assert.rejects(() => writeWebhookWrites(writes(), known, writer), /summary write failed/);
  assert.deepEqual(calls, ["leads:insert", "messages:insert", "leads:updateOnly"]);
  assert.deepEqual([...known], ["M-OLD"]);
});

test("known messages are returned after summary repair so their stable audit IDs can suppress duplicate pushes", async () => {
  const known = new Set(["M-1", "M-2"]);
  const calls: { tab: string; rows: WebhookRow[]; mode: string }[] = [];
  const writer: WebhookRowWriter = async (tab, _keys, rows, mode) => {
    calls.push({ tab, rows, mode });
    return {};
  };
  const pending = writes();
  const result = await writeWebhookWrites({ ...pending, newLeads: [] }, known, writer);
  assert.deepEqual(result.map((message) => message.message_id), ["M-1", "M-2"]);
  assert.deepEqual(calls, [{ tab: "leads", rows: pending.leadUpdates, mode: "updateOnly" }]);
  assert.deepEqual([...known], ["M-1", "M-2"]);

  calls.length = 0;
  assert.deepEqual(await writeWebhookWrites({ newLeads: [], messages: pending.messages, leadUpdates: [] }, known, writer), []);
  assert.deepEqual(calls, []);
});
