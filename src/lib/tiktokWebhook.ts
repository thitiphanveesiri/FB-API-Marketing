// SERVER ONLY. TikTok webhook: only the signature check is implemented (documented by TikTok). Messages are NOT parsed yet.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Header `TikTok-Signature: t=<unix seconds>,s=<hex>`; s = HMAC-SHA256(client_secret, `${t}.${raw body}`). Rejects anything older than `toleranceSec` (replay). */
export function tiktokSignatureOk(rawBody: string, header: string, clientSecret: string, nowMs = Date.now(), toleranceSec = 300): boolean {
  if (!clientSecret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(parts.t), s = String(parts.s ?? "");
  if (!Number.isFinite(t) || !s || Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const want = Buffer.from(createHmac("sha256", clientSecret).update(`${parts.t}.${rawBody}`).digest("hex")), got = Buffer.from(s.toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The structure of a payload with every value replaced by its type, so it can be logged without customer data. */
export const shapeOf = (v: unknown, depth = 0): unknown => v === null ? "null" : Array.isArray(v) ? (depth > 4 ? "[…]" : v.length ? [shapeOf(v[0], depth + 1)] : []) : typeof v === "object" ? (depth > 4 ? "{…}" : Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shapeOf(x, depth + 1)]))) : typeof v;
