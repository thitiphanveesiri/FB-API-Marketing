import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import {
  buildExternalWrites,
  dedupeExternalEvents,
  externalLeadId,
  externalMessageId,
  externalRecipientOf,
  type ExternalEvent,
} from "./externalWebhook";
import type { Lead } from "./types";
import { writeWebhookWrites, type WebhookRow, type WebhookRowWriter } from "./webhookWrites";

test("maps LINE events to channel-specific leads, messages and unread state", () => {
  const events: ExternalEvent[] = [
    {
      accountId: "line-account",
      customerId: "Uabcde",
      mid: "LINE-IN-line-late",
      text: "latest LINE message",
      at: Date.parse("2026-03-04T06:07:08.000Z"),
      attachmentName: "quote.pdf",
    },
    {
      accountId: "line-account",
      customerId: "Uabcde",
      mid: "LINE-IN-line-early",
      text: "early LINE message",
      at: Date.parse("2026-03-04T05:06:07.000Z"),
    },
  ];
  const writes = buildExternalWrites(events, {
    channel: "line",
    sheetPageId: "PG-LINE",
    dataset: emptyDataset(),
    timezone: "UTC",
  });

  assert.deepEqual(writes.newLeads, [{
    lead_id: "LINE-line-account-Uabcde",
    name: "LINE bcde",
    page_id: "PG-LINE",
    ad_id: "",
    assigned_to: "",
    status: "Not Responded",
    quality: "Not Responded",
    valid: true,
    created_at: "2026-03-04",
    phone: "",
    email: "",
    unread: true,
    channel: "line",
  }]);
  assert.equal("fb_user_id" in writes.newLeads[0], false);
  assert.deepEqual(writes.messages, [
    {
      message_id: "LINE-IN-line-early",
      lead_id: "LINE-line-account-Uabcde",
      direction: "in",
      sender_type: "customer",
      sender_app: "",
      text: "early LINE message",
      sent_at: "2026-03-04 05:06",
      attachment_name: "",
    },
    {
      message_id: "LINE-IN-line-late",
      lead_id: "LINE-line-account-Uabcde",
      direction: "in",
      sender_type: "customer",
      sender_app: "",
      text: "latest LINE message",
      sent_at: "2026-03-04 06:07",
      attachment_name: "quote.pdf",
    },
  ]);
  assert.deepEqual(writes.leadUpdates, [{
    lead_id: "LINE-line-account-Uabcde",
    last_contact_at: "2026-03-04 06:07",
    last_message: "latest LINE message",
    unread: true,
  }]);
});

test("maps WhatsApp profile, phone and document metadata without a Facebook PSID", () => {
  const text = "x".repeat(350);
  const writes = buildExternalWrites([{
    accountId: "phone-1",
    customerId: "66812345678",
    mid: "WA-IN-wa-1",
    text,
    at: Date.parse("2026-03-05T07:08:09.000Z"),
    displayName: "  Alice  ",
    phone: "66812345678",
    attachmentName: "quote.pdf",
  }], {
    channel: "whatsapp",
    sheetPageId: "PG-WA",
    dataset: emptyDataset(),
    timezone: "UTC",
  });

  assert.deepEqual(writes.newLeads, [{
    lead_id: "WA-phone-1-66812345678",
    name: "Alice",
    page_id: "PG-WA",
    ad_id: "",
    assigned_to: "",
    status: "Not Responded",
    quality: "Not Responded",
    valid: true,
    created_at: "2026-03-05",
    phone: "66812345678",
    email: "",
    unread: true,
    channel: "whatsapp",
  }]);
  assert.equal("fb_user_id" in writes.newLeads[0], false);
  assert.deepEqual(writes.messages, [{
    message_id: "WA-IN-wa-1",
    lead_id: "WA-phone-1-66812345678",
    direction: "in",
    sender_type: "customer",
    sender_app: "",
    text,
    sent_at: "2026-03-05 07:08",
    attachment_name: "quote.pdf",
  }]);
  assert.deepEqual(writes.leadUpdates, [{
    lead_id: "WA-phone-1-66812345678",
    last_contact_at: "2026-03-05 07:08",
    last_message: text.slice(0, 300),
    unread: true,
    phone: "66812345678",
  }]);
});

test("scopes external lead and message IDs by provider and account", () => {
  assert.equal(externalLeadId("line", "line-account", "Uabcde"), "LINE-line-account-Uabcde");
  assert.equal(externalLeadId("whatsapp", "phone-1", "66812345678"), "WA-phone-1-66812345678");
  assert.notEqual(externalLeadId("line", "account-a", "Uabcde"), externalLeadId("line", "account-b", "Uabcde"));
  assert.notEqual(externalLeadId("line", "shared-account", "shared-customer"), externalLeadId("whatsapp", "shared-account", "shared-customer"));
  assert.equal(externalMessageId("line", "raw-1"), "LINE-IN-raw-1");
  assert.equal(externalMessageId("whatsapp", "raw-1"), "WA-IN-raw-1");
  assert.notEqual(externalMessageId("line", "raw-1"), externalMessageId("whatsapp", "raw-1"));
});

test("decodes only recipient IDs belonging to the requested provider and account", () => {
  assert.equal(externalRecipientOf("LINE-line-account-Uabcde", "line", "line-account"), "Uabcde");
  assert.equal(externalRecipientOf("LINE-line-account-Uabc_DEF-123", "line", "line-account"), "Uabc_DEF-123");
  assert.equal(externalRecipientOf("WA-phone-1-66812345678", "whatsapp", "phone-1"), "66812345678");

  for (const leadId of [
    "WA-phone-1-Uabcde",
    "LINE-other-account-Uabcde",
    "LINE-line-account-user12345",
    "LINE-line-account-U1234",
    "LINE-line-account-Uabcde/extra",
    "LINE-line-account-",
  ]) assert.equal(externalRecipientOf(leadId, "line", "line-account"), null, leadId);

  for (const leadId of [
    "LINE-line-account-66812345678",
    "WA-other-account-66812345678",
    "WA-phone-1-66812abc678",
    "WA-phone-1-12345",
    "WA-phone-1-",
  ]) assert.equal(externalRecipientOf(leadId, "whatsapp", "phone-1"), null, leadId);
});

test("deduplicates known events, duplicate events in one batch and blank IDs", () => {
  const event = (mid: string, at = 1): ExternalEvent => ({
    accountId: "line-account",
    customerId: "Uabcde",
    mid,
    text: mid || "blank",
    at,
  });
  const known = event("LINE-IN-known");
  const fresh = event("LINE-IN-shared", 2);
  const providerTwin = { ...event("WA-IN-shared", 3), accountId: "phone-1", customerId: "66812345678" };
  const blank = event("");
  const incoming = [known, fresh, { ...fresh }, blank, providerTwin];
  const knownMessageIds = new Set([known.mid]);

  const freshEvents = dedupeExternalEvents(incoming, knownMessageIds);
  assert.deepEqual(freshEvents, [fresh, providerTwin]);
  assert.deepEqual([...knownMessageIds], [known.mid]);
  assert.deepEqual(dedupeExternalEvents(incoming, new Set([...knownMessageIds, ...freshEvents.map((event) => event.mid)])), []);
  assert.equal(incoming.length, 5);
});

const externalLead = (overrides: Partial<Lead> = {}): Lead => ({
  id: "LINE-line-account-Uabcde", name: "Existing Customer", phone: "", email: "", pageId: "PG-LINE", adId: null, repId: null,
  status: "Converted", quality: "Appointment Booked", valid: true, createdAt: "2026-03-01", lastContactAt: "2026-03-04T06:00:00",
  lastMessage: "newer summary", unread: false, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null,
  history: [], dropped: null, source: "import", channel: "line", ...overrides,
} as Lead);

test("inbound LINE and WhatsApp messages preserve existing sales status and quality", () => {
  for (const channel of ["line", "whatsapp"] as const) {
    const accountId = channel === "line" ? "line-account" : "phone-1";
    const customerId = channel === "line" ? "Uabcde" : "66812345678";
    const id = externalLeadId(channel, accountId, customerId);
    const existing = externalLead({ id, channel, pageId: "PG-OLD" });
    const writes = buildExternalWrites([{
      accountId, customerId, mid: externalMessageId(channel, "new-message"), text: "hello", at: Date.parse("2026-03-04T07:00:00Z"),
    }], { channel, sheetPageId: "PG-LINE", dataset: { ...emptyDataset(), leads: [existing] }, timezone: "UTC" });
    assert.deepEqual(writes.newLeads, []);
    assert.equal(writes.leadUpdates.length, 1);
    assert.equal(writes.leadUpdates[0].page_id, "PG-LINE");
    assert.equal(writes.leadUpdates[0].last_message, "hello");
    assert.equal("status" in writes.leadUpdates[0], false);
    assert.equal("quality" in writes.leadUpdates[0], false);
  }
});

test("external replays skip completed summaries but repair missing ones", () => {
  const event: ExternalEvent = {
    accountId: "line-account", customerId: "Uabcde", mid: "LINE-IN-partial", text: "persisted message", at: Date.parse("2026-03-04T05:00:00Z"),
  };
  const input = { channel: "line" as const, sheetPageId: "PG-LINE", timezone: "UTC", knownMessageIds: new Set([event.mid]) };
  assert.deepEqual(buildExternalWrites([event], { ...input, dataset: { ...emptyDataset(), leads: [externalLead()] } }).leadUpdates, []);

  const missing = externalLead({ createdAt: "2026-03-04", lastContactAt: "2026-03-04T09:00:00", lastMessage: "" });
  const repaired = buildExternalWrites([event], { ...input, dataset: { ...emptyDataset(), leads: [missing] } });
  assert.deepEqual(repaired.leadUpdates, [{
    lead_id: missing.id, last_contact_at: "2026-03-04 05:00", last_message: "persisted message", unread: true,
  }]);

  const sameMinute = buildExternalWrites([event], { ...input, knownMessageIds: new Set(), dataset: {
    ...emptyDataset(), leads: [externalLead({ lastContactAt: "2026-03-04T05:00:00", lastMessage: "previous" })],
  } });
  assert.equal(sameMinute.leadUpdates[0].last_message, "persisted message");
});

test("an external retry after message persistence repairs the summary without duplicate notification", async () => {
  const event: ExternalEvent = {
    accountId: "line-account", customerId: "Uabcde", mid: "LINE-IN-retry", text: "needs summary", at: Date.parse("2026-03-04T05:06:00Z"),
  };
  const input = { channel: "line" as const, sheetPageId: "PG-LINE", timezone: "UTC" };
  const initial = buildExternalWrites([event], { ...input, dataset: emptyDataset() });
  const known = new Set<string>();
  const persistedLeads = new Map<string, WebhookRow>();
  const persistedMessages: WebhookRow[] = [];
  let failSummary = true;
  const writer: WebhookRowWriter = async (tab, _keys, rows, mode) => {
    if (tab === "messages") persistedMessages.push(...rows);
    else if (mode === "insert") for (const row of rows) persistedLeads.set(String(row.lead_id), row);
    else if (failSummary) throw new Error("summary failed");
    else for (const row of rows) persistedLeads.set(String(row.lead_id), { ...persistedLeads.get(String(row.lead_id)), ...row });
    return {};
  };

  await assert.rejects(() => writeWebhookWrites(initial, known, writer), /summary failed/);
  assert.equal(known.has(event.mid), false);
  assert.equal(persistedMessages.length, 1);

  const retryKnown = new Set(persistedMessages.map((row) => String(row.message_id)));
  const stored = persistedLeads.get(initial.newLeads[0].lead_id as string);
  assert.ok(stored);
  const retryLead = externalLead({
    id: String(stored.lead_id), name: String(stored.name), createdAt: String(stored.created_at), channel: "line",
    lastContactAt: "2026-03-04T09:00:00", lastMessage: "", status: "Qualified", quality: "Qualified",
  });
  persistedLeads.set(retryLead.id, { ...stored, status: "Qualified", quality: "Qualified" });
  const retry = buildExternalWrites([event], { ...input, dataset: { ...emptyDataset(), leads: [retryLead] }, knownMessageIds: retryKnown });
  assert.equal(retry.leadUpdates.length, 1);
  failSummary = false;
  assert.deepEqual((await writeWebhookWrites(retry, retryKnown, writer)).map((message) => message.message_id), [event.mid]);
  assert.deepEqual(persistedLeads.get(retryLead.id), {
    ...stored, last_contact_at: "2026-03-04 05:06", last_message: "needs summary", unread: true,
    status: "Qualified", quality: "Qualified",
  });

  const completed = buildExternalWrites([event], { ...input, dataset: {
    ...emptyDataset(), leads: [{ ...retryLead, lastContactAt: "2026-03-04T05:06:00", lastMessage: "needs summary", unread: true }],
  }, knownMessageIds: retryKnown });
  assert.deepEqual(completed.leadUpdates, []);
});
