// SERVER ONLY. Username + password sign-in (scrypt) with a signed session cookie. No extra dependencies.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";
import type { Dataset } from "./dataset";
import type { User } from "./types";

export const SESSION_COOKIE = "mid_session";
export const SESSION_TTL_S = 7 * 24 * 3600;

const env = (k: string) => (process.env[k] ?? "").trim();
export const authConfigured = () => env("AUTH_SECRET").length >= 32;
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
export interface SessionPayload { typ: "session"; uid: string; name: string; exp: number }
export const makeSession = (uid: string, name: string) => signToken({ typ: "session", uid, name }, SESSION_TTL_S);
export const verifySession = (t: string | undefined) => { const p = verifyToken<SessionPayload>(t, "session"); return p?.uid ? p : null; }; // old Google-era cookies have no uid

/* ---------- redirect helper ---------- */
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

/* ---------- username + password ---------- */
// Only an Administrator can set a password (POST /api/users/password); there is no self-service change or reset.
const scryptAsync = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scrypt(pw, salt, 32, (e, k) => (e ? rej(e) : res(k))));
export const PASSWORD_MIN = 8, PASSWORD_MAX = 128;
export const usernameOk = (u: string) => /^[a-z0-9._-]{3,32}$/.test(u);
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await scryptAsync(pw, salt)).toString("base64url")}`;
}
const DUMMY = `scrypt$${"A".repeat(22)}$${"A".repeat(43)}`; // lets an unknown username cost the same time as a wrong password
export async function verifyPassword(pw: string, stored: string | undefined): Promise<boolean> {
  const [alg, salt, hash] = (stored || DUMMY).split("$");
  if (alg !== "scrypt" || !salt || !hash || pw.length > PASSWORD_MAX) return false;
  const want = Buffer.from(hash, "base64url"), got = await scryptAsync(pw, Buffer.from(salt, "base64url"));
  return want.length === got.length && timingSafeEqual(want, got) && !!stored;
}

/** Failed-attempt limiter, keyed by username+IP. shortcut: in memory per server instance, so a determined attacker spread over
 *  many serverless instances gets more tries; move to the database/Upstash if the login page is ever attacked. */
const fails = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;
export function lockedFor(key: string, now = Date.now()): number {
  const f = fails.get(key); if (!f) return 0;
  if (f.until && f.until <= now) { fails.delete(key); return 0; }
  return f.until ? f.until - now : 0;
}
export function noteFailure(key: string, now = Date.now()) {
  if (fails.size > 5000) fails.clear(); // bound memory
  const f = fails.get(key) ?? { n: 0, until: 0 }; f.n++;
  if (f.n >= MAX_FAILS) f.until = now + LOCK_MS;
  fails.set(key, f);
}
export const noteSuccess = (key: string) => { fails.delete(key); };

/** The `users` tab is the allow-list: the session only proves who signed in, this checks they still exist and are active. */
export function resolveUser(ds: Dataset, uid: string): User | null {
  const hit = ds.users.find((u) => u.id === uid);
  return hit?.active ? hit : null;
}
