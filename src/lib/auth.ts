// SERVER ONLY. Google Sign-In (OIDC code flow + PKCE) with a signed session cookie. No extra dependencies.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Dataset } from "./dataset";
import type { User } from "./types";

export const SESSION_COOKIE = "mid_session";
export const OAUTH_COOKIE = "mid_oauth";
export const SESSION_TTL_S = 7 * 24 * 3600;

const env = (k: string) => (process.env[k] ?? "").trim();
export const authConfigured = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("AUTH_SECRET").length >= 32);
export const secureCookies = () => process.env.NODE_ENV === "production" && !env("AUTH_INSECURE_COOKIES");
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/* ---------- signed tokens (HMAC-SHA256) ---------- */
function mac(data: string): Buffer { return createHmac("sha256", env("AUTH_SECRET")).update(data).digest(); }
export function signToken(payload: Record<string, unknown>, ttlS: number): string {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlS }));
  return `${body}.${b64u(mac(body))}`;
}
export function verifyToken<T extends { typ: string; exp: number }>(token: string | undefined, typ: T["typ"]): T | null {
  if (!token || !authConfigured()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig, "base64url"), want = mac(body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return p.typ === typ && typeof p.exp === "number" && p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch { return null; }
}
export interface SessionPayload { typ: "session"; email: string; name: string; exp: number }
export interface OAuthPayload { typ: "oauth"; state: string; verifier: string; next: string; exp: number }
export const makeSession = (email: string, name: string) => signToken({ typ: "session", email: email.toLowerCase(), name }, SESSION_TTL_S);
export const verifySession = (t: string | undefined) => verifyToken<SessionPayload>(t, "session");

/* ---------- OAuth helpers ---------- */
export const safeNext = (n: string | null | undefined) => {
  if (!n || !n.startsWith("/") || /[\u0000-\u001f\u007f]/.test(n)) return "/dashboard/ads";
  try {
    const decoded = decodeURIComponent(n);
    if (/[\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//") || decoded.startsWith("/\\")) return "/dashboard/ads";
    const base = "https://beq.invalid";
    const url = new URL(decoded, base);
    if (url.origin !== base || url.username || url.password || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return "/dashboard/ads";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard/ads";
  }
};
export const redirectUri = (reqUrl: string) => `${env("AUTH_URL") ? env("AUTH_URL").replace(/\/$/, "") : new URL(reqUrl).origin}/api/auth/callback`;
export const newPkce = () => { const verifier = b64u(randomBytes(32)); return { verifier, challenge: b64u(createHash("sha256").update(verifier).digest()) }; };
export const newState = () => b64u(randomBytes(24));

export function authorizeUrl(reqUrl: string, state: string, challenge: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(reqUrl), response_type: "code", scope: "openid email profile", state,
    code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
  return u.toString();
}
export interface GoogleIdentity { email: string; name: string }
/** Exchanges the code and validates the ID token claims. The token comes straight from Google's token endpoint over TLS,
 *  which OIDC Core §3.1.3.7 accepts in place of signature verification. Returns null on any problem. */
export type ExchangeResult = { ok: true; who: GoogleIdentity } | { ok: false; reason: string };
export async function exchangeCode(reqUrl: string, code: string, verifier: string): Promise<ExchangeResult> {
  const no = (reason: string): ExchangeResult => { console.error("[auth] code exchange failed:", reason); return { ok: false, reason }; };
  const base = env("GOOGLE_OAUTH_BASE_URL") || "https://oauth2.googleapis.com"; // override is for automated tests only
  const res = await fetch(`${base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri(reqUrl), grant_type: "authorization_code", code_verifier: verifier }) });
  if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }; console.error("[auth] google said:", j.error_description ?? ""); return no(/^[a-z_]{1,40}$/.test(j.error ?? "") ? j.error! : `http_${res.status}`); }
  const idToken = ((await res.json()) as { id_token?: string }).id_token;
  if (!idToken) return no("no_id_token");
  try {
    const c = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { iss: string; aud: string; exp: number; email?: string; email_verified?: boolean; name?: string };
    const okIss = c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
    if (!okIss) return no("bad_issuer");
    if (c.aud !== env("GOOGLE_CLIENT_ID")) return no("audience_mismatch");
    if (c.exp < Math.floor(Date.now() / 1000)) return no("token_expired");
    if (!c.email || c.email_verified !== true) return no("email_not_verified");
    return { ok: true, who: { email: c.email.toLowerCase(), name: c.name || c.email } };
  } catch { return no("bad_token"); }
}

/* ---------- allow-list ---------- */
const adminEmails = () => env("AUTH_ADMIN_EMAILS").toLowerCase().split(/[,;\s]+/).filter(Boolean);
/** The `users` tab is the allow-list. AUTH_ADMIN_EMAILS is a break-glass list that is always allowed (as Administrator),
 *  so you can sign in and set things up even when the sheet is empty. Disabled sheet users are refused. */
export function resolveUser(ds: Dataset, email: string, name: string): User | null {
  const e = email.toLowerCase();
  const hit = ds.users.find((u) => u.email.trim().toLowerCase() === e);
  if (hit) return hit.active ? hit : null;
  if (adminEmails().includes(e)) return { id: `U-ADMIN-${e}`, name, email: e, role: "Administrator", active: true, hue: 160 };
  return null;
}
