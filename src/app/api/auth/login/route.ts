import { connection, NextResponse } from "next/server";
import { authConfigured, authorizeUrl, newPkce, newState, OAUTH_COOKIE, safeNext, secureCookies, signToken } from "@/lib/auth";

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  if (!authConfigured()) return NextResponse.redirect(new URL("/login?error=config", url.origin));
  const { verifier, challenge } = newPkce();
  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(req.url, state, challenge));
  res.cookies.set(OAUTH_COOKIE, signToken({ typ: "oauth", state, verifier, next: safeNext(url.searchParams.get("next")) }, 600),
    { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/api/auth", maxAge: 600 });
  return res;
}
