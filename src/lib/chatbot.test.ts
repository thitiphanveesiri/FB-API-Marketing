import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, HELP, parseQuestion } from "./chatbot";
import { emptyDataset } from "./dataset";
import type { Dataset } from "./dataset";
import type { Ad, DailyPerf, Lead, User } from "./types";

const T = "2026-11-20";
const perf = (adId: string, date: string, spend: number, messages: number): DailyPerf => ({ adId, date, spend, reach: 0, impressions: 1000, clicks: 10, messages, purchases: 0, source: "import" });
const lead = (id: string, adId: string, repId: string, over: Partial<Lead> = {}) => ({ id, name: id, phone: "", email: "", pageId: "P1", adId, repId, status: "New", quality: "Qualified", valid: true, createdAt: "2026-11-15", lastContactAt: "", lastMessage: "", followUpDate: null, notes: [], firstResponseMin: 5, followUps: 1, avgFollowUpHrs: 1, unread: false, history: [], dropped: null, ...over }) as unknown as Lead;
const ds = (): Dataset => ({
  ...emptyDataset(),
  users: [{ id: "U1", name: "Somchai", role: "Sales Representative" } as User, { id: "U2", name: "Malee", role: "Sales Representative" } as User],
  pages: [{ id: "P1", name: "Hair Page", active: true, agencyId: null, teamIds: [] }],
  campaigns: [{ id: "C1", name: "Camp", pageId: "P1", agencyId: "", objective: "" }],
  ads: [{ id: "AD1", name: "Summer Video", campaignId: "C1" } as Ad, { id: "AD2", name: "Winter", campaignId: "C1" } as Ad],
  perf: [perf("AD1", "2026-11-15", 6000, 30), perf("AD2", "2026-11-16", 1000, 20), perf("AD2", "2026-10-01", 9999, 1)],
  leads: [lead("L1", "AD1", "U1", { status: "Converted", firstResponseMin: 4 }), lead("L2", "AD1", "U2", { firstResponseMin: 60 }), lead("L3", "AD1", "U2", { firstResponseMin: 90 }), lead("L4", "AD2", "U2", { firstResponseMin: 30 })],
});

test("period words and thresholds are read from the question", () => {
  assert.deepEqual(parseQuestion("เมื่อวาน", T).period, { start: "2026-11-19", end: "2026-11-19", label: "เมื่อวาน" });
  assert.equal(parseQuestion("เดือนที่แล้ว", T).period.start, "2026-10-01");
  assert.equal(parseQuestion("7 วัน", T).period.start, "2026-11-14");
  assert.deepEqual(parseQuestion("แอดที่ใช้เงินมากกว่า 5,000", T).threshold, { op: ">", n: 5000 });
});

test("a named ad gets its own spend, leads and closed count, only inside the period", () => {
  const r = answer("แอด Summer Video ใช้เงินเท่าไหร่", ds(), T);
  assert.match(r, /Summer Video: ใช้ ฿6,000/);
  assert.match(r, /ลีด 3/); assert.match(r, /ปิดได้ 1/);
  assert.doesNotMatch(answer("แอด Winter", ds(), T), /9,999/); // the October row is outside 30 days
});

test("a spend threshold keeps only the ads over it", () => {
  const r = answer("แอดที่ใช้เงินมากกว่า 5000", ds(), T);
  assert.match(r, /Summer Video/); assert.doesNotMatch(r, /1\. Winter/);
});

test("slowest sales rep comes first, and profit is never invented", () => {
  const r = answer("เซลล์คนไหนตอบช้า", ds(), T);
  assert.ok(r.indexOf("Malee") < r.indexOf("Somchai"));
  assert.match(answer("แอด Winter ได้กำไรเท่าไหร่", ds(), T), /ยังไม่มียอดเงิน/);
});

test("a page question sums the ads on that page; an unknown question gets help", () => {
  assert.match(answer("เพจ Hair Page ยิงแอดไปเท่าไหร่", ds(), T), /2 แอด · ใช้ ฿7,000/);
  assert.equal(answer("สวัสดี", ds(), T), HELP);
});
