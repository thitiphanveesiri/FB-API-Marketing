// Domain model. Mirrors the SQL schema in /docs/schema.sql so a real
// database / Meta API adapter can replace the demo seed without UI changes.

export const ROLES = [
  "Administrator",
  "Marketing Manager",
  "Sales Manager",
  "Sales Representative",
  "Agency",
  "Viewer",
] as const;
export type Role = (typeof ROLES)[number];

/** Board columns, left to right. */
export const STATUSES = [
  "Not Responded",
  "Very Poor",
  "Average",
  "Qualified",
  "Appointment Booked",
  "Connection Created",
  "New",
  "In-Process",
  "Intake",
  "Converted",
] as const;
export type LeadStatus = (typeof STATUSES)[number];

/** Lead-quality grade (first six board stages). */
export const QUALITIES = [
  "Not Responded",
  "Very Poor",
  "Average",
  "Qualified",
  "Appointment Booked",
  "Connection Created",
] as const;
export type LeadQuality = (typeof QUALITIES)[number];

/** Stages that represent CRM sales progress rather than a quality grade. */
export const SALES_STAGES: LeadStatus[] = ["New", "In-Process", "Intake", "Converted"];
/** A lead counts as "qualified" when its quality grade is one of these. */
export const QUALIFIED_QUALITIES: LeadQuality[] = ["Qualified", "Appointment Booked", "Connection Created"];

export const DROP_REASONS = [
  "No Response",
  "Not Interested",
  "Price Too High",
  "Chose Competitor",
  "Rejected After Qualification",
  "No Follow-up",
  "Postponed",
] as const;
/** Thai names shown on the Board and in menus. The English values stay the stored/sheet values. */
export const STATUS_TH: Record<LeadStatus, string> = {
  "Not Responded": "ไม่ตอบ", "Very Poor": "แย่มาก", Average: "พอได้คุย", Qualified: "มีคุณสมบัติ", "Appointment Booked": "นัดได้แล้ว", "Connection Created": "สร้างคอนเนกชันมาใหม่",
  New: "ใหม่", "In-Process": "กำลังดำเนินการ", Intake: "รับเข้า", Converted: "ปิดการขายแล้ว",
};
export const statusTh = (s: string) => (STATUS_TH as Record<string, string>)[s] ?? s;
/** Board columns, left to right: chats grouped by how the conversation went. */
export const BOARD_COLUMNS: LeadQuality[] = ["Not Responded", "Very Poor", "Average", "Qualified", "Appointment Booked", "Connection Created"];
/** Accepts English or Thai status text (from a sheet or a file). */
export function parseStatus(v: string): LeadStatus | undefined {
  const t = v.trim().toLowerCase(); if (!t) return undefined;
  return STATUSES.find((x) => x.toLowerCase() === t || STATUS_TH[x] === v.trim());
}

/** A customer comment under a page post. repliedAt = when the page first replied (null = not yet). */
export interface PostComment { id: string; pageId: string; postId: string; commenter: string; text: string; at: string; repliedAt: string | null; repliedBy: string }

export interface PageInsight { pageId: string; date: string; reach: number; views: number; engagements: number; followers: number; newFollowers: number; linkClicks: number }

export type DropReason = (typeof DROP_REASONS)[number];
export type RecoveryStatus = "Not Started" | "In Progress" | "Recovered" | "Lost";

export type AdStatus = "Active" | "Paused" | "Learning" | "Ended";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  agencyId?: string;
  hue: number;
}
export interface FbPage {
  id: string;
  name: string;
  active: boolean;
  agencyId: string | null;
  teamIds: string[]; // sales rep user ids
}
export interface Agency {
  id: string;
  name: string;
  contact: string;
  email: string;
  active: boolean;
}
export interface Campaign {
  id: string;
  name: string;
  pageId: string;
  agencyId: string;
  objective: string;
}
export interface Ad {
  id: string;
  name: string;
  campaignId: string;
  status: AdStatus;
  creative: { type: "Image" | "Video" | "Carousel"; hue: number; url?: string; video?: string };
  updatedAt: string;
}
export interface DailyPerf {
  adId: string;
  date: string; // YYYY-MM-DD
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  messages: number; // Meta "messaging conversations started"
  purchases: number; // Meta-reported purchases (NOT CRM confirmed)
  source: "demo" | "import";
  importId?: string;
}
export type ChatChannel = "facebook" | "instagram" | "line" | "whatsapp";
export const CHANNELS: { id: ChatChannel; label: string; color: string }[] = [
  { id: "facebook", label: "Facebook", color: "#1877f2" }, { id: "instagram", label: "Instagram", color: "#e1306c" },
  { id: "line", label: "LINE", color: "#06c755" }, { id: "whatsapp", label: "WhatsApp", color: "#25d366" },
];
/** Sheet / export value → channel. Meta's lead export writes "fb" / "ig". Blank or unknown = facebook (the only channel connected so far). */
export function parseChannel(raw: string | null | undefined): ChatChannel {
  const t = String(raw ?? "").trim().toLowerCase();
  if (/^(ig|insta|instagram)\b|instagram/.test(t)) return "instagram";
  if (/^line\b|line oa|ไลน์/.test(t)) return "line";
  if (/^(wa|whatsapp)\b|whatsapp/.test(t)) return "whatsapp";
  return "facebook";
}
export const channelOf = (l: { channel?: ChatChannel }): ChatChannel => l.channel ?? "facebook";
export interface Message {
  id: string;
  leadId: string;
  direction: "in" | "out" | "note";
  text: string;
  at: string; // ISO local datetime
  attachment?: { name: string; kind: "image" | "file" };
  simulated: boolean;
  sentBy?: string; // user id of the person who sent this "out" message from the dashboard
}
export interface StatusChange {
  at: string;
  from: LeadStatus | null;
  to: LeadStatus;
  by: string;
  note?: string;
}
export interface LeadNote {
  at: string;
  by: string;
  text: string;
}
export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  pageId: string;
  adId: string | null;
  repId: string | null;
  status: LeadStatus;
  quality: LeadQuality;
  valid: boolean;
  createdAt: string; // YYYY-MM-DD
  lastContactAt: string;
  lastMessage: string;
  followUpDate: string | null;
  notes: LeadNote[];
  firstResponseMin: number | null;
  followUps: number;
  avgFollowUpHrs: number | null;
  unread: boolean;
  history: StatusChange[];
  dropped: null | {
    reason: DropReason;
    at: string;
    previousStatus: LeadStatus;
    recovery: RecoveryStatus;
    lastActivity: string;
  };
  source: "demo" | "import";
  channel?: ChatChannel; // blank in the sheet = facebook
  fbUserId?: string; // Facebook user id (PSID): what the Send API needs
}
export interface Evaluation {
  id: string;
  leadId: string;
  reviewerId: string;
  at: string;
  quality: LeadQuality;
  previousQuality: LeadQuality;
  scores: { responsiveness: number; needIdentified: number; intent: number; contactCaptured: number };
  notes: string;
  reason?: string;
}
export type ImportDataType =
  | "Ads Performance"
  | "Campaign Performance"
  | "Ad-Level Performance"
  | "Lead Data"
  | "Inbox Conversations"
  | "Page Insights"
  | "Chat Messages"
  | "Post Comments"
  | "Sales Performance";
export interface ImportRecord {
  id: string;
  at: string;
  pageId: string;
  dataType: ImportDataType;
  fileName: string;
  mode: "incremental" | "replace";
  total: number;
  imported: number;
  failed: number;
  duplicates: number;
  errors: { row: number; message: string }[];
  by: string;
  rows: Record<string, string>[]; // kept in-session so "Re-import" works
  mapping: Record<string, string>;
}
