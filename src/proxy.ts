import { NextRequest, NextResponse } from "next/server";
import { authConfigured, SESSION_COOKIE, verifySession } from "@/lib/auth";

// Gate every page: no valid signed session -> /login. (/api/data re-checks on its own; this only stops the app shell loading.)
export function proxy(req: NextRequest) {
  if (!authConfigured()) return NextResponse.next();
  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const to = new URL("/login", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") to.searchParams.set("next", next);
  return NextResponse.redirect(to);
}

export const config = { matcher: ["/((?!login|api/|_next/|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:png|jpg|jpeg|svg|ico|webp|xlsx|csv|txt)$).*)"] };
