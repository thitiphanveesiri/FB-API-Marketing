// Works out what kind of access token the admin pasted. A Page token answers GET /me?fields=category; a USER token makes Graph answer
// "(#100) Tried accessing nonexisting field (category)" because the User node has no such field. We turn that into a helpful result:
// for a user token we list the pages it manages (GET /me/accounts) and hand back each page's own token.
import { metaApiVersion } from "./metaApi";

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
interface G { id?: string; name?: string; category?: string; data?: { id?: string; name?: string; access_token?: string }[]; error?: { message?: string; code?: number } }

export type TokenInfo =
  | { kind: "page"; id: string; name: string }
  | { kind: "user"; id: string; name: string; pages: { id: string; name: string; token: string }[]; why?: string };

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
  // /me/accounts is empty for Pages that live in a Business portfolio or are only "assigned" to the user (and for system users), so
  // try those routes too, and keep Meta's own reason when nothing is found instead of saying "no pages" with no explanation.
  const found = new Map<string, { id: string; name: string; token: string }>(), errs: string[] = [];
  let limited = false; // Meta code 4/17/32/613 = the app is over its call quota: more calls only make it worse, and the Pages are fine
  const list = async (path: string) => {
    if (limited) return;
    const { r, j } = await call(path, "id,name,access_token");
    if (!r.ok || j.error) { if ([4, 17, 32, 613].includes(j.error?.code ?? 0)) limited = true; errs.push(`${path}: ${scrub(j.error?.message ?? `HTTP ${r.status}`)}`); return; }
    for (const p of j.data ?? []) if (p.id && p.access_token && !found.has(p.id)) found.set(p.id, { id: p.id, name: p.name ?? p.id, token: p.access_token });
  };
  await list("me/accounts");
  if (!found.size) await list("me/assigned_pages");
  if (!found.size && !limited) {
    const biz = await call("me/businesses", "id");
    if (biz.r.ok && !biz.j.error) {
      for (const b of (biz.j.data ?? []).slice(0, 5)) if (b.id) { await list(`${b.id}/owned_pages`); await list(`${b.id}/client_pages`); }
    } else errs.push(`me/businesses: ${scrub(biz.j.error?.message ?? `HTTP ${biz.r.status}`)}`);
  }
  const pages = [...found.values()];
  const why = pages.length ? undefined : limited ? `Meta จำกัดจำนวนคำขอของแอปชั่วคราว (${errs[0]}) — รอประมาณ 1 ชั่วโมงแล้วลองใหม่ ไม่ใช่ปัญหาสิทธิ์ของโทเคน` : errs.join(" | ") || "Meta ตอบว่าไม่มีเพจ (รายการว่าง) — โทเคนอาจไม่ได้ติ๊กเลือกเพจตอนล็อกอิน";
  return { kind: "user", id: me.j.id ?? "", name: me.j.name ?? "", pages, ...(why ? { why } : {}) };
}
