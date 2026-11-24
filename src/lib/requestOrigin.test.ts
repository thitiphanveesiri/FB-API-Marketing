import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameOrigin } from "./requestOrigin";

const request = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });

test("origin check accepts the request URL, host alias and configured public URL", () => {
  assert.equal(isSameOrigin(request("http://localhost:3000/api/mutate", { origin: "http://localhost:3000" })), true);
  assert.equal(isSameOrigin(request("http://localhost:3000/api/mutate", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" })), true);
  assert.equal(isSameOrigin(request("http://internal:3000/api/mutate", {
    origin: "https://dashboard.example.com",
    "x-forwarded-host": "dashboard.example.com",
    "x-forwarded-proto": "https",
  }), "https://dashboard.example.com"), true);
  assert.equal(isSameOrigin(request("http://internal:3000/api/mutate", { origin: "https://dashboard.example.com" }), "https://dashboard.example.com"), true);
});

test("origin check accepts non-browser requests but rejects cross-site and malformed origins", () => {
  assert.equal(isSameOrigin(request("http://localhost:3000/api/mutate", {})), true);
  assert.equal(isSameOrigin(request("http://localhost:3000/api/mutate", { origin: "https://evil.example", host: "localhost:3000" })), false);
  assert.equal(isSameOrigin(request("http://localhost:3000/api/mutate", { origin: "not a url", host: "localhost:3000" })), false);
  assert.equal(isSameOrigin(request("http://localhost:3000/api/mutate", { origin: "file:///tmp/test", host: "localhost:3000" })), false);
});
