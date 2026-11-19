"use client";
import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CalendarClock, ExternalLink, GripVertical } from "lucide-react";
import { useStore } from "@/lib/store";
import { useLeadActions } from "@/lib/useLeadActions";
import { roleCan } from "@/lib/queries";
import { Avatar, Badge, Select, SearchBox, STATUS_COLOR, cn, Facebook } from "@/components/ui";
import LeadDrawer from "@/components/LeadDrawer";
import ChannelFilter, { ChannelDot, countByChannel } from "@/components/ChannelFilter";
import { BOARD_COLUMNS, ChatChannel, channelOf, Lead, LeadQuality, LeadStatus, statusTh } from "@/lib/types";
import { ANCHOR, fmtShort, NOW_ISO, relTime } from "@/lib/dates";

const COLUMN_HELP: Record<LeadQuality, string> = {
  "Not Responded": "ลูกค้าทักมาแล้ว แต่ยังไม่ได้รับการตอบกลับ", "Very Poor": "ไม่ตรงกลุ่ม หรือไม่มีความสนใจ", Average: "ได้คุยกันบ้าง สนใจเล็กน้อย",
  Qualified: "ตรงกลุ่ม มีความตั้งใจจริง", "Appointment Booked": "นัดวันเข้าใช้บริการได้แล้ว", "Connection Created": "ได้ข้อมูลติดต่อ สร้างคอนเนกชันใหม่แล้ว",
};
/** Which column a chat sits in: its stage if that is a chat type, otherwise (sales-stage leads) its quality grade. */
// Column background: red = lost / no answer, green = the chat is going well. "Connection Created" keeps the neutral grey.
const COLUMN_TONE: Record<LeadQuality, string> = {
  "Not Responded": "border-red-200 bg-red-50", "Very Poor": "border-red-200 bg-red-50",
  "Average": "border-emerald-200 bg-emerald-50", "Qualified": "border-emerald-200 bg-emerald-50", "Appointment Booked": "border-emerald-200 bg-emerald-50",
  "Connection Created": "border-line bg-gray-50/70",
};
const columnOf = (l: Lead): LeadQuality => ((BOARD_COLUMNS as readonly string[]).includes(l.status) ? (l.status as LeadQuality) : l.quality);

function Card({ lead, dragging, onOpen, fbHref }: { lead: Lead; dragging?: boolean; onOpen?: () => void; fbHref?: string }) {
  const { data } = useStore();
  const ad = lead.adId ?? "ไม่มีโฆษณา";
  const rep = data.users.find((u) => u.id === lead.repId);
  const page = data.pages.find((p) => p.id === lead.pageId)?.name ?? "";
  const overdue = lead.followUpDate && lead.followUpDate < ANCHOR;
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-3 text-left shadow-card", dragging && "rotate-1 shadow-pop ring-2 ring-brand-2")}>
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`เปิด ${lead.name}`}>
        <div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-semibold">{lead.name}</p><span className="shrink-0 text-[10px] text-muted">{lead.id}</span></div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{lead.lastMessage}</p>
        <div className="mt-2 flex flex-wrap gap-1"><Badge tone="blue">{ad}</Badge><Badge tone="gray">{channelOf(lead) === "facebook" ? <Facebook size={10} /> : <ChannelDot id={channelOf(lead)} size={8} />} {page}</Badge>{lead.unread && <Badge tone="green">ยังไม่ได้อ่าน</Badge>}{columnOf(lead) !== lead.status && <Badge tone="violet">{statusTh(lead.status)}</Badge>}</div>
        {(lead.phone || lead.email || lead.whatsapp) && <p className="mt-1 truncate text-[11px] text-muted">{lead.phone}{lead.whatsapp ? ` · WhatsApp ${lead.whatsapp}` : ""}{lead.email ? ` · ${lead.email}` : ""}</p>}
      </button>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1">{rep ? <Avatar name={rep.name} hue={rep.hue} size={18} /> : <span className="h-[18px] w-[18px] rounded-full border border-dashed border-gray-300" />}{rep?.name.split(" ")[0] ?? "ยังไม่มีผู้ดูแล"}</span>
        <span className="flex items-center gap-1">{relTime(lead.lastContactAt, NOW_ISO)}{fbHref && <a href={fbHref} target="_blank" rel="noopener noreferrer" title="เปิด Inbox ของเพจนี้ใน Facebook" aria-label="เปิด Inbox ของเพจนี้ใน Facebook" className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-[#1877F2]"><ExternalLink size={12} /></a>}</span>
      </div>
      {lead.followUpDate && <p className={cn("mt-1.5 flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-red-500" : "text-muted")}><CalendarClock size={11} /> นัดติดตาม {fmtShort(lead.followUpDate)}{overdue && " (เลยกำหนด)"}</p>}
    </div>
  );
}

function DraggableCard({ lead, onOpen, enabled }: { lead: Lead; onOpen: () => void; enabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled: !enabled });
  const { sourceMeta } = useStore();
  const fbPage = channelOf(lead) === "facebook" ? sourceMeta?.fbPages?.[lead.pageId] : undefined;
  const fbHref = fbPage ? `https://business.facebook.com/latest/inbox/all/?asset_id=${encodeURIComponent(fbPage)}` : undefined;
  return (
    <div ref={setNodeRef} className={cn("group relative", isDragging && "opacity-30")}>
      <Card lead={lead} onOpen={onOpen} fbHref={fbHref} />
      {enabled && <button {...listeners} {...attributes} aria-label={`ลาก ${lead.name}`} className="absolute right-1 top-6 cursor-grab touch-none rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500 active:cursor-grabbing"><GripVertical size={14} /></button>}
    </div>
  );
}

const COLUMN_PAGE = 30;

function Column({ status, leads, onOpen, enabled }: { status: LeadQuality; leads: Lead[]; onOpen: (id: string) => void; enabled: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const [shown, setShown] = useState(COLUMN_PAGE); // like the Facebook inbox: older chats appear as you scroll
  const overdue = leads.filter((l) => l.followUpDate && l.followUpDate < ANCHOR).length;
  const unassigned = leads.filter((l) => !l.repId).length;
  const more = leads.length > shown;
  return (
    <section ref={setNodeRef} className={cn("flex w-[272px] shrink-0 flex-col rounded-2xl border transition-colors", isOver ? "border-brand-2 bg-brand-faint" : COLUMN_TONE[status])} aria-label={statusTh(status)}>
      <header className="border-b border-line px-3 py-2.5">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />{statusTh(status)}</h3><span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabnum ring-1 ring-line">{leads.length}</span></div>
        <p className="mt-0.5 text-[11px] text-muted">{COLUMN_HELP[status]}</p>
        <p className="mt-1 text-[11px] text-muted">{overdue > 0 && <span className="mr-2 text-red-500">{overdue} เลยกำหนด</span>}{unassigned > 0 && <span>{unassigned} ยังไม่มีผู้ดูแล</span>}{overdue === 0 && unassigned === 0 && "เรียบร้อยดี"}</p>
      </header>
      <div className="max-h-[calc(100vh-320px)] min-h-[120px] space-y-2 overflow-y-auto p-2"
        onScroll={(e) => {
          if (!more) return;
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) setShown((s) => Math.min(s + COLUMN_PAGE, leads.length));
        }}>
        {leads.length === 0 && <p className="py-6 text-center text-xs text-gray-400">วางแชทที่นี่</p>}
        {leads.slice(0, shown).map((l) => <DraggableCard key={l.id} lead={l} enabled={enabled} onOpen={() => onOpen(l.id)} />)}
        {more && <p className="py-1 text-center text-xs text-muted">เลื่อนลงเพื่อดูอีก {leads.length - shown} รายการ</p>}
      </div>
    </section>
  );
}

export default function Board() {
  const { data, user, filters } = useStore();
  const act = useLeadActions();
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("all");
  const [ch, setCh] = useState<ChatChannel | "all">("all");
  const [active, setActive] = useState<Lead | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
  const canEdit = roleCan.editLeads(user.role);

  const scoped = useMemo(() => data.leads.filter((l) => l.valid && !l.dropped
    && (user.role !== "Sales Representative" || l.repId === user.id)
    && (filters.pageId === "all" || l.pageId === filters.pageId)), [data.leads, user, filters.pageId]);
  const perChannel = useMemo(() => countByChannel(scoped), [scoped]);
  const leads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((l) => (ch === "all" || channelOf(l) === ch)
      && (rep === "all" || (rep === "none" ? !l.repId : l.repId === rep))
      && (!needle || `${l.name} ${l.id} ${l.adId ?? ""}`.toLowerCase().includes(needle)));
  }, [scoped, q, rep, ch]);

  const grouped = useMemo(() => {
    const m = Object.fromEntries(BOARD_COLUMNS.map((s) => [s, [] as Lead[]])) as Record<LeadQuality, Lead[]>;
    for (const l of leads) m[columnOf(l)].push(l);
    for (const s of BOARD_COLUMNS) m[s].sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt));
    return m;
  }, [leads]);

  const onStart = (e: DragStartEvent) => setActive(data.leads.find((l) => l.id === e.active.id) ?? null);
  const onEnd = async (e: DragEndEvent) => {
    setActive(null);
    const lead = data.leads.find((l) => l.id === e.active.id);
    const to = e.over?.id as LeadStatus | undefined;
    if (lead && to && to !== columnOf(lead) && to !== lead.status) await act.move(lead, to);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">บอร์ดแชท</h1>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <SearchBox className="w-56" value={q} onChange={setQ} placeholder="ค้นหาชื่อ, Lead ID, Ad ID…" />
          {user.role !== "Sales Representative" && <Select value={rep} onChange={setRep} options={[{ value: "all", label: "เซลล์ทุกคน" }, { value: "none", label: "ยังไม่มีผู้ดูแล" }, ...data.users.filter((u) => u.role === "Sales Representative").map((u) => ({ value: u.id, label: u.name }))]} />}
        </div>
      </div>
      <ChannelFilter value={ch} onChange={setCh} counts={perChannel} />
      <p className="text-xs text-muted">การ์ดเรียงตามข้อความล่าสุดเหมือน Facebook Inbox และเลื่อนลงในคอลัมน์เพื่อโหลดรายการเก่าเพิ่ม · ลากการ์ดด้วยไอคอนจับ (⋮⋮) ไปวางในกล่องที่ต้องการ หรือเปิดการ์ดแล้วเปลี่ยนสถานะจากเมนู การย้ายที่มีความเสี่ยงจะขอให้ยืนยันก่อน และทุกการย้ายถูกบันทึกลง Google Sheet {!canEdit && "· บทบาทของคุณดูได้อย่างเดียว"}</p>
      {data.leads.length === 0 && <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-muted">ยังไม่มีแชทในระบบ — ไปที่หน้า <b>Upload</b> เพื่อนำเข้าข้อมูลแชท/ลูกค้าจากเพจ Facebook</p>}
      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {BOARD_COLUMNS.map((s) => <Column key={s} status={s} leads={grouped[s]} onOpen={setOpenId} enabled={canEdit} />)}
        </div>
        <DragOverlay>{active ? <div className="w-[256px]"><Card lead={active} dragging /></div> : null}</DragOverlay>
      </DndContext>
      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
