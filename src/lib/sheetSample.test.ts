import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDataset, type Dataset } from "./dataset";
import { datasetToTabs, headersOnly } from "./sheetSample";
import { mapSheets } from "./sheetMapper";
import { SHEET_TABS } from "./sheetSchema";

const records = (grid: string[][]) => {
  const [headers = [], ...rows] = grid;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
};

const fixture = (): Dataset => ({
  ...emptyDataset(),
  users: [
    { id: "U-ADMIN", name: "Admin", email: "admin@example.test", role: "Administrator", active: true, hue: 0 },
    { id: "U-REP", name: "Sale", email: "sale@example.test", role: "Sales Representative", agencyId: "AG-1", active: true, hue: 120 },
  ],
  pages: [{ id: "PG-1", name: "หน้าไทย", active: true, agencyId: "AG-1", teamIds: ["U-REP"] }],
  agencies: [{ id: "AG-1", name: "Agency", contact: "Contact", email: "agency@example.test", active: true }],
  campaigns: [{ id: "C-1", name: "Campaign", pageId: "PG-1", agencyId: "AG-1", objective: "Messages" }],
  ads: [{
    id: "AD-1", name: "Ad", campaignId: "C-1", pageId: "PG-1", status: "Active", updatedAt: "2026-03-03",
    creative: { type: "Video", hue: 42, url: "https://example.test/image.jpg", video: "https://example.test/video.mp4", ref: "v:video-1" },
    caption: "คำอธิบาย", headline: "หัวข้อ",
  }],
  perf: [{ adId: "AD-1", date: "2026-03-04", spend: 123.45, reach: 1000, impressions: 1600, clicks: 70, clicksAll: 91, messages: 12, purchases: 3, source: "demo" }],
  leads: [{
    id: "L-1", name: "ลูกค้าไทย", phone: "0812345678", email: "lead@example.test", pageId: "PG-1", adId: "AD-1", repId: "U-REP",
    status: "Converted", quality: "Appointment Booked", valid: true, createdAt: "2026-03-01", lastContactAt: "2026-03-04T10:11:00",
    lastMessage: "ข้อความล่าสุด", followUpDate: "2026-03-10", notes: [], firstResponseMin: 12, followUps: 3, avgFollowUpHrs: 5.5,
    unread: true, history: [], source: "demo", channel: "line", fbUserId: "Uabcde", phone2: "022222222", whatsapp: "66812345678",
    leadSource: "Paid", form: "Spring form", labels: "VIP,ไทย",
    dropped: { reason: "Postponed", at: "2026-03-05", previousStatus: "Qualified", recovery: "In Progress", lastActivity: "รอติดต่อกลับ" },
  }],
  messages: {
    "L-1": [
      { id: "M-IN", leadId: "L-1", direction: "in", senderType: "customer", text: "สวัสดี", at: "2026-03-04T10:00:00", attachment: { name: "photo.png", kind: "image" }, simulated: false },
      { id: "M-OUT", leadId: "L-1", direction: "out", senderType: "human", senderApp: "123456", sentBy: "U-REP", text: "รับทราบ", at: "2026-03-04T10:11:00", simulated: false },
    ],
  },
});

test("sample headers and every generated row follow SHEET_TABS order and width", () => {
  const dataset = fixture();
  const headers = headersOnly();
  const tabs = datasetToTabs(dataset);
  for (const spec of SHEET_TABS) {
    const names = spec.cols.map((col) => col.name);
    assert.deepEqual(headers[spec.tab], [names], spec.tab);
    assert.deepEqual(tabs[spec.tab][0], names, spec.tab);
    for (const row of tabs[spec.tab].slice(1)) assert.equal(row.length, names.length, `${spec.tab} row width`);
  }
});

test("sample values land under their header names, including clicks_all and all lead columns", () => {
  const tabs = datasetToTabs(fixture());
  assert.deepEqual(records(tabs.ad_performance)[0], {
    date: "2026-03-04", ad_id: "AD-1", spend: "123.45", reach: "1000", impressions: "1600",
    clicks: "70", clicks_all: "91", messages: "12", purchases: "3",
  });
  assert.deepEqual(records(tabs.leads)[0], {
    lead_id: "L-1", name: "ลูกค้าไทย", page_id: "PG-1", ad_id: "AD-1", assigned_to: "U-REP",
    status: "Converted", quality: "Appointment Booked", valid: "TRUE", created_at: "2026-03-01",
    last_contact_at: "2026-03-04 10:11", last_message: "ข้อความล่าสุด", follow_up_date: "2026-03-10",
    phone: "0812345678", email: "lead@example.test", phone2: "022222222", whatsapp: "66812345678",
    lead_source: "Paid", form: "Spring form", labels: "VIP,ไทย", first_response_min: "12", follow_ups: "3",
    avg_follow_up_hrs: "5.5", unread: "TRUE", drop_reason: "Postponed", dropped_at: "2026-03-05",
    previous_status: "Qualified", recovery_status: "In Progress", last_activity: "รอติดต่อกลับ", channel: "line", fb_user_id: "Uabcde",
  });
  assert.equal(records(tabs.ads)[0].creative_ref, "v:video-1");
  assert.equal(records(tabs.pages)[0].sales_team, "U-REP");
  assert.equal(records(tabs.messages)[1].sent_by, "U-REP");
  assert.equal(records(tabs.messages)[1].sender_type, "human");
  assert.equal(records(tabs.messages)[1].sender_app, "123456");
});

test("sample rows round-trip through the sheet mapper without shifting values", () => {
  const mapped = mapSheets(datasetToTabs(fixture()));
  assert.deepEqual(mapped.missingTabs, []);
  assert.deepEqual(mapped.warnings, []);
  assert.deepEqual(mapped.dataset.perf[0], {
    adId: "AD-1", date: "2026-03-04", spend: 123.45, reach: 1000, impressions: 1600,
    clicks: 70, clicksAll: 91, messages: 12, purchases: 3, source: "import",
  });
  const lead = mapped.dataset.leads[0];
  assert.equal(lead.status, "Converted");
  assert.equal(lead.quality, "Appointment Booked");
  assert.equal(lead.lastContactAt, "2026-03-04T10:11:00");
  assert.equal(lead.lastMessage, "ข้อความล่าสุด");
  assert.equal(lead.phone2, "022222222");
  assert.equal(lead.whatsapp, "66812345678");
  assert.equal(lead.leadSource, "Paid");
  assert.equal(lead.form, "Spring form");
  assert.equal(lead.labels, "VIP,ไทย");
  assert.equal(lead.firstResponseMin, 12);
  assert.equal(lead.followUps, 3);
  assert.equal(lead.avgFollowUpHrs, 5.5);
  assert.equal(lead.channel, "line");
  assert.equal(lead.fbUserId, "Uabcde");
  assert.deepEqual(lead.dropped, {
    reason: "Postponed", at: "2026-03-05", previousStatus: "Qualified", recovery: "In Progress", lastActivity: "รอติดต่อกลับ",
  });
  assert.equal(mapped.dataset.ads[0].creative.ref, "v:video-1");
  assert.deepEqual(mapped.dataset.pages[0].teamIds, ["U-REP"]);
  assert.equal(mapped.dataset.messages["L-1"][1].sentBy, "U-REP");
  assert.equal(mapped.dataset.messages["L-1"][1].senderType, "human");
  assert.equal(mapped.dataset.messages["L-1"][1].senderApp, "123456");
});
