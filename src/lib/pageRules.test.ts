import assert from "node:assert/strict";
import { test } from "node:test";
import { adsStep, matchPageRule, type PageRule } from "./adsSync";
import type { FetchFn } from "./fbSync";

const rules: PageRule[] = [
  { pageId: "NAY", keywords: ["nay", "ดร.เนย์"] },
  { pageId: "BEQ", keywords: ["beq"] },
  { pageId: "PAV", keywords: ["*"] },
];

test("matchPageRule: keyword wins, longest keyword wins, '*' takes the rest, no rules = no decision", () => {
  assert.equal(matchPageRule(rules, "Campaign DR.NAY โปรโมชั่น"), "NAY");
  assert.equal(matchPageRule(rules, "beq spring"), "BEQ");
  assert.equal(matchPageRule(rules, "something else"), "PAV");
  assert.equal(matchPageRule(undefined, "nay"), "");
  assert.equal(matchPageRule([{ pageId: "X", keywords: ["ab"] }], "zzz"), "");
  assert.equal(matchPageRule([{ pageId: "A", keywords: ["promo"] }, { pageId: "B", keywords: ["promo beq"] }], "promo beq 1"), "B");
});

test("ads Meta files under one numeric page are moved to the page their name points to", async () => {
  const ad = (id: string, name: string) => ({ id, name, effective_status: "ACTIVE", campaign: { id: "C" + id, name }, creative: { object_story_spec: { page_id: "111432947713900" }, thumbnail_url: "https://x/t.jpg" } });
  const fetchFn: FetchFn = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/ads")) return { ok: true, status: 200, json: async () => ({ data: [ad("1", "Nay filler"), ad("2", "BEQ botox"), ad("3", "generic")] }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const out = await adsStep({ accountId: "1", token: "T", sheetPageId: "FALLBACK", days: 7, state: { phase: "ads" }, fetchFn, base: "https://graph.test",
    pageMap: { "111432947713900": "PG-111432947713900" }, pageNames: { NAY: "Dr. Nay", BEQ: "Beq", PAV: "Pavicon", "PG-111432947713900": "เพจ 1114" }, pageRules: rules });
  const adRows = out.writes.find((w) => w.tab === "ads")!.rows;
  assert.deepEqual(adRows.map((r) => r.page_id), ["NAY", "BEQ", "PAV"]);
  const camps = out.writes.find((w) => w.tab === "campaigns")!.rows;
  assert.deepEqual(camps.map((r) => r.page_id), ["NAY", "BEQ", "PAV"]);
});

import { defaultPageRules } from "./adPageRules";
test("default rules copy BEQ's danai / beq aliases and leave unmatched names to A's source-Page mapping", () => {
  const map = { "109373461849494": "PG-NAY", "122342237846683": "PG-BEQ" };
  const known = new Set(["PG-NAY", "PG-BEQ", "FB-239105462619075"]);
  const r = defaultPageRules(map, known, undefined);
  assert.equal(matchPageRule(r, "Dr-Danai สิว"), "PG-NAY");
  assert.equal(matchPageRule(r, "BEQ hair"), "PG-BEQ");
  assert.equal(matchPageRule(r, "อะไรก็ได้"), "");
  // a page that does not exist here is skipped, never invented
  assert.equal(defaultPageRules({}, new Set(["X"]), undefined).length, 0);
  // env override
  const e = defaultPageRules({ "1": "A" }, new Set(["A"]), JSON.stringify([{ fbPageId: "1", keywords: ["x"] }]));
  assert.equal(matchPageRule(e, "an x ad"), "A");
});

test("built-in rules resolve to uniquely named Repository A Pages without Sheet keywords", () => {
  const known = new Set(["SYS-DANAI", "SYS-BEQ", "SYS-DEFAULT"]);
  const names = { "SYS-DANAI": "Dr Danai Clinic", "SYS-BEQ": "BEQ Thailand", "SYS-DEFAULT": "Main Page" };
  const rules = defaultPageRules({}, known, undefined, names);
  assert.equal(matchPageRule(rules, "Dr-Danai campaign"), "SYS-DANAI");
  assert.equal(matchPageRule(rules, "BEQ spring promo"), "SYS-BEQ");
  // A's source-Page resolution remains authoritative for names that B's classifier does not recognize.
  assert.equal(matchPageRule(rules, "generic campaign"), "");
});
