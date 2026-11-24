import { connection, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { isSameOrigin } from "@/lib/requestOrigin";

// POST only (a GET link could be triggered cross-site). SameSite=Lax cookies are not sent on cross-site POSTs anyway.
export async function POST(req: Request) {
  await connection();
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return res;
}
