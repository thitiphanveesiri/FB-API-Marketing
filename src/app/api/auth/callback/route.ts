import { connection, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfigured, exchangeCode, makeSession, OAUTH_COOKIE, OAuthPayload, safeNext, secureCookies, SESSION_COOKIE, SESSION_TTL_S, verifyToken } from "@/lib/auth";

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const fail = (code: string) => { const r = NextResponse.redirect(new URL(`/login?error=${code}`, url.origin)); r.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" }); return r; };
  if (!authConfigured()) return fail("config");
  const o = verifyToken<OAuthPayload>((await cookies()).get(OAUTH_COOKIE)?.value, "oauth");
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return fail("denied");
  if (!o || !code || !state || state !== o.state) return fail("state");
  const who = await exchangeCode(req.url, code, o.verifier).catch(() => null);
  if (!who) return fail("google");
  const res = NextResponse.redirect(new URL(safeNext(o.next), url.origin));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  // Membership in the `users` tab is checked on every /api/data call, so the cookie only proves "this is a verified Google account".
  res.cookies.set(SESSION_COOKIE, makeSession(who.email, who.name), { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_TTL_S });
  return res;
}
