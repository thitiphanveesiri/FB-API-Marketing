// One-off copy of the Google Sheet into Postgres (safe to re-run: existing keys are kept as they are).
// Usage: DATABASE_URL=... GOOGLE_SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_PRIVATE_KEY=... npx tsx scripts/sheets-to-db.ts
import { readTabs } from "../src/lib/googleSheets";
import { dbImport } from "../src/lib/db";

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
