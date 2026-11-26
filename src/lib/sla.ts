// Pure: response-time checking ("ตรวจการตอบแชท"). No React, no I/O — everything is derived from messages + comments.
import { countsAsReply } from "./autoReply";
import type { FbPage, Lead, Message, PostComment, User } from "./types";

export const SLA_RULES = {
  chatMinutes: 15,        // reply to a customer chat within this
  chatPenalty: 1,         // points per late reply (per chat, per occurrence, per page)
  commentMinutes: 60,     // reply to a post comment within this
  commentPenalty: 0.5,    // points deducted from EVERY sales rep on the page's team
  basePoints: 100,        // starting score, for display only
  workStart: 10 * 60, workEnd: 19 * 60,      // 10:00–19:00 → penalties apply
  morningStart: 8 * 60, eveningEnd: 22 * 60, // 08:00–10:00 and 19:00–22:00 → commute: stats only
  holidayWeekdays: [2],  // 0 = Sunday … 2 = Tuesday: the company's day off — nothing is deducted for customers who write that day
  staleHours: 3,         // a customer message still unanswered after this long is flagged as a stale chat
} as const;

/** True when the (local) date of this stamp is a day off: shown in the statistics but never deducted. */
export function isHoliday(iso: string): boolean {
  const day = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
  return (SLA_RULES.holidayWeekdays as readonly number[]).includes(day);
}

export const STICKER_TEXT = "[สติ๊กเกอร์]";
const CLOSING = /^(?:(?:ขอบคุณ|ขอบใจ|โอเคร?|โอเค|ตกลง|รับทราบ|เข้าใจแล้ว|ได้เลย|ได้|เรียบร้อย|เดี๋ยวติดต่อกลับ|แล้วจะติดต่อกลับ|แล้วจะทักไป|ไว้ติดต่อ(?:กลับ)?|บาย|ok|okay|thanks?|thank ?you|thx|bye|ค่ะ|คะ|ครับ|จ้า|จ้ะ|นะ|เลย|มาก|ๆ)+)$/i;
/** A customer message that only ends the conversation (thanks / ok / sticker / emoji): it must not start the reply clock or count as a stale chat. */
export function isClosingMessage(text: string): boolean {
  const t = text.trim();
  if (!t || t === STICKER_TEXT) return t === STICKER_TEXT;
  const plain = t.replace(/[\s.!?,~…\-_()]+/g, "");
  if (!plain) return true;
  if (!/[\p{L}\p{N}]/u.test(plain)) return true; // only emoji / symbols (👍 ❤️ …)
  return plain.length <= 40 && CLOSING.test(plain);
}

export type Band = "work" | "travel" | "night";
export const BAND_TH: Record<Band, string> = { work: "ช่วงหักคะแนน (10:00–19:00)", travel: "ช่วงเดินทาง (08:00–10:00, 19:00–22:00)", night: "ช่วงดึก (22:00–08:00)" };

const minutesOfDay = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
/** Which time band a clock time falls in. Decided by the time the CUSTOMER wrote. */
export function bandOf(iso: string): Band {
  const m = minutesOfDay(iso);
  if (m >= SLA_RULES.workStart && m < SLA_RULES.workEnd) return "work";
  if ((m >= SLA_RULES.morningStart && m < SLA_RULES.workStart) || (m >= SLA_RULES.workEnd && m < SLA_RULES.eveningEnd)) return "travel";
  return "night";
}
/** Minutes between two local "YYYY-MM-DDTHH:MM" stamps (timezone-free, so no DST surprises). */
export function minutesBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
  return Math.round((t(b) - t(a)) / 60000);
}

export interface ChatEvent {
  leadId: string; leadName: string; repId: string | null; pageId: string;
  repliedBy: string | null; // salesperson who sent the first reply from the dashboard (null = replied elsewhere / not yet)
  inAt: string; outAt: string | null; minutes: number; // minutes waited (to now if still unanswered)
  band: Band; late: boolean; open: boolean;
  holiday: boolean;    // customer wrote on a day off → statistic only
  deduct: number;      // points taken off the rep
  lateStat: boolean;   // late in a commute band → statistic only
  nightReply: boolean; // customer wrote in the night band and a reply happened → statistic only
}
export interface CommentEvent { comment: PostComment; minutes: number; open: boolean; late: boolean; deduct: number; holiday: boolean }

export interface RepSla {
  repId: string; name: string;
  chats: number; replied: number; onTime: number; late: number; open: number;
  lateDeduct: number; lateNoDeduct: number; // "late" splits into the part that costs points and the statistics-only part (travel, night, day off)
  chatDeduct: number; commentDeduct: number; deducted: number; score: number;
  lateTravel: number; nightReplies: number; avgMin: number | null;
}
export interface SlaResult { events: ChatEvent[]; commentEvents: CommentEvent[]; reps: RepSla[]; unassigned: ChatEvent[]; totals: { chatDeduct: number; commentDeduct: number; late: number; lateDeduct: number; lateNoDeduct: number; lateTravel: number; nightReplies: number; lateComments: number } }

export interface SlaInput { leads: Lead[]; messages: Record<string, Message[]>; comments: PostComment[]; pages: FbPage[]; users: User[]; start: string; end: string; now: string; pageId?: string; repId?: string }

/** Turn one conversation into reply-time events. A customer message starts the clock; follow-ups before a reply don't restart it. */
/** `isRep` decides whether a replier counts as a salesperson: a manager answering for a rep does not take the rep's chat away from them. */
export function chatEvents(lead: Lead, msgs: Message[], now: string, isRep: (id: string) => boolean = () => true): ChatEvent[] {
  const out: ChatEvent[] = []; let waiting: string | null = null;
  const push = (inAt: string, outAt: string | null, by: string | null = null) => {
    const band = bandOf(inAt); const minutes = minutesBetween(inAt, outAt ?? now);
    const late = minutes > SLA_RULES.chatMinutes;
    const replier = by && isRep(by) ? by : null;
    out.push({ leadId: lead.id, leadName: lead.name, repId: replier ?? lead.repId, repliedBy: replier, pageId: lead.pageId, inAt, outAt, minutes: Math.max(0, minutes), band, late, open: outAt == null, holiday: isHoliday(inAt),
      deduct: late && band === "work" && !isHoliday(inAt) ? SLA_RULES.chatPenalty : 0, lateStat: late && band === "travel", nightReply: band === "night" && outAt != null });
  };
  for (const m of [...msgs].sort((a, b) => a.at.localeCompare(b.at))) {
    if (m.direction === "in") { if (!waiting && !isClosingMessage(m.text)) waiting = m.at; }
    else if (countsAsReply(m) && waiting) { push(waiting, m.at, m.sentBy ?? null); waiting = null; } // automatic replies do not stop the clock
  }
  if (waiting) push(waiting, null);
  return out;
}

export function commentEvent(c: PostComment, now: string): CommentEvent {
  const minutes = Math.max(0, minutesBetween(c.at, c.repliedAt ?? now));
  const late = minutes > SLA_RULES.commentMinutes;
  return { comment: c, minutes, open: !c.repliedAt, late, deduct: late && bandOf(c.at) === "work" && !isHoliday(c.at) ? SLA_RULES.commentPenalty : 0, holiday: isHoliday(c.at) };
}

export function computeSla(i: SlaInput): SlaResult {
  const inRange = (iso: string) => iso.slice(0, 10) >= i.start && iso.slice(0, 10) <= i.end;
  const reps = i.users.filter((u) => u.role === "Sales Representative" && u.active && (!i.repId || i.repId === "all" || u.id === i.repId));
  const allReps = i.users.filter((u) => u.role === "Sales Representative" && u.active);
  const events = i.leads.filter((l) => l.valid && (!i.pageId || i.pageId === "all" || l.pageId === i.pageId))
    .flatMap((l) => chatEvents(l, i.messages[l.id] ?? [], i.now, (id) => allReps.some((r) => r.id === id))).filter((e) => inRange(e.inAt));
  const commentEvents = i.comments.filter((c) => inRange(c.at) && (!i.pageId || i.pageId === "all" || c.pageId === i.pageId)).map((c) => commentEvent(c, i.now));
  const teamOf = (pageId: string) => { const t = i.pages.find((p) => p.id === pageId)?.teamIds ?? []; return allReps.filter((r) => t.includes(r.id)); };

  const rows: RepSla[] = reps.map((r) => {
    const mine = events.filter((e) => e.repId === r.id);
    const replied = mine.filter((e) => !e.open); const waits = replied.map((e) => e.minutes);
    const cd = commentEvents.filter((c) => c.deduct > 0 && teamOf(c.comment.pageId).some((t) => t.id === r.id)).reduce((s, c) => s + c.deduct, 0);
    const chatDeduct = mine.reduce((s, e) => s + e.deduct, 0);
    return { repId: r.id, name: r.name, chats: mine.length, replied: replied.length, onTime: replied.filter((e) => !e.late).length, late: mine.filter((e) => e.late).length, open: mine.filter((e) => e.open).length,
      lateDeduct: mine.filter((e) => e.deduct > 0).length, lateNoDeduct: mine.filter((e) => e.late && e.deduct === 0).length,
      chatDeduct, commentDeduct: cd, deducted: chatDeduct + cd, score: Math.max(0, SLA_RULES.basePoints - chatDeduct - cd),
      lateTravel: mine.filter((e) => e.lateStat).length, nightReplies: mine.filter((e) => e.nightReply).length, avgMin: waits.length ? Math.round(waits.reduce((s, x) => s + x, 0) / waits.length) : null };
  }).sort((a, b) => b.deducted - a.deducted || a.name.localeCompare(b.name));
  const assigned = events.filter((e) => e.repId && reps.some((r) => r.id === e.repId));
  return { events, commentEvents, reps: rows, unassigned: events.filter((e) => !e.repId),
    totals: { chatDeduct: rows.reduce((s, r) => s + r.chatDeduct, 0), commentDeduct: commentEvents.reduce((s, c) => s + c.deduct, 0), late: assigned.filter((e) => e.late).length,
      lateDeduct: assigned.filter((e) => e.deduct > 0).length, lateNoDeduct: assigned.filter((e) => e.late && e.deduct === 0).length,
      lateTravel: assigned.filter((e) => e.lateStat).length, nightReplies: assigned.filter((e) => e.nightReply).length, lateComments: commentEvents.filter((c) => c.late).length } };
}
