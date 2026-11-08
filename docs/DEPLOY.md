# Deploying to Vercel (data in Google Sheets)

## 1. Push to GitHub
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
## 2. Import into Vercel
Vercel → Add New → Project → pick the repo. Framework is auto-detected as Next.js; no build settings needed. `npm run build` is already green.

## 3. Before putting real data behind it
- The demo has **no real sign-in**; roles are UI-only. Anyone with the URL sees everything. Until auth exists, keep it on demo data, or turn on Vercel *Deployment Protection* (Project → Settings) so only your team can open it.
- Never expose the Sheet, its service-account key or customer chats to the browser. Read the Sheet only inside Next.js route handlers (`src/app/api/*`) using the env vars in `.env.example`.

## 4. Google Sheets as the data source (not wired yet)
Current state: the app reads `src/lib/seed.ts` (demo) and keeps changes in browser memory, which resets on refresh — on Vercel it cannot save anything either. To use your Sheet:
1. Create a Google Cloud service account, enable the Google Sheets API, share the Sheet with the service-account email.
2. One tab per entity with a header row that matches `src/lib/types.ts` (e.g. `ad_performance`: date, ad_id, spend, reach, impressions, clicks, messages, purchases; `leads`: lead_id, name, ad_id, status, rep, created_at…).
3. Add a repository layer: `GET /api/data` reads the tabs and returns the same `Dataset` shape as `buildDemoDataset()`; write actions (Board moves, notes, imports) become `POST` routes that append/update rows. The pages and `lib/*` logic stay unchanged.
4. Sheets is fine for a small team but has API quotas and no transactions: cache reads for a minute or two, batch writes, and plan to move to Supabase when rows or users grow (schema in `docs/schema.sql`).
