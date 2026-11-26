// SERVER ONLY. Shared sheet mapping and persistence for inbound LINE and WhatsApp messages.
import type { Dataset } from "./dataset";
import { localStamp } from "./fbSync";
import { writeWebhookWrites, type WebhookMessageRow, type WebhookWrites } from "./webhookWrites";

export type ExternalChatChannel = "line" | "whatsapp";
export type ExternalRow = Record<string, string | number | boolean>;
export interface ExternalEvent {
  accountId: string;
  customerId: string;
  mid: string;
  text: string;
  at: number;
  displayName?: string;
  phone?: string;
  attachmentName?: string;
}
export type ExternalWrites = WebhookWrites;
export type ExternalMessageRow = WebhookMessageRow;

const prefixOf = (channel: ExternalChatChannel) => channel === "line" ? "LINE" : "WA";
export const externalLeadId = (channel: ExternalChatChannel, accountId: string, customerId: string) => `${prefixOf(channel)}-${accountId}-${customerId}`;
export const externalMessageId = (channel: ExternalChatChannel, messageId: string) => `${prefixOf(channel)}-IN-${messageId}`;

export function dedupeExternalEvents(events: ExternalEvent[], knownMessageIds: Set<string>): ExternalEvent[] {
  const seen = new Set(knownMessageIds);
  return events.filter((event) => {
    if (!event.mid || seen.has(event.mid)) return false;
    seen.add(event.mid);
    return true;
  });
}

export function buildExternalWrites(events: ExternalEvent[], input: {
  channel: ExternalChatChannel;
  sheetPageId: string;
  dataset: Dataset;
  timezone: string;
  knownMessageIds?: ReadonlySet<string>;
}): ExternalWrites {
  const writes: ExternalWrites = { newLeads: [], leadUpdates: [], messages: [] };
  const anywhere = new Map(input.dataset.leads.map((lead) => [lead.id, lead]));
  const knownLeadIds = new Set(anywhere.keys());
  const leadByCustomer = new Map<string, string>();
  const latest = new Map<string, { row: ExternalRow; at: number; fresh: boolean }>();
  const label = input.channel === "line" ? "LINE" : "WhatsApp";

  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    let leadId = leadByCustomer.get(event.customerId);
    if (!leadId) {
      leadId = externalLeadId(input.channel, event.accountId, event.customerId);
      const existing = anywhere.get(leadId);
      if (!knownLeadIds.has(leadId)) {
        knownLeadIds.add(leadId);
        if (!existing) {
          const stamp = localStamp(new Date(event.at).toISOString(), input.timezone);
          writes.newLeads.push({
            lead_id: leadId,
            name: event.displayName?.trim() || `${label} ${event.customerId.slice(-4)}`,
            page_id: input.sheetPageId,
            ad_id: "",
            assigned_to: "",
            status: "Not Responded",
            quality: "Not Responded",
            valid: true,
            created_at: stamp.slice(0, 10),
            phone: event.phone ?? "",
            email: "",
            unread: true,
            channel: input.channel,
          });
        }
      }
      leadByCustomer.set(event.customerId, leadId);
    }
    const existing = anywhere.get(leadId);
    const stamp = localStamp(new Date(event.at).toISOString(), input.timezone);
    const fresh = !input.knownMessageIds?.has(event.mid);
    writes.messages.push({
      message_id: event.mid,
      lead_id: leadId,
      direction: "in",
      sender_type: "customer",
      sender_app: "",
      text: event.text,
      sent_at: stamp,
      attachment_name: event.attachmentName ?? "",
    });
    const row: ExternalRow = {
      lead_id: leadId,
      last_contact_at: stamp,
      last_message: event.text.slice(0, 300),
      unread: true,
      ...(event.phone ? { phone: event.phone } : {}),
      ...(existing && existing.pageId !== input.sheetPageId ? { page_id: input.sheetPageId } : {}),
    };
    const previous = latest.get(leadId);
    if (!previous || event.at > previous.at || (event.at === previous.at && fresh)) latest.set(leadId, { row, at: event.at, fresh });
  }
  const contactMinute = (value: string) => value.replace("T", " ").slice(0, 16);
  for (const [leadId, entry] of latest) {
    const existing = anywhere.get(leadId);
    const stamp = contactMinute(String(entry.row.last_contact_at));
    const missingSummary = existing?.lastMessage === "" && existing.lastContactAt === `${existing.createdAt}T09:00:00`;
    const current = existing && !missingSummary ? contactMinute(existing.lastContactAt) : "";
    if (existing && (stamp < current || (stamp === current && !entry.fresh))) continue;
    writes.leadUpdates.push(entry.row);
  }
  return writes;
}

export async function writeExternalWrites(writes: ExternalWrites, knownMessageIds: Set<string>): Promise<ExternalMessageRow[]> {
  return writeWebhookWrites(writes, knownMessageIds);
}

export function externalRecipientOf(leadId: string, channel: ExternalChatChannel, accountId: string): string | null {
  const prefix = `${prefixOf(channel)}-${accountId}-`;
  if (!leadId.startsWith(prefix)) return null;
  const recipient = leadId.slice(prefix.length);
  if (channel === "whatsapp") return /^\d{6,20}$/.test(recipient) ? recipient : null;
  return /^U[A-Za-z0-9_-]{5,64}$/.test(recipient) ? recipient : null;
}
