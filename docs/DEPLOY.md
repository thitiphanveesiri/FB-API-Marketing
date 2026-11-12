# Deploying to Vercel with Google Sheets as the data source

## 1. Push to GitHub, import into Vercel
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
Vercel → Add New → Project → pick the repo (Next.js is auto-detected, no build settings needed).
With no environment variables set the app runs on **Demo Data**, so a first deploy always works.

## 2. Create the Google Sheet from the template
1. Google Drive → New → File upload → `public/google-sheet-template.xlsx` (also served at `/google-sheet-template.xlsx`), open it, then **File → Save as Google Sheets**.
   (`google-sheet-sample.xlsx` is the same layout filled with demo data — handy to try the connection before real data exists.)
2. Tabs: `pages, agencies, users, campaigns, ads, ad_performance, leads, messages`. Required: `pages, campaigns, ads, ad_performance, leads`. The `_README` tab lists every column. Do not rename tabs or row-1 headers (column order is free).
3. **Format ID columns as Plain text before pasting** (select column → Format → Number → Plain text): `ad_id`, `campaign_id`, `lead_id`, `page_id`, `user_id`. Meta Ad IDs have 15–18 digits; as numbers they are rounded (1.2E+17) and the dashboard will warn about it.
4. Fill in order: `pages` → `campaigns` → `ads` → `ad_performance` (an `ad_performance` row whose `ad_id` is not in `ads` is skipped with a warning) → `leads` (+ optional `messages`).

## 3. Google service account (read access)
1. console.cloud.google.com → create a project → **APIs & Services → Library → Google Sheets API → Enable**.
2. **IAM & Admin → Service Accounts → Create**. Open it → **Keys → Add key → JSON**. Keep that file private.
3. In the Sheet, **Share** it with the service account's `client_email` as **Editor** (the app writes card moves, notes, reviews, settings and uploads back to the sheet).

## 4. Vercel environment variables (Project → Settings → Environment Variables)
| Name | Value |
|---|---|
| `GOOGLE_SHEET_ID` | the long id in the sheet URL: `docs.google.com/spreadsheets/d/<ID>/edit` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key (paste as-is; `\n` sequences are handled) |

Redeploy. The top bar then shows **Google Sheets** instead of Demo Data. If the sheet cannot be read, the app shows an error screen (it never silently falls back to demo numbers).

## 5. Sign-in (Google account + allow-list)
1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → **OAuth consent screen** (External is fine; add yourself as test user while in Testing) → **Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URI:** `https://<your-vercel-domain>/api/auth/callback` (add `http://localhost:3000/api/auth/callback` for local use). Copy the client ID and secret.
3. Add to Vercel:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 1 |
| `AUTH_SECRET` | random string, 32+ chars: `openssl rand -hex 32` |
| `AUTH_ADMIN_EMAILS` | *(optional)* your own email(s), comma separated. Always allowed as Administrator, so you can sign in while the sheet is still empty |
| `AUTH_URL` | *(optional)* `https://your-domain` if the redirect URI is wrong behind a custom domain |

4. In the Sheet's **`users`** tab, add one row per person (`email`, `role`, `agency_id` for Agency users, `active` = TRUE). **A Google account whose email is not on the tab (or is `active` FALSE) is refused.** Changes apply within ~1 minute (sheet cache) and on the user's next page load.

What the server enforces (not just the UI): Administrator, Marketing Manager and Sales Manager receive all data; a Sales Representative receives only the leads assigned to them and those chats; an Agency user receives only their agency's campaigns, ads and performance, with no customer names, phones or chats; a Viewer receives dashboards only, without customer personal data. If the Sheet is connected but sign-in is **not** configured, `/api/data` refuses to serve it (set `ALLOW_PUBLIC=1` only if you deliberately want it open). Sessions last 7 days; **Sign out** clears the cookie.

## 6. How it behaves
- Reads happen only on the server (`/api/data`); the key never reaches the browser. Results are cached ~60 s per server instance; **Reload from sheet** in the banner bypasses the cache.
- **Saved to the sheet:** moving cards on the Board, quality reviews, assigning reps, internal notes, dropping/recovering leads, Settings (users, pages, agencies, campaign assignment) and every Upload. Each change is checked on the server against the signed-in role. Not saved: replies typed in Inbox (no Messenger API, so they are never sent).
- **Tabs the app creates and writes itself:** `lead_log` (stage changes and notes), `evaluations`, `page_insights`, `import_log`. Do not rename their header row; you can add your own columns.
- **Upload (Facebook Page data):** Inbox chats/customers → Board cards; Ads Manager exports (per ad or per campaign) → `ads`, `campaigns`, `ad_performance`; Page Insights → `page_insights`; Leads Center / Lead Ads → `leads`. Thai or English column headings and status names are accepted. "Add new rows only" skips rows already imported; "Overwrite" updates rows with the same key.
- Writes are applied one at a time per server instance; two people saving at the same instant is safe, but edits made directly in the sheet while the app writes the same cell can overwrite each other.
- Rows with problems are skipped, not guessed, and listed under **data warnings** in the banner (unknown IDs, bad dates, duplicates, rounded IDs…). A lead is counted once (duplicate `lead_id`s and duplicate `ad_id + date` rows are skipped).
- Dates are read as unambiguous Sheets dates, so regional formats (1/10 vs 10/1) do not matter. "Today" is the real date.

## 6b. ตรวจการตอบแชท (SLA)
หน้า **SLA** ตรวจเวลาตอบของเซลล์จากแท็บ `messages` (ต้องมี `sent_at` เป็นวันที่+เวลา) และ `post_comments` (`commented_at`, `replied_at`) — อัปโหลดได้ที่หน้า Upload ชนิด "ข้อความแชทรายข้อความ" และ "คอมเมนต์ใต้โพสต์" (ต้องอัปโหลดแชทของลูกค้าก่อน)

- เวลาที่ลูกค้าส่งข้อความเป็นตัวกำหนดช่วงเวลา และเริ่มนับตั้งแต่ตอนนั้น
- 10:00–19:00: ตอบเกิน 15 นาที หัก 1 แต้ม ทุกครั้งที่ช้า (ต่อแชท ต่อเพจ)
- 08:00–10:00 และ 19:00–22:00: ช้าแล้วไม่หัก เก็บเป็นสถิติตอบล่าช้า
- 22:00–08:00: ไม่หัก ถ้ามีการตอบเก็บเป็นสถิติ
- คอมเมนต์ (เฉพาะ 10:00–19:00) ตอบเกิน 60 นาที หัก 0.5 แต้ม จากเซลล์ทุกคนในทีมของเพจ (`sales_team`)
- แชท/คอมเมนต์ที่ยังไม่ตอบ นับเป็นช้าเมื่อเกินเวลา; ค่าต่าง ๆ แก้ที่ `SLA_RULES` ใน `src/lib/sla.ts`
- ผู้ดูแลของแชท = คอลัมน์ `assigned_to` ของ lead; แชทที่ยังไม่มีผู้ดูแลไม่ถูกนับให้ใคร

## 6c. ดึงแชท/คอมเมนต์จากเพจ Facebook โดยตรง (ปุ่มในหน้า Upload)
ปุ่ม **"ดึงข้อมูลตอนนี้"** (เฉพาะ Administrator) เรียก Graph API ของ Meta จากเซิร์ฟเวอร์ แล้วเขียนแชททีละข้อความลง `messages`, ลีดใหม่ลง `leads`, คอมเมนต์ลง `post_comments`

ตัวแปรใน Vercel (Settings → Environment Variables แล้ว Redeploy):
- `FB_PAGE_ID` — id ของเพจ Facebook
- `FB_PAGE_TOKEN` — Page Access Token อายุยาว (ขอผ่าน Graph API Explorer: โทเคนผู้ใช้ → Extend ใน Access Token Debugger → `me/accounts`)
- `FB_SHEET_PAGE_ID` (ไม่บังคับ) — page_id ในแท็บ `pages` ที่จะเก็บข้อมูล
- หลายเพจ: ใช้ `FB_PAGES` = `[{"fbPageId":"123","token":"EAA...","sheetPageId":"PG-1"}]` แทน

สิทธิ์ที่โทเคนต้องมี: `pages_show_list`, `pages_messaging`, `pages_read_engagement`, `pages_read_user_content`

พฤติกรรม: ดึงเป็นชุดเล็ก ๆ ต่อครั้ง (ไม่ชนเวลาจำกัดของ Vercel) · ข้อความเดิมไม่ซ้ำ · คอมเมนต์ที่ได้รับการตอบทีหลังจะอัปเดตเวลาตอบเมื่อดึงซ้ำ · แชทจับคู่ลีดเดิมด้วยชื่อลูกค้า ถ้าไม่พบ/ชื่อซ้ำ จะสร้างลีดใหม่ (id = id บทสนทนา) · โทเคนไม่ถูกส่งไปที่เบราว์เซอร์ · Facebook ระบุผู้ตอบเป็น "เพจ" ไม่ระบุตัวเซลล์ คะแนนจึงนับให้เซลล์ที่ถูกมอบหมายแชทนั้น

## 7. Before real customer data goes live
- Known limits of the sign-in: no rate limiting or brute-force protection (Google handles the password); the ID token is read straight from Google's token endpoint over TLS rather than signature-verified; a removed user can still hold a valid cookie for up to ~1 minute (blocked as soon as the sheet cache refreshes); sessions can't be revoked individually (rotate `AUTH_SECRET` to sign everyone out).
- Without Google sign-in configured, the demo build is open to anyone with the URL. Never connect real data without it.
- Sheets API quotas apply; fine for a small team. Move to Supabase (`docs/schema.sql`) when rows/users grow.
- Customer names, phones and chats are personal data (PDPA): limit who can open the Sheet itself.

## 8. Testing without Google (developers)
`SHEETS_LOCAL_JSON=/path/to/tabs.json npm start` reads tabs from a JSON file (`{ "pages": [["page_id","name"],…], … }`) instead of Google. `npx tsx scripts/sheet-roundtrip.ts` checks the mapper; `npx tsx scripts/make-sheet-template.ts` regenerates the workbooks.


## 6d. Connect chat channels (Access Token + Webhook)

Upload page → **เชื่อมช่องทางแชท** (Administrators only). Facebook Messenger is live; LINE and WhatsApp are planned (the `channels` tab already has a `channel` column).

1. Meta App → Messenger → generate a **Page Access Token** (must be a Page token; permissions `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`).
2. Paste the token and the **App Secret** (App → Settings → Basic) into the card, pick the page in the dashboard, save. The app checks the token against Meta and subscribes the page to `messages` + `message_echoes`.
3. In Meta App → Webhooks (Page) paste the **Callback URL** and **Verify Token** shown in the card, then subscribe `messages` and `message_echoes`.
4. New messages are written to `messages` / `leads` within seconds. History before connecting: use the backfill button below the card.

Security: tokens/secrets are stored in the Google Sheet tab `channels` — **anyone who can open the sheet can read them**; keep sharing "Restricted". The browser only ever receives the last 4 characters. `/api/webhook/facebook` is public and every POST is verified with `X-Hub-Signature-256` (HMAC-SHA256, App Secret).
Optional: set `APP_URL` if the Callback URL shown is not your public domain.

## 6e. Follow-up page ("ติดตาม")

Built from the chat messages already in the sheet (no extra setup): median first-reply time, share answered within 15 min, chats by time band and hour, a queue of silent customers (our message was last; threshold 3 h / 1 day / 3 days), customers who came back after going quiet, and a hot / warm / cold guess plus interest tags. The keyword lists live at the top of `src/lib/followup.ts` (`INTENT_WORDS`, `SERVICE_TAGS`) — edit them to match your services. It only lists who to follow up; it does not send messages.

## 6f. Replying from the Inbox + who answered (SLA)

With a Messenger page connected (§6d), the Inbox reply box sends to the customer for real (Send API). Rules: only within 24 h of the customer's last message (Meta's rule); Sales Representatives can reply only to leads assigned to them; text only (no attachments yet). Each reply is saved in `messages` with `sent_by` = the user who sent it, and SLA credits the reply to that salesperson. Replies typed in Business Suite arrive through the webhook with no sender, so SLA credits the lead's assigned rep. A manager/admin replying does not take a rep's chat away: it stays with the assigned rep.
The page token needs `pages_messaging`. The `messages` tab gets a `sent_by` column automatically.
