// SERVER ONLY. Same gate as /api/mutate, plus: Administrators only (these routes touch customer conversations / secrets).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfigured, resolveUser, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getCached, setCached } from "@/lib/sheetCache";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets, type MapResult } from "@/lib/sheetMapper";

export const noStore = { headers: { "Cache-Control": "no-store" } };
export const fail = (status: number, message: string, extra: object = {}) => NextResponse.json({ ok: false, message, ...extra }, { status, ...noStore });

export async function adminOnly(req: Request, write: boolean): Promise<{ err: NextResponse } | { mapped: MapResult }> {
  if (!sheetsConfigured()) return { err: fail(503, "ยังไม่ได้เชื่อม Google Sheet") };
  if (write) { const origin = req.headers.get("origin"); if (origin && origin !== new URL(req.url).origin) return { err: fail(403, "Bad origin") }; }
  let session = null as { email: string; name: string } | null;
  if (authConfigured()) { session = verifySession((await cookies()).get(SESSION_COOKIE)?.value); if (!session) return { err: fail(401, "กรุณาล็อกอินใหม่") }; }
  else if (process.env.ALLOW_PUBLIC !== "1") return { err: fail(503, "ยังไม่ได้ตั้งค่าการล็อกอิน") };
  const mapped = getCached() ?? mapSheets(await readTabs()); setCached(mapped);
  const me = session ? resolveUser(mapped.dataset, session.email, session.name) : mapped.dataset.users.find((u) => u.role === "Administrator") ?? null;
  if (!me || me.role !== "Administrator") return { err: fail(403, "เฉพาะผู้ดูแลระบบเท่านั้น") };
  return { mapped };
}
