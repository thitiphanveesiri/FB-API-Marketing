import assert from "node:assert/strict";
import { test } from "node:test";
import { runMetaPageTokenCheck } from "./check-meta-page-token.mjs";

test("token diagnostic checks granted scopes, Page tasks, account, and story without exposing tokens", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const output = [];
  const calls = [];
  const userToken = "test-user-token-secret";
  const pageToken = "test-page-token-secret";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    const authorization = init?.headers?.Authorization;
    calls.push({ path: url.pathname, authorization, hasQueryToken: url.searchParams.has("access_token") });
    let payload;
    if (url.pathname.endsWith("/me")) payload = { id: "user-1", name: "Test User" };
    else if (url.pathname.endsWith("/me/permissions")) payload = { data: [
      { permission: "ads_read", status: "granted" },
      { permission: "pages_show_list", status: "granted" },
      { permission: "pages_read_engagement", status: "declined" },
    ] };
    else if (url.pathname.endsWith("/me/accounts")) payload = { data: [{ id: "12345", name: "Test Page", tasks: ["MODERATE", "ADVERTISE"], access_token: pageToken }] };
    else if (url.pathname.endsWith("/act_98765")) payload = { id: "act_98765", name: "Test Ad Account", account_status: 1, currency: "THB" };
    else if (url.pathname.endsWith("/12345_67890")) payload = { id: "12345_67890", full_picture: "https://example.test/picture.jpg", message: "private post text", attachments: { data: [] } };
    else throw new Error(`Unexpected mocked path: ${url.pathname}`);
    return { ok: true, status: 200, json: async () => payload };
  };
  console.log = (...args) => output.push(args.join(" "));
  console.warn = (...args) => output.push(args.join(" "));
  try {
    const result = await runMetaPageTokenCheck({
      META_USER_ACCESS_TOKEN: userToken,
      FB_PAGE_ID: "12345",
      META_TEST_AD_ACCOUNT_ID: "act_98765",
      META_TEST_STORY_ID: "12345_67890",
      META_API_VERSION: "v27.0",
      FB_GRAPH_BASE: "https://graph.facebook.com",
    });
    assert.equal(result.userId, "user-1");
    assert.equal(result.visiblePageCount, 1);
    assert.equal(calls.length, 5);
    assert.ok(calls.every((call) => !call.hasQueryToken), "tokens must not be placed in the URL");
    assert.equal(calls.find((call) => call.path.endsWith("/12345_67890"))?.authorization, `Bearer ${pageToken}`);
    assert.ok(calls.filter((call) => !call.path.endsWith("/12345_67890")).every((call) => call.authorization === `Bearer ${userToken}`));
    assert.ok(output.some((line) => line.includes("Permission pages_show_list: granted")));
    assert.ok(output.some((line) => line.includes("Permission pages_read_engagement: declined")));
    assert.ok(output.some((line) => line.includes("tasks=MODERATE, ADVERTISE")));
    assert.ok(output.some((line) => line.includes("Ad Account lookup: PASS")));
    assert.ok(output.some((line) => line.includes("Page story lookup: PASS")));
    assert.ok(!output.join("\n").includes(userToken));
    assert.ok(!output.join("\n").includes(pageToken));
    assert.ok(!output.join("\n").includes("private post text"));
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.warn = originalWarn;
  }
});
