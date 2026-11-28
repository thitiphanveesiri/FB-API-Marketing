import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { loadChannels } from "@/lib/channels";
import { sendCommentReply } from "@/lib/commentSend";
import { SendError } from "@/lib/fbSend";
import { localStamp } from "@/lib/fbSync";
import { invalidateCache } from "@/lib/sheetCache";
import { upsertRows } from "@/lib/sheetsWrite";
import { roleCan } from "@/lib/queries";

export const maxDuration = 20;

/** POST { commentId, text }: replies to a comment as the page, then marks it replied (replied_at / replied_by) so the response check counts it. */
export async function POST(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  try {
    const b = (await req.json()) as { commentId?: string; text?: string };
    const text = (b.text ?? "").trim();
    if (!b.commentId || !text) return fail(400, "พิมพ์ข้อความก่อนส่ง");
    if (text.length > 2000) return fail(400, "ข้อความยาวเกินไป (สูงสุด 2,000 ตัวอักษร)");
    const { mapped, me } = g, ds = mapped.dataset;
    if (!roleCan.editLeads(me.role) || me.role === "Agency" || me.role === "Sales Representative") return fail(403, "บทบาทของคุณตอบคอมเมนต์ไม่ได้ (เซลล์ไม่เห็นเนื้อหาคอมเมนต์)");
    const c = ds.comments.find((x) => x.id === b.commentId);
    if (!c) return fail(404, "ไม่พบคอมเมนต์นี้");
    if (c.repliedAt) return fail(409, "คอมเมนต์นี้ตอบไปแล้ว");
    const channel = ds.posts.find((p) => p.id === c.postId)?.channel ?? (/instagram\.com/i.test(c.postId) ? "instagram" : "facebook");
    const ch = (await loadChannels()).find((x) => x.channel === channel && x.active && x.accessToken && (x.sheetPageId === c.pageId || (channel === "instagram" && x.channelId === `instagram:${c.pageId}`)));
    if (!ch) return fail(400, `${channel === "instagram" ? "Instagram" : "Facebook"} ของเพจนี้ยังไม่ได้เชื่อมช่องทาง (ไปที่หน้า Upload → เชื่อมเพจ)`);
    await sendCommentReply({ commentId: c.id, token: ch.accessToken, text, channel, base: process.env.FB_GRAPH_BASE || "https://graph.facebook.com" });
    // From here the customer HAS the reply: a failed sheet write must not look like a failed send.
    const at = localStamp(new Date().toISOString(), process.env.APP_TZ || "Asia/Bangkok").slice(0, 16);
    let saved = true;
    try { await upsertRows("post_comments", ["comment_id"], [{ comment_id: c.id, replied_at: at, replied_by: me.id }], "updateOnly"); invalidateCache(); }
    catch (e) { saved = false; console.error("[api/comment-reply] sent, but the sheet write failed:", e instanceof Error ? e.message : e); }
    return NextResponse.json({ ok: true, at, saved }, noStore);
  } catch (e) {
    if (e instanceof SendError) return fail(e.status, e.message);
    return fail(500, "ส่งคำตอบไม่สำเร็จ");
  }
}
