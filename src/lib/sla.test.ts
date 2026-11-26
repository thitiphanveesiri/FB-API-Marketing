import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSla } from "./sla";
import type { Lead, Message, PostComment, User } from "./types";

const rep: User = { id: "R1", name: "Rep One", email: "", role: "Sales Representative", active: true, hue: 0 };
const lead = (id: string): Lead => ({
  id, name: id, phone: "", email: "", pageId: "PG-1", adId: null, repId: rep.id, status: "Not Responded", quality: "Not Responded",
  valid: true, createdAt: "2026-03-04", lastContactAt: "2026-03-04T09:30:00", lastMessage: "", followUpDate: null,
  notes: [], firstResponseMin: null, followUps: 0, avgFollowUpHrs: null, unread: true, history: [], dropped: null, source: "import",
});
const message = (id: string, leadId: string, direction: "in" | "out", at: string): Message => ({
  id, leadId, direction, text: direction === "in" ? "สอบถาม" : "ตอบแล้ว", at, simulated: false,
});

test("SLA onTime counts only replies that meet the target, not open chats", () => {
  const leads = [lead("L-ON-TIME"), lead("L-LATE"), lead("L-OPEN")];
  const result = computeSla({
    leads,
    messages: {
      "L-ON-TIME": [message("M1", "L-ON-TIME", "in", "2026-03-04T09:00:00"), message("M2", "L-ON-TIME", "out", "2026-03-04T09:15:00")],
      "L-LATE": [message("M3", "L-LATE", "in", "2026-03-04T09:00:00"), message("M4", "L-LATE", "out", "2026-03-04T09:16:00")],
      "L-OPEN": [message("M5", "L-OPEN", "in", "2026-03-04T09:30:00")],
    },
    comments: [], pages: [{ id: "PG-1", name: "Page", active: true, agencyId: null, teamIds: [rep.id] }], users: [rep],
    start: "2026-03-04", end: "2026-03-04", now: "2026-03-04T09:40:00",
  });
  const row = result.reps.find((item) => item.repId === rep.id);
  assert.ok(row);
  assert.equal(row.chats, 3);
  assert.equal(row.replied, 2);
  assert.equal(row.onTime, 1);
  assert.equal(row.late, 1);
  assert.equal(row.open, 1);
});

test("an empty page team does not fall back to all sales reps for comment penalties", () => {
  const second: User = { ...rep, id: "R2", name: "Rep Two" };
  const comment = (id: string, pageId: string): PostComment => ({
    id, pageId, postId: "POST-1", commenter: "Customer", text: "สอบถาม", at: "2026-03-04T10:00:00", repliedAt: null, repliedBy: "",
  });
  const result = computeSla({
    leads: [], messages: {}, comments: [comment("C-EMPTY", "PG-EMPTY"), comment("C-TEAM", "PG-TEAM")],
    pages: [
      { id: "PG-EMPTY", name: "Empty team", active: true, agencyId: null, teamIds: [] },
      { id: "PG-TEAM", name: "One rep", active: true, agencyId: null, teamIds: [rep.id] },
    ],
    users: [rep, second], start: "2026-03-04", end: "2026-03-04", now: "2026-03-04T12:00:00",
  });
  assert.equal(result.reps.find((item) => item.repId === rep.id)?.commentDeduct, 0.5);
  assert.equal(result.reps.find((item) => item.repId === second.id)?.commentDeduct, 0);
});
