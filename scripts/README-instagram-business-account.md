# ตรวจ User Access Token กับ Instagram Business Account

สคริปต์ `test-instagram-business-account.mjs` เป็นการตรวจแบบ **read-only**: เรียก `me`, `me/permissions`, `me/accounts` และอ่าน Page fields `instagram_business_account{id,username}` เท่านั้น ไม่มีการ subscribe webhook แก้ค่าบนเพจ หรือเขียนข้อมูลกลับ Meta

การอ่าน field `instagram_business_account` ต้องใช้ **User Access Token** ของผู้ใช้ที่มี Page task ที่เหมาะสม ไม่ใช่ Page Access Token ตาม [Meta Page reference](https://developers.facebook.com/docs/graph-api/reference/page/). สำหรับ Business System User อาจต้องมี `business_management` ด้วย

## วิธีรัน

ใช้ Node.js 20 ขึ้นไป บนเครื่องหรือ shell ที่ต้องการตรวจจริง ตั้ง Page ID แล้วป้อน token ด้วย prompt แบบซ่อนข้อความ เพื่อไม่ให้ token อยู่ใน shell history:

```bash
export FB_PAGE_ID="ใส่_NUMERIC_PAGE_ID"
read -r -s -p "Meta User Access Token: " META_USER_ACCESS_TOKEN; printf '\n'
export META_USER_ACCESS_TOKEN
node scripts/test-instagram-business-account.mjs
status=$?
unset META_USER_ACCESS_TOKEN
exit "$status"
```

สคริปต์รองรับ `FB_USER_ACCESS_TOKEN` แทน `META_USER_ACCESS_TOKEN` และ `META_PAGE_ID` แทน `FB_PAGE_ID` ได้เช่นกัน ค่า Graph API เริ่มต้นคือ `v27.0`; หากต้องการ override ให้ตั้ง `META_API_VERSION` เช่น `v27.0` ส่วน `FB_GRAPH_BASE` ใช้เฉพาะกรณีที่ต้องกำหนด Graph API host เอง

สคริปต์ส่ง token ผ่าน `Authorization` header เท่านั้น ไม่รับ token จาก command-line argument และไม่แสดงค่า token หากคำขอสำเร็จ จะรายงาน User identity, สถานะการมองเห็นเพจใน `/me/accounts` และ Instagram account ID/username พร้อม `RESULT: PASS` เมื่ออ่าน `instagram_business_account` ได้

ถ้าขึ้น `RESULT: FAIL` ให้ตรวจ error code และ trace ID ที่สคริปต์แสดง จากนั้นตรวจว่า token ยังใช้ได้ เป็น User token ของแอปที่ถูกต้อง ผู้ใช้มีสิทธิ์/งานกับเพจ และแอปได้รับ permissions ที่จำเป็น เช่น `instagram_basic` หรือ `pages_show_list` ตามคำขอที่ล้มเหลว ค่า `instagram_business_account` ที่เป็น `null` อาจหมายถึงเพจยังไม่ผูกบัญชี Instagram Professional หรือ token/app ยังไม่มีสิทธิ์อ่านความสัมพันธ์นั้น
