import assert from "node:assert/strict";
import { test } from "node:test";
import { sendCommentReply } from "./commentSend";

const fake = (status: number, body: object, seen: { url?: string; body?: string } = {}) => (async (url: string, init: RequestInit) => {
  seen.url = url; seen.body = String(init.body);
  return { ok: status < 400, status, json: async () => body };
}) as unknown as typeof fetch;
const base = { commentId: "123_456", token: "EAAsecretsecretsecretsecretsecret", text: "สวัสดีค่ะ", base: "https://g.test" };

test("Facebook replies go to /comments and Instagram replies to /replies", async () => {
  const a: { url?: string; body?: string } = {}, b: { url?: string } = {};
  assert.equal(await sendCommentReply({ ...base, channel: "facebook" }, fake(200, { id: "n1" }, a)), "n1");
  assert.match(a.url!, /\/123_456\/comments\?/); assert.equal(a.body, JSON.stringify({ message: "สวัสดีค่ะ" }));
  await sendCommentReply({ ...base, channel: "instagram" }, fake(200, { id: "n2" }, b));
  assert.match(b.url!, /\/123_456\/replies\?/);
});

test("Meta errors become readable messages and never show the token", async () => {
  await assert.rejects(sendCommentReply({ ...base, channel: "facebook" }, fake(400, { error: { code: 200, message: "no EAAsecretsecretsecretsecretsecret" } })), (e: Error) => /pages_manage_engagement/.test(e.message) && !/EAAsecret/.test(e.message));
  await assert.rejects(sendCommentReply({ ...base, channel: "instagram" }, fake(400, { error: { code: 10, message: "x" } })), /instagram_manage_comments/);
  await assert.rejects(sendCommentReply({ ...base, channel: "facebook" }, fake(400, { error: { code: 190, message: "x" } })), /หมดอายุ/);
  await assert.rejects(sendCommentReply({ ...base, channel: "facebook" }, fake(400, { error: { code: 100, message: "x" } })), /ถูกลบ/);
});
