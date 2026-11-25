import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { dbImport, dbRead, dbRewrite, dbUpsert, useDb } from "./db";
import { headersOnly } from "./sheetSample";
import { mapSheets } from "./sheetMapper";

let pg: PGlite;
beforeEach(() => { pg = new PGlite(); useDb((sql, params) => pg.query(sql, params as unknown[]) as never); });
const grid = async (tab: string) => (await dbRead())[tab];

test("insert skips a key that exists, upsert merges fields, updateOnly never creates", async () => {
  assert.deepEqual(await dbUpsert("leads", ["lead_id"], [{ lead_id: "L1", name: "A", status: "New" }], "insert"), { updated: 0, appended: 1, skipped: 0 });
  assert.deepEqual(await dbUpsert("leads", ["lead_id"], [{ lead_id: "L1", name: "B" }], "insert"), { updated: 0, appended: 0, skipped: 1 });
  assert.deepEqual(await dbUpsert("leads", ["lead_id"], [{ lead_id: " L1 ", status: "Won" }, { lead_id: "L2", name: "C" }], "upsert"), { updated: 1, appended: 1, skipped: 0 });
  assert.deepEqual(await dbUpsert("leads", ["lead_id"], [{ lead_id: "L1", phone: "081" }, { lead_id: "NOPE", phone: "1" }], "updateOnly"), { updated: 1, appended: 0, skipped: 1 });
  const g = await grid("leads"), h = g[0], row = (id: string) => g.find((r) => r[h.indexOf("lead_id")] === id)!;
  assert.deepEqual([row("L1")[h.indexOf("name")], row("L1")[h.indexOf("status")], row("L1")[h.indexOf("phone")]], ["A", "Won", "081"]); // later writes only touch the fields they carry
  assert.equal(g.length, 3);
});

test("a batch with the same key twice merges (upsert) or keeps the first (insert); a blank key always appends; column order of keys does not matter", async () => {
  await dbUpsert("leads", ["lead_id"], [{ lead_id: "D", name: "x" }, { lead_id: "D", name: "y", phone: "1" }], "upsert");
  await dbUpsert("leads", ["lead_id"], [{ lead_id: "E", name: "first" }, { lead_id: "E", name: "second" }], "insert");
  await dbUpsert("lead_log", [], [{ lead_id: "D", kind: "note", text: "a" }, { lead_id: "D", kind: "note", text: "a" }], "upsert");
  await dbUpsert("ad_performance", ["date", "ad_id"], [{ date: "2026-11-01", ad_id: "A1", spend: 5 }], "upsert");
  await dbUpsert("ad_performance", ["ad_id", "date"], [{ date: "2026-11-01", ad_id: "A1", spend: 9 }], "upsert");
  const l = await grid("leads"), h = l[0];
  assert.deepEqual(l.slice(1).map((r) => [r[h.indexOf("lead_id")], r[h.indexOf("name")], r[h.indexOf("phone")]]), [["D", "y", "1"], ["E", "first", ""]]);
  assert.equal((await grid("lead_log")).length, 3);
  const p = await grid("ad_performance");
  assert.deepEqual([p.length, p[1][p[0].indexOf("spend")]], [2, "9"]);
});

test("rewriteRow moves a row to its new key, is a no-op when the new key exists, and throws when nothing matches", async () => {
  await dbUpsert("push_subs", ["endpoint"], [{ endpoint: "old", user_id: "U1" }], "insert");
  await dbRewrite("push_subs", "endpoint", "old", { endpoint: "new", user_id: "U1", encrypted_subscription: "x" });
  await dbRewrite("push_subs", "endpoint", "old", { endpoint: "new" }); // already migrated
  const g = await grid("push_subs");
  assert.deepEqual(g.slice(1).map((r) => r[g[0].indexOf("endpoint")]), ["new"]);
  await assert.rejects(() => dbRewrite("push_subs", "endpoint", "ghost", { endpoint: "other" }));
});

test("extra columns survive, and the mapper reads what the database returns", async () => {
  await dbUpsert("pages", ["page_id"], [{ page_id: "FB-1", name: "Clinic", my_extra: "keep" }], "insert");
  const tabs = await dbRead();
  assert.ok(tabs.pages[0].includes("my_extra"));
  const mapped = mapSheets(tabs);
  assert.deepEqual(mapped.dataset.pages.map((p) => p.name), ["Clinic"]);
  assert.deepEqual(mapped.missingTabs, []);
});

test("import copies sheet rows, keeps the first duplicate, ignores blank rows, and can be re-run", async () => {
  const t = headersOnly();
  t.pages.push(["P1", "One", "", "TRUE", ""], ["P1", "Dup", "", "TRUE", ""], ["", "", "", "", ""], ["P2", "Two", "", "TRUE", ""]);
  const once = await dbImport(t);
  assert.deepEqual(once.pages, { sheet: 2, db: 2 });
  assert.deepEqual((await dbImport(t)).pages, { sheet: 2, db: 2 });
  assert.deepEqual((await grid("pages")).slice(1).map((r) => r[1]), ["One", "Two"]);
});
