import assert from "node:assert/strict";
import { test } from "node:test";
import { adsStep } from "./adsSync";
import { pickSystemPage } from "./autoPage";
import type { FetchFn } from "./fbSync";

test("an ad goes to the page its creative posts as, whatever words its name contains", async () => {
  const ad = (id: string, name: string, page: string) => ({ id, name, effective_status: "ACTIVE", campaign: { id: "C" + id, name }, creative: { object_story_spec: { page_id: page }, thumbnail_url: "https://x/t.jpg" } });
  const fetchFn: FetchFn = async (url) => new URL(url).pathname.endsWith("/ads")
    ? { ok: true, status: 200, json: async () => ({ data: [ad("1", "BEQ botox", "111"), ad("2", "generic", "222")] }) }
    : { ok: true, status: 200, json: async () => ({ data: [] }) };
  const out = await adsStep({ accountId: "1", token: "T", sheetPageId: "FALLBACK", days: 7, state: { phase: "ads" }, fetchFn, base: "https://graph.test",
    pageMap: { "111": "NAY", "222": "BEQ" }, pageNames: { NAY: "Dr. Nay", BEQ: "Beq" } });
  assert.deepEqual(out.writes.find((w) => w.tab === "ads")!.rows.map((r) => r.page_id), ["NAY", "BEQ"]);
});

test("a page the admin added under the plain Facebook ID is reused, not duplicated as FB-<id>", () => {
  const pick = pickSystemPage([{ id: "111432947713900", name: "Dr. Nay" }], [], "111432947713900", "Dr. Nay Clinic");
  assert.deepEqual(pick, { id: "111432947713900", create: false });
});
