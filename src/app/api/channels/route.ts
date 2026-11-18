import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { invalidateCache } from "@/lib/sheetCache";
import { checkAdAccount, actId, listAdAccounts } from "@/lib/adsSync";
import { FbError, type FetchFn } from "@/lib/fbSync";
import { type Channel, defaultVerifyToken, invalidateChannels, loadChannels, newVerifyToken, saveChannel, toPublic } from "@/lib/channels";
import { inspectToken, TokenError, type TokenInfo } from "@/lib/fbToken";
import { extendUserToken, type ExtendResult } from "@/lib/metaExtend";
import { expiredMetaTokenMessage, isExpiredMetaToken } from "@/lib/metaTokenError";
import { upsertRows } from "@/lib/sheetsWrite";
import { ensureIgSystemPage, ensureSystemPage, pickSystemPage } from "@/lib/autoPage";
import { metaApiVersion } from "@/lib/metaApi";

export const maxDuration = 60;
const GRAPH = () => `${process.env.FB_GRAPH_BASE || "https://graph.facebook.com"}/${metaApiVersion()}`;
const INSTAGRAM_GRAPH = () => `${process.env.FB_GRAPH_BASE || "https://graph.facebook.com"}/${metaApiVersion("v27.0")}`;
const scrub = (s: string) => s.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…");
const origin = (req: Request) => process.env.APP_URL?.replace(/\/$/, "") || new URL(req.url).origin;

/** A user token that has ads_read also sees the ad accounts: connect them too, so one token covers chats AND ads.
 *  An ad account whose stored token still works keeps it (it may be a never-expiring system-user token); one whose token Meta says is dead
 *  (expired / revoked) gets the new token — that is why pasting a fresh token revives ad pulls that had stopped. Never throws. */
async function connectAdAccounts(userToken: string, sheetPageId: string, all: Channel[]): Promise<{ added: number; existing: number; refreshed: number; names: string[]; message: string }> {
  const base = process.env.FB_GRAPH_BASE || "https://graph.facebook.com", f: FetchFn = (u) => fetch(u, { cache: "no-store" }) as ReturnType<FetchFn>;
  try {
    const accts = await listAdAccounts(userToken, f, base);
    if (!accts.length) return { added: 0, existing: 0, refreshed: 0, names: [], message: "โทเคนนี้มองไม่เห็นบัญชีโฆษณา — ถ้าต้องการดึงโฆษณาด้วย ให้เพิ่มสิทธิ์ ads_read แล้วสร้างโทเคนใหม่" };
    let added = 0, existing = 0, refreshed = 0; const names: string[] = [];
    for (const a of accts) {
      const channelId = `ads:${a.id}`, prev = all.find((x) => x.channelId === channelId && x.accessToken);
      names.push(prev?.name || a.name || a.id);
      if (prev) {
        let dead = false;
        try { await checkAdAccount(actId(a.id), prev.accessToken, f, base); } catch (e) { dead = isExpiredMetaToken(e); }
        if (!dead) { existing++; continue; }
        await saveChannel({ channelId, channel: "ads", accountId: a.id, name: prev.name || a.name || `act_${a.id}`, accessToken: userToken, sheetPageId: prev.sheetPageId || sheetPageId, active: true });
        refreshed++; continue;
      }
      await saveChannel({ channelId, channel: "ads", accountId: a.id, name: a.name || `act_${a.id}`, accessToken: userToken, sheetPageId, active: true });
      added++;
    }
    return { added, existing, refreshed, names, message: "" };
  } catch (e) {
    const permission = e instanceof FbError && (e.code === 200 || e.code === 10 || e.code === 100);
    return { added: 0, existing: 0, refreshed: 0, names: [], message: permission ? "โทเคนนี้ไม่มีสิทธิ์ ads_read จึงยังไม่ได้เชื่อมบัญชีโฆษณา (เพิ่มสิทธิ์ ads_read ใน Graph API Explorer แล้วสร้างโทเคนใหม่)" : "เชื่อมบัญชีโฆษณาไม่สำเร็จ (เชื่อมแยกได้ในส่วนโฆษณาด้านล่าง)" };
  }
}

/** The one place a pasted USER token is handled: swap it for a long-lived one (Page tokens taken from a short-lived user token die within hours; from a
 *  long-lived one they do not expire), then re-read the pages it manages. A Page token is returned untouched. Never throws: when extending is not possible
 *  the original answer comes back with a note saying why. */
async function widenToken(token: string, info: TokenInfo, appSecret: string): Promise<{ info: TokenInfo; userToken: string; extend: ExtendResult | null }> {
  if (info.kind !== "user") return { info, userToken: "", extend: null };
  const base = process.env.FB_GRAPH_BASE || undefined, extend = await extendUserToken(token, appSecret, base);
  if (!extend.extended) return { info, userToken: token, extend };
  try { const again = await inspectToken(extend.token, base); if (again.kind === "user" && again.pages.length) return { info: again, userToken: extend.token, extend }; } catch { /* keep the first answer */ }
  return { info, userToken: extend.token, extend };
}
const extendJson = (e: ExtendResult | null) => e ? { extended: e.extended, days: e.days ?? null, note: e.note } : null;

/** Admin only. Never returns tokens or secrets — only whether they are set and the last 4 characters of the token. */
export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  try {
    const list = (await loadChannels(true)).map(toPublic);
    const verifyToken = list.find((c) => (c.channel === "facebook" || c.channel === "instagram") && c.active && c.verifyToken)?.verifyToken || defaultVerifyToken();
    const webhookUrl = `${origin(req)}/api/webhook/facebook`;
    return NextResponse.json({ ok: true, channels: list, verifyToken, webhookUrls: { facebook: webhookUrl, instagram: webhookUrl } }, noStore);
  } catch { return fail(502, "อ่านการตั้งค่าช่องทางจาก Google Sheet ไม่สำเร็จ"); }
}

interface Body { action?: "save" | "disconnect" | "connectAll"; channel?: string; accountId?: string; channelId?: string; accessToken?: string; appSecret?: string; sheetPageId?: string; forceSheetPage?: boolean; fbPageId?: string }

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as Body;
    if (b.channel && b.channel !== "facebook" && b.channel !== "ads") return fail(400, "ช่องทางนี้ยังไม่เปิดให้ใช้ (ตอนนี้รองรับเฉพาะ Facebook Messenger)");
    const all = await loadChannels(true);

    if (b.action === "disconnect") {
      const c = all.find((x) => x.channelId === b.channelId); if (!c) return fail(404, "ไม่พบการเชื่อมต่อนี้");
      const rows = [{ channel_id: c.channelId, active: false, access_token: "", app_secret: "", updated_at: new Date().toISOString() }];
      if (c.channel === "facebook") rows.push({ channel_id: `instagram:${c.accountId}`, active: false, access_token: "", app_secret: "", updated_at: new Date().toISOString() });
      await upsertRows("channels", ["channel_id"], rows, "upsert");
      invalidateCache(); return NextResponse.json({ ok: true }, noStore);
    }

    if (b.action === "connectAll") return connectAll(b, all, g.mapped.dataset.pages);

    let sheetPageId = (b.sheetPageId ?? "").trim();
    if (sheetPageId && !g.mapped.dataset.pages.some((p) => p.id === sheetPageId)) return fail(400, "ไม่พบเพจนี้ในระบบ");
    if (b.channel === "ads" && !sheetPageId) return fail(400, "เลือกเพจในระบบที่จะเป็นค่าเริ่มต้นของบัญชีโฆษณานี้ก่อน");
    const token = (b.accessToken ?? "").trim(), secret = (b.appSecret ?? "").trim();
    if (token && !/^[\w-]{20,400}$/.test(token)) return fail(400, "รูปแบบ Access Token ไม่ถูกต้อง (คัดลอกมาทั้งสตริง ไม่มีช่องว่าง)");
    if (secret && !/^[\w-]{8,100}$/.test(secret)) return fail(400, "รูปแบบ App Secret ไม่ถูกต้อง");

    if (b.channel === "ads") { // Meta ad account (Marketing API): needs the account id + a token with ads_read
      const digits = (b.accountId ?? "").replace(/\D/g, "");
      if (digits.length < 5) return fail(400, "ใส่ Ad Account ID (ตัวเลข เช่น 1234567890 หรือ act_1234567890)");
      const channelId = `ads:${digits}`, prev = all.find((x) => x.channelId === channelId);
      if (!token && !prev?.accessToken) return fail(400, "วาง Access Token ที่มีสิทธิ์ ads_read ก่อน");
      if (!token && prev?.accessToken) {
        await saveChannel({ channelId, channel: "ads", accountId: digits, name: prev.name, sheetPageId, forceSheetPage: b.forceSheetPage === true, active: true });
        invalidateCache();
        return NextResponse.json({ ok: true, channelId, name: prev.name, mappingUpdated: true }, noStore);
      }
      let info = { name: prev?.name ?? "", currency: "", timezone: "" };
      try {
        info = await checkAdAccount(actId(digits), token || prev!.accessToken, (u) => fetch(u, { cache: "no-store" }) as ReturnType<Parameters<typeof checkAdAccount>[2]>, process.env.FB_GRAPH_BASE || "https://graph.facebook.com");
      } catch (e) { return fail(400, isExpiredMetaToken(e) ? expiredMetaTokenMessage("ads") : e instanceof FbError ? e.message : "เชื่อมต่อ Meta ไม่สำเร็จ"); }
      await saveChannel({ channelId, channel: "ads", accountId: digits, name: info.name || prev?.name || `act_${digits}`, accessToken: token, sheetPageId, forceSheetPage: b.forceSheetPage === true, active: true });
      invalidateCache();
      return NextResponse.json({ ok: true, channelId, name: info.name, currency: info.currency, timezone: info.timezone }, noStore);
    }

    let existing = all.find((x) => x.channelId === b.channelId);
    let accountId = existing?.accountId ?? "", name = existing?.name ?? "", subscribed: boolean | null = null, subscribeMessage = "";
    let pageToken = token || existing?.accessToken || "", viaUserToken = false, userToken = "", extend: ExtendResult | null = null;
    if (token) {
      // ask Meta what this token is. A Page token is used as is; a USER token is exchanged for the token of the page it manages.
      let info: TokenInfo; try { info = await inspectToken(token, process.env.FB_GRAPH_BASE || undefined); } catch (e) { return fail(400, isExpiredMetaToken(e) ? expiredMetaTokenMessage("facebook") : e instanceof TokenError ? e.message : "เชื่อมต่อ Meta ไม่สำเร็จ"); }
      // the secret of any connected page works too: every page of one Meta app shares it
      const wide = await widenToken(token, info, secret || existing?.appSecret || all.find((c) => c.channel === "facebook" && c.active && c.appSecret)?.appSecret || process.env.META_APP_SECRET?.trim() || "");
      info = wide.info; userToken = wide.userToken; extend = wide.extend;
      let j: { id: string; name: string };
      if (info.kind === "page") j = info;
      else {
        const who = info.name ? ` (${info.name})` : "";
        if (!info.pages.length) return fail(400, `โทเคนนี้เป็นของผู้ใช้${who} และมองไม่เห็นเพจใดเลย — ใน Graph API Explorer ขอสิทธิ์ pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, instagram_basic และ instagram_manage_messages แล้วกด Generate Access Token ใหม่ (หรือเลือก "Get Page Access Token" แล้วเลือกเพจ)`);
        const pick = info.pages.length === 1 ? info.pages[0] : info.pages.find((p) => p.id === b.fbPageId);
        if (!pick) return fail(400, `โทเคนนี้เป็นของผู้ใช้${who} ที่ดูแลหลายเพจ เลือกเพจ Facebook ที่จะเชื่อม`, { pages: info.pages.map((p) => ({ id: p.id, name: p.name })) });
        pageToken = pick.token; j = pick; viaUserToken = true;
      }
      accountId = j.id; name = j.name ?? ""; existing = all.find((x) => x.channelId === `facebook:${accountId}`) ?? existing;
      // subscribe the page to this app's webhook (needs the token to have pages_messaging)
      try {
        const s = await fetch(`${GRAPH()}/${accountId}/subscribed_apps`, { method: "POST", cache: "no-store", body: new URLSearchParams({ subscribed_fields: "messages,message_echoes", access_token: pageToken }) });
        const sj = (await s.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
        subscribed = s.ok && sj.success === true; if (!subscribed) subscribeMessage = scrub(sj.error?.message ?? `HTTP ${s.status}`);
      } catch { subscribed = false; subscribeMessage = "เชื่อมต่อ Meta ไม่สำเร็จ"; }
    }
    if (!accountId) return fail(400, "วาง Page Access Token ก่อน");
    const channelId = `facebook:${accountId}`;
    if (!secret && !existing?.appSecret) return fail(400, "ใส่ App Secret ด้วย (Meta App → Settings → Basic) — ใช้ตรวจว่าข้อความมาจาก Meta จริง");
    if (!sheetPageId) sheetPageId = (await ensureSystemPage({ pages: g.mapped.dataset.pages, channels: all, fbPageId: accountId, name })).id;
    const appSecret = secret || existing?.appSecret || "";
    const verifyToken = existing?.verifyToken || defaultVerifyToken() || newVerifyToken();
    await saveChannel({ channelId, channel: "facebook", accountId, name, accessToken: pageToken, appSecret, verifyToken, sheetPageId, active: true });
    const instagramLookup = await instagramOf(accountId, pageToken);
    const instagram = instagramLookup.status === "found" ? instagramLookup.account : null;
    const instagramLookupMessage = instagramLookup.status === "error" ? instagramLookup.message : "";
    if (instagram) {
      const igPage = await ensureIgSystemPage({ pages: g.mapped.dataset.pages, channels: all, fbPageId: accountId, igAccountId: instagram.id, name, remember: false });
      await saveChannel({
        channelId: `instagram:${accountId}`, channel: "instagram", accountId: instagram.id,
        name: instagram.username ? `@${instagram.username}` : instagram.id, accessToken: pageToken,
        appSecret, verifyToken, sheetPageId: igPage.id, active: true,
      });
      if (igPage.created) invalidateCache();
    } else if (instagramLookup.status === "none") {
      const previousInstagram = all.find((item) => item.channelId === `instagram:${accountId}`);
      if (previousInstagram?.active) await upsertRows("channels", ["channel_id"], [{ channel_id: previousInstagram.channelId, active: false, updated_at: new Date().toISOString() }], "upsert");
    }
    const ads = viaUserToken ? await connectAdAccounts(userToken, sheetPageId, all) : null;
    invalidateCache();
    return NextResponse.json({ ok: true, channelId, name, subscribed, subscribeMessage, instagram, instagramLookupMessage, ads, extend: extendJson(extend) }, noStore);
  } catch (e) {
    console.error("[api/channels]", e instanceof Error ? scrub(e.message) : "error");
    return fail(502, "บันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

/** Connect every Facebook page visible to one user token, keeping all credentials on the server. */
async function connectAll(b: Body, all: Channel[], systemPages: { id: string; name: string }[]) {
  const token = (b.accessToken ?? "").trim(), secretIn = (b.appSecret ?? "").trim();
  if (!token) return fail(400, "วาง Access Token ก่อน");
  if (!/^[\w-]{20,400}$/.test(token)) return fail(400, "รูปแบบ Access Token ไม่ถูกต้อง (คัดลอกมาทั้งสตริง ไม่มีช่องว่าง)");
  if (secretIn && !/^[\w-]{8,100}$/.test(secretIn)) return fail(400, "รูปแบบ App Secret ไม่ถูกต้อง");
  if (!secretIn) return fail(400, "ใส่ App Secret ของ Meta App ที่ออกโทเคนนี้ เพื่อยืนยันลายเซ็น Webhook");
  const secret = secretIn;

  let info: TokenInfo;
  try { info = await inspectToken(token, process.env.FB_GRAPH_BASE || undefined); }
  catch (error) {
    return fail(400, isExpiredMetaToken(error) ? expiredMetaTokenMessage("facebook") : error instanceof TokenError ? error.message : "เชื่อมต่อ Meta ไม่สำเร็จ");
  }
  const wide = await widenToken(token, info, secret); // long-lived user token → Page tokens that do not expire
  info = wide.info;
  const pages = info.kind === "page" ? [{ id: info.id, name: info.name, token }] : info.pages;
  const uniquePages = [...new Map(pages.map((page) => [page.id, page])).values()];
  if (!uniquePages.length) return fail(400, "โทเคนนี้มองไม่เห็นเพจใดเลย — ใน Graph API Explorer ขอสิทธิ์ pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, instagram_basic และ instagram_manage_messages แล้วสร้าง Access Token ใหม่");

  const mapping = uniquePages.map((page) => {
    const pick = pickSystemPage(systemPages, all, page.id, page.name);
    return { page, pick, previous: all.find((channel) => channel.channelId === `facebook:${page.id}`) };
  });
  const pageRows = mapping.flatMap(({ pick }) => pick.create ? [{ page_id: pick.id, name: pick.name, active: true }] : []);
  const channelRows = mapping.map(({ page, pick, previous }) => ({
    channel_id: `facebook:${page.id}`,
    channel: "facebook",
    account_id: page.id,
    name: page.name,
    access_token: page.token,
    app_secret: secret,
    verify_token: previous?.verifyToken || defaultVerifyToken() || newVerifyToken(),
    sheet_page_id: pick.id,
    active: true,
    updated_at: new Date().toISOString(),
  }));
  if (pageRows.length) await upsertRows("pages", ["page_id"], pageRows, "insert");
  await upsertRows("channels", ["channel_id"], channelRows, "upsert");
  invalidateChannels();
  invalidateCache();

  const results: ConnectResult[] = [];
  for (let i = 0; i < mapping.length; i += 5) {
    const group = mapping.slice(i, i + 5);
    results.push(...await Promise.all(group.map(async ({ page, pick, previous }) => {
      let subscribed = false, subscribeMessage = "";
      try {
        const response = await fetch(`${GRAPH()}/${encodeURIComponent(page.id)}/subscribed_apps`, {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
          body: new URLSearchParams({ subscribed_fields: "messages,message_echoes", access_token: page.token }),
        });
        const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
        subscribed = response.ok && result.success === true;
        if (!subscribed) subscribeMessage = scrub(result.error?.message ?? `HTTP ${response.status}`);
      } catch { subscribeMessage = "เชื่อมต่อ Meta ไม่สำเร็จ"; }
      const instagramLookup = await instagramOf(page.id, page.token);
      const instagram = instagramLookup.status === "found" ? instagramLookup.account : null;
      const instagramLookupMessage = instagramLookup.status === "error" ? instagramLookup.message : "";
      if (instagram) {
        const igPage = await ensureIgSystemPage({ pages: systemPages, channels: all, fbPageId: page.id, igAccountId: instagram.id, name: page.name, remember: false });
        if (igPage.created) invalidateCache();
        await saveChannel({
          channelId: `instagram:${page.id}`, channel: "instagram", accountId: instagram.id,
          name: instagram.username ? `@${instagram.username}` : instagram.id, accessToken: page.token,
          appSecret: secret, verifyToken: previous?.verifyToken || defaultVerifyToken() || newVerifyToken(),
          sheetPageId: igPage.id, active: true,
        });
      } else if (instagramLookup.status === "none") {
        const previousInstagram = all.find((item) => item.channelId === `instagram:${page.id}`);
        if (previousInstagram?.active) await upsertRows("channels", ["channel_id"], [{ channel_id: previousInstagram.channelId, active: false, updated_at: new Date().toISOString() }], "upsert");
      }
      return {
        fbPageId: page.id,
        name: page.name,
        ok: true,
        systemPageId: pick.id,
        createdPage: pick.create,
        subscribed,
        subscribeMessage,
        instagram,
        instagramLookupMessage,
      };
    })));
  }
  const firstSheet = mapping[0]?.pick.id ?? "";
  const ads = info.kind === "user" && firstSheet ? await connectAdAccounts(wide.userToken || token, firstSheet, all) : null;
  return NextResponse.json({ ok: true, connectedAll: true, results, ads, extend: extendJson(wide.extend) }, noStore);
}

interface ConnectResult {
  fbPageId: string;
  name: string;
  ok: boolean;
  message?: string;
  systemPageId?: string;
  createdPage?: boolean;
  subscribed?: boolean;
  subscribeMessage?: string;
  instagram?: { id: string; username: string } | null;
  instagramLookupMessage?: string;
}

type InstagramLookup =
  | { status: "found"; account: { id: string; username: string } }
  | { status: "none" }
  | { status: "error"; message: string };

async function instagramOf(pageId: string, pageToken: string): Promise<InstagramLookup> {
  try {
    const response = await fetch(`${INSTAGRAM_GRAPH()}/${encodeURIComponent(pageId)}?${new URLSearchParams({ fields: "instagram_business_account{id,username}", access_token: pageToken })}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const result = (await response.json()) as {
      instagram_business_account?: { id?: string; username?: string } | null;
      error?: { message?: string };
    };
    if (!response.ok || result.error) return { status: "error", message: scrub(result.error?.message ?? `HTTP ${response.status}`) };
    const instagram = result.instagram_business_account;
    if (instagram === undefined || instagram === null) return { status: "none" };
    if (!instagram.id) return { status: "error", message: "Meta returned invalid Instagram account data" };
    return { status: "found", account: { id: instagram.id, username: instagram.username ?? "" } };
  } catch { return { status: "error", message: "Instagram account lookup failed" }; }
}
