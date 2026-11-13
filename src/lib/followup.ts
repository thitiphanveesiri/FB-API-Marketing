// Pure: response-speed stats, silent-customer queue, "came back" count, lead temperature and interest tags. No React, no I/O.
import { SLA_RULES, chatEvents, minutesBetween, type Band, type ChatEvent } from "./sla";
import type { FbPage, Lead, Message } from "./types";

export type Temp = "hot" | "warm" | "cold";
export const TEMP_TH: Record<Temp, string> = { hot: "ร้อน (ควรโทรก่อน)", warm: "อุ่น", cold: "เย็น" };

/** Words that show buying intent. Edit freely — plain substrings, case-insensitive. */
export const INTENT_WORDS = ["นัด", "จอง", "วันไหน", "ว่างไหม", "โอน", "มัดจำ", "ขอเบอร์", "โทรกลับ", "ไลน์", "line", "ราคา", "เท่าไหร่", "โปร", "สนใจ", "book", "price", "appointment"];
/** Interest tags: tag name → words. Customize to your own services. */
export const SERVICE_TAGS: Record<string, string[]> = {
  "ปลูกผม": ["ปลูกผม", "hair transplant", "fue", "dhi", "almi"],
  "ผมร่วง/ผมบาง": ["ผมร่วง", "ผมบาง", "ศีรษะล้าน", "หัวล้าน", "hair loss"],
  "ราคา/โปรโมชัน": ["ราคา", "เท่าไหร่", "โปร", "ส่วนลด", "price", "promotion"],
  "นัดหมาย": ["นัด", "จอง", "วันไหน", "appointment", "book"],
};

export const SILENT_OPTIONS = [{ hours: 3, label: "เงียบเกิน 3 ชั่วโมง" }, { hours: 24, label: "เงียบเกิน 1 วัน" }, { hours: 72, label: "เงียบเกิน 3 วัน" }] as const;
const CLOSED: Lead["status"][] = ["Converted", "Appointment Booked"];

export interface SilentLead { lead: Lead; silentHours: number; lastOutAt: string; temp: Temp; tags: string[]; lastText: string }
export interface Recovered { lead: Lead; backAt: string; gapHours: number }
export interface FollowupResult {
  chats: number; replied: number; open: number; medianMin: number | null; within15: number; // first reply of each conversation start
  byBand: Record<Band, { started: number; replied: number; within15: number }>;
  hourly: number[];                // customer conversations started per hour of day (24)
  stale: ChatEvent[];              // customer waiting with no reply for staleHours or more (found automatically — nobody has to scan chats)
  silent: SilentLead[]; recovered: Recovered[]; temps: Record<Temp, number>;
}
export interface FollowupInput { leads: Lead[]; messages: Record<string, Message[]>; pages: FbPage[]; start: string; end: string; now: string; pageId?: string; silentHours: number; repId?: string }

const has = (text: string, words: string[]) => { const t = text.toLowerCase(); return words.some((w) => t.includes(w)); };
export const tagsOf = (msgs: Message[]): string[] => {
  const mine = msgs.filter((m) => m.direction === "in").map((m) => m.text).join(" \n ");
  return Object.entries(SERVICE_TAGS).filter(([, w]) => has(mine, w)).map(([k]) => k);
};

/** Hot = ready to act (booked/qualified, left a phone/email, or just asked about booking/price). Cold = quiet 7+ days or never answered. */
export function temperature(lead: Lead, msgs: Message[], now: string): Temp {
  const ins = msgs.filter((m) => m.direction === "in"), lastIn = ins[ins.length - 1];
  const idleDays = lastIn ? minutesBetween(lastIn.at, now) / 1440 : 99;
  if (lead.status === "Appointment Booked" || lead.status === "Converted") return "hot";
  if (idleDays >= 7) return "cold";
  if (lead.status === "Qualified" || lead.phone || lead.email) return "hot";
  if (lastIn && idleDays <= 3 && has(lastIn.text, INTENT_WORDS)) return "hot";
  if (lead.status === "Not Responded" || lead.status === "Very Poor") return idleDays >= 3 ? "cold" : "warm";
  return "warm";
}

export function computeFollowup(i: FollowupInput): FollowupResult {
  const inRange = (iso: string) => iso.slice(0, 10) >= i.start && iso.slice(0, 10) <= i.end;
  const leads = i.leads.filter((l) => l.valid && (!i.pageId || i.pageId === "all" || l.pageId === i.pageId) && (!i.repId || l.repId === i.repId));
  const byBand: FollowupResult["byBand"] = { work: { started: 0, replied: 0, within15: 0 }, travel: { started: 0, replied: 0, within15: 0 }, night: { started: 0, replied: 0, within15: 0 } };
  const hourly = Array<number>(24).fill(0), waits: number[] = [];
  const stale: ChatEvent[] = [], silent: SilentLead[] = [], recovered: Recovered[] = [], temps: Record<Temp, number> = { hot: 0, warm: 0, cold: 0 };
  let chats = 0, replied = 0, open = 0, within15 = 0;

  for (const l of leads) {
    const msgs = [...(i.messages[l.id] ?? [])].filter((m) => m.direction !== "note").sort((a, b) => a.at.localeCompare(b.at));
    if (!msgs.length) continue;
    for (const e of chatEvents(l, msgs, i.now)) {
      if (!inRange(e.inAt)) continue;
      chats++; hourly[+e.inAt.slice(11, 13)]++; byBand[e.band].started++;
      if (e.open && e.minutes >= SLA_RULES.staleHours * 60) stale.push(e);
      if (e.open) open++; else { replied++; waits.push(e.minutes); byBand[e.band].replied++; if (e.minutes <= SLA_RULES.chatMinutes) { within15++; byBand[e.band].within15++; } }
    }
    // silent: the page spoke last and the customer has not answered for N hours (leads already booked/converted are done)
    const last = msgs[msgs.length - 1];
    const tags = tagsOf(msgs);
    if (last.direction === "out" && !CLOSED.includes(l.status) && !l.dropped) {
      const h = minutesBetween(last.at, i.now) / 60;
      if (h >= i.silentHours) { const t = temperature(l, msgs, i.now); silent.push({ lead: l, silentHours: Math.floor(h), lastOutAt: last.at, temp: t, tags, lastText: last.text }); }
    }
    // came back: the page's last message, a long gap, then the customer wrote again inside the date range
    for (let k = 1; k < msgs.length; k++) {
      if (msgs[k].direction === "in" && msgs[k - 1].direction === "out" && inRange(msgs[k].at)) {
        const g = minutesBetween(msgs[k - 1].at, msgs[k].at) / 60;
        if (g >= i.silentHours) recovered.push({ lead: l, backAt: msgs[k].at, gapHours: Math.floor(g) });
      }
    }
    temps[temperature(l, msgs, i.now)]++;
  }
  const sorted = [...waits].sort((a, b) => a - b);
  const medianMin = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)) : null;
  const rank: Record<Temp, number> = { hot: 0, warm: 1, cold: 2 };
  silent.sort((a, b) => rank[a.temp] - rank[b.temp] || a.silentHours - b.silentHours);
  recovered.sort((a, b) => b.backAt.localeCompare(a.backAt));
  stale.sort((a, b) => b.minutes - a.minutes);
  return { chats, replied, open, medianMin, within15, byBand, hourly, stale, silent, recovered, temps };
}
