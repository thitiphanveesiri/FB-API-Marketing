import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { shapeOf, tiktokSignatureOk } from "./tiktokWebhook";

const NOW = 1_700_000_000_000, body = '{"event":"x","content":"{}"}';
const header = (t: number, secret: string, b = body) => `t=${t},s=${createHmac("sha256", secret).update(`${t}.${b}`).digest("hex")}`;

test("TikTok signature: right secret passes; wrong secret, edited body and old timestamps fail", () => {
  assert.ok(tiktokSignatureOk(body, header(NOW / 1000, "sec"), "sec", NOW));
  assert.ok(!tiktokSignatureOk(body, header(NOW / 1000, "sec"), "other", NOW));
  assert.ok(!tiktokSignatureOk(body + " ", header(NOW / 1000, "sec"), "sec", NOW));
  assert.ok(!tiktokSignatureOk(body, header(NOW / 1000 - 3600, "sec"), "sec", NOW));
  assert.ok(!tiktokSignatureOk(body, "", "sec", NOW));
});

test("the logged shape has field names and types but no values", () => {
  assert.deepEqual(shapeOf({ a: "secret text", b: { c: 5 }, d: [{ e: true }] }), { a: "string", b: { c: "number" }, d: [{ e: "boolean" }] });
});
