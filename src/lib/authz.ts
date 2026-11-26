// Pure: what each role is allowed to RECEIVE from the server. UI hiding is cosmetic; this is the real boundary.
import { createHmac, randomBytes } from "node:crypto";
import type { Dataset } from "./dataset";
import type { Lead, PostComment, User } from "./types";

const fallbackRedactionKey = randomBytes(32);
const opaqueLeadId = (id: string) => createHmac("sha256", process.env.AUTH_SECRET?.trim() || fallbackRedactionKey)
  .update(`lead-id\0${id}`).digest("hex").slice(0, 24);
const stripPii = (l: Lead): Lead => {
  const opaque = opaqueLeadId(l.id);
  return {
    ...l, id: `LEAD-${opaque}`, name: `Lead ${opaque.slice(-6).toUpperCase()}`, phone: "", phone2: "", whatsapp: "", email: "", fbUserId: undefined,
    lastMessage: "", leadSource: "", form: "", labels: "", notes: [], history: l.history.map((h) => ({ ...h, note: undefined })),
    dropped: l.dropped ? { ...l.dropped, lastActivity: "" } : null,
  };
};
/** Sales reps need comment timings (the penalty is shared) but not the customers' words or names. */
const blindComment = (c: PostComment): PostComment => ({ ...c, postId: "", commenter: "", text: "", repliedBy: "" });
const hideEmail = (u: User, me: User): User => (u.id === me.id ? u : { ...u, email: "" });

export function scopeDataset(ds: Dataset, me: User): Dataset {
  switch (me.role) {
    case "Administrator":
    case "Marketing Manager":
    case "Sales Manager":
      return ds;
    case "Sales Representative": {
      const leads = ds.leads.filter((l) => l.repId === me.id);
      const ids = new Set(leads.map((l) => l.id));
      const adIds = new Set(leads.map((l) => l.adId).filter((id): id is string => !!id));
      const campaignIds = new Set(ds.ads.filter((a) => adIds.has(a.id)).map((a) => a.campaignId));
      const pageIds = new Set(leads.map((l) => l.pageId));
      return { ...ds, leads, messages: Object.fromEntries(Object.entries(ds.messages).filter(([id]) => ids.has(id))), users: ds.users.map((u) => hideEmail(u, me)),
        agencies: ds.agencies.map((a) => ({ ...a, contact: "", email: "" })), campaigns: ds.campaigns.filter((c) => campaignIds.has(c.id)), ads: ds.ads.filter((a) => adIds.has(a.id)),
        pages: ds.pages.filter((p) => pageIds.has(p.id)), perf: [], evaluations: [], imports: [], insights: [], comments: ds.comments.map(blindComment), posts: [] };
    }
    case "Agency": {
      const campaigns = ds.campaigns.filter((c) => !!me.agencyId && c.agencyId === me.agencyId);
      const cIds = new Set(campaigns.map((c) => c.id));
      const ads = ds.ads.filter((a) => cIds.has(a.campaignId));
      const adIds = new Set(ads.map((a) => a.id));
      const pageIds = new Set([...campaigns.map((c) => c.pageId), ...ads.map((a) => a.pageId).filter((id): id is string => !!id)]);
      return { users: [me], pages: ds.pages.filter((p) => pageIds.has(p.id)).map((p) => ({ ...p, teamIds: [] })), agencies: ds.agencies.filter((a) => a.id === me.agencyId).map((a) => ({ ...a, contact: "", email: "" })),
        campaigns, ads, perf: ds.perf.filter((p) => adIds.has(p.adId)), leads: ds.leads.filter((l) => l.adId && adIds.has(l.adId)).map((l) => ({ ...stripPii(l), repId: null })), messages: {}, evaluations: [], imports: [], insights: ds.insights.filter((x) => pageIds.has(x.pageId)), comments: [], posts: [] };
    }
    default: // Viewer: dashboards only, no customer personal data, no conversations
      return { ...ds, users: ds.users.map((u) => hideEmail(u, me)), agencies: ds.agencies.map((a) => ({ ...a, contact: "", email: "" })), leads: ds.leads.map(stripPii), messages: {}, evaluations: [], imports: [], insights: ds.insights, comments: [], posts: [] };
  }
}
