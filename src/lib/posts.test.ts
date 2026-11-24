import assert from "node:assert/strict";
import { test } from "node:test";
import { postRows, type PostQuery } from "./posts";
import { emptyDataset } from "./dataset";
import { syncStep, type FetchFn } from "./fbSync";
import type { PagePost, PostComment } from "./types";

const post = (id: string, at: string, channel: PagePost["channel"] = "facebook"): PagePost => ({ id, pageId: "PG-1", channel, text: id, at });
const comment = (id: string, postId: string, at: string, repliedAt: string | null = null): PostComment => ({ id, pageId: "PG-1", postId, commenter: "A", text: "hi", at, repliedAt, repliedBy: "" });
const q: PostQuery = { start: "2026-11-01", end: "2026-11-30", pageId: "all", channel: "all" };
const ids = (rows: ReturnType<typeof postRows>, withComments?: boolean) => rows.filter((r) => withComments === undefined || (r.comments > 0) === withComments).map((r) => r.post.id);

test("posts without comments are listed alongside commented ones, for both platforms", () => {
  const ds = { posts: [post("fb-1", "2026-11-10T09:00:00"), post("fb-2", "2026-11-11T09:00:00"), post("ig-1", "2026-11-12T09:00:00", "instagram")], comments: [comment("c1", "fb-1", "2026-11-10T10:00:00")] };
  assert.deepEqual(ids(postRows(ds, q)), ["ig-1", "fb-2", "fb-1"]); // newest first
  assert.deepEqual(ids(postRows(ds, q), false), ["ig-1", "fb-2"]);
  assert.deepEqual(ids(postRows(ds, q), true), ["fb-1"]);
  assert.deepEqual(ids(postRows(ds, { ...q, channel: "instagram" })), ["ig-1"]);
});

test("comment tally counts unreplied comments, and a comment outside the date range still marks the post as commented", () => {
  const ds = { posts: [post("fb-1", "2026-11-10T09:00:00")], comments: [comment("c1", "fb-1", "2026-11-10T10:00:00", "2026-11-10T10:05:00"), comment("c2", "fb-1", "2026-10-01T10:00:00")] };
  const [row] = postRows(ds, q);
  assert.equal(row.comments, 2);
  assert.equal(row.unreplied, 1);
  assert.deepEqual(ids(postRows(ds, q), false), []); // the October comment must not make it look uncommented
});

test("a post known only from its comments is listed with the platform read from its link; old posts need an in-range comment", () => {
  const ds = { posts: [post("old", "2026-09-01T09:00:00")], comments: [comment("c1", "https://www.instagram.com/p/abc/", "2026-11-05T10:00:00"), comment("c2", "https://www.facebook.com/x/posts/1", "2026-09-02T10:00:00")] };
  const rows = postRows(ds, q);
  assert.deepEqual(rows.map((r) => [r.post.id, r.post.channel]), [["https://www.instagram.com/p/abc/", "instagram"]]);
});

// --- the sync must save every feed post, not only the ones with comments ---
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const input = { sheetPageId: "PG-1", days: 7, ds: emptyDataset(), tz: "Asia/Bangkok", now: new Date("2026-11-24T08:00:00Z") };

test("Facebook sync writes a posts row for a post that has no comments", async () => {
  const fetchFn: FetchFn = async (url) => {
    if (/\/me\?/.test(url)) return reply({ id: "P1", name: "Shop", category: "Shopping" });
    if (/\/P1\/feed\?/.test(url)) return reply({ data: [
      { id: "P1_A", permalink_url: "https://www.facebook.com/P1/posts/A", created_time: "2026-11-23T03:00:00+0000", message: "สวัสดี\nชาว  FB", comments: { summary: { total_count: 1 } } },
      { id: "P1_B", permalink_url: "https://www.facebook.com/P1/posts/B", created_time: "2026-11-22T03:00:00+0000", comments: { summary: { total_count: 0 } } },
    ] });
    if (/\/P1_A\/comments\?/.test(url)) return reply({ data: [{ id: "c1", from: { id: "U1", name: "Mali" }, message: "ราคา?", created_time: "2026-11-23T04:00:00+0000" }] });
    throw new Error(`unexpected ${url}`);
  };
  const out = await syncStep({ ...input, cfg: { fbPageId: "P1", token: "t" }, state: { phase: "comments" }, fetchFn });
  const posts = out.writes.find((w) => w.tab === "posts");
  assert.deepEqual(posts?.rows.map((r) => [r.post_id, r.channel, r.text, r.posted_at]), [
    ["https://www.facebook.com/P1/posts/A", "facebook", "สวัสดี ชาว FB", "2026-11-23 10:00"],
    ["https://www.facebook.com/P1/posts/B", "facebook", "", "2026-11-22 10:00"],
  ]);
  // the comment row points at the same key the post row uses, so the page can join them
  assert.equal(out.writes.find((w) => w.tab === "post_comments")?.rows[0].post_id, "https://www.facebook.com/P1/posts/A");
});

test("Instagram sync writes a posts row for media that has no comments", async () => {
  const fetchFn: FetchFn = async (url) => {
    if (/\/me\?/.test(url)) return reply({ id: "P1", name: "Shop", category: "Shopping" });
    if (/\/IG1\/media\?/.test(url)) return reply({ data: [{ id: "m1", permalink: "https://www.instagram.com/p/m1/", comments_count: 0, timestamp: "2026-11-23T03:00:00+0000", caption: "new in" }] });
    throw new Error(`unexpected ${url}`);
  };
  const out = await syncStep({ ...input, channel: "instagram", igId: "IG1", cfg: { fbPageId: "P1", token: "t" }, state: { phase: "comments" }, fetchFn });
  assert.deepEqual(out.writes.find((w) => w.tab === "posts")?.rows.map((r) => [r.post_id, r.channel, r.text]), [["https://www.instagram.com/p/m1/", "instagram", "new in"]]);
});
