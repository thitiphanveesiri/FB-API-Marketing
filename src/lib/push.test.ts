import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import { NOTIFICATION_PENDING_LEASE_MS, pendingNotificationRetryable, recipientsFor, validEndpoint, validSubscription } from "./push";
import type { User } from "./types";

test("push endpoints are limited to known HTTPS push services", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v1/token",
    "https://web.push.apple.com/token",
    "https://wns.windows.com/token",
    "https://db5p.notify.windows.com/token",
  ]) assert.equal(validEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    "https://attacker.example/token",
    "http://fcm.googleapis.com/fcm/send/token",
    "https://user:pass@fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com.attacker.example/token",
    "not a url",
  ]) assert.equal(validEndpoint(endpoint), false, endpoint);
});

test("push subscription keys have the expected encoded shape", () => {
  const keys = { p256dh: "A".repeat(43), auth: "B".repeat(22) };
  assert.equal(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/token", keys }), true);
  assert.equal(validSubscription({ endpoint: "https://attacker.example/token", keys }), false);
  assert.equal(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/token", keys: { ...keys, auth: "short" } }), false);
});

test("pending notifications retry only after their attempt lease expires", () => {
  const now = Date.parse("2026-11-25T10:00:00.000Z");
  const attemptedAt = new Date(now - NOTIFICATION_PENDING_LEASE_MS).toISOString();
  assert.equal(pendingNotificationRetryable("pending", attemptedAt, now), true);
  assert.equal(pendingNotificationRetryable("pending", new Date(now - NOTIFICATION_PENDING_LEASE_MS + 1).toISOString(), now), false);
  assert.equal(pendingNotificationRetryable("pending", "", now), true);
  assert.equal(pendingNotificationRetryable("pending", "invalid", now), true);
  assert.equal(pendingNotificationRetryable("sent", attemptedAt, now), false);
  assert.equal(pendingNotificationRetryable("failed", attemptedAt, now), false);
});

test("unassigned inbound chats notify active managers and administrators", () => {
  const users: User[] = [
    { id: "A", name: "Admin", email: "", role: "Administrator", active: true, hue: 0 },
    { id: "SM", name: "Manager", email: "", role: "Sales Manager", active: true, hue: 0 },
    { id: "OFF", name: "Off", email: "", role: "Sales Manager", active: false, hue: 0 },
    { id: "R", name: "Rep", email: "", role: "Sales Representative", active: true, hue: 0 },
  ];
  const ds = { ...emptyDataset(), users };
  assert.deepEqual(recipientsFor(ds, { repId: null }), ["A", "SM"]);
  assert.deepEqual(recipientsFor(ds, { repId: "R" }), ["R"]);
  assert.deepEqual(recipientsFor(ds, { repId: "OFF" }), ["A", "SM"]);
});
