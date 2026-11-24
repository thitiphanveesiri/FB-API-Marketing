// Pure: the Comments page's post list = posts the sync saved + posts only known from their comments (older imports), each with its comment tally.
import type { Dataset } from "./dataset";
import type { PagePost } from "./types";

export interface PostRow { post: PagePost; comments: number; unreplied: number; lastCommentAt: string }
export interface PostQuery { start: string; end: string; pageId: string; channel: "all" | "facebook" | "instagram" }

export function postRows(ds: Pick<Dataset, "posts" | "comments">, q: PostQuery): PostRow[] {
  const inRange = (iso: string) => !!iso && iso.slice(0, 10) >= q.start && iso.slice(0, 10) <= q.end;
  const rows = new Map<string, PostRow>();
  const commentedInRange = new Set<string>(); // an old post that just got a comment still belongs to the range
  for (const post of ds.posts) rows.set(post.id, { post, comments: 0, unreplied: 0, lastCommentAt: "" });
  for (const c of ds.comments) {
    if (!c.postId) continue;
    // Comments with no saved post (imported by hand): the link tells which platform it is.
    const row = rows.get(c.postId) ?? { post: { id: c.postId, pageId: c.pageId, channel: /instagram\.com/i.test(c.postId) ? "instagram" : "facebook", text: "", at: "" }, comments: 0, unreplied: 0, lastCommentAt: "" };
    row.comments++;
    if (!c.repliedAt) row.unreplied++;
    if (c.at > row.lastCommentAt) row.lastCommentAt = c.at;
    if (inRange(c.at)) commentedInRange.add(c.postId);
    rows.set(c.postId, row);
  }
  return [...rows.values()]
    .filter((r) => (q.pageId === "all" || r.post.pageId === q.pageId) && (q.channel === "all" || r.post.channel === q.channel) && (inRange(r.post.at) || commentedInRange.has(r.post.id)))
    .sort((a, b) => (b.post.at || b.lastCommentAt).localeCompare(a.post.at || a.lastCommentAt));
}
