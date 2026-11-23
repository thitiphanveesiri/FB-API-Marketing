import assert from "node:assert/strict";
import { test } from "node:test";
import { isVideoFile, moveVideoOutOfPicture } from "./adsSync";

test("isVideoFile: video files yes, pictures no", () => {
  assert.equal(isVideoFile("https://x.cdninstagram.com/v/t50/a.mp4?_nc=1"), true);
  assert.equal(isVideoFile("https://x.fbcdn.net/a.jpg?oe=1"), false);
  assert.equal(isVideoFile(undefined), false);
});

test("moveVideoOutOfPicture: .mp4 goes to video_url and the picture is cleared so a cover can replace it", () => {
  const row = { creative_url: "https://x.cdninstagram.com/a.mp4?x=1", video_url: "", creative_type: "Image" };
  moveVideoOutOfPicture(row);
  assert.deepEqual(row, { creative_url: "", video_url: "https://x.cdninstagram.com/a.mp4?x=1", creative_type: "Video" });
});

test("moveVideoOutOfPicture: keeps an existing video link, leaves pictures alone", () => {
  const a = { creative_url: "https://x/a.mp4", video_url: "https://www.facebook.com/watch/?v=1", creative_type: "Video" };
  moveVideoOutOfPicture(a);
  assert.equal(a.video_url, "https://www.facebook.com/watch/?v=1"); assert.equal(a.creative_url, "");
  const b = { creative_url: "https://x/a.jpg", video_url: "", creative_type: "Image" };
  moveVideoOutOfPicture(b); assert.equal(b.creative_url, "https://x/a.jpg");
});

test("needsFreshLink: a video file stored as the picture asks for a cover, even before its link expires", async () => {
  const { needsFreshLink } = await import("./creativeUrl");
  const far = "https://scontent.cdninstagram.com/v/a.mp4?oe=" + Math.floor(Date.now() / 1000 + 86400 * 30).toString(16).toUpperCase();
  assert.equal(needsFreshLink({ id: "1", creative: { url: far, ref: "s:1_2" } }), true);
});
