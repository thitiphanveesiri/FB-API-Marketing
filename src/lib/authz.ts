// Pure: what each role is allowed to RECEIVE from the server. UI hiding is cosmetic; this is the real boundary.
import type { Dataset } from "./seed";
import type { Lead, User } from "./types";

const stripPii = (l: Lead): Lead => ({ ...l, name: `Lead ${l.id}`, phone: "", email: "", lastMessage: "", notes: [] });
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
      return { ...ds, leads, messages: Object.fromEntries(Object.entries(ds.messages).filter(([id]) => ids.has(id))), users: ds.users.map((u) => hideEmail(u, me)),
        agencies: ds.agencies.map((a) => ({ ...a, contact: "", email: "" })), evaluations: [], imports: [] };
    }
    case "Agency": {
      const campaigns = ds.campaigns.filter((c) => !!me.agencyId && c.agencyId === me.agencyId);
      const cIds = new Set(campaigns.map((c) => c.id));
      const ads = ds.ads.filter((a) => cIds.has(a.campaignId));
      const adIds = new Set(ads.map((a) => a.id));
      const pageIds = new Set(campaigns.map((c) => c.pageId));
      return { users: [me], pages: ds.pages.filter((p) => pageIds.has(p.id)).map((p) => ({ ...p, teamIds: [] })), agencies: ds.agencies.filter((a) => a.id === me.agencyId).map((a) => ({ ...a, contact: "", email: "" })),
        campaigns, ads, perf: ds.perf.filter((p) => adIds.has(p.adId)), leads: ds.leads.filter((l) => l.adId && adIds.has(l.adId)).map((l) => ({ ...stripPii(l), repId: null })), messages: {}, evaluations: [], imports: [] };
    }
    default: // Viewer: dashboards only, no customer personal data, no conversations
      return { ...ds, users: ds.users.map((u) => hideEmail(u, me)), agencies: ds.agencies.map((a) => ({ ...a, contact: "", email: "" })), leads: ds.leads.map(stripPii), messages: {}, evaluations: [], imports: [] };
  }
}
