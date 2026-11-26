import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTransition } from "./transitions";
import type { Lead } from "./types";

const lead: Lead = {
  id: "L-1", name: "Customer", phone: "", email: "", pageId: "PG-1", adId: null, repId: "U-REP",
  status: "Intake", quality: "Qualified", valid: true, createdAt: "2026-11-01", lastContactAt: "", lastMessage: "",
  followUpDate: null, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null, unread: false, history: [], dropped: null, source: "import",
};

test("recovery uses the same Converted role restrictions as normal moves", () => {
  const converted = { ...lead, status: "Converted" as const };
  assert.equal(checkTransition(converted, "Intake", "Sales Representative").kind, "blocked");
  const managerCheck = checkTransition(converted, "Intake", "Sales Manager");
  assert.equal(managerCheck.kind, "confirm");
  if (managerCheck.kind === "confirm") assert.equal(managerCheck.requireReason, true);
  assert.equal(checkTransition(lead, "Converted", "Sales Representative").kind, "blocked");
  assert.deepEqual(checkTransition(lead, "Converted", "Sales Manager"), { kind: "ok" });
});

test("recovery to the existing stage is allowed but an unqualified jump needs a reason", () => {
  assert.deepEqual(checkTransition(lead, "Intake", "Sales Representative"), { kind: "ok" });
  const unqualified = { ...lead, status: "Average" as const, quality: "Average" as const };
  const check = checkTransition(unqualified, "New", "Sales Representative");
  assert.equal(check.kind, "confirm");
  if (check.kind === "confirm") assert.equal(check.requireReason, true);
});
