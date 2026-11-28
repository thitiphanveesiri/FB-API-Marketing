import assert from "node:assert/strict";
import { test } from "node:test";
import { prompt, redact, rewrite } from "./chatAi";

const names = { ads: ["Summer Video"], pages: ["Hair Page"], reps: ["Somchai"] };
const reply = (text: string, ok = true) => (async () => ({ ok, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })) as unknown as typeof fetch;

test("phone numbers and emails never leave the server", () => {
  assert.equal(redact("ลีด 081-234-5678 a.b@x.com แอดไหนดี"), "ลีด แอดไหนดี");
});

test("the prompt lists business names only", () => {
  const p = prompt(names);
  assert.match(p, /Summer Video/); assert.match(p, /Somchai/); assert.match(p, /NONE/);
});

test("rewrite returns the model's sentence, and null for NONE, errors and empty questions", async () => {
  assert.equal(await rewrite("แอดหน้าร้อนเป็นไง", names, "k", reply("แอด Summer Video 7 วัน")), "แอด Summer Video 7 วัน");
  assert.equal(await rewrite("ดวงวันนี้", names, "k", reply("NONE")), null);
  assert.equal(await rewrite("x", names, "k", reply("เสีย", false)), null);
  assert.equal(await rewrite("   ", names, "k", reply("ไม่ถูกเรียก")), null);
});
