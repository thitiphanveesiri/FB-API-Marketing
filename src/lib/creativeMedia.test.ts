import assert from "node:assert/strict";
import { test } from "node:test";
import { isVideoFileUrl, resolveCreativeMedia } from "./creativeMedia";

test("CreativeCell routes an MP4 stored in creative.url to the video renderer", () => {
  const mp4 = "https://cdn.example.test/ad-creative.MP4?signature=abc123";
  const media = resolveCreativeMedia({ url: mp4 });

  assert.equal(media.imageUrl, undefined);
  assert.equal(media.videoUrl, mp4);
  assert.equal(media.videoInImageField, true);
  assert.equal(isVideoFileUrl(media.videoUrl), true);
});

test("CreativeCell keeps a regular image URL in the image source", () => {
  const image = "https://cdn.example.test/ad-creative.jpg?signature=abc123";
  const media = resolveCreativeMedia({ url: image });

  assert.equal(media.imageUrl, image);
  assert.equal(media.videoUrl, undefined);
  assert.equal(media.videoInImageField, false);
});

test("a dedicated video_url takes precedence while the image remains available", () => {
  const image = "https://cdn.example.test/ad-creative.jpg";
  const video = "https://cdn.example.test/ad-video.mp4";
  const media = resolveCreativeMedia({ url: image, video });

  assert.equal(media.imageUrl, image);
  assert.equal(media.videoUrl, video);
  assert.equal(media.videoInImageField, false);
});

test("video file detection accepts query strings and fragments but not a .mp4 substring", () => {
  assert.equal(isVideoFileUrl("https://cdn.example.test/video.mp4?token=1"), true);
  assert.equal(isVideoFileUrl("https://cdn.example.test/video.MOV#player"), true);
  assert.equal(isVideoFileUrl("https://cdn.example.test/video.mp4.jpg"), false);
});
