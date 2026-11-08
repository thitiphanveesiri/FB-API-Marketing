import { connection, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// POST only (a GET link could be triggered cross-site). SameSite=Lax cookies are not sent on cross-site POSTs anyway.
export async function POST(req: Request) {
  await connection();
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ ok: false }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return res;
}
