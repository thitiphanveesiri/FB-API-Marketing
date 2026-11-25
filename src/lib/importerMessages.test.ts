import assert from "node:assert/strict";
import { test } from "node:test";
import { autoMap, FIELDS, leadNameKey, validate } from "./importer";
import type { Lead } from "./types";

// Same customer chatted on Facebook (page P-FB) and Instagram (page P-IG): the IG chat lives on the "… (Instagram)" page.
const lead = (id: string, pageId: string): Lead => ({ id, name: "Napat K.", pageId } as Lead);
const fbChat = lead("L-FB", "P-FB"), igChat = lead("L-IG", "P-IG");
const byName = (ls: Lead[]) => new Map(ls.map((l) => [leadNameKey(l.name), l.id] as const));

const run = (headers: string[], rows: Record<string, string>[]) => validate({
  type: "Chat Messages", mapping: autoMap(headers, FIELDS["Chat Messages"]), rows, mode: "incremental", importId: "T",
  existingPerfKeys: new Set(), existingAdIds: new Set(), existingLeadIds: new Set([fbChat.id, igChat.id]), existingInsightKeys: new Set(),
  existingLeads: [fbChat], leadIdByName: byName([fbChat]), leadsByPage: new Map([["P-FB", [fbChat]], ["P-IG", [igChat]]]), channelPageIds: { instagram: "P-IG" },
  pageId: "P-FB", repsByName: new Map(), nextLeadNo: 1,
});

test("an Instagram message goes to the Instagram chat even when a Facebook chat has the same name", () => {
  const h = ["Channel", "Name", "Sender", "Time", "Text"];
  const r = run(h, [
    { Channel: "ig", Name: "Napat K.", Sender: "customer", Time: "2026-11-02 11:00", Text: "from ig" },
    { Channel: "fb", Name: "Napat K.", Sender: "customer", Time: "2026-11-02 11:05", Text: "from fb" },
  ]);
  assert.deepEqual(r.messages.map((m) => [m.leadId, m.text]), [["L-IG", "from ig"], ["L-FB", "from fb"]]);
});

test("a file without a Channel column still lands on the selected page", () => {
  const r = run(["Name", "Sender", "Time", "Text"], [{ Name: "Napat K.", Sender: "customer", Time: "2026-11-02 11:00", Text: "hi" }]);
  assert.deepEqual(r.messages.map((m) => m.leadId), ["L-FB"]);
});
