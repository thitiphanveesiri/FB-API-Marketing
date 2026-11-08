"use client";
import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CalendarClock, GripVertical } from "lucide-react";
import { useStore } from "@/lib/store";
import { useLeadActions } from "@/lib/useLeadActions";
import { roleCan } from "@/lib/queries";
import { Avatar, Badge, Select, SearchBox, STATUS_COLOR, cn, hueOf, Facebook, DemoBadge } from "@/components/ui";
import LeadDrawer from "@/components/LeadDrawer";
import { Lead, LeadStatus, STATUSES } from "@/lib/types";
import { ANCHOR, fmtShort, NOW_ISO, relTime } from "@/lib/dates";

const COLUMN_HELP: Partial<Record<LeadStatus, string>> = {
  "Not Responded": "Customer messaged, no reply yet", "Very Poor": "Not a fit / no intent", Average: "Some interest", Qualified: "Fits criteria, real intent",
  "Appointment Booked": "Visit scheduled", "Connection Created": "Contact details confirmed", New: "Enter sales pipeline", "In-Process": "Being worked", Intake: "Paperwork / onboarding", Converted: "Customer won",
};

function Card({ lead, dragging }: { lead: Lead; dragging?: boolean }) {
  const { data } = useStore();
  const ad = lead.adId ?? "No Ad";
  const rep = data.users.find((u) => u.id === lead.repId);
  const page = data.pages.find((p) => p.id === lead.pageId)?.name.replace("Demo ", "") ?? "";
  const overdue = lead.followUpDate && lead.followUpDate < ANCHOR;
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-3 text-left shadow-card", dragging && "rotate-1 shadow-pop ring-2 ring-brand-2")}>
      <div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-semibold">{lead.name}</p><span className="shrink-0 text-[10px] text-muted">{lead.id}</span></div>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{lead.lastMessage}</p>
      <div className="mt-2 flex flex-wrap gap-1"><Badge tone="blue">{ad}</Badge><Badge tone="gray"><Facebook size={10} /> {page}</Badge>{lead.unread && <Badge tone="green">Unread</Badge>}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1">{rep ? <Avatar name={rep.name} hue={rep.hue} size={18} /> : <span className="h-[18px] w-[18px] rounded-full border border-dashed border-gray-300" />}{rep?.name.split(" ")[0] ?? "Unassigned"}</span>
        <span>{relTime(lead.lastContactAt, NOW_ISO)}</span>
      </div>
      {lead.followUpDate && <p className={cn("mt-1.5 flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-red-500" : "text-muted")}><CalendarClock size={11} /> Follow-up {fmtShort(lead.followUpDate)}{overdue && " (overdue)"}</p>}
    </div>
  );
}

function DraggableCard({ lead, onOpen, enabled }: { lead: Lead; onOpen: () => void; enabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled: !enabled });
  return (
    <div ref={setNodeRef} className={cn("group relative", isDragging && "opacity-30")}>
      <button onClick={onOpen} className="block w-full text-left" aria-label={`Open ${lead.name}`}><Card lead={lead} /></button>
      {enabled && <button {...listeners} {...attributes} aria-label={`Drag ${lead.name}`} className="absolute right-1 top-6 cursor-grab touch-none rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500 active:cursor-grabbing"><GripVertical size={14} /></button>}
    </div>
  );
}

function Column({ status, leads, onOpen, enabled }: { status: LeadStatus; leads: Lead[]; onOpen: (id: string) => void; enabled: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const overdue = leads.filter((l) => l.followUpDate && l.followUpDate < ANCHOR).length;
  const unassigned = leads.filter((l) => !l.repId).length;
  return (
    <section ref={setNodeRef} className={cn("flex w-[272px] shrink-0 flex-col rounded-2xl border bg-gray-50/70 transition-colors", isOver ? "border-brand-2 bg-brand-faint" : "border-line")} aria-label={status}>
      <header className="border-b border-line px-3 py-2.5">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />{status}</h3><span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabnum ring-1 ring-line">{leads.length}</span></div>
        <p className="mt-0.5 text-[11px] text-muted">{COLUMN_HELP[status]}</p>
        <p className="mt-1 text-[11px] text-muted">{overdue > 0 && <span className="mr-2 text-red-500">{overdue} overdue</span>}{unassigned > 0 && <span>{unassigned} unassigned</span>}{overdue === 0 && unassigned === 0 && "All on track"}</p>
      </header>
      <div className="max-h-[calc(100vh-320px)] min-h-[120px] space-y-2 overflow-y-auto p-2">
        {leads.length === 0 && <p className="py-6 text-center text-xs text-gray-400">Drop leads here</p>}
        {leads.slice(0, 40).map((l) => <DraggableCard key={l.id} lead={l} enabled={enabled} onOpen={() => onOpen(l.id)} />)}
        {leads.length > 40 && <p className="py-1 text-center text-xs text-muted">+{leads.length - 40} more — use search or filters to narrow down</p>}
      </div>
    </section>
  );
}

export default function Board() {
  const { data, user, filters } = useStore();
  const act = useLeadActions();
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("all");
  const [active, setActive] = useState<Lead | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
  const canEdit = roleCan.editLeads(user.role);

  const leads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.leads.filter((l) => l.valid && !l.dropped
      && (user.role !== "Sales Representative" || l.repId === user.id)
      && (filters.pageId === "all" || l.pageId === filters.pageId)
      && (rep === "all" || (rep === "none" ? !l.repId : l.repId === rep))
      && (!needle || `${l.name} ${l.id} ${l.adId ?? ""}`.toLowerCase().includes(needle)));
  }, [data.leads, q, rep, user, filters.pageId]);

  const grouped = useMemo(() => {
    const m = Object.fromEntries(STATUSES.map((s) => [s, [] as Lead[]])) as Record<LeadStatus, Lead[]>;
    for (const l of leads) m[l.status].push(l);
    for (const s of STATUSES) m[s].sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt));
    return m;
  }, [leads]);

  const onStart = (e: DragStartEvent) => setActive(data.leads.find((l) => l.id === e.active.id) ?? null);
  const onEnd = async (e: DragEndEvent) => {
    setActive(null);
    const lead = data.leads.find((l) => l.id === e.active.id);
    const to = e.over?.id as LeadStatus | undefined;
    if (lead && to && to !== lead.status) await act.move(lead, to);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Board</h1><DemoBadge />
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <SearchBox className="w-56" value={q} onChange={setQ} placeholder="Search name, Lead ID, Ad ID…" />
          {user.role !== "Sales Representative" && <Select value={rep} onChange={setRep} options={[{ value: "all", label: "All salespeople" }, { value: "none", label: "Unassigned" }, ...data.users.filter((u) => u.role === "Sales Representative").map((u) => ({ value: u.id, label: u.name }))]} />}
        </div>
      </div>
      <p className="text-xs text-muted">Drag a card by its grip handle (or open it and use the Stage menu). Risky moves ask for confirmation; Converted needs a Sales Manager or Administrator. {!canEdit && "Your role is read-only."}</p>
      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STATUSES.map((s) => <Column key={s} status={s} leads={grouped[s]} onOpen={setOpenId} enabled={canEdit} />)}
        </div>
        <DragOverlay>{active ? <div className="w-[256px]"><Card lead={active} dragging /></div> : null}</DragOverlay>
      </DndContext>
      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} />
      <span className="hidden">{hueOf("")}</span>
    </div>
  );
}
