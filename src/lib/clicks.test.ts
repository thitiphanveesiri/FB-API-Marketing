import assert from "node:assert/strict";
import { test } from "node:test";
import { adsStep } from "./adsSync";
import type { FetchFn } from "./fbSync";
import { aggregate, derive } from "./metrics";
import type { DailyPerf } from "./types";

type Row = Record<string, string | number | boolean>;
const NOW = new Date("2026-11-20T00:00:00Z");

/** Fake Graph API answering only the daily-insights call. */
function insightsMeta(data: Record<string, unknown>[], rejectFullFields = false) {
  const urls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    const u = new URL(url);
    if (!u.pathname.endsWith("/insights")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    if (rejectFullFields && u.searchParams.get("fields")!.includes("reach"))
      return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: "Invalid parameter" } }) };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { fetchFn, urls };
}
const insights = async (m: ReturnType<typeof insightsMeta>) => {
  const out = await adsStep({ accountId: "1", token: "T", sheetPageId: "P", days: 7, state: { phase: "insights" }, now: NOW, fetchFn: m.fetchFn, base: "https://graph.test" });
  return { out, rows: (out.writes.find((w) => w.tab === "ad_performance")?.rows ?? []) as Row[] };
};

test("sync saves link clicks and clicks (all) as two separate numbers", async () => {
  const { rows } = await insights(insightsMeta([{ ad_id: "A1", date_start: "2026-11-19", spend: "100", reach: "900", impressions: "1000", clicks: "80", inline_link_clicks: "30" }]));
  assert.equal(rows[0].clicks, 30);
  assert.equal(rows[0].clicks_all, 80);
});

test("an ad with no link clicks keeps 0 for link clicks while clicks (all) stays its own value", async () => {
  const { rows } = await insights(insightsMeta([{ ad_id: "A1", date_start: "2026-11-19", spend: "5", impressions: "100", clicks: "7", inline_link_clicks: "0" }]));
  assert.equal(rows[0].clicks, 0);
  assert.equal(rows[0].clicks_all, 7);
});

test("basic-fields fallback: clicks (all) is saved, link clicks is left out (so an earlier good value is not overwritten with 0)", async () => {
  const m = insightsMeta([{ ad_id: "A1", date_start: "2026-11-19", spend: "5", impressions: "100", clicks: "7" }], true);
  const { rows, out } = await insights(m);
  assert.equal("clicks" in rows[0], false);
  assert.equal(rows[0].clicks_all, 7);
  assert.ok(out.warnings?.some((w) => w.includes("Clicks (all)")));
});

test("aggregate keeps the two click totals apart and tells 'not synced' from zero", () => {
  const p = (clicksAll?: number): DailyPerf => ({ adId: "A", date: "2026-11-19", spend: 100, reach: 0, impressions: 1000, clicks: 20, ...(clicksAll != null ? { clicksAll } : {}), messages: 0, purchases: 0, source: "import" });
  const some = aggregate([p(50), p(30), p()]); // the third row was never synced with clicks (all)
  assert.equal(some.clicks, 60);
  assert.equal(some.clicksAll, 80);
  assert.equal(some.clicksAllRows, 2);
  const none = aggregate([p(), p()]);
  assert.equal(none.clicksAllRows, 0);
  assert.equal(derive(none).ctrAll, null);
  assert.equal(derive(none).cpcAll, null);
  const d = derive(aggregate([p(50)]));
  assert.equal(d.ctrAll, 5); // 50 / 1000 × 100
  assert.equal(d.cpcAll, 2); // 100 / 50
});
