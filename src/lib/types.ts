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
  creative: { type: "Image" | "Video" | "Carousel"; hue: number };
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
export interface Message {
  id: string;
  leadId: string;
  direction: "in" | "out" | "note";
  text: string;
  at: string; // ISO local datetime
  attachment?: { name: string; kind: "image" | "file" };
  simulated: boolean;
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
