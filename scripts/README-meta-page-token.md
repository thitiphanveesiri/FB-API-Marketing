# ตรวจ Token, Page list และ Page tasks ของ Meta

`check-meta-page-token.mjs` เป็น diagnostic แบบ read-only สำหรับ User Access Token ที่ระบบใช้เชื่อม Page และ Ad Account โดยตรวจ `me`, สิทธิ์ที่ Meta แสดงจริงผ่าน `me/permissions`, รายการ `me/accounts` พร้อม Page tasks และ Page Access Token ที่ส่งกลับมา รวมถึงทดสอบ Ad Account หรือโพสต์ต้นทางได้เมื่อระบุค่าเพิ่ม สคริปต์ไม่แก้ Page หรือบัญชีโฆษณา และไม่แสดง token, ข้อความโพสต์ หรือ access token ของ Page

การเปิด permission ใน App Dashboard ไม่ได้ทำให้ token ที่ออกไว้ก่อนหน้าได้รับ permission นั้นโดยอัตโนมัติ สคริปต์จะแสดง `granted`, `declined` หรือ `not returned` ตามผลที่ Meta ส่งให้ token ที่กำลังตรวจ และจะบอกแยกว่ามองเห็น Page ใดใน `/me/accounts` พร้อม tasks ที่ token นั้นมี

## วิธีรันโดยไม่ใส่ token ใน shell history

ใช้ Node.js 20 ขึ้นไป เปิด terminal ใน repository A แล้วตั้งค่าที่ต้องการตรวจ ส่วน token ให้ป้อนผ่าน prompt ที่ไม่แสดงตัวอักษร:

```bash
export FB_PAGE_ID="NUMERIC_PAGE_ID"                 # ไม่บังคับ; จำกัดรายละเอียด Page ที่แสดง
export META_TEST_AD_ACCOUNT_ID="NUMERIC_AD_ACCOUNT_ID" # ไม่บังคับ; รองรับ act_ นำหน้า
export META_TEST_STORY_ID="PAGE_ID_POST_ID"           # ไม่บังคับ; ใช้ Page token ของ Page ต้นทาง
read -r -s -p "Meta User Access Token: " META_USER_ACCESS_TOKEN; printf '\n'
export META_USER_ACCESS_TOKEN
node scripts/check-meta-page-token.mjs
status=$?
unset META_USER_ACCESS_TOKEN
exit "$status"
```

อย่าวาง token เป็น argument เช่น `node ... TOKEN`, อย่าวาง token ใน source code, `.env` ที่ถูก commit, log หรือแชต. หากต้องการดูตัวเลือก ให้รัน `node scripts/check-meta-page-token.mjs --help` โดยไม่ต้องตั้ง token

## การอ่านผล

`/me` สำเร็จแปลว่า token ใช้งานได้ ณ เวลาตรวจ แต่สคริปต์ไม่ได้เรียก `/debug_token` จึงไม่รายงานวันหมดอายุหรือชนิด token อย่างเป็นทางการ ส่วน `me/permissions` แสดงสถานะสิทธิ์ที่ Meta คืนมาสำหรับ token นี้จริง ไม่ใช่สถานะการตั้งค่าใน App Dashboard

`/me/accounts` แสดง Pages ที่ผู้ใช้/Business สามารถเข้าถึงด้วย token นี้ ค่า `tasks` คือ Page tasks ที่ Meta คืนมา; ให้ตรวจว่ามีงานที่เหมาะกับการจัดการ/อ่านเนื้อหา Page ต้นทางหรือไม่ (เช่น `MODERATE` ตาม operation ที่ต้องใช้) หาก Page ไม่อยู่ในรายการ ให้ตรวจ `pages_show_list`, การ assign Page ให้ผู้ใช้หรือ Business System User และ Page access โดยตรง การมองเห็น Page กับการอ่านโพสต์เป็นคนละการตรวจ

ถ้าตั้ง `META_TEST_AD_ACCOUNT_ID` สคริปต์จะอ่านข้อมูลพื้นฐานของบัญชีด้วย User Access Token เพื่อทดสอบว่า token เห็นบัญชีจริง ไม่ใช่เพียงมี `ads_read` ปรากฏใน permission list ถ้าตั้ง `META_TEST_STORY_ID` สคริปต์จะหา Page Access Token ของ Page ID ที่อยู่หน้าขีดล่าง แล้วเรียกโพสต์ด้วย token นั้นเท่านั้น หากไม่มี Page token การตรวจโพสต์จะถูกข้าม ไม่ใช้ Ad Account token แทน

ผลจากสคริปต์เป็นการวินิจฉัย token ที่ป้อนในครั้งนั้นเท่านั้น ไม่สามารถยืนยัน token production ที่เก็บใน Google Sheet ได้ เว้นแต่ผู้ใช้จะรันบนสภาพแวดล้อมที่เก็บ token นั้นและป้อนค่าอย่างปลอดภัยเอง
