// SERVER ONLY. Administrators only. Answers "why 502?" without Vercel logs: checks the Google Sheet read, every Facebook page
// token and every linked Instagram account, then reports which connection is broken and what to do about it.
import { connection, NextResponse } from "next/server";
import { adminOnly, noStore } from "@/lib/adminGate";
import { loadChannels, type Channel } from "@/lib/channels";
import { FbError, graph, inboxHint, metaFetchWith } from "@/lib/fbSync";
import { metaApiVersion } from "@/lib/metaApi";

export const maxDuration = 60;
interface Check { id: string; name: string; ok: boolean; detail: string; token?: string }

const graphBase = () => process.env.FB_GRAPH_BASE || "https://graph.facebook.com";

function why(e: unknown): string {
  if (!(e instanceof FbError)) return e instanceof Error ? e.message.slice(0, 160) : "ไม่ทราบสาเหตุ";
  if (e.code === 190) return "โทเคนเพจหมดอายุหรือถูกยกเลิก — ไปที่ Upload → เชื่อมช่องทางแชท → แก้ไขเพจ แล้วบันทึก Access Token ใหม่";
  if (e.code === 10 || e.code === 200) return "โทเคนนี้ไม่มีสิทธิ์กับเพจ — ต้องมี pages_read_engagement / pages_manage_metadata, instagram_manage_messages และ instagram_manage_comments สำหรับ IG";
  if (e.code === 100) return "ไม่พบเพจ หรือโทเคนไม่ใช่ของเพจนี้ — ตรวจว่า Page ID กับ Access Token มาจากเพจเดียวกัน";
  if (e.rateLimited) return "Meta จำกัดจำนวนคำขอชั่วคราว — รอสักครู่แล้วตรวจใหม่";
  if (e.code === 1 || e.code === 2) return "Meta ตอบช้าเกิน 8 วินาทีหรือขัดข้องชั่วคราว — ลองตรวจอีกครั้ง";
  return e.message;
}

export async function GET(req: Request) {
  await connection();
  // A failed sheet read answers here as 502 with its own reason — that alone explains a 502 on every pull.
  const g = await adminOnly(req, false); if ("err" in g) return g.err;

  let channels: Channel[] = [], sheet = "อ่าน Google Sheet ได้ปกติ (และมีสิทธิ์เขียนถ้าเคยดึงสำเร็จ)";
  try { channels = await loadChannels(true); }
  catch (e) { sheet = `อ่าน Google Sheet ไม่ได้: ${e instanceof Error ? e.message.slice(0, 160) : "ไม่ทราบสาเหตุ"}`; }

  const fb = channels.filter((c) => c.channel === "facebook" && c.active && c.accessToken && c.accountId);
  const igs = channels.filter((c) => c.channel === "instagram" && c.active && c.accountId);
  const f = metaFetchWith(8000);

  /** Reads one conversation to prove the inbox itself is reachable — this is the call that answers 500/code 100 during a pull. */
  const probe = async (path: string, kind: "messenger" | "instagram", token: string): Promise<string | null> => {
    const params: Record<string, string> = kind === "instagram" ? { fields: "id", limit: "1", platform: "instagram" } : { fields: "id", limit: "1", platform: "messenger" };
    try { await graph(path, params, token, f, graphBase(), 900, 0); return null; }
    catch (e) { return e instanceof FbError ? inboxHint(e, kind === "instagram") ?? why(e) : why(e); }
  };

  /** Instagram inbox on both nodes, with timing: the Page node is the documented one for Page tokens, the IG node is the fallback. */
  const fIg = metaFetchWith(20000);
  const igProbe = async (pageId: string, igId: string, token: string): Promise<{ ok: boolean; detail: string }> => {
    const ask = async (label: string, path: string): Promise<{ ok: boolean; text: string }> => {
      const t = Date.now();
      try { await graph(path, { fields: "id", limit: "1", platform: "instagram" }, token, fIg, graphBase(), 900, 0); return { ok: true, text: `${label} อ่านได้ (${((Date.now() - t) / 1000).toFixed(1)} วิ)` }; }
      catch (e) { return { ok: false, text: `${label}: ${e instanceof FbError ? inboxHint(e, true) ?? why(e) : why(e)}` }; }
    };
    const page = await ask("Page node", `${encodeURIComponent(pageId)}/conversations`);
    if (page.ok) return { ok: true, detail: page.text };
    const ig = await ask("IG node", `${encodeURIComponent(igId)}/conversations`);
    return { ok: ig.ok, detail: `${page.text} · ${ig.text}` };
  };

  /** Expiry and scopes straight from Meta: a Page token dies with the user token that made it, which is what turns a pull into a 502. */
  const tokenInfo = async (c: Channel): Promise<string> => {
    if (!c.appSecret) return "";
    try {
      const appId = process.env.META_APP_ID?.trim() || (await graph("app", { fields: "id" }, c.accessToken, f, graphBase(), 900, 0) as { id?: string }).id;
      if (!appId) return "";
      const r = await f(`${graphBase()}/${metaApiVersion()}/debug_token?${new URLSearchParams({ input_token: c.accessToken, access_token: `${appId}|${c.appSecret}` })}`);
      const d = ((await r.json().catch(() => ({}))) ?? {}) as { data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] } };
      if (!d.data) return "";
      if (!d.data.is_valid) return "โทเคนถูกเพิกถอน";
      const need = ["pages_read_engagement", "pages_messaging", ...(igs.some((g) => g.channelId === `instagram:${c.accountId}`) ? ["instagram_basic", "instagram_manage_messages", "instagram_manage_comments"] : [])];
      const missing = need.filter((s) => !(d.data!.scopes ?? []).includes(s));
      return `${d.data.expires_at ? `หมดอายุ ${new Date(d.data.expires_at * 1000).toISOString().slice(0, 10)}` : "ไม่มีวันหมดอายุ (System User token)"}${missing.length ? ` · ขาดสิทธิ์ ${missing.join(", ")}` : ""}`;
    } catch { return ""; }
  };

  const pages = await Promise.all(fb.map(async (c): Promise<Check> => {
    try {
      const j = (await graph(encodeURIComponent(c.accountId), { fields: "name,instagram_business_account{id,username}" }, c.accessToken, f, graphBase(), 900, 1)) as { name?: string; instagram_business_account?: { id?: string; username?: string } };
      const ig = j.instagram_business_account;
      // The two failures that look like a "502" while the token is fine: Meta 500s on the page's conversation list, and code 100 (cannot read that inbox).
      const [messenger, insta, token] = await Promise.all([
        probe(`${encodeURIComponent(c.accountId)}/conversations`, "messenger", c.accessToken),
        ig?.id ? igProbe(c.accountId, ig.id, c.accessToken) : Promise.resolve(null),
        tokenInfo(c),
      ]);
      return {
        id: c.accountId, name: j.name || c.name || c.accountId, ok: !messenger && (!insta || insta.ok), token,
        detail: [
          ig ? `โทเคนใช้ได้ · Instagram @${ig.username ?? ig.id}` : "โทเคนใช้ได้ · เพจนี้ยังไม่ผูกบัญชี Instagram",
          messenger ? `Messenger: ${messenger}` : "Messenger อ่านได้",
          ig ? `IG inbox — ${insta!.detail}` : "",
        ].filter(Boolean).join(" · "),
      };
    } catch (e) { return { id: c.accountId, name: c.name || c.accountId, ok: false, detail: why(e) }; }
  }));

  const instagram = await Promise.all(igs.map(async (c): Promise<Check> => {
    const pageId = c.channelId.startsWith("instagram:") ? c.channelId.slice("instagram:".length) : "";
    // the IG channel keeps its own copy of the Page token; fall back to the Facebook row when it is blank
    const token = c.accessToken || fb.find((x) => x.accountId === pageId)?.accessToken || "";
    const name = c.name || c.channelId;
    if (!token) return { id: c.accountId, name, ok: false, detail: "ไม่พบโทเคนเพจ Facebook ที่ผูกกับ Instagram นี้ — เชื่อมเพจ Facebook ก่อน" };
    try {
      const id = encodeURIComponent(c.accountId);
      const j = (await graph(id, { fields: "username" }, token, f, graphBase(), 900, 1)) as { username?: string };
      // Reading the account proves nothing about comments: that is instagram_manage_comments on its own, so probe the comments edge too.
      let comments = "ยังไม่มีโพสต์ให้ตรวจคอมเมนต์";
      try {
        const media = (await graph(`${id}/media`, { fields: "id", limit: "1" }, token, fIg, graphBase(), 900, 0)) as unknown as { data?: { id?: string }[] };
        const first = media.data?.find((m) => m.id)?.id;
        if (first) {
          await graph(`${encodeURIComponent(first)}/comments`, { fields: "id", limit: "1" }, token, fIg, graphBase(), 900, 0);
          comments = "คอมเมนต์อ่านได้";
        }
      } catch (e) {
        const msg = e instanceof FbError && (e.code === 10 || e.code === 200)
          ? "อ่านคอมเมนต์ไม่ได้ — โทเคนขาดสิทธิ์ instagram_manage_comments (สร้างโทเคนใหม่โดยติ๊กสิทธิ์นี้ แล้วเชื่อมเพจใหม่)"
          : `อ่านคอมเมนต์ไม่ได้: ${why(e)}`;
        return { id: c.accountId, name, ok: false, detail: `อ่านบัญชีได้ · @${j.username ?? c.accountId} · ${msg}` };
      }
      return { id: c.accountId, name, ok: true, detail: `อ่านบัญชีได้ · @${j.username ?? c.accountId} · ${comments}` };
    } catch (e) {
      return { id: c.accountId, name, ok: false, detail: e instanceof FbError && e.code === 100
        ? "โหลดบัญชี Instagram นี้ด้วยแอป/โทเคนนี้ไม่ได้ — ID ของ Graph แยกตามแอป (อาจคัดลอกมาจากแอปอื่น) หรือ IG ยังไม่ผูกกับเพจ; เชื่อมเพจใหม่ที่ Upload เพื่อให้ระบบอ่าน ID ใหม่"
        : why(e) };
    }
  }));

  const bad = [...pages, ...instagram].filter((x) => !x.ok);
  const count = (list: Check[]) => `${list.length} รายการ (มีปัญหา ${list.filter((x) => !x.ok).length})`;
  const tokens = pages.filter((p) => p.token).map((p) => `${p.name}: ${p.token}`).join(" · ");
  const message = [
    `ตรวจสอบแล้ว · Google Sheet: ${sheet}`,
    `Facebook ${count(pages)}`,
    `Instagram ${count(instagram)}`,
    tokens ? `โทเคน — ${tokens}` : "",
    bad.length ? `พบปัญหา: ${bad.map((x) => `${x.name}: ${x.detail}`).join(" | ")}` : "ทุกการเชื่อมต่อปกติ — ถ้ายังได้ 502 ให้ดู Logs ของ Vercel (Deployments → Functions)",
  ].filter(Boolean).join(" · ");

  return NextResponse.json({ ok: true, message, sheet, pages, instagram }, noStore);
}
