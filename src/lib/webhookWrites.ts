import { upsertRows } from "./sheetsWrite";

export type WebhookRow = Record<string, string | number | boolean>;
export interface WebhookWrites { newLeads: WebhookRow[]; leadUpdates: WebhookRow[]; messages: WebhookRow[] }
export interface WebhookMessageRow { message_id: string; lead_id: string; direction: string; text: string }
export type WebhookRowWriter = (
  tab: string,
  keyCols: string[],
  rows: WebhookRow[],
  mode: "insert" | "updateOnly",
) => Promise<unknown>;

/** Persist messages before publishing their IDs. Lead summaries are written even when every message is a replay, so retries can repair partial writes. */
export async function writeWebhookWrites(
  writes: WebhookWrites,
  knownMessageIds: Set<string>,
  writeRows: WebhookRowWriter = upsertRows,
): Promise<WebhookMessageRow[]> {
  const seen = new Set<string>();
  const freshRows: WebhookRow[] = [];
  const newMessages: WebhookMessageRow[] = [];
  const repairedMessages: WebhookMessageRow[] = [];
  for (const row of writes.messages) {
    const id = String(row.message_id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const message = { message_id: id, lead_id: String(row.lead_id ?? ""), direction: String(row.direction ?? "in"), text: String(row.text ?? "") };
    if (knownMessageIds.has(id)) repairedMessages.push(message);
    else {
      freshRows.push(row);
      newMessages.push(message);
    }
  }
  const repaired = !freshRows.length && !!(writes.newLeads.length || writes.leadUpdates.length);
  if (!freshRows.length && !repaired) return [];

  if (writes.newLeads.length) await writeRows("leads", ["lead_id"], writes.newLeads, "insert");
  if (freshRows.length) await writeRows("messages", ["message_id"], freshRows, "insert");
  if (writes.leadUpdates.length) await writeRows("leads", ["lead_id"], writes.leadUpdates, "updateOnly");
  for (const message of newMessages) knownMessageIds.add(message.message_id);
  return repaired ? repairedMessages : newMessages;
}
