import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth";
import { upsertRows } from "@/lib/sheetsWrite";
import { invalidateCache } from "@/lib/sheetCache";

// The ONLY place a password can be set or changed, and only an Administrator may call it. Users cannot change their own.
export async function POST(req: Request) {
  await connection();
  const gate = await adminOnly(req, true);
  if ("err" in gate) return gate.err;
  const b = (await req.json().catch(() => null)) as { userId?: unknown; password?: unknown } | null;
  const userId = typeof b?.userId === "string" ? b.userId : "", password = typeof b?.password === "string" ? b.password : "";
  const user = gate.mapped.dataset.users.find((u) => u.id === userId);
  if (!user) return fail(404, "ไม่พบผู้ใช้");
  if (!user.username) return fail(400, "ตั้งชื่อผู้ใช้ (username) ให้คนนี้ก่อน");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return fail(400, `รหัสผ่านต้องยาว ${PASSWORD_MIN}-${PASSWORD_MAX} ตัวอักษร`);
  await upsertRows("users", ["user_id"], [{ user_id: userId, password_hash: await hashPassword(password) }], "updateOnly");
  invalidateCache();
  return NextResponse.json({ ok: true }, noStore);
}
