"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from "react";
import { buildDemoDataset, Dataset } from "./seed";
import { defaultFilters, effectiveFilters, Filters, applyPreset, Preset } from "./queries";
import { nowStamp } from "./dates";
import {
  Ad, Campaign, Agency, DailyPerf, Evaluation, FbPage, ImportRecord, Lead, LeadQuality, LeadStatus, Message,
  QUALIFIED_QUALITIES, QUALITIES, RecoveryStatus, SALES_STAGES, User, DropReason,
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

interface Store {
  data: Dataset;
  user: User;
  setUserId: (id: string) => void;
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
  commitImport: (rec: ImportRecord, perf: DailyPerf[], leads: Lead[], replaceKeys: Set<string> | null, newAds?: Ad[], newCampaigns?: Campaign[]) => void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

let toastSeq = 1;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset>(() => buildDemoDataset());
  const [userId, setUserId] = useState("U-ADMIN");
  const [filters, setF] = useState<Filters>(defaultFilters());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const seq = useRef(1);

  const user = data.users.find((u) => u.id === userId) ?? data.users[0];
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

  const store: Store = {
    data, user, setUserId,
    filters, eff,
    setFilters: (p) => setF((f) => ({ ...f, ...p, preset: p.start || p.end ? "custom" : (p.preset ?? f.preset) })),
    setPreset: (p) => setF((f) => applyPreset(f, p)),
    resetFilters: () => setF(defaultFilters()),
    toasts, toast, dismissToast, confirmState, confirm, clearConfirm,

    moveLead: (id, to, note) =>
      updLead(id, (l) => {
        let quality = l.quality;
        if ((QUALITIES as readonly string[]).includes(to)) quality = to as LeadQuality;
        else if (SALES_STAGES.includes(to) && !QUALIFIED_QUALITIES.includes(quality)) quality = "Qualified";
        return {
          ...l, status: to, quality,
          history: [...l.history, { at: nowStamp(), from: l.status, to, by: byName, note }],
        };
      }),
    patchLead: (id, patch) => updLead(id, (l) => ({ ...l, ...patch })),
    setQuality: (id, q, note) =>
      updLead(id, (l) => ({
        ...l, quality: q,
        status: (QUALITIES as readonly string[]).includes(l.status) ? q : l.status,
        history: [...l.history, { at: nowStamp(), from: l.status, to: (QUALITIES as readonly string[]).includes(l.status) ? q : l.status, by: byName, note: note ?? `Quality set to ${q}` }],
      })),
    assignLead: (id, repId) => {
      const name = data.users.find((u) => u.id === repId)?.name ?? "Unassigned";
      updLead(id, (l) => ({ ...l, repId, history: [...l.history, { at: nowStamp(), from: l.status, to: l.status, by: byName, note: `Assigned to ${name}` }] }));
    },
    addNote: (id, text) => updLead(id, (l) => ({ ...l, notes: [...l.notes, { at: nowStamp(), by: byName, text }] })),
    sendMessage: (id, text, mode, attachment) => {
      const at = nowStamp();
      const msg: Message = { id: `${id}-S${seq.current++}`, leadId: id, direction: mode === "note" ? "note" : "out", text, at, attachment, simulated: true };
      setData((d) => ({ ...d, messages: { ...d.messages, [id]: [...(d.messages[id] ?? []), msg] } }));
      if (mode === "note") {
        updLead(id, (l) => ({ ...l, notes: [...l.notes, { at, by: byName, text }] }));
      } else {
        updLead(id, (l) => ({ ...l, lastMessage: text || attachment?.name || "", lastContactAt: at, unread: false, firstResponseMin: l.firstResponseMin ?? 0 }));
      }
    },
    markRead: (id) => updLead(id, (l) => (l.unread ? { ...l, unread: false } : l)),
    dropLead: (id, reason) =>
      updLead(id, (l) => ({
        ...l,
        dropped: { reason, at: nowStamp().slice(0, 10), previousStatus: l.status, recovery: "Not Started", lastActivity: "Marked as dropped by user" },
        history: [...l.history, { at: nowStamp(), from: l.status, to: l.status, by: byName, note: `Dropped: ${reason}` }],
      })),
    recoverLead: (id, to) =>
      updLead(id, (l) => {
        let quality = l.quality;
        if ((QUALITIES as readonly string[]).includes(to)) quality = to as LeadQuality;
        return {
          ...l, status: to, quality, dropped: null, unread: false,
          history: [...l.history, { at: nowStamp(), from: l.status, to, by: byName, note: "Recovered from Dropped" }],
        };
      }),
    setRecovery: (id, r) => updLead(id, (l) => (l.dropped ? { ...l, dropped: { ...l.dropped, recovery: r } } : l)),
    addEvaluation: (e) => {
      const lead = data.leads.find((l) => l.id === e.leadId);
      if (!lead) return;
      const ev: Evaluation = { ...e, id: `EV-${data.evaluations.length + 1}`, at: nowStamp(), reviewerId: user.id, previousQuality: lead.quality };
      setData((d) => ({ ...d, evaluations: [ev, ...d.evaluations] }));
      updLead(lead.id, (l) => ({
        ...l, quality: e.quality,
        status: (QUALITIES as readonly string[]).includes(l.status) ? e.quality : l.status,
        history: [...l.history, { at: ev.at, from: l.status, to: (QUALITIES as readonly string[]).includes(l.status) ? e.quality : l.status, by: byName, note: `Quality review: ${lead.quality} → ${e.quality}${e.reason ? ` (${e.reason})` : ""}` }],
      }));
    },

    savePage: (p) => setData((d) => ({ ...d, pages: d.pages.some((x) => x.id === p.id) ? d.pages.map((x) => (x.id === p.id ? p : x)) : [...d.pages, p] })),
    saveAgency: (a) => setData((d) => ({ ...d, agencies: d.agencies.some((x) => x.id === a.id) ? d.agencies.map((x) => (x.id === a.id ? a : x)) : [...d.agencies, a] })),
    saveUser: (u) => setData((d) => ({ ...d, users: d.users.some((x) => x.id === u.id) ? d.users.map((x) => (x.id === u.id ? u : x)) : [...d.users, u] })),
    assignCampaigns: (agencyId, ids) =>
      setData((d) => ({ ...d, campaigns: d.campaigns.map((c) => (ids.includes(c.id) ? { ...c, agencyId } : c.agencyId === agencyId ? { ...c } : c)) })),

    commitImport: (rec, perf, leads, replaceKeys, newAds = [], newCampaigns = []) =>
      setData((d) => {
        let base = d.perf;
        // "replace" only removes rows for the exact ad+date keys present in the file; other periods stay intact.
        if (replaceKeys) base = base.filter((p) => !replaceKeys.has(`${p.adId}|${p.date}`));
        const newMsgs = { ...d.messages };
        for (const l of leads) newMsgs[l.id] = [];
        return { ...d, perf: [...base, ...perf], leads: [...d.leads, ...leads], messages: newMsgs, ads: [...d.ads, ...newAds], campaigns: [...d.campaigns, ...newCampaigns], imports: [rec, ...d.imports] };
      }),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
