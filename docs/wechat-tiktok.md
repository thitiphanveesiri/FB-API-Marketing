# WeChat และ TikTok

## WeChat (ใช้ได้เลยเมื่อมีบัญชี)
ต้องมี **WeChat Official Account** (Service หรือ Subscription) ที่ผ่านการยืนยันตัวตน (มีค่ายืนยันรายปี ตรวจราคาที่ WeChat) บัญชีที่ยังไม่ยืนยันใช้ API ตอบลูกค้าไม่ได้

1. ในแอป: หน้า Upload → การ์ด “LINE, WhatsApp และ WeChat” → **+ เชื่อม WeChat** ใส่ AppID, AppSecret, เลือกเพจที่จะเก็บแชท (Token เว้นว่าง = สุ่มให้)
2. WeChat → Settings & development → Basic configuration → Server configuration:
   - URL = `https://<โดเมนของคุณ>/api/webhook/wechat`
   - Token = ค่า Token ที่แสดงในการ์ด (ตัวอักษรอังกฤษ/เลข 3–32 ตัว)
   - Message encryption mode = **Plain text** (โหมดเข้ารหัสยังไม่รองรับ)
3. เพิ่ม IP ของเซิร์ฟเวอร์ใน **IP whitelist** (ไม่งั้นขอ access token ไม่ได้ ระบบจะแจ้ง error 40164) — Vercel ไม่มี IP คงที่ จึงอาจต้องใช้ proxy ที่มี IP คงที่ ข้อนี้ยังไม่ได้ตรวจกับ WeChat จริง
4. ตอบกลับได้ภายใน 48 ชั่วโมงหลังลูกค้าทักมาล่าสุด รับข้อความตัวอักษรและรูป (รูปแสดงเป็น “[รูปภาพ]”)

## TikTok (ยังรับข้อความเข้าแชทไม่ได้)
- `/api/webhook/tiktok` ตรวจลายเซ็น `TikTok-Signature` (`t=…,s=…`, HMAC-SHA256 ของ `t.body` ด้วย client secret) ตามเอกสาร TikTok ต้องตั้ง `TIKTOK_CLIENT_SECRET`
- เมื่อลายเซ็นถูก ระบบ **บันทึกเฉพาะโครงสร้าง** (ชื่อฟิลด์และชนิด ไม่มีค่า) ลง log ของเซิร์ฟเวอร์ ยังไม่บันทึกเป็นแชท เพราะรูปแบบ payload ข้อความของ TikTok อ่านได้เฉพาะหลังแอปได้รับอนุมัติ Business Messaging API
- ขั้นต่อไป: ขอสิทธิ์ Business Messaging API จาก TikTok → ลูกค้าทักมา 1 ครั้ง → ส่งโครงสร้างใน log มาให้ → เขียน parser แบบเดียวกับ `wechatWebhook.ts` และเพิ่มการส่งตอบ
