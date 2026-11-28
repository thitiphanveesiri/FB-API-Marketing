// One-off copy of the Google Sheet into Postgres (safe to re-run: existing keys are kept as they are).
// Usage: npx tsx --env-file=.env.local scripts/sheets-to-db.ts   (.env.local holds DATABASE_URL and the GOOGLE_* variables)
import { readTabs } from "../src/lib/googleSheets";
import { dbImport } from "../src/lib/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL first");
  delete process.env.DATABASE_URL; // readTabs must read the SHEET here, not the empty database
  const tabs = await readTabs(true);
  process.env.DATABASE_URL = url;
  const result = await dbImport(tabs);
  let bad = 0;
  for (const [tab, n] of Object.entries(result)) { const ok = n.sheet === n.db; if (!ok) bad++; console.log(`${ok ? "OK " : "DIFF"} ${tab.padEnd(18)} sheet=${n.sheet} db=${n.db}`); }
  console.log(bad ? `${bad} tab(s) differ: check them before switching.` : "All tabs match. Set DATABASE_URL on the app to switch; unset it to go back to Sheets.");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
