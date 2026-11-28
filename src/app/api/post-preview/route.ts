import { connection, NextResponse } from "next/server";
import { fail, noStore, userGate } from "@/lib/adminGate";
import { loadChannels } from "@/lib/channels";
import { fetchPostPreview } from "@/lib/postPreview";

export const maxDuration = 20;

/** GET ?postId=<posts.post_id>: the post's picture/video, caption and link, straight from Meta (not stored). */
export async function GET(req: Request) {
  await connection();
  const g = await userGate(req); if ("err" in g) return g.err;
  const { me, mapped } = g;
  if (me.role === "Sales Representative" || me.role === "Agency") return fail(403, "บทบาทของคุณดูพรีวิวโพสต์ไม่ได้");
  const postId = new URL(req.url).searchParams.get("postId") ?? "";
  const post = mapped.dataset.posts.find((p) => p.id === postId);
  if (!post) return fail(404, "ไม่พบโพสต์นี้");
  const graphId = post.graphId || (/^\d+_\d+$/.test(post.id) ? post.id : "");
  if (!graphId) return fail(409, "โพสต์นี้ยังไม่มีรหัสจาก Meta — กดซิงค์คอมเมนต์อีกครั้งเพื่ออัปเดต");
  const ch = (await loadChannels()).find((x) => x.channel === post.channel && x.active && x.accessToken && (x.sheetPageId === post.pageId || (post.channel === "instagram" && x.channelId === `instagram:${post.pageId}`)));
  if (!ch) return fail(400, "เพจนี้ยังไม่ได้เชื่อมช่องทาง (ไปที่หน้า Upload → เชื่อมเพจ)");
  try {
    const preview = await fetchPostPreview({ graphId, channel: post.channel, token: ch.accessToken, base: process.env.FB_GRAPH_BASE || "https://graph.facebook.com" });
    return preview ? NextResponse.json({ ok: true, preview }, noStore) : fail(404, "Meta ไม่ส่งโพสต์นี้มา (อาจถูกลบ หรือโทเคนไม่มีสิทธิ์อ่านโพสต์)");
  } catch { return fail(502, "ดึงพรีวิวไม่สำเร็จ"); }
}
