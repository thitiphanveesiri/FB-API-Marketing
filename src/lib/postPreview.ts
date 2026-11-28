// SERVER ONLY. What a post looks like: picture/video, caption and link, asked from Meta at the moment it is opened
// (the picture links Meta hands out expire after a few days, so they are never stored).
import { metaApiVersion } from "./metaApi";

export interface PostPreview { type: "photo" | "video" | "text" | "other"; image: string; video: string; text: string; link: string }

interface FbPostRaw { full_picture?: string; permalink_url?: string; message?: string; attachments?: { data?: { media_type?: string; media?: { source?: string; image?: { src?: string } } }[] } }
interface IgMediaRaw { media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; caption?: string }

/** Returns null when Meta cannot show the post (deleted, or the token has no permission). */
export async function fetchPostPreview(o: { graphId: string; channel: "facebook" | "instagram"; token: string; base: string }, doFetch: typeof fetch = fetch): Promise<PostPreview | null> {
  const fields = o.channel === "instagram" ? "media_type,media_url,thumbnail_url,permalink,caption" : "full_picture,permalink_url,message,attachments{media_type,media{source,image{src}}}";
  const r = await doFetch(`${o.base}/${metaApiVersion()}/${encodeURIComponent(o.graphId)}?${new URLSearchParams({ fields, access_token: o.token })}`, { cache: "no-store" });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => null)) as (FbPostRaw & IgMediaRaw) | null;
  if (!j) return null;
  if (o.channel === "instagram") {
    const video = j.media_type === "VIDEO";
    return { type: video ? "video" : j.media_url ? "photo" : "other", image: video ? j.thumbnail_url ?? "" : j.media_url ?? "", video: video ? j.media_url ?? "" : "", text: j.caption ?? "", link: j.permalink ?? "" };
  }
  const att = j.attachments?.data?.[0], video = !!att?.media?.source || /video/i.test(att?.media_type ?? "");
  return { type: video ? "video" : j.full_picture ? "photo" : j.message ? "text" : "other", image: j.full_picture ?? att?.media?.image?.src ?? "", video: att?.media?.source ?? "", text: j.message ?? "", link: j.permalink_url ?? "" };
}
