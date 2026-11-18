import { connection, NextResponse } from "next/server";
import { adminOnly, fail, noStore } from "@/lib/adminGate";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";
import { fbSyncConfigs, loadChannels } from "@/lib/channels";
import { ensureIgSystemPage, ensureSystemPage, fetchPageName } from "@/lib/autoPage";
import { FbError, MAX_COMMENT_POSTS_PER_BATCH, syncStep, type SyncState } from "@/lib/fbSync";
import { expiredMetaTokenMessage, isExpiredMetaToken } from "@/lib/metaTokenError";

export const maxDuration = 60;
export async function GET(req: Request) {
  await connection();
  const g = await adminOnly(req, false); if ("err" in g) return g.err;
  // never send tokens to the browser: only which Facebook pages are configured
  try {
    const channels = await loadChannels();
    const pages = (await fbSyncConfigs()).map((c) => ({ fbPageId: c.fbPageId, sheetPageId: c.sheetPageId ?? "", name: c.name ?? "", instagram: channels.some((x) => x.channelId === `instagram:${c.fbPageId}` && x.channel === "instagram" && x.active && !!x.accountId) }));
    return NextResponse.json({ ok: true, pages }, noStore);
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 140) : "";
    return fail(502, `อ่านการเชื่อมต่อเพจจาก Google Sheet ไม่สำเร็จ${why ? ` (${why})` : ""}`);
  }
}

export async function POST(req: Request) {
  await connection();
  const g = await adminOnly(req, true); if ("err" in g) return g.err;
  let ig = false;
  try {
    const b = (await req.json()) as { fbPageId?: string; sheetPageId?: string; days?: number; state?: SyncState; channel?: string };
    ig = b.channel === "instagram";
    const cfg = (await fbSyncConfigs()).find((c) => c.fbPageId === b.fbPageId); if (!cfg) return fail(400, "ไม่พบเพจนี้ในการตั้งค่า (เชื่อมเพจในหน้า Upload ก่อน)");
    const ds = g.mapped.dataset;
    let sheetPageId = [b.sheetPageId, cfg.sheetPageId].find((id) => !!id && ds.pages.some((p) => p.id === id)) ?? "";
    if (!sheetPageId) {
      const made = await ensureSystemPage({
        pages: ds.pages,
        channels: await loadChannels(true),
        fbPageId: cfg.fbPageId,
        name: cfg.name || (await fetchPageName(cfg.fbPageId, cfg.token)),
      });
      sheetPageId = made.id;
      if (made.created) invalidateCache();
    }
    const channelsNow = await loadChannels();
    const igChannel = b.channel === "instagram" ? channelsNow.find((x) => x.channelId === `instagram:${cfg.fbPageId}` && x.channel === "instagram" && x.active && x.accountId) : undefined;
    const previousSheetPageId = igChannel?.sheetPageId && ds.pages.some((p) => p.id === igChannel.sheetPageId) ? igChannel.sheetPageId : sheetPageId;
    if (b.channel === "instagram" && !igChannel) return fail(400, "เพจนี้ยังไม่ได้เชื่อม Instagram (เชื่อมเพจใหม่ในหน้า Upload — ต้องผูกบัญชี Instagram Business กับเพจก่อน)");
    if (igChannel) {
      // Instagram lives in its own page row, so the Page filter can show it separately from the Facebook page
      const igPage = await ensureIgSystemPage({
        pages: ds.pages,
        channels: channelsNow,
        fbPageId: cfg.fbPageId,
        igAccountId: igChannel.accountId,
        name: cfg.name || (await fetchPageName(cfg.fbPageId, cfg.token)),
      });
      sheetPageId = igPage.id;
      if (igPage.created) invalidateCache();
    }
    const days = Math.min(90, Math.max(1, Math.floor(Number(b.days) || 7)));
    const phase = (b.state?.phase === "comments" && b.channel !== "instagram") || b.state?.phase === "done" ? b.state.phase : "chats";
    const after = typeof b.state?.after === "string" && /^[\w=+/.-]{1,400}$/.test(b.state.after) ? b.state.after : undefined;
    const chatList = b.state?.chatList === "light" || b.state?.chatList === "no-platform" || b.state?.chatList === "ig-node" ? b.state.chatList : undefined;
    const commentCursor = (value: unknown) => typeof value === "string" && /^[\w=+/.-]{1,400}$/.test(value) ? value : undefined;
    const igChats = Array.isArray(b.state?.igChats)
      ? b.state.igChats.slice(0, 6).flatMap((c) => {
        const id = typeof c?.id === "string" && /^[\w.-]{1,200}$/.test(c.id) ? c.id : undefined;
        const updated = typeof c?.updated_time === "string" && /^[\dT:+\-.Z]{10,40}$/.test(c.updated_time) ? c.updated_time : undefined;
        return id && updated ? [{ id, updated_time: updated }] : [];
      })
      : undefined;
    const commentId = (value: unknown) => typeof value === "string" && /^[\w.-]{1,200}$/.test(value) ? value : undefined;
    const commentUrl = (value: unknown) => {
      if (typeof value !== "string" || value.length > 2048) return undefined;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) ? url.href : undefined;
      } catch { return undefined; }
    };
    const commentBatch = Array.isArray(b.state?.commentBatch)
      ? b.state.commentBatch.slice(0, MAX_COMMENT_POSTS_PER_BATCH).flatMap((post) => {
        const id = commentId(post?.id);
        return id ? [{ id, url: commentUrl(post.url), after: commentCursor(post.after), basic: post.basic === true }] : [];
      })
      : undefined;
    const commentPostId = typeof b.state?.commentPostId === "string" && /^[\w.-]{1,200}$/.test(b.state.commentPostId) ? b.state.commentPostId : undefined;
    const commentPostUrl = commentUrl(b.state?.commentPostUrl);
    const commentAfter = commentCursor(b.state?.commentAfter);
    const commentsFeedDone = typeof b.state?.commentsFeedDone === "boolean" ? b.state.commentsFeedDone : undefined;
    const commentBasic = b.state?.commentBasic === true ? true : undefined;
    const out = await syncStep({
      ...(igChannel ? { channel: "instagram" as const, igId: igChannel.accountId, legacyPageId: previousSheetPageId } : {}),
      cfg,
      sheetPageId,
      days,
      state: { phase, after, chatList, igChats, commentBatch, commentPostId, commentPostUrl, commentAfter, commentsFeedDone, commentBasic },
      ds,
      tz: process.env.APP_TZ || "Asia/Bangkok",
      base: process.env.FB_GRAPH_BASE,
    });
    for (const w of out.writes) await upsertRows(w.tab, w.keyCols, w.rows, w.mode);
    if (out.writes.length) invalidateCache();
    return NextResponse.json({ ok: true, next: out.next, counts: out.counts, warning: out.warning }, noStore);
  } catch (e) {
    if (e instanceof FbError) {
      const slowIg = ig && (e.code === 1 || e.code === 2);
      const message = isExpiredMetaToken(e) ? expiredMetaTokenMessage("facebook") : `${e.message}${slowIg ? " — Instagram ตอบช้ากว่ากำหนด: ลดจำนวนวันย้อนหลัง (เช่น 3 วัน) แล้วดึงซ้ำ" : ""}`;
      // Only timeouts and Meta hiccups are worth retrying; a permission/link error answers the same every time.
      const permanent = [100, 190, 10, 200].includes(e.code ?? -1);
      return fail(e.rateLimited ? 429 : permanent ? 400 : 502, message, { rateLimited: e.rateLimited });
    }
    const sheetStatus = e instanceof Error ? /^Google Sheets (\d+):/i.exec(e.message)?.[1] : undefined;
    if (sheetStatus) {
      invalidateCache();
      const rateLimited = sheetStatus === "429";
      const hint = sheetStatus === "403" ? " ตรวจสิทธิ์ Editor ของ service account ใน Google Sheet" : rateLimited ? " ลองใหม่หลังรอสักครู่" : "";
      return fail(rateLimited ? 429 : 502, `ดึงข้อมูลจาก Meta ได้แต่บันทึก Google Sheet ไม่สำเร็จ (HTTP ${sheetStatus}).${hint}`, { rateLimited });
    }
    console.error("[api/fb-sync]", e instanceof Error ? e.message : "error"); invalidateCache();
    const why = e instanceof Error ? e.message.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…").slice(0, 140) : "";
    return fail(502, `ดึงข้อมูลหรือบันทึกลง Google Sheet ไม่สำเร็จ ลองใหม่อีกครั้ง${why ? ` (${why})` : ""}`);
  }
}
