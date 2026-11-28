// SERVER ONLY. Reply to a customer's comment under a Facebook post or Instagram media, as the page.
import { SendError } from "./fbSend";
import { metaApiVersion } from "./metaApi";

const scrub = (s: string) => s.replace(/EAA[\w-]{20,}/g, "…").replace(/access_token=[^&\s"']+/gi, "access_token=…");

/** Facebook: POST /{comment-id}/comments · Instagram: POST /{ig-comment-id}/replies. Returns the id of the new reply. */
export async function sendCommentReply(o: { commentId: string; token: string; text: string; channel: "facebook" | "instagram"; base: string }, doFetch: typeof fetch = fetch): Promise<string> {
  const edge = o.channel === "instagram" ? "replies" : "comments";
  const r = await doFetch(`${o.base}/${metaApiVersion()}/${encodeURIComponent(o.commentId)}/${edge}?${new URLSearchParams({ access_token: o.token })}`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ message: o.text }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
  if (r.ok && j.id) return j.id;
  const code = j.error?.code, msg = scrub(j.error?.message ?? `HTTP ${r.status}`);
  if (code === 190) throw new SendError("โทเคนของเพจหมดอายุหรือถูกเพิกถอน — วางโทเคนใหม่ในการ์ด “เชื่อมช่องทางแชท”", 401);
  if (code === 10 || code === 200) throw new SendError(`Meta ไม่อนุญาตให้ตอบคอมเมนต์: ${msg} (โทเคนต้องมีสิทธิ์ ${o.channel === "instagram" ? "instagram_manage_comments" : "pages_manage_engagement"})`, 400);
  if (code === 100 || code === 1705) throw new SendError("ตอบไม่ได้: คอมเมนต์นี้ถูกลบหรือซ่อนไปแล้ว หรือรหัสคอมเมนต์ไม่ใช่ของ Meta (ข้อมูลที่อัปโหลดจากไฟล์ตอบกลับไม่ได้)", 400);
  throw new SendError(`Meta ตอบ ${r.status}: ${msg}`, 502);
}
