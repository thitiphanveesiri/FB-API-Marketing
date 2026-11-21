import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCreativeLinks } from "./adsSync";
import type { FetchFn } from "./fbSync";
import { metaApiVersion } from "./metaApi";

type BatchOperation = { method: string; relative_url: string };
const token = "test-access-token";
const image = (id: string) => `https://images.example.test/${id}.jpg`;
const readOperations = (body?: string): BatchOperation[] => {
  const params = new URLSearchParams(body ?? "");
  assert.equal(params.get("access_token"), token, "the top-level batch token is required");
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

test("creative image lookup uses Graph Batch POSTs in chunks of no more than 50", async () => {
  const sizes: number[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    assert.match(url, /\/v\d+\.\d+$/);
    assert.equal(init?.method, "POST");
    assert.match(init?.headers?.["Content-Type"] ?? "", /application\/x-www-form-urlencoded/);
    const operations = readOperations(init?.body);
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
  const ads = Array.from({ length: 51 }, (_, index) => ({ adId: `ad-${index}`, ref: `s:page_${index}` }));
  const result = await resolveCreativeLinks(ads, token, fetchFn, "https://graph.facebook.com");
  assert.deepEqual(sizes, [50, 1]);
  assert.equal(Object.keys(result).length, 51);
  assert.equal(result["ad-50"].url, image("page_50"));
});

test("a failed batch subrequest retries only that ID with lighter fields", async () => {
  const sizes: number[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    const operations = readOperations(init?.body);
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
    { adId: "ad-1", ref: "s:page_1" },
    { adId: "ad-2", ref: "s:page_2" },
  ], token, fetchFn, "https://graph.facebook.com");
  assert.deepEqual(sizes, [2, 1]);
  assert.equal(result["ad-1"].url, image("page_1"));
  assert.equal(result["ad-2"].url, image("page_2"));
});
