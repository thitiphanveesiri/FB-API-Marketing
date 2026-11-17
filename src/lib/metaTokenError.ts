export type MetaTokenKind = "facebook" | "ads";

export function isExpiredMetaToken(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? Number(error.code) : undefined;
  const message = error instanceof Error ? error.message : "";
  return code === 190 || /session has expired|error validating access token/i.test(message);
}

export function expiredMetaTokenMessage(kind: MetaTokenKind): string {
  if (kind === "ads") {
    return "Meta แจ้งว่าโทเคนบัญชีโฆษณาหมดอายุหรือถูกยกเลิก ไปที่ Upload → เชื่อมช่องทางแชท → โฆษณา → แก้ไขบัญชี แล้วใส่ Access Token ใหม่ที่มีสิทธิ์ ads_read จากนั้นลองดึงอีกครั้ง";
  }
  return "Meta แจ้งว่าโทเคนเพจที่ระบบใช้อยู่หมดอายุหรือถูกยกเลิก ไปที่ Upload → เชื่อมช่องทางแชท → แก้ไขเพจ แล้วบันทึก Access Token ใหม่ จากนั้นลองดึงอีกครั้ง หากเพจนี้ยังไม่ได้เชื่อมใน Upload ให้ตรวจ FB_PAGES หรือ FB_PAGE_TOKEN ใน Vercel แล้ว Redeploy (ถ้ามีเพจเดียวกันในทั้งสองที่ ระบบใช้ค่าจาก Upload)";
}
