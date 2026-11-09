# Marketing Intelligence Dashboard

Facebook Ads performance, chat-quality analytics, Inbox, Kanban lead board, data import, quality control and settings — one multi-page Next.js app.
**Phase 1 (this build):** fully working front end on clearly labelled **Demo Data**. No Facebook account is accessed; nothing is sent to real customers.

## Run it
```bash
npm install
npm run dev            # http://localhost:3000   (redirects to /dashboard/ads)
npm run build && npm start   # production check
```
Node 20+ recommended. Copy `.env.example` to `.env.local` only when you start Phase 2 (not needed now).
Try the import wizard with `public/sample-ads-export.csv` (also downloadable from the Upload page): it intentionally contains a duplicate row, a missing Ad ID, a bad date, a bad number and an inconsistent campaign name.

**Roles:** set per person in the sheet's `users` tab. Sales Reps see only their leads; Agency users only their campaigns (no customer data); Viewer is read-only. Enforced on the server.

## Data sources
- **Demo Data** (default, nothing to configure) — built-in generator, resets on refresh.
- **Google Sheets** — set `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`; the server route `/api/data` reads the tabs and maps them to the same `Dataset` the pages already use (`src/lib/sheetMapper.ts`; layout in `src/lib/sheetSchema.ts`). Reads and writes (service account must be an Editor). Template: `public/google-sheet-template.xlsx`. Full steps: `docs/DEPLOY.md`.

## Comfort & display (palette icon in the header)
- **Theme:** Soft (default, low-glare), Light, Dark, Auto (follows the device). Colours are CSS tokens in `src/app/globals.css`; a tiny pre-paint script (`src/lib/prePaint.ts`) applies the saved choice before first paint so there is no flash.
- **Text size** Normal/Large and **table density** Comfortable/Compact. Saved per device in localStorage. Animations are disabled when the OS requests reduced motion.
- **Extras:** *Export CSV* on every table (respects search and sort), and a *Needs attention* strip on Ads Performance (high cost per message, Poor chat quality, un-responded leads, overdue follow-ups) that links to the relevant view.

## Stack
Next.js (App Router) · TypeScript · Tailwind CSS v4 · Recharts · @dnd-kit (Kanban) · Papaparse + SheetJS (CSV/XLSX in-browser) · Lucide.
Deviations from the brief: shadcn/ui and TanStack Table are **not** used — a small in-house component kit (`src/components/ui.tsx`, including a sortable/searchable/paginated `DataTable`) keeps the demo dependency-light. Swapping in either later is straightforward because pages only depend on the `Column` interface.

## Folder structure
```
src/
  app/                    one folder per page (dashboard/{ads,ads-chat,sales,trend,dropped}, inbox, board, upload, quality, settings, account)
  components/             ui.tsx (kit), AppShell, FilterBar, LeadDrawer, charts
  lib/
    types.ts              domain model (mirrors docs/schema.sql)
    seed.ts               DEMO data generator — the only place sample data lives
    queries.ts            filter + role-scope logic (pure)
    metrics.ts            all KPI formulas (pure)
    transitions.ts        Board stage rules (pure)
    importer.ts           column mapping + validation + dedupe (pure)
    store.tsx             in-memory state + actions (swap for API/DB)
    useDash.ts, useLeadActions.ts
docs/schema.sql           PostgreSQL / Supabase schema proposal
public/sample-ads-export.csv
```
Separation: **UI** (`app/`, `components/`) → **hooks/store** → **pure business logic** (`metrics`, `queries`, `transitions`, `importer`) → **data** (`seed.ts` now; repository/API later).

## Pages
| Page | What it does |
|---|---|
| Dashboard › Ads Performance | 3 KPI boxes with period-over-period change and sparklines; click a KPI to chart it with the previous period overlaid; campaign table (sort, search, filter, pagination, cost/quality highlights, detail drawer) |
| Ads & Chat | Per-ad lead quality and sales funnel counts; click an Ad ID or count to list the customers and open their chat |
| Sales Performance | Team KPIs, ranked salesperson table (score = conversion, quality, speed, follow-up, workload — never volume alone), comparison chart, rep drawer |
| Trend | 8 interactive charts, Daily/Weekly/Monthly, previous-period comparison |
| Dropped | Dropped-lead KPIs and table; view chat, reassign, recover into a pipeline stage |
| Inbox | 3-column CRM inbox with **simulated** conversations, replies, internal notes, attachments, status/quality/assignee/follow-up |
| Board | 10-column Kanban, drag & drop, guarded transitions with confirmation + reason, status history |
| Upload | 8-step CSV/XLSX import (page → type → file → preview → map → validate → confirm → summary), incremental vs replace, error report download, history, re-import |
| Quality | Distribution and breakdown by campaign/ad/agency/rep, shared category definitions, conversation review with criteria, reviewer, timestamp, downgrade reason |
| Setting | CRUD for pages, agencies (assign campaigns, performance), users; role/permission matrix |

## Metric definitions (`src/lib/metrics.ts`)
CTR = clicks ÷ impressions × 100 · CPC = spend ÷ clicks · CPM = spend ÷ impressions × 1000 · Cost/Message = spend ÷ messaging conversations started · Qualified Lead Rate = qualified ÷ valid leads × 100 · CQC = spend ÷ qualified leads · Conversion Rate = converted ÷ qualified × 100 · Cost/Purchase = spend ÷ purchases.
- **Qualified** = quality Qualified, Appointment Booked or Connection Created. Invalid/spam leads are excluded everywhere.
- Division by zero returns *unavailable* (shown “—”), never 0. Zero and “no data” are different.
- **Meta-reported purchases** (ads side) and **CRM-confirmed conversions** (lead side) are always labelled separately and never added together.
- Each lead has at most one source Ad ID, so a lead is counted under one ad only.
- Reach is summed over days (approximation; Meta de-duplicates only inside one reporting window) and flagged in its tooltip.

## Data flow
Filters (store) → `useDash` → `queries.ts` selects ads/performance/leads for the range and the equal-length previous range → `metrics.ts` aggregates → page renders. Lead actions go through `useLeadActions` (permission check → confirmation → store action → toast → history entry). Imports: file → `importer.validate` → confirm → `store.commitImport`, which only touches ad+date keys present in the file.

## Known limitations of the demo
- State lives in browser memory: a refresh resets to the seed data (imports included). Persistence arrives with the database.
- Sign-in is simulated; role checks are UI-level only. Real enforcement must be server-side + row-level security.
- Inbox replies are simulated and labelled as such. Creative thumbnails are placeholders.
- The Board shows up to 40 cards per column (search/filter to narrow); no virtualisation yet.

## Facebook integration plan
1. **Database:** apply `docs/schema.sql` (Supabase). Replace `store.tsx` actions with API route handlers + a repository layer; keep `lib/*` logic as-is.
2. **Auth & RBAC:** Supabase Auth; RLS for agency/rep scoping; mirror the permission matrix server-side.
3. **Ads data:** start with the existing CSV/XLSX import writing to `ad_performance` (primary key `ad_id, date` gives duplicate protection). Then a scheduled job pulling Meta Marketing API insights (ad level, daily) with a fixed attribution window stored per row.
4. **Messenger:** requires a Meta app with Page permissions approved through App Review, per-page access tokens (encrypted), and a webhook (`META_WEBHOOK_VERIFY_TOKEN`) that creates `leads`/`conversations`/`messages`, deduping on `(page_id, messenger_psid)`. Ad attribution comes from the referral payload on click-to-Messenger conversations. Respect the 24-hour messaging window when sending.
5. **CRM:** a webhook/import sets `Converted` and CRM purchase values, kept in separate columns from Meta-reported purchases.

## Sign-in
Google sign-in with a sheet-based allow-list and server-side role scoping. Setup: docs/DEPLOY.md §5.
