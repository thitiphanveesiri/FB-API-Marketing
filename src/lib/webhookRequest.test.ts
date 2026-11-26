import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedText } from "./webhookRequest";

const requestWith = (body: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) =>
  ({ headers: new Headers(headers), body }) as Request;

test("declared oversized webhook bodies are rejected before the stream is read", async () => {
  let reads = 0;
  const body = {
    getReader() {
      reads++;
      throw new Error("body must not be read");
    },
  } as unknown as ReadableStream<Uint8Array>;
  const result = await readBoundedText(requestWith(body, { "content-length": "1000001" }));
  assert.deepEqual(result, { ok: false, status: 413 });
  assert.equal(reads, 0);
});

test("a false Content-Length cannot bypass the bounded webhook stream", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("1234"));
      controller.enqueue(encoder.encode("5678"));
    },
    cancel() { cancelled = true; },
  });
  const result = await readBoundedText(requestWith(body, { "content-length": "1" }), 7);
  assert.deepEqual(result, { ok: false, status: 413 });
  assert.equal(cancelled, true);
});

test("bounded webhook reads accept the exact byte limit and preserve UTF-8", async () => {
  const text = "สวัสดี";
  const bytes = new TextEncoder().encode(text).byteLength;
  const result = await readBoundedText(requestWith(new Response(text).body), bytes);
  assert.deepEqual(result, { ok: true, text });
});
