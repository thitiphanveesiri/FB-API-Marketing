// SERVER ONLY. Same gate as /api/mutate, plus: Administrators only (these routes touch customer conversations / secrets).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfigured, resolveUser, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getCached, setCached } from "@/lib/sheetCache";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets, type MapResult } from "@/lib/sheetMapper";
import type { User } from "@/lib/types";
import { isSameOrigin } from "@/lib/requestOrigin";

export const noStore = { headers: { "Cache-Control": "no-store" } };
export const fail = (status: number, message: string, extra: object = {}) => NextResponse.json({ ok: false, message, ...extra }, { status, ...noStore });

/** Reads the sheet; a failure (quota 429, network) becomes a JSON answer the pages know how to wait on instead of an HTML 500. */
async function readMapped(): Promise<{ mapped: MapResult } | { err: NextResponse }> {
  const hit = getCached(); if (hit) return { mapped: hit };
  try { const mapped = mapSheets(await readTabs()); setCached(mapped); return { mapped }; }
  catch (e) { const m = e instanceof Error ? e.message : ""; const quota = /\b429\b/.test(m); return { err: fail(quota ? 429 : 502, quota ? "Google Sheets จำกัดจำนวนคำขอ — รอสักครู่แล้วระบบจะลองต่อ" : `อ่านข้อมูลจาก Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง${m ? ` (${m.replace(/EAA[\w-]{20,}/g, "…").slice(0, 140)})` : ""}`, { rateLimited: quota }) }; }
}

export async function adminOnly(req: Request, write: boolean): Promise<{ err: NextResponse } | { mapped: MapResult }> {
  if (!sheetsConfigured()) return { err: fail(503, "ยังไม่ได้เชื่อม Google Sheet") };
  if (write && !isSameOrigin(req)) return { err: fail(403, "Bad origin") };
  let session = null as { uid: string } | null;
  if (authConfigured()) { session = verifySession((await cookies()).get(SESSION_COOKIE)?.value); if (!session) return { err: fail(401, "กรุณาล็อกอินใหม่") }; }
  else if (process.env.ALLOW_PUBLIC !== "1") return { err: fail(503, "ยังไม่ได้ตั้งค่าการล็อกอิน") };
  const rd = await readMapped(); if ("err" in rd) return { err: rd.err }; const mapped = rd.mapped;
  const me = session ? resolveUser(mapped.dataset, session.uid) : mapped.dataset.users.find((u) => u.role === "Administrator") ?? null;
  if (!me || me.role !== "Administrator") return { err: fail(403, "เฉพาะผู้ดูแลระบบเท่านั้น") };
  return { mapped };
}

/** Any signed-in user with a role; returns the full (unscoped) dataset for server-side checks. */
export async function userGate(req: Request): Promise<{ err: NextResponse } | { mapped: MapResult; me: User }> {
  if (!sheetsConfigured()) return { err: fail(503, "ยังไม่ได้เชื่อม Google Sheet") };
  if (!isSameOrigin(req)) return { err: fail(403, "Bad origin") };
  let session = null as { uid: string } | null;
  if (authConfigured()) { session = verifySession((await cookies()).get(SESSION_COOKIE)?.value); if (!session) return { err: fail(401, "กรุณาล็อกอินใหม่") }; }
  else if (process.env.ALLOW_PUBLIC !== "1") return { err: fail(503, "ยังไม่ได้ตั้งค่าการล็อกอิน") };
  const rd = await readMapped(); if ("err" in rd) return { err: rd.err }; const mapped = rd.mapped;
  const me = session ? resolveUser(mapped.dataset, session.uid) : mapped.dataset.users.find((u) => u.role === "Administrator") ?? null;
  if (!me) return { err: fail(403, "บัญชีนี้ไม่มีสิทธิ์เข้าใช้") };
  return { mapped, me };
}
