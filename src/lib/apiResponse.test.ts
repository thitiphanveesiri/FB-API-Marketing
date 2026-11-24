import assert from "node:assert/strict";
import { test } from "node:test";
import { apiErrorMessage, readMutationResult } from "./apiResponse";

test("mutation result keeps the server message", async () => {
  const result = await readMutationResult(Response.json({ ok: false, message: "This account has no access." }, { status: 403 }));
  assert.deepEqual(result, { ok: false, message: "This account has no access." });
});

test("mutation result replaces HTML and empty errors with actionable messages", async () => {
  const html = await readMutationResult(new Response("<html>Proxy error</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
  assert.equal(html.ok, false);
  assert.match(html.message, /HTTP 502/);

  const empty = await readMutationResult(new Response(null, { status: 403 }));
  assert.deepEqual(empty, { ok: false, message: apiErrorMessage(null, new Response(null, { status: 403 }), "บันทึกไม่สำเร็จ") });
  assert.doesNotMatch(empty.message, /unknown error/i);
});

test("mutation result accepts a successful JSON response", async () => {
  assert.deepEqual(await readMutationResult(Response.json({ ok: true, results: [] })), { ok: true });
});
