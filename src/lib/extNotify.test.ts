import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { lineSignatureOk, noteText, extConfigured } from "./extNotify";

test("LINE signature: valid HMAC passes, wrong/missing/other-body fails", () => {
  const body = '{"events":[]}', secret = "s3cret", sig = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(lineSignatureOk(body, sig, secret), true);
  assert.equal(lineSignatureOk(body + " ", sig, secret), false);
  assert.equal(lineSignatureOk(body, "AAAA", secret), false);
  assert.equal(lineSignatureOk(body, null, secret), false);
  assert.equal(lineSignatureOk(body, sig, ""), false);
});

test("channels are off without env vars", () => {
  for (const k of ["LINE_CHANNEL_ACCESS_TOKEN", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME"]) delete process.env[k];
  assert.equal(extConfigured(), false);
});

test("message text carries title, body and an absolute link", () => {
  process.env.APP_URL = "https://example.test/";
  assert.equal(noteText({ title: "ตอบ A", body: "รอ 5 นาที", url: "/inbox" }), "ตอบ A\nรอ 5 นาที\nhttps://example.test/inbox");
});
