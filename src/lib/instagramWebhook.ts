import type { Dataset } from "./dataset";
import { localStamp } from "./fbSync";

export interface InstagramEvent {
  accountId: string;
  customerId: string;
  mid: string;
  out: boolean;
  text: string;
  at: number;
  username?: string;
  adId?: string;
}

interface InstagramPayload {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string; username?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        is_deleted?: boolean;
        is_unsupported?: boolean;
        attachments?: { type?: string }[];
        referral?: { ad_id?: string | number };
      };
    }[];
  }[];
}

/** Instagram Messaging has its own webhook object and account-scoped customer IDs. */
export function parseInstagramEvents(payload: InstagramPayload): InstagramEvent[] {
  if (payload.object !== "instagram") return [];
  const events: InstagramEvent[] = [];
  for (const entry of payload.entry ?? []) for (const item of entry.messaging ?? []) {
    const message = item.message;
    if (!entry.id || !message?.mid || message.is_deleted) continue;
    const out = message.is_echo === true;
    const customerId = out
      ? item.recipient?.id !== entry.id ? item.recipient?.id : item.sender?.id
      : item.sender?.id;
    if (!customerId || customerId === entry.id) continue;
    const attachment = !!message.attachments?.length || message.is_unsupported;
    events.push({
      accountId: entry.id,
      customerId,
      mid: message.mid,
      out,
      text: (message.text || (attachment ? "[ไฟล์แนบ]" : "")).slice(0, 2000),
      at: item.timestamp ?? Date.now(),
      username: !out ? item.sender?.username : undefined,
      adId: !out && message.referral?.ad_id != null ? String(message.referral.ad_id) : undefined,
    });
  }
  return events;
}

type Row = Record<string, string | number | boolean>;
export interface InstagramWrites { newLeads: Row[]; leadUpdates: Row[]; messages: Row[] }

/** Build sheet rows without matching Instagram users to Facebook leads or writing their IGSID as a Facebook PSID. */
export function buildInstagramWrites(
  events: InstagramEvent[],
  channel: { accountId: string; sheetPageId: string },
  dataset: Dataset,
  timezone: string,
  knownMessageIds: ReadonlySet<string> = new Set(),
): InstagramWrites {
  const writes: InstagramWrites = { newLeads: [], leadUpdates: [], messages: [] };
  const leads = dataset.leads.filter((lead) => lead.pageId === channel.sheetPageId && lead.channel === "instagram");
  const knownLeadIds = new Set(leads.map((lead) => lead.id));
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const anywhere = new Map(dataset.leads.map((lead) => [lead.id, lead]));
  const leadByCustomer = new Map<string, string>();
  const latest = new Map<string, { row: Row; at: number; fresh: boolean }>();
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    let leadId = leadByCustomer.get(event.customerId);
    if (!leadId) {
      leadId = `IG-${channel.accountId}-${event.customerId}`;
      const existing = anywhere.get(leadId);
      if (!knownLeadIds.has(leadId)) {
        knownLeadIds.add(leadId);
        if (!existing) {
          const name = event.username ? `@${event.username}` : `Instagram user ${event.customerId.slice(-4)}`;
          const stamp = localStamp(new Date(event.at).toISOString(), timezone);
          writes.newLeads.push({
            lead_id: leadId, name, page_id: channel.sheetPageId, ad_id: event.adId ?? "", assigned_to: "",
            status: event.out ? "Average" : "Not Responded", quality: event.out ? "Average" : "Not Responded",
            valid: true, created_at: stamp.slice(0, 10), phone: "", email: "", unread: !event.out, channel: "instagram",
          });
        }
      }
      leadByCustomer.set(event.customerId, leadId);
    }
    const stamp = localStamp(new Date(event.at).toISOString(), timezone);
    writes.messages.push({
      message_id: event.mid, lead_id: leadId, direction: event.out ? "out" : "in",
      sender_type: event.out ? "unknown" : "customer", sender_app: "", text: event.text,
      sent_at: stamp, attachment_name: "",
    });
    const existing = anywhere.get(leadId);
    const row: Row = {
      lead_id: leadId, last_contact_at: stamp, last_message: event.text.slice(0, 300), unread: !event.out,
      ...(existing && existing.pageId !== channel.sheetPageId ? { page_id: channel.sheetPageId } : {}),
    };
    const fresh = !knownMessageIds.has(event.mid);
    const previous = latest.get(leadId);
    if (!previous || event.at > previous.at || (event.at === previous.at && fresh)) latest.set(leadId, { row, at: event.at, fresh });
  }
  const contactMinute = (value: string) => value.replace("T", " ").slice(0, 16);
  for (const [leadId, entry] of latest) {
    const existing = leadsById.get(leadId);
    const stamp = contactMinute(String(entry.row.last_contact_at));
    const missingSummary = existing?.lastMessage === "" && existing.lastContactAt === `${existing.createdAt}T09:00:00`;
    const current = existing && !missingSummary ? contactMinute(existing.lastContactAt) : "";
    if (existing && (stamp < current || (stamp === current && !entry.fresh))) continue;
    writes.leadUpdates.push(entry.row);
  }
  return writes;
}

export function instagramRecipientOf(leadId: string, instagramAccountId: string): string | null {
  const prefix = `IG-${instagramAccountId}-`;
  if (!leadId.startsWith(prefix)) return null;
  const id = leadId.slice(prefix.length);
  return /^\d{1,32}$/.test(id) ? id : null;
}

/** Who to message on Instagram. Webhook leads encode the customer in their id (`IG-<account>-<igsid>`); leads imported by the history sync
 *  keep the conversation id as lead_id and store the customer's Instagram-scoped id in fb_user_id, so fall back to that. */
export function instagramRecipientFor(lead: { id: string; fbUserId?: string }, instagramAccountId: string): string | null {
  const fromId = instagramRecipientOf(lead.id, instagramAccountId);
  if (fromId) return fromId;
  const stored = lead.fbUserId?.trim();
  return stored && /^\d{5,32}$/.test(stored) && stored !== instagramAccountId ? stored : null;
}
