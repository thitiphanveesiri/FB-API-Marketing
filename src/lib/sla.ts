// Pure: response-time checking ("ตรวจการตอบแชท"). No React, no I/O — everything is derived from messages + comments.
import type { FbPage, Lead, Message, PostComment, User } from "./types";

export const SLA_RULES = {
  chatMinutes: 15,        // reply to a customer chat within this
  chatPenalty: 1,         // points per late reply (per chat, per occurrence, per page)
  commentMinutes: 60,     // reply to a post comment within this
  commentPenalty: 0.5,    // points deducted from EVERY sales rep on the page's team
  basePoints: 100,        // starting score, for display only
  workStart: 10 * 60, workEnd: 19 * 60,      // 10:00–19:00 → penalties apply
  morningStart: 8 * 60, eveningEnd: 22 * 60, // 08:00–10:00 and 19:00–22:00 → commute: stats only
} as const;

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
  inAt: string; outAt: string | null; minutes: number; // minutes waited (to now if still unanswered)
  band: Band; late: boolean; open: boolean;
  deduct: number;      // points taken off the rep
  lateStat: boolean;   // late in a commute band → statistic only
  nightReply: boolean; // customer wrote in the night band and a reply happened → statistic only
}
export interface CommentEvent { comment: PostComment; minutes: number; open: boolean; late: boolean; deduct: number }

export interface RepSla {
  repId: string; name: string;
  chats: number; replied: number; onTime: number; late: number; open: number;
  chatDeduct: number; commentDeduct: number; deducted: number; score: number;
  lateTravel: number; nightReplies: number; avgMin: number | null;
}
export interface SlaResult { events: ChatEvent[]; commentEvents: CommentEvent[]; reps: RepSla[]; unassigned: ChatEvent[]; totals: { chatDeduct: number; commentDeduct: number; late: number; lateTravel: number; nightReplies: number; lateComments: number } }

export interface SlaInput { leads: Lead[]; messages: Record<string, Message[]>; comments: PostComment[]; pages: FbPage[]; users: User[]; start: string; end: string; now: string; pageId?: string; repId?: string }

/** Turn one conversation into reply-time events. A customer message starts the clock; follow-ups before a reply don't restart it. */
export function chatEvents(lead: Lead, msgs: Message[], now: string): ChatEvent[] {
  const out: ChatEvent[] = []; let waiting: string | null = null;
  const push = (inAt: string, outAt: string | null) => {
    const band = bandOf(inAt); const minutes = minutesBetween(inAt, outAt ?? now);
    const late = minutes > SLA_RULES.chatMinutes;
    out.push({ leadId: lead.id, leadName: lead.name, repId: lead.repId, pageId: lead.pageId, inAt, outAt, minutes: Math.max(0, minutes), band, late, open: outAt == null,
      deduct: late && band === "work" ? SLA_RULES.chatPenalty : 0, lateStat: late && band === "travel", nightReply: band === "night" && outAt != null });
  };
  for (const m of [...msgs].sort((a, b) => a.at.localeCompare(b.at))) {
    if (m.direction === "in") { if (!waiting) waiting = m.at; }
    else if (m.direction === "out" && waiting) { push(waiting, m.at); waiting = null; }
  }
  if (waiting) push(waiting, null);
  return out;
}

export function commentEvent(c: PostComment, now: string): CommentEvent {
  const minutes = Math.max(0, minutesBetween(c.at, c.repliedAt ?? now));
  const late = minutes > SLA_RULES.commentMinutes;
  return { comment: c, minutes, open: !c.repliedAt, late, deduct: late && bandOf(c.at) === "work" ? SLA_RULES.commentPenalty : 0 };
}

export function computeSla(i: SlaInput): SlaResult {
  const inRange = (iso: string) => iso.slice(0, 10) >= i.start && iso.slice(0, 10) <= i.end;
  const reps = i.users.filter((u) => u.role === "Sales Representative" && u.active && (!i.repId || i.repId === "all" || u.id === i.repId));
  const events = i.leads.filter((l) => l.valid && (!i.pageId || i.pageId === "all" || l.pageId === i.pageId))
    .flatMap((l) => chatEvents(l, i.messages[l.id] ?? [], i.now)).filter((e) => inRange(e.inAt));
  const commentEvents = i.comments.filter((c) => inRange(c.at) && (!i.pageId || i.pageId === "all" || c.pageId === i.pageId)).map((c) => commentEvent(c, i.now));
  const allReps = i.users.filter((u) => u.role === "Sales Representative" && u.active);
  const teamOf = (pageId: string) => { const t = i.pages.find((p) => p.id === pageId)?.teamIds ?? []; return t.length ? allReps.filter((r) => t.includes(r.id)) : allReps; };

  const rows: RepSla[] = reps.map((r) => {
    const mine = events.filter((e) => e.repId === r.id);
    const replied = mine.filter((e) => !e.open); const waits = replied.map((e) => e.minutes);
    const cd = commentEvents.filter((c) => c.deduct > 0 && teamOf(c.comment.pageId).some((t) => t.id === r.id)).reduce((s, c) => s + c.deduct, 0);
    const chatDeduct = mine.reduce((s, e) => s + e.deduct, 0);
    return { repId: r.id, name: r.name, chats: mine.length, replied: replied.length, onTime: mine.filter((e) => !e.late).length, late: mine.filter((e) => e.late).length, open: mine.filter((e) => e.open).length,
      chatDeduct, commentDeduct: cd, deducted: chatDeduct + cd, score: Math.max(0, SLA_RULES.basePoints - chatDeduct - cd),
      lateTravel: mine.filter((e) => e.lateStat).length, nightReplies: mine.filter((e) => e.nightReply).length, avgMin: waits.length ? Math.round(waits.reduce((s, x) => s + x, 0) / waits.length) : null };
  }).sort((a, b) => b.deducted - a.deducted || a.name.localeCompare(b.name));
  const assigned = events.filter((e) => e.repId && reps.some((r) => r.id === e.repId));
  return { events, commentEvents, reps: rows, unassigned: events.filter((e) => !e.repId),
    totals: { chatDeduct: rows.reduce((s, r) => s + r.chatDeduct, 0), commentDeduct: commentEvents.reduce((s, c) => s + c.deduct, 0), late: assigned.filter((e) => e.late).length,
      lateTravel: assigned.filter((e) => e.lateStat).length, nightReplies: assigned.filter((e) => e.nightReply).length, lateComments: commentEvents.filter((c) => c.late).length } };
}
