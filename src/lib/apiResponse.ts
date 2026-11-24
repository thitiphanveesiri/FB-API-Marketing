export type ApiResult = { ok: true } | { ok: false; message: string };

export async function readApiBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function apiErrorMessage(body: unknown, response: Response, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string" && body.message.trim())
    return body.message.trim();
  if (response.status === 400) return "ข้อมูลที่ส่งไปไม่ถูกต้อง กรุณาตรวจสอบไฟล์แล้วลองอีกครั้ง";
  if (response.status === 401) return "กรุณาล็อกอินใหม่";
  if (response.status === 403) return "คำขอถูกปฏิเสธ กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง";
  if (response.status === 413) return "ไฟล์ใหญ่เกินไป กรุณาแยกไฟล์แล้วอัปโหลดทีละส่วน";
  if (response.status === 429) return "Google Sheets กำลังจำกัดจำนวนคำขอ กรุณารอสักครู่แล้วลองอีกครั้ง";
  if (response.status >= 500) return `เซิร์ฟเวอร์ทำงานไม่สำเร็จ (HTTP ${response.status}) กรุณาลองอีกครั้ง`;
  return `${fallback} (HTTP ${response.status})`;
}

export async function readMutationResult(response: Response): Promise<ApiResult> {
  const body = await readApiBody(response);
  if (response.ok && body && typeof body === "object" && "ok" in body && body.ok === true) return { ok: true };
  return { ok: false, message: apiErrorMessage(body, response, "บันทึกไม่สำเร็จ") };
}
