"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { emptyDataset, Dataset } from "./dataset";
import { defaultFilters, effectiveFilters, Filters, applyPreset, Preset } from "./queries";
import { localToday, nowStamp, setAnchor } from "./dates";
import type { SheetWarning } from "./sheetMapper";
import {
  Ad, Campaign, Agency, DailyPerf, Evaluation, FbPage, ImportRecord, Lead, LeadQuality, LeadStatus, Message,
  QUALIFIED_QUALITIES, QUALITIES, RecoveryStatus, PageInsight, SALES_STAGES, User, DropReason,
} from "./types";

export interface Toast { id: number; tone: "success" | "error" | "info"; text: string }
export interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  requireReason?: boolean;
}
export interface ConfirmState extends ConfirmOpts { resolve: (r: { ok: boolean; reason?: string }) => void }

export type Source = "loading" | "setup" | "sheets" | "error" | "forbidden";
export interface SourceMeta { fetchedAt?: string; warnings: SheetWarning[]; warningCount: number; missingTabs: string[]; counts?: Record<string, number>; message?: string }

interface Store {
  source: Source;
  sourceMeta: SourceMeta | null;
  reloadData: (fresh?: boolean) => Promise<void>;
  authed: boolean; // a real signed-in session exists
  signOut: () => Promise<void>;
  data: Dataset;
  user: User;
  filters: Filters; // raw
  eff: Filters; // role-scoped
  setFilters: (p: Partial<Filters>) => void;
  setPreset: (p: Preset) => void;
  resetFilters: () => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  confirmState: ConfirmState | null;
  confirm: (o: ConfirmOpts) => Promise<{ ok: boolean; reason?: string }>;
  clearConfirm: () => void;
  // leads
  moveLead: (id: string, to: LeadStatus, note?: string) => void;
  patchLead: (id: string, patch: Partial<Lead>) => void;
  setQuality: (id: string, q: LeadQuality, note?: string) => void;
  assignLead: (id: string, repId: string | null) => void;
  addNote: (id: string, text: string) => void;
  sendMessage: (id: string, text: string, mode: "reply" | "note", attachment?: Message["attachment"]) => void;
  markRead: (id: string) => void;
  dropLead: (id: string, reason: DropReason) => void;
  recoverLead: (id: string, to: LeadStatus) => void;
  setRecovery: (id: string, r: RecoveryStatus) => void;
  addEvaluation: (e: Omit<Evaluation, "id" | "at" | "reviewerId" | "previousQuality">) => void;
  // settings
  savePage: (p: FbPage) => void;
  saveAgency: (a: Agency) => void;
  saveUser: (u: User) => void;
  assignCampaigns: (agencyId: string, campaignIds: string[]) => void;
  // imports
  commitImport: (rec: ImportRecord, perf: DailyPerf[], leads: Lead[], replaceKeys: Set<string> | null, newAds?: Ad[], newCampaigns?: Campaign[], insights?: PageInsight[], patches?: { lead_id: string; set: Record<string, string | number> }[], extra?: { messages?: unknown[]; comments?: unknown[]; users?: { user_id: string; name: string }[] }) => Promise<boolean>;
  setCreative: (adId: string, image: string, video: string) => Promise<boolean>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

let toastSeq = 1;

const qualityAfterMove = (l: Lead, to: LeadStatus): LeadQuality => {
  if ((QUALITIES as readonly string[]).includes(to)) return to as LeadQuality;
  if (SALES_STAGES.includes(to) && !QUALIFIED_QUALITIES.includes(l.quality)) return "Qualified";
  return l.quality;
};
const leadPatchToSet = (p: Partial<Lead>): Record<string, string | number | boolean> => {
  const o: Record<string, string | number | boolean> = {};
  if ("repId" in p) o.assigned_to = p.repId ?? "";
  if ("followUpDate" in p) o.follow_up_date = p.followUpDate ?? "";
  if ("firstResponseMin" in p) o.first_response_min = p.firstResponseMin ?? "";
  if ("followUps" in p && p.followUps != null) o.follow_ups = p.followUps;
  if ("unread" in p && p.unread != null) o.unread = p.unread;
  if ("valid" in p && p.valid != null) o.valid = p.valid;
  if ("status" in p && p.status) o.status = p.status;
  if ("quality" in p && p.quality) o.quality = p.quality;
  return o;
};
const leadToRow = (l: Lead) => ({ lead_id: l.id, name: l.name, page_id: l.pageId, ad_id: l.adId ?? "", assigned_to: l.repId ?? "", status: l.status, quality: l.quality, valid: l.valid, created_at: l.createdAt,
  last_contact_at: l.lastContactAt.replace("T", " ").slice(0, 16), last_message: l.lastMessage, phone: l.phone, email: l.email, unread: l.unread });

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset>(() => emptyDataset());
  const [userId, setUserId] = useState("");
  const [filters, setF] = useState<Filters>(defaultFilters());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const seq = useRef(1);
  const [source, setSource] = useState<Source>("loading");
  const [authed, setAuthed] = useState(false);
  const [sourceMeta, setSourceMeta] = useState<SourceMeta | null>(null);

  const applyResponse = useCallback((first: boolean, j: { source: string; me?: { id?: string; email?: string; name?: string } | null; email?: string; dataset?: Dataset; fetchedAt?: string; warnings?: SheetWarning[]; warningCount?: number; missingTabs?: string[]; counts?: Record<string, number>; message?: string }) => {
    if (j.source === "sheets" && j.dataset) {
      setAnchor(localToday()); // real data uses the real date, not the demo's fixed one
      const ds = j.dataset;
      setData(ds); if (first) setF(defaultFilters());
      setUserId(j.me?.id ?? (ds.users.find((u) => u.role === "Administrator") ?? ds.users[0]).id);
      setAuthed(!!j.me);
      setSourceMeta({ fetchedAt: j.fetchedAt, warnings: j.warnings ?? [], warningCount: j.warningCount ?? 0, missingTabs: j.missingTabs ?? [], counts: j.counts });
      setSource("sheets");
    } else if (j.source === "unauthenticated") { // full page load on purpose: drops all in-memory data
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; }
    else if (j.source === "forbidden") { setSourceMeta({ warnings: [], warningCount: 0, missingTabs: [], message: j.email }); setSource("forbidden"); }
    else if (j.source === "error") { setSourceMeta({ warnings: [], warningCount: 0, missingTabs: [], message: j.message }); setSource("error"); }
    else if (j.source === "setup") { setAuthed(!!j.me); setSource("setup"); }
    else { setSourceMeta({ warnings: [], warningCount: 0, missingTabs: [], message: "Unexpected response from the server." }); setSource("error"); }
  }, []);
  const signOut = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so no data stays in memory
    finally { window.location.href = "/login"; }
  }, []);
  const reloadData = useCallback(async (fresh = false) => {
    try { applyResponse(false, await (await fetch(`/api/data${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })).json()); }
    catch { setSourceMeta({ warnings: [], warningCount: 0, missingTabs: [], message: "Could not reach the server." }); setSource("error"); }
  }, [applyResponse]);
  useEffect(() => {
    let alive = true;
    fetch("/api/data", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive) applyResponse(true, j); }).catch(() => { if (alive) { setSourceMeta({ warnings: [], warningCount: 0, missingTabs: [], message: "Could not reach the server." }); setSource("error"); } });
    return () => { alive = false; };
  }, [applyResponse]);

  const user: User = useMemo(() => data.users.find((u) => u.id === userId) ?? data.users[0] ?? { id: "", name: "—", email: "", role: "Viewer", active: true, hue: 160 }, [data.users, userId]);
  const eff = useMemo(() => effectiveFilters(filters, user), [filters, user]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<{ ok: boolean; reason?: string }>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  );
  const clearConfirm = useCallback(() => setConfirmState(null), []);

  const updLead = useCallback((id: string, fn: (l: Lead) => Lead) => {
    setData((d) => ({ ...d, leads: d.leads.map((l) => (l.id === id ? fn(l) : l)) }));
  }, []);
  const byName = user.name;

  const persist = useCallback(async (op: object, quiet = false): Promise<boolean> => {
    try {
      const r = await fetch("/api/mutate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (r.ok && j.ok) return true;
      if (r.status === 401) { // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- session expired: full reload to sign-in
        window.location.href = "/login"; return false; }
      toast(`Not saved: ${j.message ?? "unknown error"}. Reloading from the sheet.`, "error");
    } catch { if (!quiet) toast("Not saved: could not reach the server. Reloading from the sheet.", "error"); }
    await reloadData(true);
    return false;
  }, [toast, reloadData]);

  const store: Store = {
    source, sourceMeta, reloadData, authed, signOut,
    data, user,
    filters, eff,
    setFilters: (p) => setF((f) => ({ ...f, ...p, preset: p.start || p.end ? "custom" : (p.preset ?? f.preset) })),
    setPreset: (p) => setF((f) => applyPreset(f, p)),
    resetFilters: () => setF(defaultFilters()),
    toasts, toast, dismissToast, confirmState, confirm, clearConfirm,

    moveLead: (id, to, note) => {
      const l = data.leads.find((x) => x.id === id); if (!l) return;
      const quality = qualityAfterMove(l, to);
      updLead(id, (x) => ({ ...x, status: to, quality, history: [...x.history, { at: nowStamp(), from: x.status, to, by: byName, note }] }));
      void persist({ t: "lead.set", id, set: { status: to, quality }, log: { from: l.status, to, text: note ?? "" } });
    },
    patchLead: (id, patch) => {
      updLead(id, (l) => ({ ...l, ...patch }));
      const set = leadPatchToSet(patch);
      if (Object.keys(set).length) void persist({ t: "lead.set", id, set });
    },
    setQuality: (id, q, note) => {
      const l = data.leads.find((x) => x.id === id); if (!l) return;
      const status = (QUALITIES as readonly string[]).includes(l.status) ? q : l.status;
      updLead(id, (x) => ({ ...x, quality: q, status, history: [...x.history, { at: nowStamp(), from: x.status, to: status, by: byName, note: note ?? `Quality set to ${q}` }] }));
      void persist({ t: "lead.set", id, set: { quality: q, status }, log: { from: l.status, to: status, text: note ?? `Quality set to ${q}` } });
    },
    assignLead: (id, repId) => {
      const l = data.leads.find((x) => x.id === id); if (!l) return;
      const name = data.users.find((u) => u.id === repId)?.name ?? "Unassigned";
      updLead(id, (x) => ({ ...x, repId, history: [...x.history, { at: nowStamp(), from: x.status, to: x.status, by: byName, note: `Assigned to ${name}` }] }));
      void persist({ t: "lead.set", id, set: { assigned_to: repId ?? "" }, log: { from: l.status, to: l.status, text: `Assigned to ${name}` } });
    },
    addNote: (id, text) => {
      updLead(id, (l) => ({ ...l, notes: [...l.notes, { at: nowStamp(), by: byName, text }] }));
      void persist({ t: "lead.note", id, text });
    },
    sendMessage: (id, text, mode, attachment) => {
      const at = nowStamp();
      const msg: Message = { id: `${id}-S${seq.current++}`, leadId: id, direction: mode === "note" ? "note" : "out", text, at, attachment, simulated: mode !== "note" };
      setData((d) => ({ ...d, messages: { ...d.messages, [id]: [...(d.messages[id] ?? []), msg] } }));
      if (mode === "note") {
        updLead(id, (l) => ({ ...l, notes: [...l.notes, { at, by: byName, text }] }));
        void persist({ t: "lead.note", id, text });
      } else {
        // Replies are NOT sent to Messenger (no Messenger API connected) — shown on screen only, so nothing is saved.
        updLead(id, (l) => ({ ...l, lastMessage: text || attachment?.name || "", lastContactAt: at, unread: false, firstResponseMin: l.firstResponseMin ?? 0 }));
      }
    },
    markRead: (id) => {
      const l = data.leads.find((x) => x.id === id); if (!l?.unread) return;
      updLead(id, (x) => ({ ...x, unread: false }));
      void persist({ t: "lead.set", id, set: { unread: false } }, true);
    },
    dropLead: (id, reason) => {
      const l = data.leads.find((x) => x.id === id); if (!l) return;
      const at = nowStamp().slice(0, 10);
      updLead(id, (x) => ({ ...x, dropped: { reason, at, previousStatus: x.status, recovery: "Not Started", lastActivity: "Marked as dropped by user" }, history: [...x.history, { at: nowStamp(), from: x.status, to: x.status, by: byName, note: `Dropped: ${reason}` }] }));
      void persist({ t: "lead.set", id, set: { drop_reason: reason, dropped_at: at, previous_status: l.status, recovery_status: "Not Started", last_activity: "Marked as dropped by user" }, log: { from: l.status, to: l.status, text: `Dropped: ${reason}` } });
    },
    recoverLead: (id, to) => {
      const l = data.leads.find((x) => x.id === id); if (!l) return;
      const quality = (QUALITIES as readonly string[]).includes(to) ? (to as LeadQuality) : l.quality;
      updLead(id, (x) => ({ ...x, status: to, quality, dropped: null, unread: false, history: [...x.history, { at: nowStamp(), from: x.status, to, by: byName, note: "Recovered from Dropped" }] }));
      void persist({ t: "lead.set", id, set: { status: to, quality, drop_reason: "", dropped_at: "", previous_status: "", recovery_status: "", last_activity: "", unread: false }, log: { from: l.status, to, text: "Recovered from Dropped" } });
    },
    setRecovery: (id, r) => {
      updLead(id, (l) => (l.dropped ? { ...l, dropped: { ...l.dropped, recovery: r } } : l));
      void persist({ t: "lead.set", id, set: { recovery_status: r } });
    },
    addEvaluation: (e) => {
      const lead = data.leads.find((l) => l.id === e.leadId);
      if (!lead) return;
      const ev: Evaluation = { ...e, id: `EV-${Date.now().toString(36)}`, at: nowStamp(), reviewerId: user.id, previousQuality: lead.quality };
      const status = (QUALITIES as readonly string[]).includes(lead.status) ? e.quality : lead.status;
      setData((d) => ({ ...d, evaluations: [ev, ...d.evaluations] }));
      updLead(lead.id, (l) => ({ ...l, quality: e.quality, status, history: [...l.history, { at: ev.at, from: l.status, to: status, by: byName, note: `Quality review: ${lead.quality} → ${e.quality}${e.reason ? ` (${e.reason})` : ""}` }] }));
      void (async () => {
        const ok = await persist({ t: "eval.add", row: { eval_id: ev.id, lead_id: lead.id, quality: e.quality, previous_quality: lead.quality, responsiveness: e.scores.responsiveness, need_identified: e.scores.needIdentified, intent: e.scores.intent, contact_captured: e.scores.contactCaptured, notes: e.notes, reason: e.reason ?? "" } });
        if (ok) await persist({ t: "lead.set", id: lead.id, set: { quality: e.quality, status }, log: { from: lead.status, to: status, text: `Quality review: ${lead.quality} → ${e.quality}${e.reason ? ` (${e.reason})` : ""}` } }, true);
      })();
    },

    savePage: (p) => {
      setData((d) => ({ ...d, pages: d.pages.some((x) => x.id === p.id) ? d.pages.map((x) => (x.id === p.id ? p : x)) : [...d.pages, p] }));
      void persist({ t: "settings.upsert", tab: "pages", row: { page_id: p.id, name: p.name, agency_id: p.agencyId ?? "", active: p.active, sales_team: p.teamIds.join(",") } });
    },
    saveAgency: (a) => {
      setData((d) => ({ ...d, agencies: d.agencies.some((x) => x.id === a.id) ? d.agencies.map((x) => (x.id === a.id ? a : x)) : [...d.agencies, a] }));
      void persist({ t: "settings.upsert", tab: "agencies", row: { agency_id: a.id, name: a.name, contact: a.contact, email: a.email, active: a.active } });
    },
    saveUser: (u) => {
      setData((d) => ({ ...d, users: d.users.some((x) => x.id === u.id) ? d.users.map((x) => (x.id === u.id ? u : x)) : [...d.users, u] }));
      void persist({ t: "settings.upsert", tab: "users", row: { user_id: u.id, name: u.name, email: u.email, role: u.role, agency_id: u.agencyId ?? "", active: u.active } });
    },
    assignCampaigns: (agencyId, ids) => {
      setData((d) => ({ ...d, campaigns: d.campaigns.map((c) => (ids.includes(c.id) ? { ...c, agencyId } : c)) }));
      void (async () => { for (const id of ids) { if (!(await persist({ t: "settings.upsert", tab: "campaigns", row: { campaign_id: id, agency_id: agencyId } }, true))) break; } })();
    },

    setCreative: async (adId, image, video) => {
      const img = image.trim(), vid = video.trim();
      setData((d) => ({ ...d, ads: d.ads.map((a) => (a.id === adId ? { ...a, creative: { ...a.creative, url: img || undefined, video: vid || undefined, type: vid ? "Video" : a.creative.type } } : a)) }));
      return persist({ t: "ad.creative", id: adId, image: img, video: vid });
    },

    commitImport: async (rec, perf, leads, replaceKeys, newAds = [], newCampaigns = [], insights = [], patches = [], extra = {}) => {
      const ok = await persist({
        t: "import.commit", replace: !!replaceKeys,
        record: { import_id: rec.id, page_id: rec.pageId, data_type: rec.dataType, file_name: rec.fileName, mode: rec.mode, total: rec.total, imported: rec.imported, failed: rec.failed, duplicates: rec.duplicates },
        campaigns: newCampaigns.map((c) => ({ campaign_id: c.id, name: c.name, page_id: c.pageId, agency_id: c.agencyId, objective: c.objective })),
        ads: newAds.map((a) => ({ ad_id: a.id, name: a.name, campaign_id: a.campaignId, status: a.status, creative_type: a.creative.type, updated_at: a.updatedAt })),
        perf: perf.map((p) => ({ date: p.date, ad_id: p.adId, spend: p.spend, reach: p.reach, impressions: p.impressions, clicks: p.clicks, messages: p.messages, purchases: p.purchases })),
        leads: leads.map(leadToRow),
        insights: insights.map((i) => ({ page_id: i.pageId, date: i.date, reach: i.reach, views: i.views, engagements: i.engagements, followers: i.followers, new_followers: i.newFollowers, link_clicks: i.linkClicks })),
        messages: extra.messages ?? [], comments: extra.comments ?? [], users: extra.users ?? [],
        patches,
      });
      if (ok) await reloadData(true); // show exactly what the sheet now holds
      return ok;
    },
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
