import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset } from "./dataset";
import { mapSheets } from "./sheetMapper";
import { datasetToTabs } from "./sheetSample";
import type { Lead, Message } from "./types";

test("the same message from Meta and from a CSV shows once, keeping the Meta id", () => {
  const lead = { id: "L1", name: "A", phone: "", email: "", pageId: "P1", adId: null, repId: null, status: "Not Responded", quality: "Not Responded", valid: true, createdAt: "2026-11-02", lastContactAt: "2026-11-02T11:00:00", lastMessage: "hello", unread: false, notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null, history: [], dropped: null, source: "import", channel: "facebook" } as Lead;
  const m = (id: string, at: string) => ({ id, leadId: "L1", direction: "in", senderType: "customer", text: "hello", at }) as Message;
  const ds = { ...emptyDataset(), leads: [lead], messages: { L1: [m("MSG-L1-202611021100-in", "2026-11-02T11:00:00"), m("m_abc", "2026-11-02T11:00:23")] } };
  assert.deepEqual(mapSheets(datasetToTabs(ds)).dataset.messages.L1.map((x) => x.id), ["m_abc"]);
});
