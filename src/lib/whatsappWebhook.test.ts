import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { parseWhatsAppEvents, whatsappSignatureOk } from "./whatsappWebhook";

test("parses WhatsApp text, buttons, interactive replies, media and documents by phone-number metadata", () => {
  const customer = "66811111111";
  const baseTimestamp = 1_700_000_000;
  const cases = [
    { message: { id: "text", type: "text", text: { body: "hello" } }, text: "hello", attachmentName: "" },
    { message: { id: "button", type: "button", button: { text: "Yes" } }, text: "Yes", attachmentName: "" },
    { message: { id: "interactive-button", type: "interactive", interactive: { button_reply: { title: "Book" } } }, text: "Book", attachmentName: "" },
    { message: { id: "interactive-list", type: "interactive", interactive: { list_reply: { title: "Option 2" } } }, text: "Option 2", attachmentName: "" },
    { message: { id: "image-caption", type: "image", image: { id: "media-1", caption: "photo" } }, text: "photo", attachmentName: "" },
    { message: { id: "image-default", type: "image", image: { id: "media-2" } }, text: "[รูปภาพ]", attachmentName: "" },
    { message: { id: "video-caption", type: "video", video: { id: "media-3", caption: "clip" } }, text: "clip", attachmentName: "" },
    { message: { id: "video-default", type: "video", video: { id: "media-4" } }, text: "[วิดีโอ]", attachmentName: "" },
    { message: { id: "audio", type: "audio", audio: { id: "media-5" } }, text: "[เสียง]", attachmentName: "" },
    { message: { id: "document-caption", type: "document", document: { id: "media-6", filename: "quote.pdf", caption: "Please read" } }, text: "Please read", attachmentName: "quote.pdf" },
    { message: { id: "document-default", type: "document", document: { id: "media-7", filename: "terms.pdf" } }, text: "[ไฟล์แนบ]", attachmentName: "terms.pdf" },
  ];
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [
      {
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-1" },
          contacts: [{ wa_id: customer, profile: { name: "Alice" } }],
          messages: cases.map(({ message }, index) => ({ ...message, from: customer, timestamp: String(baseTimestamp + index) })),
          statuses: [{ id: "status-1", status: "delivered" }],
        },
      },
      {
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-2" },
          contacts: [{ wa_id: "66822222222", profile: { name: "Bob" } }],
          messages: [{ id: "second-phone", from: "66822222222", timestamp: "1700000060", type: "text", text: { body: "other account" } }],
        },
      },
      {
        field: "smb_app_state_suggested",
        value: {
          metadata: { phone_number_id: "phone-3" },
          messages: [{ id: "wrong-field", from: customer, timestamp: "1700000000", type: "text", text: { body: "ignored" } }],
        },
      },
    ] }],
  };

  const events = parseWhatsAppEvents(payload);
  assert.deepEqual(events.map((event) => ({
    mid: event.mid,
    accountId: event.accountId,
    customerId: event.customerId,
    text: event.text,
    at: event.at,
    displayName: event.displayName,
    phone: event.phone,
    attachmentName: event.attachmentName,
  })), [
    ...cases.map(({ message, text, attachmentName }, index) => ({
      mid: `WA-IN-${message.id}`,
      accountId: "phone-1",
      customerId: customer,
      text,
      at: (baseTimestamp + index) * 1_000,
      displayName: "Alice",
      phone: customer,
      attachmentName,
    })),
    {
      mid: "WA-IN-second-phone",
      accountId: "phone-2",
      customerId: "66822222222",
      text: "other account",
      at: 1_700_000_060_000,
      displayName: "Bob",
      phone: "66822222222",
      attachmentName: "",
    },
  ]);
});

test("ignores WhatsApp statuses, system messages, missing metadata and the wrong object", () => {
  const validMessage = { id: "valid", from: "66811111111", timestamp: "1700000000", type: "text", text: { body: "hello" } };
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [
      { field: "message_status", value: { metadata: { phone_number_id: "phone-1" }, messages: [validMessage] } },
      { field: "messages", value: { metadata: {}, messages: [validMessage] } },
      { field: "messages", value: { messages: [validMessage] } },
      { field: "messages", value: { metadata: { phone_number_id: "phone-1" }, statuses: [{ id: "status-1", status: "read" }] } },
      {
        field: "messages",
        value: {
          metadata: { phone_number_id: "phone-1" },
          messages: [
            { ...validMessage, id: "system", type: "system" },
            { from: validMessage.from, type: "text", text: { body: "missing id" } },
            { id: "missing-from", type: "text", text: { body: "missing sender" } },
          ],
        },
      },
    ] }],
  };

  assert.deepEqual(parseWhatsAppEvents(payload), []);
  assert.deepEqual(parseWhatsAppEvents({ object: "page", entry: [] }), []);
  assert.deepEqual(parseWhatsAppEvents({ entry: [] }), []);
});

test("accepts only an exact WhatsApp HMAC-SHA256 signature for the raw body", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  const secret = "test-only-whatsapp-app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const wrongSecret = `sha256=${createHmac("sha256", "other-test-secret").update(body).digest("hex")}`;

  assert.equal(whatsappSignatureOk(body, signature, secret), true);
  assert.equal(whatsappSignatureOk(body, signature.toUpperCase(), secret), true);
  assert.equal(whatsappSignatureOk(`${body} `, signature, secret), false);
  assert.equal(whatsappSignatureOk(body, wrongSecret, secret), false);
  assert.equal(whatsappSignatureOk(body, null, secret), false);
  assert.equal(whatsappSignatureOk(body, signature, undefined), false);
  assert.equal(whatsappSignatureOk(body, signature, ""), false);

  for (const malformed of [
    "",
    "sha256=",
    `sha256=${"a".repeat(63)}`,
    `sha256=${"a".repeat(65)}`,
    `sha256=${"g".repeat(64)}`,
    `sha1=${"a".repeat(64)}`,
    `${signature}=`,
    ` ${signature}`,
  ]) assert.equal(whatsappSignatureOk(body, malformed, secret), false, malformed);
});
