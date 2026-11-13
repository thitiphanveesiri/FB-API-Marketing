"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send, StickyNote, Phone, Mail, CalendarClock, ArrowLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { useLeadActions } from "@/lib/useLeadActions";
import { roleCan } from "@/lib/queries";
import { Avatar, Badge, Btn, EmptyState, Facebook, Select, SearchBox, StatusBadge, TextArea, TextInput, cn, hueOf } from "@/components/ui";
import { fmtDate, fmtDateTime, NOW_ISO, relTime } from "@/lib/dates";
import ChannelFilter, { ChannelDot, countByChannel } from "@/components/ChannelFilter";
import { CHANNELS, ChatChannel, channelOf, Lead, LeadQuality, LeadStatus, QUALITIES, STATUSES } from "@/lib/types";
import { ANCHOR } from "@/lib/dates";

type F = "all" | "unread" | "mine" | "unassigned" | "follow";
const FILTERS: { id: F; label: string }[] = [
  { id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "mine", label: "Assigned to Me" }, { id: "unassigned", label: "Unassigned" }, { id: "follow", label: "Follow-up Required" },
];

export default function InboxPage() {
  const { data, user, markRead, sendMessage, sendReply, patchLead, addNote, toast, filters, reloadData, source } = useStore();
  const act = useLeadActions();
  const [f, setF] = useState<F>("all");
  // "Live": Meta's webhook writes new messages into the sheet within seconds; this re-reads the sheet while the tab is open and visible.
  // 30 s keeps well inside Google Sheets' read quota (every viewer shares one service account).
  const [live, setLive] = useState(true);
  useEffect(() => {
    if (!live || source !== "sheets") return;
    const id = setInterval(() => { if (document.visibilityState === "visible") void reloadData(true); }, 30_000);
    return () => clearInterval(id);
  }, [live, source, reloadData]);
  const [q, setQ] = useState("");
  const [ch, setCh] = useState<ChatChannel | "all">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [attach, setAttach] = useState<{ name: string; kind: "image" | "file" } | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const canEdit = roleCan.editLeads(user.role);

  const mine = (l: Lead) => (user.role === "Sales Representative" ? l.repId === user.id : true);
  const visible = useMemo(
    () => data.leads.filter((l) => !l.dropped && l.valid && mine(l) && (filters.pageId === "all" || l.pageId === filters.pageId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.leads, user.id, filters.pageId]);
  const perChannel = useMemo(() => countByChannel(visible), [visible]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visible
      .filter((l) => ch === "all" || channelOf(l) === ch)
      .filter((l) => (f === "unread" ? l.unread : f === "mine" ? l.repId === user.id : f === "unassigned" ? !l.repId : f === "follow" ? !!l.followUpDate && l.followUpDate <= ANCHOR : true))
      .filter((l) => !needle || `${l.name} ${l.lastMessage} ${l.id}`.toLowerCase().includes(needle))
      .sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt))
      .slice(0, 120);
  }, [visible, ch, f, q, user.id]);

  const lead = data.leads.find((l) => l.id === sel) ?? null;
  const msgs = lead ? data.messages[lead.id] ?? [] : [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length, sel]);

  const open = (l: Lead) => { setSel(l.id); markRead(l.id); setMobileView("chat"); setText(""); setAttach(null); };
  const reps = data.users.filter((u) => u.role === "Sales Representative" && u.active);
  const repName = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "Unassigned";
  const pageName = (id: string) => data.pages.find((p) => p.id === id)?.name ?? id;
  const ad = lead?.adId ? data.ads.find((a) => a.id === lead.adId) : null;

  const [sending, setSending] = useState(false);
  const real = source === "sheets" && !!lead && channelOf(lead) === "facebook"; // connected to the sheet: replies go to Messenger for real
  const send = async () => {
    if (!lead || (!text.trim() && !attach) || sending) return;
    if (mode === "reply" && real) {
      if (!text.trim()) return;
      setSending(true); const r = await sendReply(lead.id, text.trim()); setSending(false);
      if (!r.ok) { toast(r.message, "error"); return; }
      setText(""); toast("ส่งข้อความถึงลูกค้าแล้ว", "success"); return;
    }
    sendMessage(lead.id, text.trim(), mode, attach ?? undefined);
    setText(""); setAttach(null);
    toast(mode === "note" ? "Internal note saved" : "Message added to simulated conversation", mode === "note" ? "success" : "info");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <Badge tone="green">From Google Sheet</Badge>
        <button onClick={() => setLive((v) => !v)} aria-pressed={live} title="Re-read the sheet every 30 seconds while this tab is open" className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", live ? "border-brand-2 bg-brand-faint text-brand" : "border-line text-muted")}><span className={cn("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-brand" : "bg-gray-300")} />{live ? "Live · refreshes every 30 s" : "Live off"}</button>
        <span className="text-xs text-muted">New messages arrive through the Facebook webhook. Replies sent here go to the customer on Messenger (within 24 h of their last message) and are recorded under your name for SLA. Replies sent from Business Suite are recorded without a sender. Internal notes are saved.</span>
      </div>
      <div className="grid h-[calc(100vh-170px)] min-h-[560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:grid-cols-[320px_1fr_300px]">
        {/* LEFT */}
        <div className={cn("flex min-h-0 flex-col border-r border-line", mobileView === "chat" && "hidden lg:flex")}>
          <div className="space-y-2 border-b border-line p-3">
            <SearchBox value={q} onChange={setQ} placeholder="Search conversations…" />
            <ChannelFilter value={ch} onChange={setCh} counts={perChannel} />
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((x) => <button key={x.id} aria-pressed={f === x.id} onClick={() => setF(x.id)} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", f === x.id ? "bg-brand text-white" : "bg-gray-100 text-muted hover:bg-gray-200")}>{x.label}</button>)}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 && <EmptyState title="No conversations" hint={ch !== "all" && ch !== "facebook" && perChannel[ch] === 0 ? `ยังไม่มีแชท ${CHANNELS.find((c) => c.id === ch)?.label} — ช่องทางนี้ยังไม่ได้เชื่อมต่อ (ตอนนี้เชื่อมได้เฉพาะ Facebook)` : "Nothing matches this filter."} />}
            {list.map((l) => (
              <li key={l.id}>
                <button onClick={() => open(l)} className={cn("flex w-full gap-2.5 border-b border-line/60 px-3 py-2.5 text-left hover:bg-gray-50", sel === l.id && "bg-brand-faint")}>
                  <Avatar name={l.name} hue={hueOf(l.name)} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className={cn("truncate text-sm", l.unread ? "font-semibold" : "font-medium")}>{l.name}</span><span className="shrink-0 text-[11px] text-muted">{relTime(l.lastContactAt, NOW_ISO)}</span></span>
                    <span className={cn("block truncate text-xs", l.unread ? "text-ink" : "text-muted")}>{l.lastMessage}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1"><StatusBadge status={l.status} />
                      <span className="inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-muted"><ChannelDot id={channelOf(l)} size={7} />{repName(l.repId)} · {pageName(l.pageId).replace("Demo ", "")}</span></span>
                  </span>
                  {l.unread && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-2" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* CENTER */}
        <div className={cn("flex min-h-0 flex-col", mobileView === "list" && "hidden lg:flex")}>
          {!lead ? <div className="flex flex-1 items-center justify-center"><EmptyState title="Select a conversation" hint="Pick a customer on the left to view the chat." /></div> : (
            <>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <button className="rounded p-1 hover:bg-gray-100 lg:hidden" onClick={() => setMobileView("list")} aria-label="Back to list"><ArrowLeft size={18} /></button>
                <Avatar name={lead.name} hue={hueOf(lead.name)} size={34} />
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{lead.name}</p><p className="flex items-center gap-1 text-xs text-muted"><Facebook size={11} className="text-[#1877f2]" />{pageName(lead.pageId)}</p></div>
                <Select value={lead.status} disabled={!canEdit} onChange={(v) => act.move(lead, v as LeadStatus)} options={STATUSES.map((s) => ({ value: s, label: s }))} className="w-44" />
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4">
                <p className="mx-auto w-fit rounded-full bg-amber-50 px-3 py-1 text-[11px] text-amber-700">Conversation loaded from your sheet — not live Messenger</p>
                {msgs.map((m) => (
                  <div key={m.id} className={m.direction === "out" ? "flex justify-end" : m.direction === "note" ? "flex justify-center" : "flex"}>
                    <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 text-sm", m.direction === "out" ? "bg-brand text-white" : m.direction === "note" ? "w-full max-w-[90%] border border-dashed border-amber-300 bg-amber-50 text-amber-900" : "border border-line bg-surface")}>
                      {m.direction === "note" && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase"><StickyNote size={11} /> Internal note · only your team sees this</p>}
                      {m.text}
                      {m.attachment && <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-black/10 px-2 py-1 text-xs">{m.attachment.kind === "image" ? "🖼" : "📎"} {m.attachment.name}</div>}
                      <p className={cn("mt-0.5 text-[10px]", m.direction === "out" ? "text-white/70" : "text-gray-400")}>{fmtDateTime(m.at)}{m.simulated && " · not sent"}{m.direction === "out" && m.sentBy && ` · ${data.users.find((u) => u.id === m.sentBy)?.name ?? "—"}`}</p>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {canEdit ? (
                <div className={cn("border-t border-line p-3", mode === "note" && "bg-amber-50")}>
                  <div className="mb-2 flex gap-1 text-xs">
                    <button onClick={() => setMode("reply")} className={cn("rounded-md px-2.5 py-1 font-medium", mode === "reply" ? "bg-brand text-white" : "bg-gray-100 text-muted")}>{real ? "ตอบลูกค้า (ส่งจริง)" : "Reply (simulated)"}</button>
                    <button onClick={() => setMode("note")} className={cn("rounded-md px-2.5 py-1 font-medium", mode === "note" ? "bg-amber-500 text-white" : "bg-gray-100 text-muted")}>Internal note</button>
                  </div>
                  {attach && <p className="mb-1 flex items-center gap-1 text-xs text-muted">📎 {attach.name} <button className="text-red-500" onClick={() => setAttach(null)}>remove</button></p>}
                  <div className="flex items-end gap-2">
                    <input ref={fileRef} type="file" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) setAttach({ name: fl.name, kind: fl.type.startsWith("image/") ? "image" : "file" }); e.target.value = ""; }} />
                    <Btn variant="ghost" aria-label="Attach file" onClick={() => fileRef.current?.click()} disabled={mode === "note" || real} title={real ? "ส่งไฟล์แนบจากระบบยังไม่รองรับ" : undefined}><Paperclip size={18} /></Btn>
                    <TextArea className="flex-1" rows={2} placeholder={mode === "note" ? "Write an internal note…" : "Type a message…"} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    <Btn variant="primary" onClick={send} disabled={(!text.trim() && !attach) || sending}><Send size={16} /> {mode === "note" ? "Save" : sending ? "กำลังส่ง…" : "Send"}</Btn>
                  </div>
                </div>
              ) : <p className="border-t border-line p-3 text-center text-sm text-muted">Your role has read-only access.</p>}
            </>
          )}
        </div>

        {/* RIGHT */}
        <aside className="hidden min-h-0 overflow-y-auto border-l border-line p-4 lg:block">
          {!lead ? <p className="text-sm text-muted">Customer details appear here.</p> : (
            <div className="space-y-4 text-sm">
              <div className="text-center"><Avatar name={lead.name} hue={hueOf(lead.name)} size={56} /><p className="mt-2 font-semibold">{lead.name}</p><p className="text-xs text-muted">{lead.id}</p></div>
              <div className="space-y-1.5">
                <p className="flex items-center gap-2"><Phone size={14} className="text-muted" />{lead.phone}</p>
                <p className="flex items-center gap-2 break-all"><Mail size={14} className="text-muted" />{lead.email}</p>
                <p className="flex items-center gap-2"><Facebook size={14} className="text-[#1877f2]" />{pageName(lead.pageId)}</p>
              </div>
              <dl className="space-y-2 rounded-xl bg-gray-50 p-3">
                <div><dt className="text-xs text-muted">Source Ad ID</dt><dd>{ad ? <>{ad.id}<span className="block text-xs text-muted">{ad.name}</span></> : "Unattributed"}</dd></div>
                <div><dt className="text-xs text-muted">Current status</dt><dd><StatusBadge status={lead.status} /></dd></div>
              </dl>
              <Select label="Assigned salesperson" value={lead.repId ?? ""} disabled={!canEdit} onChange={(v) => act.assign(lead, v || null)} options={[{ value: "", label: "Unassigned" }, ...reps.map((r) => ({ value: r.id, label: r.name }))]} />
              <Select label="Lead quality" value={lead.quality} disabled={!canEdit} onChange={(v) => act.quality(lead, v as LeadQuality)} options={QUALITIES.map((s) => ({ value: s, label: s }))} />
              <TextInput label="Follow-up date" type="date" disabled={!canEdit} value={lead.followUpDate ?? ""} onChange={(e) => { patchLead(lead.id, { followUpDate: e.target.value || null }); toast(e.target.value ? `Follow-up set for ${fmtDate(e.target.value)}` : "Follow-up cleared"); }} />
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted"><CalendarClock size={13} /> Internal notes</p>
                <ul className="mb-2 space-y-1">{lead.notes.length === 0 && <li className="text-xs text-muted">No notes.</li>}{lead.notes.map((n, i) => <li key={i} className="rounded-lg bg-amber-50 px-2 py-1 text-xs"><span className="text-amber-700">{n.by} · {fmtDate(n.at)}</span><br />{n.text}</li>)}</ul>
                {canEdit && <div className="flex gap-1"><TextInput className="flex-1" aria-label="Add note" placeholder="Add note…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { addNote(lead.id, note.trim()); setNote(""); toast("Note added"); } }} />
                  <Btn size="sm" disabled={!note.trim()} onClick={() => { addNote(lead.id, note.trim()); setNote(""); toast("Note added"); }}>Add</Btn></div>}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
