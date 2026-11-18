// Works out what kind of access token the admin pasted. A Page token answers GET /me?fields=category; a USER token makes Graph answer
// "(#100) Tried accessing nonexisting field (category)" because the User node has no such field. We turn that into a helpful result:
// for a user token we list the pages it manages (GET /me/accounts) and hand back each page's own token.
import { metaApiVersion } from "./metaApi";

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
interface G { id?: string; name?: string; category?: string; data?: { id?: string; name?: string; access_token?: string }[]; error?: { message?: string; code?: number } }

export type TokenInfo =
  | { kind: "page"; id: string; name: string }
  | { kind: "user"; id: string; name: string; pages: { id: string; name: string; token: string }[] };

export class TokenError extends Error {}
const scrub = (s: string) => s.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…");

export async function inspectToken(token: string, base = "https://graph.facebook.com", f: FetchFn = (u) => fetch(u, { cache: "no-store" }) as ReturnType<FetchFn>): Promise<TokenInfo> {
  const call = async (path: string, fields: string) => {
    const r = await f(`${base}/${metaApiVersion()}/${path}?${new URLSearchParams({ fields, limit: "100", access_token: token })}`);
    return { r, j: ((await r.json().catch(() => ({}))) ?? {}) as G };
  };
  const first = await call("me", "id,name,category");
  if (first.r.ok && !first.j.error) {
    if (first.j.id && first.j.category) return { kind: "page", id: first.j.id, name: first.j.name ?? "" };
    if (!first.j.id) throw new TokenError("Meta ไม่ส่งข้อมูลโทเคนกลับมา");
  } else if (!(first.j.error?.code === 100 && /category/i.test(first.j.error.message ?? ""))) {
    throw new TokenError(`Meta ไม่ยอมรับโทเคนนี้: ${scrub(first.j.error?.message ?? `HTTP ${first.r.status}`)}`);
  }
  // user (or system-user) token: look up who it is and which pages it can manage
  const me = await call("me", "id,name");
  const acc = await call("me/accounts", "id,name,access_token");
  const pages = acc.r.ok && !acc.j.error ? (acc.j.data ?? []).filter((p) => p.id && p.access_token).map((p) => ({ id: p.id!, name: p.name ?? p.id!, token: p.access_token! })) : [];
  return { kind: "user", id: me.j.id ?? "", name: me.j.name ?? "", pages };
}
