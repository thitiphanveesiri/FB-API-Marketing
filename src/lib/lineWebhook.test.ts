import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLineEvents } from "./lineWebhook";

test("parses direct LINE text and file attachments with account-scoped IDs", () => {
  const events = parseLineEvents({
    events: [
      {
        type: "message",
        timestamp: 0,
        source: { type: "user", userId: "Uabcde" },
        message: { id: "line-text-1", type: "text", text: "hello" },
      },
      {
        type: "message",
        timestamp: 1_700_000_000_000,
        source: { type: "user", userId: "Uabcde" },
        message: { id: "line-file-1", type: "file", fileName: "quote.pdf" },
      },
    ],
  }, "line-account");

  assert.deepEqual(events, [
    {
      accountId: "line-account",
      customerId: "Uabcde",
      mid: "LINE-IN-line-text-1",
      text: "hello",
      at: 0,
      attachmentName: "",
    },
    {
      accountId: "line-account",
      customerId: "Uabcde",
      mid: "LINE-IN-line-file-1",
      text: "[ไฟล์แนบ]",
      at: 1_700_000_000_000,
      attachmentName: "quote.pdf",
    },
  ]);
});

test("normalizes LINE attachment placeholders and caps message text", () => {
  const attachments = [
    { type: "image", text: "[รูปภาพ]" },
    { type: "video", text: "[วิดีโอ]" },
    { type: "audio", text: "[เสียง]" },
    { type: "file", text: "[ไฟล์แนบ]" },
    { type: "sticker", text: "[สติ๊กเกอร์]" },
    { type: "location", text: "[ตำแหน่ง]" },
    { type: "unsupported", text: "[ข้อความแบบไม่รองรับ]" },
  ];
  const events = parseLineEvents({
    events: [
      ...attachments.map(({ type }, index) => ({
        type: "message",
        timestamp: index,
        source: { type: "user", userId: "Uabcde" },
        message: { id: `attachment-${type}`, type },
      })),
      {
        type: "message",
        timestamp: 100,
        source: { type: "user", userId: "Uabcde" },
        message: { id: "long-text", type: "text", text: "x".repeat(2_001) },
      },
    ],
  }, "line-account");

  assert.deepEqual(events.slice(0, attachments.length).map(({ text }) => text), attachments.map(({ text }) => text));
  assert.equal(events.at(-1)?.text.length, 2_000);
});

test("ignores non-user and incomplete LINE message events", () => {
  const message = { id: "ignored", type: "text", text: "hello" };
  const events = parseLineEvents({
    events: [
      { type: "follow", source: { type: "user", userId: "Uabcde" }, message },
      { type: "message", source: { type: "group", groupId: "group-1" }, message },
      { type: "message", source: { type: "room", roomId: "room-1" }, message },
      { type: "message", source: { type: "user" }, message },
      { type: "message", source: { type: "user", userId: "" }, message },
      { type: "message", source: { type: "user", userId: "Uabcde" } },
      { type: "message", source: { type: "user", userId: "Uabcde" }, message: { type: "text", text: "missing id" } },
      { type: "message", source: { type: "user", userId: "Uabcde" }, message: { id: "empty", type: "text" } },
      { source: { type: "user", userId: "Uabcde" }, message },
      {},
    ],
  }, "line-account");

  assert.deepEqual(events, []);
});
