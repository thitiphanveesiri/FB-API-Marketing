import { connection, NextResponse } from "next/server";
import { authConfigured, lockedFor, makeSession, noteFailure, noteSuccess, PASSWORD_MAX, safeNext, secureCookies, SESSION_COOKIE, SESSION_TTL_S, verifyPassword } from "@/lib/auth";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { isSameOrigin } from "@/lib/requestOrigin";

const no = (status: number, message: string) => NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  await connection();
  if (!isSameOrigin(req)) return no(403, "Bad origin");
  if (!authConfigured() || !sheetsConfigured()) return no(503, "ระบบล็อกอินยังไม่ได้ตั้งค่า");
  const b = (await req.json().catch(() => null)) as { username?: unknown; password?: unknown; next?: unknown } | null;
  const username = typeof b?.username === "string" ? b.username.trim().toLowerCase().slice(0, 64) : "";
  const password = typeof b?.password === "string" ? b.password : "";
  if (!username || !password || password.length > PASSWORD_MAX) return no(400, "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
  const key = `${username}|${(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()}`;
  const wait = lockedFor(key);
  if (wait) return no(429, `ใส่รหัสผิดหลายครั้ง กรุณารอ ${Math.ceil(wait / 60000)} นาที`);

  // The hash is read straight from the raw users tab; it is never part of the dataset sent to browsers.
  const grid = (await readTabs()).users ?? [];
  const head = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const row = grid.slice(1).find((r) => String(r[col("username")] ?? "").trim().toLowerCase() === username);
  const cell = (n: string) => (row && col(n) >= 0 ? String(row[col(n)] ?? "").trim() : "");
  const active = !["false", "no", "0"].includes(cell("active").toLowerCase()); // blank = active, like the mapper
  const ok = await verifyPassword(password, cell("password_hash") || undefined);
  if (!row || !ok || !active || !cell("user_id")) { noteFailure(key); return no(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"); }
  noteSuccess(key);
  const res = NextResponse.json({ ok: true, next: safeNext(typeof b?.next === "string" ? b.next : null) }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, makeSession(cell("user_id"), cell("name")), { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_TTL_S });
  return res;
}
