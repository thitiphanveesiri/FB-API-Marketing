// Generates public/google-sheet-template.xlsx (headers only) and public/google-sheet-sample.xlsx (demo data).
// Run: npx tsx scripts/make-sheet-template.ts
import * as XLSX from "xlsx";
import { buildDemoDataset } from "../src/lib/seed";
import { datasetToTabs, headersOnly } from "../src/lib/sheetSample";
import { SHEET_TABS } from "../src/lib/sheetSchema";
import { RawTabs } from "../src/lib/sheetMapper";

function readme(sample: boolean): string[][] {
  const rows: string[][] = [
    [sample ? "SAMPLE WORKBOOK — all values are DEMO DATA. Delete the rows (keep row 1 headers) before using real data." : "TEMPLATE — headers only. Paste your real data under row 1 of each tab."],
    ["Do not rename the tabs or the header cells in row 1 (column order does not matter). This _README tab is ignored by the dashboard."],
    ["IMPORTANT: format the ID columns (ad_id, campaign_id, lead_id, page_id, user_id) as Plain text BEFORE pasting: select the column → Format → Number → Plain text. Meta Ad IDs have 15–18 digits and get rounded if Sheets treats them as numbers."],
    ["Dates: type or paste real dates (Sheets stores them unambiguously) or text like 2026-10-31. Booleans: TRUE / FALSE."],
    ["Share the spreadsheet with the service-account email as Viewer (see docs/DEPLOY.md)."],
    [""],
    ["tab", "column", "required", "description", "tab purpose"],
  ];
  for (const t of SHEET_TABS) for (const c of t.cols) rows.push([t.tab, c.name, c.required ? "yes" : "", c.note, t.purpose + (t.required ? "" : " (optional tab)")]);
  return rows;
}
function book(tabs: RawTabs, sample: boolean): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const t of SHEET_TABS) {
    const ws = XLSX.utils.aoa_to_sheet(tabs[t.tab]);
    ws["!cols"] = t.cols.map((c) => ({ wch: Math.max(12, c.name.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, t.tab);
  }
  const rs = XLSX.utils.aoa_to_sheet(readme(sample)); rs["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 9 }, { wch: 90 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, rs, "_README");
  return wb;
}
XLSX.writeFile(book(headersOnly(), false), "public/google-sheet-template.xlsx");
XLSX.writeFile(book(datasetToTabs(buildDemoDataset()), true), "public/google-sheet-sample.xlsx");
console.log("written");
