import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregate } from "./metrics";
import { groupPerfByAdInRange } from "./queries";
import type { DailyPerf } from "./types";

test("page-split performance totals include only rows inside the selected date range", () => {
  const perf: DailyPerf[] = [
    { adId: "ad-1", date: "2026-10-31", spend: 100, reach: 0, impressions: 0, clicks: 0, messages: 10, purchases: 0, source: "import" },
    { adId: "ad-1", date: "2026-11-01", spend: 5, reach: 0, impressions: 0, clicks: 0, messages: 1, purchases: 0, source: "import" },
    { adId: "ad-1", date: "2026-11-30", spend: 7, reach: 0, impressions: 0, clicks: 0, messages: 2, purchases: 0, source: "import" },
    { adId: "ad-1", date: "2026-12-01", spend: 200, reach: 0, impressions: 0, clicks: 0, messages: 20, purchases: 0, source: "import" },
    { adId: "ad-2", date: "2026-11-15", spend: 3, reach: 0, impressions: 0, clicks: 0, messages: 4, purchases: 0, source: "import" },
  ];

  const byAd = groupPerfByAdInRange(perf, { start: "2026-11-01", end: "2026-11-30" });
  const selectedRows = [...byAd.values()].flat();
  const totals = aggregate(selectedRows);

  assert.deepEqual(byAd.get("ad-1")?.map((row) => row.date), ["2026-11-01", "2026-11-30"]);
  assert.equal(totals.spend, 15);
  assert.equal(totals.messages, 7);
  assert.equal(selectedRows.some((row) => row.date < "2026-11-01" || row.date > "2026-11-30"), false);
});
