import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import {
  buildExternalWrites,
  dedupeExternalEvents,
  externalLeadId,
  externalMessageId,
  writeExternalWrites,
  type ExternalEvent,
} from "./externalWebhook";
import { upsertRows } from "./sheetsWrite";

type LocalGrid = Record<string, string[][]>;

const records = (grid: string[][] = []) => {
  const [headers = [], ...rows] = grid;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
};

const readLocalSheet = async (file: string): Promise<LocalGrid> => JSON.parse(await readFile(file, "utf8")) as LocalGrid;

test("writes and deduplicates external messages through the local JSON upsert backend", { concurrency: false }, async () => {
  const originalLocalFile = process.env.SHEETS_LOCAL_JSON;
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "marketing-external-writes-"));
  const file = join(directory, "sheet.json");

  try {
    await writeFile(file, JSON.stringify({ leads: [], messages: [] }));
    process.env.SHEETS_LOCAL_JSON = file;
    globalThis.fetch = async () => { throw new Error("Local Sheet test attempted a network request"); };

    const first: ExternalEvent = {
      accountId: "line-account",
      customerId: "Uabcde",
      mid: externalMessageId("line", "local-1"),
      text: "first message",
      at: Date.parse("2026-04-05T05:06:07.000Z"),
    };
    const second: ExternalEvent = {
      ...first,
      mid: externalMessageId("line", "local-2"),
      text: "x".repeat(350),
      at: Date.parse("2026-04-05T06:07:08.000Z"),
      attachmentName: "receipt.pdf",
    };
    const leadId = externalLeadId("line", "line-account", "Uabcde");
    const knownMessageIds = new Set<string>();
    const freshEvents = dedupeExternalEvents([second, first, { ...first }], knownMessageIds);
    const writes = buildExternalWrites(freshEvents, {
      channel: "line",
      sheetPageId: "PG-LOCAL",
      dataset: emptyDataset(),
      timezone: "UTC",
    });

    const newMessages = await writeExternalWrites(writes, knownMessageIds);
    assert.deepEqual(newMessages, [
      { message_id: first.mid, lead_id: leadId, direction: "in", text: first.text },
      { message_id: second.mid, lead_id: leadId, direction: "in", text: second.text },
    ]);
    assert.deepEqual([...knownMessageIds].sort(), [first.mid, second.mid].sort());

    const local = await readLocalSheet(file);
    assert.deepEqual(records(local.leads), [{
      lead_id: leadId,
      name: "LINE bcde",
      page_id: "PG-LOCAL",
      ad_id: "",
      assigned_to: "",
      status: "Not Responded",
      quality: "Not Responded",
      valid: "true",
      created_at: "2026-04-05",
      phone: "",
      email: "",
      unread: "true",
      channel: "line",
      last_contact_at: "2026-04-05 06:07",
      last_message: second.text.slice(0, 300),
    }]);
    assert.equal("fb_user_id" in records(local.leads)[0], false);
    assert.deepEqual(records(local.messages), [
      {
        message_id: first.mid,
        lead_id: leadId,
        direction: "in",
        sender_type: "customer",
        sender_app: "",
        text: first.text,
        sent_at: "2026-04-05 05:06",
        attachment_name: "",
      },
      {
        message_id: second.mid,
        lead_id: leadId,
        direction: "in",
        sender_type: "customer",
        sender_app: "",
        text: second.text,
        sent_at: "2026-04-05 06:07",
        attachment_name: "receipt.pdf",
      },
    ]);

    const beforeReplay = await readFile(file, "utf8");
    assert.deepEqual(await writeExternalWrites(writes, knownMessageIds), newMessages);
    assert.equal(await readFile(file, "utf8"), beforeReplay);

    assert.deepEqual(await upsertRows("leads", ["lead_id"], [{
      lead_id: leadId,
      status: "Qualified",
      quality: "Qualified",
      phone: "0812345678",
    }], "updateOnly"), { updated: 1, appended: 0, skipped: 0 });
    const updated = await readLocalSheet(file);
    assert.equal(records(updated.leads)[0].status, "Qualified");
    assert.equal(records(updated.leads)[0].quality, "Qualified");
    assert.equal(records(updated.leads)[0].phone, "0812345678");
    assert.equal(records(updated.messages).length, 2);
  } finally {
    if (originalLocalFile === undefined) delete process.env.SHEETS_LOCAL_JSON;
    else process.env.SHEETS_LOCAL_JSON = originalLocalFile;
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
