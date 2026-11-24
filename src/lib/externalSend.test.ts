import assert from "node:assert/strict";
import { test } from "node:test";
import { sendLineText, sendWhatsAppText } from "./externalSend";
import { SendError } from "./fbSend";

test("sends LINE and WhatsApp text through their provider APIs", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.FB_GRAPH_BASE;
  const calls: { url: string; init?: RequestInit }[] = [];
  try {
    process.env.FB_GRAPH_BASE = "https://graph.test";
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({});
    };

    const lineToken = "test_line_token_1234567890abcdef";
    const lineMessageId = await sendLineText({ accessToken: lineToken }, "Uabcde", "hello LINE");
    assert.match(lineMessageId, /^LINE-OUT-[a-f0-9-]{36}$/);
    const lineCall = calls.at(-1)!;
    assert.equal(lineCall.url, "https://api.line.me/v2/bot/message/push");
    assert.equal(new Headers(lineCall.init?.headers).get("authorization"), `Bearer ${lineToken}`);
    assert.deepEqual(JSON.parse(String(lineCall.init?.body)), {
      to: "Uabcde",
      messages: [{ type: "text", text: "hello LINE" }],
    });

    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ messages: [{ id: "wamid.outbound-1" }] });
    };
    const whatsappToken = "test_whatsapp_token_1234567890abcdef";
    assert.equal(await sendWhatsAppText({ accountId: "2099999999", accessToken: whatsappToken }, "66811111111", "hello WhatsApp"), "wamid.outbound-1");
    const whatsappCall = calls.at(-1)!;
    assert.match(whatsappCall.url, /\/2099999999\/messages$/);
    assert.equal(new Headers(whatsappCall.init?.headers).get("authorization"), `Bearer ${whatsappToken}`);
    assert.deepEqual(JSON.parse(String(whatsappCall.init?.body)), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "66811111111",
      type: "text",
      text: { preview_url: false, body: "hello WhatsApp" },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.FB_GRAPH_BASE;
    else process.env.FB_GRAPH_BASE = originalBase;
  }
});

test("does not expose the stored LINE token in provider errors", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const token = "test_line_token_1234567890abcdef";
  try {
    globalThis.fetch = async () => Response.json({ message: `Invalid token ${token}` }, { status: 401 });
    await assert.rejects(sendLineText({ accessToken: token }, "Uabcde", "hello"), (error: unknown) => {
      assert.ok(error instanceof SendError);
      assert.equal(error.status, 502);
      assert.equal(error.message.includes(token), false);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps WhatsApp token, service-window and recipient errors without leaking credentials", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const token = "test_whatsapp_token_1234567890abcdef";
  const channel = { accountId: "2099999999", accessToken: token };
  try {
    globalThis.fetch = async () => Response.json({ error: { code: 190, message: `Invalid token ${token}` } }, { status: 401 });
    await assert.rejects(sendWhatsAppText(channel, "66811111111", "hello"), (error: unknown) => {
      assert.ok(error instanceof SendError);
      assert.equal(error.status, 502);
      assert.equal(error.message.includes(token), false);
      return true;
    });

    globalThis.fetch = async () => Response.json({ error: { code: 131047, message: "outside 24 hour window" } }, { status: 400 });
    await assert.rejects(sendWhatsAppText(channel, "66811111111", "hello"), (error: unknown) => {
      assert.ok(error instanceof SendError);
      assert.equal(error.status, 400);
      assert.match(error.message, /24 ชั่วโมง/);
      return true;
    });

    globalThis.fetch = async () => Response.json({ error: { code: 131026, message: "recipient is not valid" } }, { status: 400 });
    await assert.rejects(sendWhatsAppText(channel, "66811111111", "hello"), (error: unknown) => {
      assert.ok(error instanceof SendError);
      assert.equal(error.status, 400);
      assert.match(error.message, /รับข้อความ WhatsApp ไม่ได้/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
