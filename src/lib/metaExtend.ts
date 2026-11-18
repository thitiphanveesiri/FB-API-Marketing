// SERVER ONLY. A token made in Graph API Explorer lives 1–2 hours, and so do the Page tokens taken from it. Exchanging it for a long-lived
// USER token first (≈60 days) makes /me/accounts hand out Page tokens that never expire. Needs the app's id (found from the token itself)
// and its App Secret. Never throws: on any problem the original token is returned together with a note saying why it was not extended.
type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
interface G { id?: string; access_token?: string; expires_in?: number; error?: { message?: string; code?: number } }
export interface ExtendResult { token: string; extended: boolean; days?: number; note: string }

const scrub = (s: string) => s.replace(/EAA[\w-]{20,}/g, "…").replace(/(access_token|client_secret|fb_exchange_token)=[^&\s"']+/gi, "$1=…");

export async function extendUserToken(token: string, appSecret: string, base = "https://graph.facebook.com", f: FetchFn = (u) => fetch(u, { cache: "no-store" }) as ReturnType<FetchFn>, appIdHint = process.env.META_APP_ID?.trim() || ""): Promise<ExtendResult> {
  const keep = (note: string): ExtendResult => ({ token, extended: false, note });
  if (!appSecret) return keep("ไม่มี App Secret จึงต่ออายุโทเคนไม่ได้ — โทเคนอาจหมดอายุภายใน 1–2 ชั่วโมง (ใส่ App Secret แล้วเชื่อมใหม่)");
  const get = async (path: string, params: Record<string, string>) => {
    const r = await f(`${base}/v21.0/${path}?${new URLSearchParams(params)}`);
    return { r, j: ((await r.json().catch(() => ({}))) ?? {}) as G };
  };
  try {
    let appId = appIdHint;
    if (!appId) {
      const a = await get("app", { fields: "id", access_token: token });
      if (a.j.error?.code === 190) return keep("ต่ออายุโทเคนไม่ได้: โทเคนที่วางหมดอายุหรือถูกเพิกถอนไปแล้ว — สร้างโทเคนใหม่ใน Graph API Explorer แล้ววางทันที");
      if (!a.r.ok || a.j.error || !a.j.id) return keep(`ต่ออายุโทเคนไม่ได้: หา App ID ของโทเคนไม่เจอ (${scrub(a.j.error?.message ?? `HTTP ${a.r.status}`)})`);
      appId = a.j.id;
    }
    const x = await get("oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token });
    if (!x.r.ok || x.j.error || !x.j.access_token) {
      const code = x.j.error?.code, msg = scrub(x.j.error?.message ?? `HTTP ${x.r.status}`);
      if (code === 190) return keep("ต่ออายุโทเคนไม่ได้: โทเคนที่วางหมดอายุหรือถูกเพิกถอนไปแล้ว — สร้างโทเคนใหม่แล้ววางทันที");
      if (code === 1 || code === 101 || /client_secret|app secret|secret/i.test(msg)) return keep("ต่ออายุโทเคนไม่ได้: App Secret ไม่ถูกต้อง หรือไม่ใช่ของแอปเดียวกับโทเคน");
      return keep(`ต่ออายุโทเคนไม่ได้: ${msg}`);
    }
    return { token: x.j.access_token, extended: true, days: x.j.expires_in ? Math.round(x.j.expires_in / 86400) : undefined, note: "" };
  } catch { return keep("ต่ออายุโทเคนไม่ได้: เชื่อมต่อ Meta ไม่สำเร็จ"); }
}
