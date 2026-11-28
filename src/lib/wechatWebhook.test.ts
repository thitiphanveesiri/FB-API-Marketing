import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildExternalWrites, externalRecipientOf } from "./externalWebhook";
import { emptyDataset } from "./dataset";
import { sendWeChatText } from "./externalSend";
import { parseWeChatEvents, wechatSignatureOk, xmlField } from "./wechatWebhook";

const sign = (token: string, ts: string, nonce: string) => createHash("sha1").update([token, ts, nonce].sort().join("")).digest("hex");
const OPENID = "oABCDEFGHIJKLMNOPQRSTUVWXYZ1";
const xml = (type: string, body: string) => `<xml><ToUserName><![CDATA[gh_abc]]></ToUserName><FromUserName><![CDATA[${OPENID}]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[${type}]]></MsgType>${body}<MsgId>123456</MsgId></xml>`;

test("the WeChat signature is sha1 of the sorted token, timestamp and nonce", () => {
  const sig = sign("tok123", "1700000000", "n0nce");
  assert.ok(wechatSignatureOk("tok123", "1700000000", "n0nce", sig));
  assert.ok(wechatSignatureOk("tok123", "1700000000", "n0nce", sig.toUpperCase()));
  assert.ok(!wechatSignatureOk("other", "1700000000", "n0nce", sig));
  assert.ok(!wechatSignatureOk("tok123", "1700000000", "n0nce", ""));
});

test("a text message becomes one chat message, with a stable id so a WeChat retry makes no second one", () => {
  const e = parseWeChatEvents(xml("text", "<Content><![CDATA[สวัสดี ราคาเท่าไหร่]]></Content>"));
  assert.deepEqual(e, [{ customerId: OPENID, mid: "WC-IN-123456", text: "สวัสดี ราคาเท่าไหร่", at: 1700000000000 }]);
  assert.equal(xmlField("<a>x</a>", "a"), "x");
});

test("a picture shows as a picture note; follow/unfollow events are ignored", () => {
  assert.equal(parseWeChatEvents(xml("image", "<PicUrl><![CDATA[https://x]]></PicUrl>"))[0].text, "[รูปภาพ]");
  assert.deepEqual(parseWeChatEvents(xml("event", "<Event><![CDATA[subscribe]]></Event>")), []);
});

test("a WeChat message makes a WC- lead on the chosen page, and the OpenID can be read back for the reply", () => {
  const w = buildExternalWrites(parseWeChatEvents(xml("text", "<Content>hi</Content>")).map((e) => ({ ...e, accountId: "wx0123456789abcdef" })), { channel: "wechat", sheetPageId: "P1", dataset: { ...emptyDataset(), pages: [{ id: "P1", name: "Page", active: true, agencyId: null, teamIds: [] }] }, timezone: "Asia/Bangkok" });
  assert.equal(w.newLeads.length, 1);
  const id = String(w.newLeads[0].lead_id);
  assert.match(id, /^WC-wx0123456789abcdef-/);
  assert.equal(externalRecipientOf(id, "wechat", "wx0123456789abcdef"), OPENID);
});

const wc = (calls: string[], send: object) => (async (url: string) => {
  calls.push(url.includes("/token?") ? "token" : "send");
  return { ok: true, status: 200, json: async () => (url.includes("/token?") ? { access_token: "AT", expires_in: 7200 } : send) };
}) as unknown as typeof fetch;

test("sending asks for a token once, then posts the text; the 48-hour error is readable", async () => {
  const calls: string[] = [];
  assert.match(await sendWeChatText({ accountId: "wxA", accessToken: "secretA" }, OPENID, "hi", wc(calls, { errcode: 0 })), /^WC-OUT-/);
  assert.deepEqual(calls, ["token", "send"]);
  await sendWeChatText({ accountId: "wxA", accessToken: "secretA" }, OPENID, "hi again", wc(calls, { errcode: 0 }));
  assert.deepEqual(calls, ["token", "send", "send"]); // token cached
  await assert.rejects(sendWeChatText({ accountId: "wxA", accessToken: "secretA" }, OPENID, "x", wc([], { errcode: 45015, errmsg: "response out of time limit" })), /48 ชั่วโมง/);
});
