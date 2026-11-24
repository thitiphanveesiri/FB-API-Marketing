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
    status: "Not Responded",
    quality: "Not Responded",
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
    status: "Not Responded",
    quality: "Not Responded",
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
