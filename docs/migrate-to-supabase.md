# Move the data from Google Sheets to Supabase

The app uses Postgres whenever `DATABASE_URL` is set, and Google Sheets when it is not. Nothing else changes. Switching back = removing the variable.

## Before you start
- Merge the PR with `src/lib/db.ts`. Take a copy of the Google Sheet (File → Make a copy): this is your backup.
- Pick a quiet time. Messages that arrive between step 4 and step 6 are written to the Sheet only, so keep that gap short.

## Steps
1. **Create the project.** supabase.com → New project (region close to your Vercel region). Save the database password.
2. **Get the connection string.** Project → Connect → *Transaction pooler* (port 6543). It looks like
   `postgresql://postgres.xxxx:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres`.
3. **Try it on your computer first.** In `.env.local` add the `GOOGLE_*` variables you already use on Vercel plus `DATABASE_URL=...`, then run:
   ```
   npx tsx --env-file=.env.local scripts/sheets-to-db.ts
   ```
   It creates the table (`sheet_rows`, row level security on), copies every tab, and prints `OK` / `DIFF` with row counts per tab. Re-running is safe (rows that already exist are kept). Fix any `DIFF` before going on.
4. **Check the app against the copy.** Run `npm run dev` with `DATABASE_URL` set. Open Dashboard, Inbox, Comments, Settings → Pages and compare a few numbers with the live site (which still reads the Sheet).
5. **Optional, for live Inbox updates later.** SQL editor: `alter publication supabase_realtime add table sheet_rows;`
6. **Switch.** Do the copy once more right before (`npx tsx --env-file=.env.local scripts/sheets-to-db.ts`), then add `DATABASE_URL` in Vercel → Settings → Environment Variables (Production) and redeploy.
7. **Verify on production.** Send a test message to a connected Page: it should appear in Inbox. Open Dashboard. Check Supabase → Table editor → `sheet_rows`.
8. **Keep the Sheet read-only** (the backup) for about two weeks. Rows written after the switch are NOT copied back to the Sheet.

## Roll back
Remove `DATABASE_URL` in Vercel and redeploy. The app reads the Sheet again. Data written to Supabase after the switch stays in Supabase only.

## Known limits
- One generic table (`tab`, `key`, `data jsonb`), not typed tables yet. Fine for normal volume; split big tabs (`messages`, `ad_performance`) into real tables later.
- The Sheet's own formulas, charts or manual edits are not part of the app after the switch.
- Not yet tested against a live Supabase (only against an in-memory Postgres).
