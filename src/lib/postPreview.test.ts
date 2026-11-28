import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPostPreview } from "./postPreview";

const fake = (body: object | null, ok = true, seen: { url?: string } = {}) => (async (url: string) => { seen.url = url; return { ok, json: async () => body }; }) as unknown as typeof fetch;
const o = { graphId: "1_2", token: "t", base: "https://g.test" };

test("a Facebook video post gives the video, its thumbnail and caption", async () => {
  const seen: { url?: string } = {};
  const p = await fetchPostPreview({ ...o, channel: "facebook" }, fake({ full_picture: "https://i/p.jpg", message: "hi", permalink_url: "https://fb/p", attachments: { data: [{ media_type: "video", media: { source: "https://v/a.mp4" } }] } }, true, seen));
  assert.deepEqual(p, { type: "video", image: "https://i/p.jpg", video: "https://v/a.mp4", text: "hi", link: "https://fb/p" });
  assert.match(seen.url!, /\/1_2\?/);
});

test("an Instagram reel uses the thumbnail as the picture; a photo uses media_url", async () => {
  const reel = await fetchPostPreview({ ...o, channel: "instagram" }, fake({ media_type: "VIDEO", media_url: "https://v/r.mp4", thumbnail_url: "https://i/t.jpg", caption: "c", permalink: "https://ig/r" }));
  assert.equal(reel?.video, "https://v/r.mp4"); assert.equal(reel?.image, "https://i/t.jpg");
  const photo = await fetchPostPreview({ ...o, channel: "instagram" }, fake({ media_type: "IMAGE", media_url: "https://i/p.jpg" }));
  assert.equal(photo?.type, "photo"); assert.equal(photo?.video, "");
});

test("a post Meta will not show gives null", async () => {
  assert.equal(await fetchPostPreview({ ...o, channel: "facebook" }, fake({ error: {} }, false)), null);
});
