import { buildDemoDataset } from "../src/lib/seed";
import { datasetToTabs, headersOnly } from "../src/lib/sheetSample";
import { mapSheets } from "../src/lib/sheetMapper";
import { leadStats, aggregate } from "../src/lib/metrics";

const demo = buildDemoDataset();
const r = mapSheets(datasetToTabs(demo));
console.log("demo   :", { ads: demo.ads.length, perf: demo.perf.length, leads: demo.leads.length, msgs: Object.values(demo.messages).flat().length });
console.log("mapped :", r.counts, "| warnings:", r.warnings.length, "| missing tabs:", r.missingTabs);
if (r.warnings.length) console.log(r.warnings.slice(0, 5));
const a = leadStats(demo.leads), b = leadStats(r.dataset.leads);
console.log("lead stats equal:", JSON.stringify([a.valid, a.qualified, a.converted]) === JSON.stringify([b.valid, b.qualified, b.converted]), [a.valid, a.qualified, a.converted], [b.valid, b.qualified, b.converted]);
console.log("spend equal:", aggregate(demo.perf).spend === aggregate(r.dataset.perf).spend, "| dropped equal:", demo.leads.filter((l) => l.dropped).length === r.dataset.leads.filter((l) => l.dropped).length);

// empty template (headers only) must not crash
const e = mapSheets(headersOnly());
console.log("empty template:", e.counts, "| warnings:", e.warnings.length);

// bad data
const bad = datasetToTabs(demo);
bad.ad_performance.push(["2026-13-40", "AD-1001", "10", "1", "1", "1", "1", "1"], ["2026-10-01", "NOPE", "10", "1", "1", "1", "1", "1"], bad.ad_performance[1].slice());
bad.leads.push(["L-X", "Test", "PG-NOPE", "", "", "Qualified", "", "", "2026-10-01"]);
const w = mapSheets(bad).warnings.map((x) => x.tab + ": " + x.message);
console.log("bad-data warnings:", w);
const noTabs = mapSheets({ pages: [["page_id", "name"]] });
console.log("missing tabs reported:", noTabs.missingTabs);

// --- Google serial dates + rounded IDs ---
const sv = datasetToTabs(demo);
sv.ad_performance[1][0] = "46297";            // 2026-10-... serial
sv.leads[1][8] = "46297.5";                    // created_at with time -> date only
sv.leads[1][9] = "46297.5";                    // last_contact_at 12:00
sv.ads.push(["1.2021e+17", "Rounded id ad", sv.ads[1][2], "Active", "Image", ""]);
const sr = mapSheets(sv);
const ok1 = sr.dataset.perf[0].date === "2026-10-02";
const ok2 = sr.dataset.leads[0].createdAt === "2026-10-02" && sr.dataset.leads[0].lastContactAt === "2026-10-02T12:00:00";
console.log("serial 46297 -> perf date 2026-10-02:", ok1, "| lead created/last contact:", ok2, sr.dataset.leads[0].createdAt, sr.dataset.leads[0].lastContactAt);
console.log("id hint     :", sr.warnings.filter((w) => w.message.includes("Plain text")).length > 0);
