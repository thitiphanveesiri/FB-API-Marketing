// SERVER ONLY. Shared sheet mapping for inbound LINE and WhatsApp messages.
import type { Dataset } from "./dataset";
import { localStamp } from "./fbSync";
import { upsertRows } from "./sheetsWrite";

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
export interface ExternalWrites { newLeads: ExternalRow[]; leadUpdates: ExternalRow[]; messages: ExternalRow[] }
export interface ExternalMessageRow { message_id: string; lead_id: string; direction: string; text: string }

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
}): ExternalWrites {
  const writes: ExternalWrites = { newLeads: [], leadUpdates: [], messages: [] };
  const anywhere = new Map(input.dataset.leads.map((lead) => [lead.id, lead]));
  const knownLeadIds = new Set(anywhere.keys());
  const leadByCustomer = new Map<string, string>();
  const latest = new Map<string, ExternalRow>();
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
    latest.set(leadId, {
      lead_id: leadId,
      last_contact_at: stamp,
      last_message: event.text.slice(0, 300),
      unread: true,
      status: "Not Responded",
      quality: "Not Responded",
      ...(event.phone ? { phone: event.phone } : {}),
      ...(existing && existing.pageId !== input.sheetPageId ? { page_id: input.sheetPageId } : {}),
    });
  }
  writes.leadUpdates.push(...latest.values());
  return writes;
}

export async function writeExternalWrites(writes: ExternalWrites, knownMessageIds: Set<string>): Promise<ExternalMessageRow[]> {
  const newMessages: ExternalMessageRow[] = [];
  for (const row of writes.messages) {
    const id = String(row.message_id ?? "");
    if (!id || knownMessageIds.has(id)) continue;
    knownMessageIds.add(id);
    newMessages.push({ message_id: id, lead_id: String(row.lead_id ?? ""), direction: String(row.direction ?? "in"), text: String(row.text ?? "") });
  }
  if (!newMessages.length) return [];
  const newIds = new Set(newMessages.map((message) => message.message_id));
  if (writes.newLeads.length) await upsertRows("leads", ["lead_id"], writes.newLeads, "insert");
  await upsertRows("messages", ["message_id"], writes.messages.filter((row) => newIds.has(String(row.message_id ?? ""))), "insert");
  if (writes.leadUpdates.length) await upsertRows("leads", ["lead_id"], writes.leadUpdates, "updateOnly");
  return newMessages;
}

export function externalRecipientOf(leadId: string, channel: ExternalChatChannel, accountId: string): string | null {
  const prefix = `${prefixOf(channel)}-${accountId}-`;
  if (!leadId.startsWith(prefix)) return null;
  const recipient = leadId.slice(prefix.length);
  if (channel === "whatsapp") return /^\d{6,20}$/.test(recipient) ? recipient : null;
  return /^U[A-Za-z0-9_-]{5,64}$/.test(recipient) ? recipient : null;
}
