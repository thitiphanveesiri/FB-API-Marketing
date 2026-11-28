import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, lockedFor, noteFailure, noteSuccess, makeSession, verifySession, usernameOk, resolveUser } from "./auth";
process.env.AUTH_SECRET = "x".repeat(40); // read lazily by auth.ts

test("password hash verifies only the right password", async () => {
  const h = await hashPassword("correct horse");
  assert.ok(await verifyPassword("correct horse", h));
  assert.ok(!(await verifyPassword("wrong", h)));
  assert.ok(!(await verifyPassword("anything", undefined)), "unknown user / no hash never passes");
  assert.notEqual(h, await hashPassword("correct horse"), "salted");
});

test("5 failures lock the key for 15 minutes, success clears", () => {
  const t = 1_000_000;
  for (let i = 0; i < 4; i++) noteFailure("a|1", t);
  assert.equal(lockedFor("a|1", t), 0);
  noteFailure("a|1", t);
  assert.ok(lockedFor("a|1", t + 1000) > 0);
  assert.equal(lockedFor("a|1", t + 16 * 60_000), 0);
  noteFailure("b|1", t); noteSuccess("b|1");
  assert.equal(lockedFor("b|1", t), 0);
});

test("session carries uid; forged or old-style cookies are refused", () => {
  assert.equal(verifySession(makeSession("U-1", "Ann"))?.uid, "U-1");
  assert.equal(verifySession(makeSession("U-1", "Ann") + "x"), null);
  assert.equal(verifySession(undefined), null);
});

test("username format and resolveUser", () => {
  assert.ok(usernameOk("ann.lee-1")); assert.ok(!usernameOk("Ann")); assert.ok(!usernameOk("ab"));
  const ds = { users: [{ id: "U-1", active: true }, { id: "U-2", active: false }] } as never;
  assert.ok(resolveUser(ds, "U-1")); assert.equal(resolveUser(ds, "U-2"), null); assert.equal(resolveUser(ds, "U-9"), null);
});
