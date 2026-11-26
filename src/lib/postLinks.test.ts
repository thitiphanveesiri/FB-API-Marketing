import assert from "node:assert/strict";
import { test } from "node:test";
import { postLink } from "./postLinks";

test("post links accept stored IDs and safe Facebook or Instagram HTTPS URLs", () => {
  assert.deepEqual(postLink("123_456"), { href: "https://www.facebook.com/123_456", site: "Facebook" });
  assert.deepEqual(postLink(" https://www.facebook.com/123/posts/456?comment_id=789 "), {
    href: "https://www.facebook.com/123/posts/456?comment_id=789", site: "Facebook",
  });
  assert.deepEqual(postLink("https://www.instagram.com/p/ABC/"), { href: "https://www.instagram.com/p/ABC/", site: "Instagram" });
});

test("post links reject unsafe schemes, hosts, credentials, ports and malformed values", () => {
  for (const value of [
    "", "javascript:alert(1)", "http://facebook.com/123", "//facebook.com/123",
    "https://facebook.com.evil.test/123", "https://evil.test/123",
    "https://user:pass@facebook.com/123", "https://facebook.com:444/123",
    "https://[invalid", "123/456",
  ]) assert.equal(postLink(value), null, value);
});
