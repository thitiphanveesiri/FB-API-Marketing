"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, MessageSquare, Moon, Timer, TrafficCone } from "lucide-react";
import { useStore } from "@/lib/store";
import { Badge, Card, DataTable, Drawer, EmptyState, KpiCard, Select, Column } from "@/components/ui";
import FilterBar from "@/components/FilterBar";
import { BAND_TH, ChatEvent, RepSla, SLA_RULES, computeSla } from "@/lib/sla";
import { nowStamp } from "@/lib/dates";

const hm = (iso: string) => iso.slice(0, 10) + " " + iso.slice(11, 16);
const dur = (m: number) => (m >= 120 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`);
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function download(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function SlaPage() {
  const { data, user, filters } = useStore();
  const [repId, setRepId] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const isRep = user.role === "Sales Representative";
  const now = useMemo(() => nowStamp().slice(0, 16), []);

  const res = useMemo(() => computeSla({ leads: data.leads, messages: data.messages, comments: data.comments, pages: data.pages, users: data.users, start: filters.start, end: filters.end, now, pageId: filters.pageId, repId: isRep ? user.id : repId }),
    [data, filters.start, filters.end, filters.pageId, repId, isRep, user.id, now]);
  const leadName = (id: string) => data.leads.find((l) => l.id === id)?.name ?? id;
  const pageName = (id: string) => data.pages.find((p) => p.id === id)?.name ?? id;
  const repName = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "ยังไม่มีผู้ดูแล";
  const canSee = (e: ChatEvent) => !isRep || e.repId === user.id;

  const cols: Column<RepSla>[] = [
    { key: "n", header: "เซลล์", sort: (r) => r.name, render: (r) => <b>{r.name}</b> },
    { key: "c", header: "แชทที่ต้องตอบ", align: "right", sort: (r) => r.chats, render: (r) => r.chats },
    { key: "o", header: "ตอบทัน", align: "right", sort: (r) => r.onTime, render: (r) => r.onTime },
    { key: "l", header: "ตอบช้า", align: "right", sort: (r) => r.late, render: (r) => (r.late ? <span className="font-semibold text-red-500">{r.late}</span> : 0) },
    { key: "op", header: "ยังไม่ตอบ", align: "right", sort: (r) => r.open, render: (r) => r.open },
    { key: "a", header: "เวลาตอบเฉลี่ย", align: "right", sort: (r) => r.avgMin, render: (r) => (r.avgMin == null ? "—" : dur(r.avgMin)) },
    { key: "cd", header: "หักจากแชท", align: "right", sort: (r) => r.chatDeduct, render: (r) => (r.chatDeduct ? `−${pts(r.chatDeduct)}` : "0"), tip: `ตอบเกิน ${SLA_RULES.chatMinutes} นาที ในช่วง 10:00–19:00 ครั้งละ ${SLA_RULES.chatPenalty} แต้ม` },
    { key: "md", header: "หักจากคอมเมนต์", align: "right", sort: (r) => r.commentDeduct, render: (r) => (r.commentDeduct ? `−${pts(r.commentDeduct)}` : "0"), tip: `คอมเมนต์ตอบเกิน ${SLA_RULES.commentMinutes} นาที ช่วง 10:00–19:00 หัก ${SLA_RULES.commentPenalty} แต้ม ทุกคนในทีมของเพจนั้น` },
    { key: "lt", header: "ช้า (ช่วงเดินทาง)", align: "right", sort: (r) => r.lateTravel, render: (r) => r.lateTravel, tip: "สถิติเท่านั้น ไม่หักคะแนน" },
    { key: "nr", header: "ตอบช่วงดึก", align: "right", sort: (r) => r.nightReplies, render: (r) => r.nightReplies, tip: "สถิติเท่านั้น ไม่หักคะแนน" },
    { key: "s", header: `คะแนน (เต็ม ${SLA_RULES.basePoints})`, align: "right", sort: (r) => r.score, render: (r) => <b className="tabnum" style={{ color: r.deducted === 0 ? "#087a58" : r.deducted >= 10 ? "#dc6b6b" : undefined }}>{pts(r.score)}</b> },
  ];

  const detail = res.reps.find((r) => r.repId === open);
  const detailEvents = res.events.filter((e) => e.repId === open && canSee(e)).sort((a, b) => b.inAt.localeCompare(a.inAt));
  const exportAll = () => download(`sla-${filters.start}_${filters.end}.csv`, [
    ["เซลล์", "เพจ", "แชท", "ลูกค้าส่งเมื่อ", "ตอบเมื่อ", "นาที", "ช่วงเวลา", "ช้า", "หักคะแนน", "สถิติช้าช่วงเดินทาง", "สถิติตอบช่วงดึก"],
    ...res.events.filter(canSee).map((e) => [repName(e.repId), pageName(e.pageId), e.leadName, hm(e.inAt), e.outAt ? hm(e.outAt) : "ยังไม่ตอบ", e.minutes, BAND_TH[e.band], e.late ? "ใช่" : "ไม่", e.deduct, e.lateStat ? 1 : 0, e.nightReply ? 1 : 0]),
  ]);
  const hasData = Object.values(data.messages).some((m) => m.length > 0) || data.comments.length > 0;
  const late = res.events.filter((e) => e.late && canSee(e));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">ตรวจการตอบแชท</h1>
        <div className="ml-auto flex items-end gap-2">
          {!isRep && <Link href="/comments" className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-gray-50"><MessageSquare size={14} /> คอมเมนต์ใต้โพสต์</Link>}
          {!isRep && <Select value={repId} onChange={setRepId} options={[{ value: "all", label: "เซลล์ทุกคน" }, ...data.users.filter((u) => u.role === "Sales Representative" && u.active).map((u) => ({ value: u.id, label: u.name }))]} />}
          <button onClick={exportAll} className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-gray-50"><Download size={14} /> ส่งออก CSV</button>
        </div>
      </div>
      <FilterBar hide={["rep", "adStatus"]} />

      <Card title="กติกาการตรวจ" subtitle="ใช้เวลาที่ลูกค้าส่งข้อความเป็นตัวกำหนดช่วงเวลา และเริ่มนับเวลาตั้งแต่ตอนนั้น">
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          <li className="flex gap-2"><Timer size={16} className="mt-0.5 shrink-0 text-brand-2" /><span><b>10:00–19:00</b> ตอบแชทเกิน {SLA_RULES.chatMinutes} นาที → หัก {SLA_RULES.chatPenalty} แต้ม ต่อแชท ต่อครั้ง ต่อเพจ (หักทุกครั้งที่ตอบช้า)</span></li>
          <li className="flex gap-2"><TrafficCone size={16} className="mt-0.5 shrink-0 text-amber-500" /><span><b>08:00–10:00 และ 19:00–22:00</b> (เดินทาง) ตอบเกิน {SLA_RULES.chatMinutes} นาที → ไม่หักคะแนน เก็บเป็นสถิติตอบล่าช้า</span></li>
          <li className="flex gap-2"><TrafficCone size={16} className="mt-0.5 shrink-0 text-gray-400" /><span><b>วันอังคาร (วันหยุด)</b> ไม่นำมาคิดหักคะแนนทั้งแชทและคอมเมนต์ เก็บเป็นสถิติเท่านั้น · ข้อความปิดบทสนทนาของลูกค้า (ขอบคุณ/โอเค/สติกเกอร์) ไม่เริ่มนับเวลา</span></li>
          <li className="flex gap-2"><Moon size={16} className="mt-0.5 shrink-0 text-violet-500" /><span><b>22:00–08:00</b> ไม่หักคะแนน หากมีการตอบ เก็บเป็นสถิติการตอบแชทของเซลล์</span></li>
          <li className="flex gap-2"><Timer size={16} className="mt-0.5 shrink-0 text-brand-2" /><span><b>คอมเมนต์ใต้โพสต์</b> (เฉพาะ 10:00–19:00) ตอบเกิน {SLA_RULES.commentMinutes} นาที → หัก {SLA_RULES.commentPenalty} แต้ม จากเซลล์ทุกคนในทีมของเพจนั้น</span></li>
        </ul>
        <p className="mt-2 text-xs text-muted">แชทที่ลูกค้าส่งมาแล้วยังไม่ได้ตอบ นับเป็นตอบช้าเมื่อเกินเวลา (คิดถึงเวลาปัจจุบัน) · ลูกค้าส่งหลายข้อความติดกันก่อนได้รับการตอบ นับเป็น 1 ครั้ง · คะแนนเต็ม {SLA_RULES.basePoints} เป็นค่าสำหรับแสดงผลเท่านั้น</p>
      </Card>

      {!hasData ? (
        <EmptyState title="ยังไม่มีข้อมูลเวลาของข้อความ" hint="ไปที่หน้า Upload เลือก “ข้อความแชทรายข้อความ” และ “คอมเมนต์ใต้โพสต์” (หรือกรอกแท็บ messages และ post_comments ใน Google Sheet) ระบบต้องรู้เวลาที่ลูกค้าส่งและเวลาที่เซลล์ตอบ" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="ตอบช้าทั้งหมด" value={String(res.totals.late)} lowerIsBetter />
            <KpiCard label="แต้มที่หักจากแชท" value={pts(res.totals.chatDeduct)} lowerIsBetter />
            <KpiCard label="ตอบช้าช่วงเดินทาง (สถิติ)" value={String(res.totals.lateTravel)} />
            <KpiCard label="ตอบช่วงดึก (สถิติ)" value={String(res.totals.nightReplies)} />
            {!isRep && <KpiCard label="คอมเมนต์ตอบช้า" value={String(res.totals.lateComments)} lowerIsBetter />}
            {!isRep && <KpiCard label="แต้มที่หักจากคอมเมนต์ (ต่อคน)" value={pts(res.totals.commentDeduct)} lowerIsBetter tip="หักเท่ากันทุกคนในทีมของเพจนั้น" />}
          </div>

          <Card title="สรุปรายเซลล์" subtitle="คลิกแถวเพื่อดูรายการที่ตอบช้า">
            <DataTable columns={cols} rows={res.reps} rowKey={(r) => r.repId} defaultSort={{ key: "s", dir: "asc" }} onRowClick={(r) => setOpen(r.repId)} caption="สรุปการตอบแชทรายเซลล์" emptyTitle="ไม่มีเซลล์ในช่วงนี้" />
            {!isRep && res.unassigned.length > 0 && <p className="mt-2 text-xs text-muted">มี {res.unassigned.length} แชทที่ยังไม่มีผู้ดูแล จึงไม่ถูกนับให้ใคร — มอบหมายเซลล์ที่หน้า Board</p>}
          </Card>

          <Card title="รายการที่ตอบช้า" subtitle={`${late.length} รายการในช่วงที่เลือก`}>
            <EventTable events={late} leadName={leadName} pageName={pageName} repName={repName} />
          </Card>
        </>
      )}

      <Drawer open={!!detail} onClose={() => setOpen(null)} title={detail?.name ?? ""} width={720}>
        {detail && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["แชท", detail.chats], ["ตอบช้า", detail.late], ["หักคะแนน", `−${pts(detail.deducted)}`], ["คะแนน", pts(detail.score)]].map(([k, v]) => <div key={String(k)} className="rounded-lg bg-gray-50 p-2.5"><div className="text-xs text-muted">{k}</div><div className="text-lg font-semibold tabnum">{v}</div></div>)}
          </div>
          <EventTable events={detailEvents} leadName={leadName} pageName={pageName} repName={repName} all />
        </div>}
      </Drawer>
    </div>
  );
}

function EventTable({ events, leadName, pageName, repName, all }: { events: ChatEvent[]; leadName: (id: string) => string; pageName: (id: string) => string; repName: (id: string | null) => string; all?: boolean }) {
  const cols: Column<ChatEvent>[] = [
    { key: "t", header: "ลูกค้าส่งเมื่อ", sort: (e) => e.inAt, render: (e) => hm(e.inAt) },
    { key: "l", header: "แชท", sort: (e) => leadName(e.leadId), render: (e) => leadName(e.leadId) },
    ...(all ? [] : [{ key: "r", header: "เซลล์", sort: (e: ChatEvent) => repName(e.repId), render: (e: ChatEvent) => repName(e.repId) }]),
    { key: "p", header: "เพจ", render: (e) => pageName(e.pageId) },
    { key: "w", header: "ใช้เวลา", align: "right", sort: (e) => e.minutes, render: (e) => (e.open ? <Badge tone="red">ยังไม่ตอบ · {dur(e.minutes)}</Badge> : dur(e.minutes)) },
    { key: "b", header: "ช่วงเวลา", render: (e) => <Badge tone={e.band === "work" ? "blue" : e.band === "travel" ? "amber" : "violet"}>{e.band === "work" ? "10:00–19:00" : e.band === "travel" ? "เดินทาง" : "ดึก"}</Badge> },
    { key: "d", header: "ผล", align: "right", sort: (e) => e.deduct, render: (e) => (e.deduct ? <b className="text-red-500">−{pts(e.deduct)}</b> : e.late ? <span className="text-xs text-muted">สถิติ ไม่หัก</span> : e.nightReply ? <span className="text-xs text-muted">ตอบช่วงดึก</span> : "ทัน") },
  ];
  return <DataTable columns={cols} rows={events} rowKey={(e) => e.leadId + e.inAt} defaultSort={{ key: "t", dir: "desc" }} emptyTitle="ไม่มีรายการ" pageSize={8} />;
}
