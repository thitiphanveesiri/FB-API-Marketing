# แจ้งเตือนบนมือถือ (PWA + Web Push)

เซลล์ได้รับแจ้งเตือนเมื่อ (1) ลูกค้าทักเข้ามาและมี Sales ที่ active ถูก assign ไว้ (ไม่มีผู้รับ = ไม่ส่ง) (2) แชทที่ลูกค้ารอ 5 นาที, 10 นาที (เตือนให้ตาม) และเมื่อครบ 15 นาที (เกินแล้ว) — ตั้งนาทีเตือนที่ `SLA_RULES.remindMinutes` ใน `src/lib/sla.ts` (3) แชทค้างเกิน 3 ชั่วโมง (ส่งถึงหัวหน้าด้วย) ผู้ดูแลระบบยังกดแจ้ง Sales เองจากคิวติดตามได้
ไม่มีค่าใช้จ่าย ไม่ต้องมีบัญชี LINE / แอปสโตร์

## 1. ตั้งค่าครั้งเดียว (แอดมิน)
1. สร้างกุญแจ: บนเครื่องที่มี Node รัน `npx web-push generate-vapid-keys` จะได้ Public Key กับ Private Key
2. Vercel → Settings → Environment Variables เพิ่ม (Production):
   - `VAPID_PUBLIC_KEY` = Public Key
   - `VAPID_PRIVATE_KEY` = Private Key (เก็บเป็นความลับ)
   - `VAPID_SUBJECT` = `mailto:อีเมลของคุณ`
   - `PUSH_SUBSCRIPTION_SECRET` = สุ่มอย่างน้อย 32 ตัวอักษร ใช้เข้ารหัส endpoint และ key ของแต่ละเครื่องก่อนเก็บลงชีต
   - `CRON_SECRET` = ข้อความสุ่มยาว ๆ (ใช้ป้องกันตัวตั้งเวลา)
3. Redeploy
4. (ไม่บังคับ) `PUSH_QUIET_HOURS` = `22-8` (ค่าเริ่มต้น: ไม่เด้งข้อความใหม่ 22:00–08:00) หรือ `off`

## 2. ให้ทุกคนเปิดบนเครื่องตัวเอง
เข้าเว็บ → เมนูบัญชี (User Account) → การ์ด "แจ้งเตือนบนมือถือ" → "เปิดแจ้งเตือนบนเครื่องนี้" → "ส่งทดสอบ"
- **Android (Chrome):** กดเมนู ⋮ → "ติดตั้งแอป" / "เพิ่มลงหน้าจอหลัก" แล้วเปิดแจ้งเตือน
- **iPhone:** ต้อง iOS 16.4+ เปิดด้วย Safari → ปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" → เปิดจากไอคอน แล้วค่อยกด "เปิดแจ้งเตือน"

## 3. ตัวตั้งเวลา (สำหรับเตือน "ใกล้เกิน 15 นาที" และ "แชทค้าง")
Vercel แผนฟรีตั้ง Cron ได้วันละครั้ง จึงใช้บริการภายนอกฟรีเรียกทุก 5 นาที เช่น cron-job.org:
- URL: `https://<โดเมนของคุณ>/api/notify/tick?interval=5`
- Header: `Authorization: Bearer <CRON_SECRET>`  (หรือใส่ `&key=<CRON_SECRET>` ที่ท้าย URL ถ้าบริการไม่รองรับ header)
- ความถี่: ทุก 5 นาที ให้ตรงกับค่า `interval`
ถ้าไม่ตั้งส่วนนี้ การแจ้งเตือน "ข้อความใหม่" ยังทำงานตามปกติ (มาจาก Webhook) แต่จะไม่มีเตือนก่อนเกินเวลา/แชทค้าง

## หมายเหตุ
- ข้อมูลการสมัครรับแจ้งเตือนเก็บแบบ AES-256-GCM ในแท็บ `push_subs`; endpoint ในชีตเป็น SHA-256 hash ส่วน secret ต้องเก็บใน Vercel เท่านั้น แถวเก่าที่เป็น plaintext จะถูกย้ายและล้างค่าเดิมเมื่อระบบอ่านการสมัครครั้งถัดไป
- Google service account ต้องมีสิทธิ์ Editor ในชีตเพื่อบันทึกการสมัครและประวัติการแจ้งเตือน
- ประวัติและ dedupe ของข้อความเข้า/การแจ้งด้วยมือเก็บใน `notification_log` แท็บถูกสร้างให้อัตโนมัติ จำกัดสิทธิ์เปิด Google Sheet เหมือนข้อมูลลูกค้า
- การแจ้งซ้ำถูกกันด้วย key และ audit row แต่ Google Sheets ไม่มี transaction/unique constraint ข้ามหลาย Vercel instances จึงรับประกันการกันซ้ำพร้อมกันแบบเด็ดขาดไม่ได้
- ข้อความเข้าใหม่จาก Messenger, Instagram, LINE และ WhatsApp เข้า Web Push ชุดเดียวกันโดย dedupe ด้วย message ID; Messenger echo ที่ไม่มีข้อมูลผู้ส่งถูกเก็บเป็น `unknown`
- ข้อความปิดบทสนทนา (ขอบคุณ/โอเค/สติกเกอร์) ไม่ส่งแจ้งเตือน
- วันอังคาร (วันหยุด) ไม่เตือนเรื่องใกล้เกิน 15 นาที
- ต้องเปิดแจ้งเตือนในแต่ละเครื่อง/เบราว์เซอร์แยกกัน
- iPhone/iPad ต้อง iOS/iPadOS 16.4+ และเพิ่มเว็บไปยังหน้าจอโฮมก่อนเปิด Web Push; ต้องใช้ HTTPS และอนุญาตแจ้งเตือนในเบราว์เซอร์/ระบบปฏิบัติการ

## LINE และ WhatsApp สำหรับแจ้งเตือนเซลล์ (ไม่บังคับ)

แจ้งเตือนชุดเดียวกับ Web Push (ตอบภายใน 5 นาที / เกิน 15 นาที / ค้างนาน / ข้อความใหม่) จะส่งไปทาง LINE และ WhatsApp ได้เมื่อผู้รับมีรหัสในชีต ส่วนการรับแชทลูกค้าและตอบกลับจาก Inbox ตั้งค่าที่หน้า Upload → **เชื่อมช่องทางแชท** ตาม `docs/DEPLOY.md` §6d

### 1) ชีต `notify_contacts` (สร้างแท็บใหม่)
| user_id | line_user_id | whatsapp |
|---|---|---|
| U-R1 | Uxxxxxxxx… | 66812345678 |

`user_id` ต้องตรงกับแท็บ `users` · `whatsapp` ใส่เบอร์รหัสประเทศ ไม่มี + หรือ 0 นำหน้า · เว้นว่างได้ถ้าไม่ใช้ช่องทางนั้น

### 2) LINE (Messaging API)
1. สร้าง LINE Official Account + เปิด Messaging API ที่ LINE Developers
2. หากใช้ OA นี้รับแชทลูกค้า ให้เชื่อม Channel ID, Channel Access Token และ Channel Secret ในหน้า Upload → **เชื่อมช่องทางแชท** ก่อน; Webhook จะยืนยันลายเซ็นด้วย Secret ที่บันทึกในชีต
3. สำหรับส่งแจ้งเตือนไปยังเซลล์ ตั้ง Vercel env: `LINE_CHANNEL_ACCESS_TOKEN` (long-lived) และ `LINE_CHANNEL_SECRET`; ถ้าใช้ OA เดียวกัน ให้ใช้ Token/Secret ชุดเดียวกัน
4. ตั้ง Webhook URL เป็น `https://<โดเมน>/api/webhook/line` และเปิด Webhook sending; ห้ามตอบ userId กลับอัตโนมัติอีกต่อไป เพราะ Webhook ใช้รับแชทลูกค้า
5. ให้เซลล์เพิ่ม OA เป็นเพื่อน และเก็บ LINE userId จาก `source.userId` ใน Webhook event ลงช่อง `line_user_id`
6. LINE Notify ปิดบริการแล้ว ต้องใช้ Messaging API · โควตาข้อความฟรีมีจำกัด ตรวจแพ็กเกจของ OA

### 3) WhatsApp (Cloud API)
1. WhatsApp Business Platform: เบอร์ผู้ส่ง + token ถาวร (System User)
2. สร้างและรออนุมัติ **message template** ที่มีตัวแปรเดียว `{{1}}` สำหรับการแจ้งเตือนที่ธุรกิจเริ่มแชทก่อน
3. Vercel env: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` (ค่าเริ่มต้น `th`)
4. หากใช้เบอร์เดียวกันรับแชทลูกค้า ให้เชื่อม Phone Number ID, Access Token และ Meta App Secret ในหน้า Upload → **เชื่อมช่องทางแชท**; Callback URL และ Verify Token สำหรับรับแชทแสดงในแผงเดียวกัน
5. ข้อความธุรกิจเริ่มแชทมีค่าใช้จ่ายตามเรทของ Meta — ไม่ฟรีทั้งหมด

### 4) ทดสอบ
ล็อกอินแล้วเรียก `POST /api/push/test` (ปุ่มทดสอบในหน้า Account) — ส่งถึงตัวเองทุกช่องทางที่ตั้งค่าไว้
`APP_URL` (ไม่บังคับ) = โดเมนที่ใช้ในลิงก์ของข้อความ
