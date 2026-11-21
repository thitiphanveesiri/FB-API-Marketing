import assert from "node:assert/strict";
import { test } from "node:test";
import { creativeRef, resolveCreativeLinks } from "./adsSync";
import type { FetchFn } from "./fbSync";
import { metaApiVersion } from "./metaApi";

type BatchOperation = { method: string; relative_url: string };
const token = "test-access-token";
const pageToken = "test-page-access-token";
const image = (id: string) => `https://images.example.test/${id}.jpg`;
const readOperations = (body?: string, expectedToken = token): BatchOperation[] => {
  const params = new URLSearchParams(body ?? "");
  assert.equal(params.get("access_token"), expectedToken, "the top-level batch token is required");
  const parsed = JSON.parse(params.get("batch") ?? "[]") as BatchOperation[];
  assert.ok(parsed.every((operation) => operation.method === "GET"));
  return parsed;
};

test("Graph API defaults to v27.0 when META_API_VERSION is unset", () => {
  const previous = process.env.META_API_VERSION;
  delete process.env.META_API_VERSION;
  try { assert.equal(metaApiVersion(), "v27.0"); }
  finally { if (previous === undefined) delete process.env.META_API_VERSION; else process.env.META_API_VERSION = previous; }
});

test("video-only creative references preserve the source Page ID", () => {
  const ref = creativeRef({ id: "ad-video", creative: { video_id: "video-1", object_story_spec: { page_id: "12345" } } });
  assert.match(ref, /(?:^|,)p:12345(?:,|$)/);
});

test("Page post lookups use the source Page token in Graph Batch POSTs of no more than 50", async () => {
  const sizes: number[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    assert.match(url, /\/v\d+\.\d+$/);
    assert.equal(init?.method, "POST");
    assert.match(init?.headers?.["Content-Type"] ?? "", /application\/x-www-form-urlencoded/);
    assert.equal(init?.headers?.Authorization, `Bearer ${pageToken}`);
    const operations = readOperations(init?.body, pageToken);
    assert.equal(url.includes("?ids="), false);
    sizes.push(operations.length);
    return {
      ok: true,
      status: 200,
      json: async () => operations.map((operation) => {
        const id = decodeURIComponent(operation.relative_url.split("?", 1)[0]);
        return { code: 200, body: JSON.stringify({ full_picture: image(id) }) };
      }),
    };
  };
  const ads = Array.from({ length: 51 }, (_, index) => ({ adId: `ad-${index}`, ref: `s:12345_${index}` }));
  const result = await resolveCreativeLinks(ads, token, fetchFn, "https://graph.facebook.com", undefined, { "12345": pageToken });
  assert.deepEqual(sizes, [50, 1]);
  assert.equal(Object.keys(result).length, 51);
  assert.equal(result["ad-50"].url, image("12345_50"));
});

test("a failed Page post subrequest retries only that ID with lighter fields and the Page token", async () => {
  const sizes: number[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    assert.equal(init?.headers?.Authorization, `Bearer ${pageToken}`);
    const operations = readOperations(init?.body, pageToken);
    sizes.push(operations.length);
    const response = (id: string) => ({ code: 200, body: JSON.stringify({ full_picture: image(id) }) });
    if (sizes.length === 1) {
      const successfulId = decodeURIComponent(operations[1].relative_url.split("?", 1)[0]);
      return {
        ok: true,
        status: 200,
        json: async () => [
          { code: 400, body: JSON.stringify({ error: { message: "unsupported field", code: 100 } }) },
          response(successfulId),
        ],
      };
    }
    const retriedId = decodeURIComponent(operations[0].relative_url.split("?", 1)[0]);
    return { ok: true, status: 200, json: async () => [response(retriedId)] };
  };
  const result = await resolveCreativeLinks([
    { adId: "ad-1", ref: "s:12345_1" },
    { adId: "ad-2", ref: "s:12345_2" },
  ], token, fetchFn, "https://graph.facebook.com", undefined, { "12345": pageToken });
  assert.deepEqual(sizes, [2, 1]);
  assert.equal(result["ad-1"].url, image("12345_1"));
  assert.equal(result["ad-2"].url, image("12345_2"));
});

test("Page video-cover lookup uses the source Page token", async () => {
  const requested: string[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    assert.equal(init?.headers?.Authorization, `Bearer ${pageToken}`);
    const operations = readOperations(init?.body, pageToken);
    requested.push(...operations.map((operation) => decodeURIComponent(operation.relative_url.split("?", 1)[0])));
    return {
      ok: true,
      status: 200,
      json: async () => operations.map((operation) => {
        const id = decodeURIComponent(operation.relative_url.split("?", 1)[0]);
        return { code: 200, body: JSON.stringify(id === "video-1" ? { picture: image("video-cover") } : { full_picture: image("source-post") }) };
      }),
    };
  };
  const result = await resolveCreativeLinks([
    { adId: "ad-video", ref: "p:12345,v:video-1" },
  ], token, fetchFn, "https://graph.facebook.com", undefined, { "12345": pageToken });
  assert.deepEqual(requested, ["video-1"]);
  assert.equal(result["ad-video"].url, image("video-cover"));
});

test("without a connected Page token, story lookup is skipped and the ad creative URL is retained", async () => {
  const requested: string[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    const operations = readOperations(init?.body);
    requested.push(...operations.map((operation) => decodeURIComponent(operation.relative_url.split("?", 1)[0])));
    return {
      ok: true,
      status: 200,
      json: async () => operations.map(() => ({
        code: 200,
        body: JSON.stringify({ creative: { asset_feed_spec: { images: [{ url: image("from-creative") }] } } }),
      })),
    };
  };
  const result = await resolveCreativeLinks([
    { adId: "ad-1", ref: "s:12345_1" },
  ], token, fetchFn, "https://graph.facebook.com");
  assert.deepEqual(requested, ["ad-1"]);
  assert.equal(result["ad-1"].url, image("from-creative"));
});
