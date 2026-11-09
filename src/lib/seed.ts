// DEMO DATA ONLY. Deterministic generator — nothing here is real Facebook data.
// Replace `buildDemoDataset()` with a repository that reads from SQL / Meta APIs.
import { addDays, DEMO_ANCHOR as ANCHOR, diffDays } from "./dates";
import {
  Ad, AdStatus, Agency, Campaign, DailyPerf, DropReason, Evaluation, FbPage, ImportRecord,
  Lead, LeadQuality, LeadStatus, Message, QUALITIES, QUALIFIED_QUALITIES, User,
} from "./types";

import type { Dataset } from "./dataset";
export type { Dataset };

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Somchai", "Malee", "Nattapong", "Pimchanok", "Kittisak", "Supansa", "Anucha", "Wanida", "Thanakorn", "Ploy", "Chaiwat", "Napat", "Sirikarn", "Arthit", "Jiraporn", "Pakorn", "Kanokwan", "Teerapat", "Orawan", "Ratchanon", "Benjawan", "Surasak", "Mintra", "Phuwadol"];
const LAST = ["Srisuk", "Charoen", "Wongsa", "Boonmee", "Saetang", "Prasert", "Kaewdee", "Rattana", "Thongchai", "Suwan", "Phanit", "Chaisiri"];

const IN_MSGS = [
  "Hi, I saw your ad. Can I get more details?",
  "How much does the consultation cost?",
  "Is there any promotion this month?",
  "Can I book for this weekend?",
  "Where is your branch located?",
  "What time are you open?",
  "I'm interested, what are the next steps?",
  "Thanks, I'll think about it.",
  "Can you send me some before/after photos?",
  "That's a bit expensive for me.",
];
const OUT_MSGS = [
  "Hello! Thanks for contacting us 😊 How can we help?",
  "The first consultation is free. Would you like to book a time?",
  "We have a promotion running until the end of the month.",
  "We have slots on Saturday at 10:00 and 14:00. Which works for you?",
  "Our branch is open 10:00–20:00 daily. I can send you the map.",
  "Sure! I'll send the details now. Could I have your phone number?",
  "Just checking in — would you like to confirm your appointment?",
];

const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const p2 = (n: number) => String(n).padStart(2, "0");

export function buildDemoDataset(): Dataset {
  const r = rng(20261107);

  const agencies: Agency[] = [
    { id: "AG-1", name: "Growth Lab (Demo)", contact: "Pim A.", email: "hello@growthlab.example", active: true },
    { id: "AG-2", name: "Pixel Reach (Demo)", contact: "Jon K.", email: "team@pixelreach.example", active: true },
    { id: "AG-3", name: "Northwind Media (Demo)", contact: "Ice S.", email: "ads@northwind.example", active: true },
  ];

  const users: User[] = [
    { id: "U-ADMIN", name: "Demo Admin", email: "admin@demo.example", role: "Administrator", active: true, hue: 160 },
    { id: "U-MKT", name: "Narin Chaiyo", email: "narin@demo.example", role: "Marketing Manager", active: true, hue: 200 },
    { id: "U-SM", name: "Kanda Phet", email: "kanda@demo.example", role: "Sales Manager", active: true, hue: 30 },
    { id: "U-R1", name: "Anan Wong", email: "anan@demo.example", role: "Sales Representative", active: true, hue: 270 },
    { id: "U-R2", name: "Bella Rattana", email: "bella@demo.example", role: "Sales Representative", active: true, hue: 330 },
    { id: "U-R3", name: "Chai Suwan", email: "chai@demo.example", role: "Sales Representative", active: true, hue: 90 },
    { id: "U-R4", name: "Dao Kaewdee", email: "dao@demo.example", role: "Sales Representative", active: true, hue: 15 },
    { id: "U-R5", name: "Ekachai Prasert", email: "ek@demo.example", role: "Sales Representative", active: true, hue: 220 },
    { id: "U-AG1", name: "Pim (Growth Lab)", email: "pim@growthlab.example", role: "Agency", active: true, agencyId: "AG-1", hue: 120 },
    { id: "U-VIEW", name: "Viewer Guest", email: "viewer@demo.example", role: "Viewer", active: true, hue: 0 },
  ];
  const repSkill: Record<string, number> = { "U-R1": 0.9, "U-R2": 0.75, "U-R3": 0.55, "U-R4": 0.8, "U-R5": 0.4 };

  const pages: FbPage[] = [
    { id: "PG-1", name: "Demo Clinic Bangkok", active: true, agencyId: "AG-1", teamIds: ["U-R1", "U-R2", "U-R3"] },
    { id: "PG-2", name: "Demo Clinic Chiang Mai", active: true, agencyId: "AG-2", teamIds: ["U-R3", "U-R4"] },
    { id: "PG-3", name: "Demo Wellness Pattaya", active: true, agencyId: "AG-3", teamIds: ["U-R4", "U-R5", "U-R1"] },
  ];

  const campaigns: Campaign[] = [
    { id: "CP-01", name: "Always-On Messages", pageId: "PG-1", agencyId: "AG-1", objective: "Messages" },
    { id: "CP-02", name: "Free Consult Lead Magnet", pageId: "PG-1", agencyId: "AG-1", objective: "Messages" },
    { id: "CP-03", name: "Video Testimonials", pageId: "PG-1", agencyId: "AG-1", objective: "Engagement → Messages" },
    { id: "CP-04", name: "Weekend Offer", pageId: "PG-2", agencyId: "AG-2", objective: "Messages" },
    { id: "CP-05", name: "Retargeting Warm Audience", pageId: "PG-2", agencyId: "AG-2", objective: "Sales" },
    { id: "CP-06", name: "Lookalike 1%", pageId: "PG-2", agencyId: "AG-2", objective: "Messages" },
    { id: "CP-07", name: "Seasonal Promo", pageId: "PG-3", agencyId: "AG-3", objective: "Messages" },
    { id: "CP-08", name: "Brand Awareness Boost", pageId: "PG-3", agencyId: "AG-3", objective: "Reach" },
  ];

  const AD_NAMES = ["Hero image — offer", "UGC video 15s", "Carousel — services", "Before/After", "Doctor intro", "Customer story", "Price drop banner", "Reel — behind the scenes"];
  const ads: Ad[] = [];
  const adMeta: Record<string, { start: string; end: string; q: number; eff: number; spendBase: number }> = {};
  let adNo = 1001;
  campaigns.forEach((c, ci) => {
    for (let k = 0; k < 3; k++) {
      const id = `AD-${adNo++}`;
      const roll = r();
      let status: AdStatus = "Active";
      let start = addDays(ANCHOR, -Math.floor(40 + r() * 55));
      let end = ANCHOR;
      if (roll > 0.9) { status = "Learning"; start = addDays(ANCHOR, -Math.floor(4 + r() * 8)); }
      else if (roll > 0.75) { status = "Ended"; end = addDays(ANCHOR, -Math.floor(12 + r() * 30)); }
      else if (roll > 0.6) { status = "Paused"; end = addDays(ANCHOR, -Math.floor(2 + r() * 8)); }
      const type = pick(r, ["Image", "Video", "Carousel"] as const);
      ads.push({
        id,
        name: `${c.name.split(" ")[0]} · ${AD_NAMES[(ci * 3 + k) % AD_NAMES.length]}`,
        campaignId: c.id,
        status,
        creative: { type, hue: Math.floor(((ci * 3 + k) * 47) % 360) },
        updatedAt: end,
      });
      adMeta[id] = { start, end, q: 0.08 + r() * 0.42, eff: 0.7 + r() * 0.7, spendBase: 260 + r() * 520 };
    }
  });

  // ---- Daily performance (Meta-reported side) ----
  const perf: DailyPerf[] = [];
  for (const ad of ads) {
    const m = adMeta[ad.id];
    const cpm = 55 + r() * 70 * m.eff;
    const ctr = 0.009 + r() * 0.02;
    const msgRate = 0.1 + r() * 0.22;
    const freq = 1.1 + r() * 0.5;
    for (let d = m.start; d <= m.end; d = addDays(d, 1)) {
      const age = diffDays(ANCHOR, d);
      if (age > 100) continue;
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      const wk = dow === 0 || dow === 6 ? 1.15 : 1;
      const spend = Math.round(m.spendBase * (0.75 + r() * 0.5) * wk);
      const impressions = Math.round((spend / (cpm * (0.9 + r() * 0.2))) * 1000);
      const clicks = Math.round(impressions * ctr * (0.85 + r() * 0.3));
      const messages = Math.round(clicks * msgRate * (0.8 + r() * 0.4));
      const purchases = r() < 0.55 ? Math.round(messages * (0.02 + r() * 0.07)) : 0;
      perf.push({ adId: ad.id, date: d, spend, reach: Math.round(impressions / (freq * (0.95 + r() * 0.1))), impressions, clicks, messages, purchases, source: "demo" });
    }
  }

  // ---- Leads / conversations (CRM side) ----
  const leads: Lead[] = [];
  const messages: Record<string, Message[]> = {};
  let leadNo = 1;
  const campById = new Map(campaigns.map((c) => [c.id, c]));
  const pageById = new Map(pages.map((p) => [p.id, p]));

  for (const ad of ads) {
    const m = adMeta[ad.id];
    const camp = campById.get(ad.campaignId)!;
    const page = pageById.get(camp.pageId)!;
    const n = 7 + Math.floor(r() * 14);
    const span = Math.max(1, Math.min(100, diffDays(m.end, m.start)));
    for (let i = 0; i < n; i++) {
      const createdAt = addDays(m.end, -Math.floor(r() * Math.min(span, 99)));
      const q = m.q;
      const w = [0.14, Math.max(0.03, 0.3 - 0.4 * q), 0.24, 0.15 + 0.8 * q, 0.07 + 0.35 * q, 0.04 + 0.25 * q];
      const tot = w.reduce((a, b) => a + b, 0);
      let x = r() * tot, qi = 0;
      for (; qi < w.length - 1; qi++) { if (x < w[qi]) break; x -= w[qi]; }
      const quality: LeadQuality = QUALITIES[qi];
      const qualified = QUALIFIED_QUALITIES.includes(quality);

      let status: LeadStatus = quality;
      if (qualified && r() < 0.55) {
        const y = r() + (quality === "Connection Created" ? 0.25 : 0);
        status = y < 0.3 ? "New" : y < 0.58 ? "In-Process" : y < 0.78 ? "Intake" : "Converted";
      }
      const repId = r() < 0.05 ? null : pick(r, page.teamIds);
      const skill = repId ? repSkill[repId] ?? 0.6 : 0;
      const responded = quality !== "Not Responded";
      const firstResponseMin = responded && repId ? Math.max(1, Math.round((4 + r() * 150) * (1.6 - skill))) : null;
      const followUps = responded ? (r() < skill ? 1 + Math.floor(r() * 3) : 0) : 0;
      const hh = 9 + Math.floor(r() * 11), mm = Math.floor(r() * 60);
      const lastDay = status === "Converted" || qualified ? addDays(createdAt, Math.floor(r() * 8)) : addDays(createdAt, Math.floor(r() * 3));
      const lastContactAt = `${lastDay > ANCHOR ? ANCHOR : lastDay}T${p2(hh)}:${p2(mm)}:00`;
      const id = `L-${String(leadNo++).padStart(5, "0")}`;
      const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
      const valid = r() > 0.06;

      let dropped: Lead["dropped"] = null;
      if (valid && status !== "Converted" && r() < 0.17) {
        const reasons: DropReason[] = !responded
          ? ["No Response"]
          : qualified
            ? ["Rejected After Qualification", "No Follow-up", "Price Too High", "Postponed", "Chose Competitor"]
            : ["Not Interested", "Price Too High", "Chose Competitor", "No Response"];
        dropped = {
          reason: pick(r, reasons),
          at: lastDay > ANCHOR ? ANCHOR : lastDay,
          previousStatus: status,
          recovery: pick(r, ["Not Started", "Not Started", "In Progress", "Recovered", "Lost"] as const),
          lastActivity: pick(r, ["Customer stopped replying", "Last quote sent", "Appointment missed", "Asked to call back later", "Seen, no reply"]),
        };
        if (dropped.recovery === "Recovered") dropped = { ...dropped, recovery: "In Progress" };
      }

      // message thread
      const msgs: Message[] = [];
      const count = quality === "Not Responded" ? 1 : 3 + Math.floor(r() * 4);
      let t = 10 * 60 + Math.floor(r() * 600);
      for (let k = 0; k < count; k++) {
        const inbound = k === 0 || (responded && k % 2 === 0);
        const dayOffset = Math.min(k > 2 ? 1 : 0, diffDays(lastDay, createdAt));
        const date = addDays(createdAt, dayOffset);
        msgs.push({
          id: `${id}-M${k}`,
          leadId: id,
          direction: inbound ? "in" : "out",
          text: inbound ? (k === 0 ? IN_MSGS[Math.floor(r() * 4)] : pick(r, IN_MSGS)) : pick(r, OUT_MSGS),
          at: `${date}T${p2(Math.floor(t / 60) % 24)}:${p2(t % 60)}:00`,
          simulated: true,
        });
        t += 3 + Math.floor(r() * 40);
      }
      const last = msgs[msgs.length - 1];

      const history = [{ at: `${createdAt}T${p2(hh)}:${p2(mm)}:00`, from: null, to: "Not Responded" as LeadStatus, by: "System", note: "Lead created from Messenger conversation (demo)" }];
      if (status !== "Not Responded") history.push({ at: lastContactAt, from: "Not Responded", to: status, by: repId ? users.find((u) => u.id === repId)!.name : "System", note: "" } as never);

      leads.push({
        id, name, phone: `08${Math.floor(10000000 + r() * 89999999)}`, email: `${name.split(" ")[0].toLowerCase()}${leadNo}@mail.example`,
        pageId: page.id, adId: r() < 0.03 ? null : ad.id, repId, status, quality, valid, createdAt,
        lastContactAt, lastMessage: last.text, followUpDate: qualified && !dropped && status !== "Converted" && r() < 0.5 ? addDays(ANCHOR, Math.floor(r() * 9) - 2) : null,
        notes: r() < 0.3 ? [{ at: lastContactAt, by: repId ? users.find((u) => u.id === repId)!.name : "System", text: "Asked about weekend availability." }] : [],
        firstResponseMin, followUps, avgFollowUpHrs: followUps ? Math.round((3 + r() * 40 * (1.5 - skill)) * 10) / 10 : null,
        unread: !dropped && r() < 0.2, history, dropped, source: "demo",
      });
      messages[id] = msgs;
    }
  }

  const evaluations: Evaluation[] = [];
  const imports: ImportRecord[] = [];
  return { users, pages, agencies, campaigns, ads, perf, leads, messages, evaluations, imports, insights: [] };
}
