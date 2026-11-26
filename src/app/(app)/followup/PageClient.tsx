"use client";
import { useMemo, useState } from "react";
import { BellRing, Download, MessageCircleReply, Moon } from "lucide-react";
import { useStore } from "@/lib/store";
import { Badge, Card, DataTable, EmptyState, KpiCard, Select, Column } from "@/components/ui";
import FilterBar from "@/components/FilterBar";
import { BAND_TH, SLA_RULES } from "@/lib/sla";
import { computeFollowup, SILENT_OPTIONS, SilentLead, Temp, TEMP_TH } from "@/lib/followup";
import { nowStamp } from "@/lib/dates";
import { toCsv } from "@/lib/csv";
import type { Lead } from "@/lib/types";

const dur = (m: number) => (m >= 120 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : m < 1 ? "< 1 นาที" : `${m} นาที`);
const hrs = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} วัน` : `${h} ชม.`);
const TONE: Record<Temp, "red" | "amber" | "blue"> = { hot: "red", warm: "amber", cold: "blue" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function FollowupPage() {
  const { data, user, filters, toast } = useStore();
  const [silentHours, setSilentHours] = useState("24"); const [repId, setRepId] = useState("all"); const [temp, setTemp] = useState<"all" | Temp>("all");
  const [notifying, setNotifying] = useState<string | null>(null); const [notified, setNotified] = useState<Set<string>>(() => new Set());
  const isRep = user.role === "Sales Representative";
  const isAdmin = user.role === "Administrator";
  const now = useMemo(() => nowStamp().slice(0, 16), []);
  const res = useMemo(() => computeFollowup({ leads: data.leads, messages: data.messages, pages: data.pages, start: filters.start, end: filters.end, now, pageId: filters.pageId, silentHours: Number(silentHours), repId: isRep ? user.id : repId === "all" ? undefined : repId }),
    [data, filters.start, filters.end, filters.pageId, silentHours, repId, isRep, user.id, now]);
  const repName = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "ยังไม่มีผู้ดูแล";
  const pageName = (id: string) => data.pages.find((p) => p.id === id)?.name ?? id;
  const hasData = Object.values(data.messages).some((m) => m.length > 0);
  const rows = res.silent.filter((s) => temp === "all" || s.temp === temp);
  const maxH = Math.max(1, ...res.hourly);
  const notificationKey = (l: Lead) => [l.id, l.status, l.followUpDate ?? "", l.repId ?? "", l.lastContactAt].join("|");
  const notifySales = async (l: Lead) => {
    const key = notificationKey(l);
    if (notifying) return;
    setNotifying(l.id);
    try {
      const response = await fetch("/api/notify/followup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: l.id, silentHours: Number(silentHours) }),
      });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) { toast(result.message || "ส่งการแจ้งเตือนไม่สำเร็จ", "error"); return; }
      setNotified((previous) => new Set(previous).add(key));
      toast(result.duplicate ? "แจ้งเซลล์แล้วสำหรับสถานะติดตามนี้" : "ส่งแจ้งเตือนให้เซลล์แล้ว", result.duplicate ? "info" : "success");
    } catch { toast("เชื่อมต่อระบบแจ้งเตือนไม่สำเร็จ", "error"); }
    finally { setNotifying(null); }
  };

  const cols: Column<SilentLead>[] = [
    { key: "t", header: "ความพร้อม", sort: (r) => ({ hot: 0, warm: 1, cold: 2 })[r.temp], render: (r) => <Badge tone={TONE[r.temp]}>{r.temp === "hot" ? "ร้อน" : r.temp === "warm" ? "อุ่น" : "เย็น"}</Badge> },
    { key: "n", header: "ลูกค้า", sort: (r) => r.lead.name, render: (r) => <b>{r.lead.name}</b> },
    { key: "p", header: "เพจ", render: (r) => pageName(r.lead.pageId) },
    { key: "r", header: "เซลล์", sort: (r) => repName(r.lead.repId), render: (r) => repName(r.lead.repId) },
    { key: "s", header: "เงียบมา", align: "right", sort: (r) => r.silentHours, render: (r) => hrs(r.silentHours) },
    { key: "g", header: "สนใจ", render: (r) => <span className="flex flex-wrap gap-1">{r.tags.length ? r.tags.map((t) => <Badge key={t} tone="violet">{t}</Badge>) : "—"}</span> },
    { key: "c", header: "โทร/อีเมล", render: (r) => r.lead.phone || r.lead.email || "—" },
    { key: "m", header: "ข้อความล่าสุดของเรา", render: (r) => <span className="line-clamp-1 max-w-[260px] text-muted">{r.lastText}</span> },
    ...(isAdmin ? [{ key: "notify", header: "แจ้งเซลล์", render: (r: SilentLead) => {
      const rep = data.users.find((u) => u.id === r.lead.repId && u.role === "Sales Representative" && u.active);
      const key = notificationKey(r.lead), sent = notified.has(key), busy = notifying === r.lead.id;
      return rep
        ? <button type="button" disabled={busy || sent || (!!notifying && !busy)} onClick={() => void notifySales(r.lead)}
            aria-label={`แจ้ง ${rep.name} ให้ติดตาม ${r.lead.name}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60">
            <BellRing size={14} />{busy ? "กำลังส่ง…" : sent ? "แจ้งแล้ว" : "แจ้ง Sales"}
          </button>
        : <span className="text-xs text-muted">ยังไม่ assign</span>;
    } }] : []),
  ];
  const exportQueue = () => download(`followup-${filters.start}_${filters.end}.csv`, [["ความพร้อม", "ลูกค้า", "เพจ", "เซลล์", "เงียบมา(ชม.)", "สนใจ", "เบอร์/อีเมล", "ข้อความล่าสุดของเรา"],
    ...rows.map((r) => [TEMP_TH[r.temp], r.lead.name, pageName(r.lead.pageId), repName(r.lead.repId), r.silentHours, r.tags.join(" / "), r.lead.phone || r.lead.email, r.lastText])]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">ติดตามลูกค้า</h1>
        <div className="ml-auto flex items-end gap-2">
          {!isRep && <Select value={repId} onChange={setRepId} options={[{ value: "all", label: "เซลล์ทุกคน" }, ...data.users.filter((u) => u.role === "Sales Representative" && u.active).map((u) => ({ value: u.id, label: u.name }))]} />}
          <Select value={silentHours} onChange={setSilentHours} options={SILENT_OPTIONS.map((o) => ({ value: String(o.hours), label: o.label }))} />
          <button onClick={exportQueue} className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-gray-50"><Download size={14} /> ส่งออก CSV</button>
        </div>
      </div>
      <FilterBar hide={["rep", "adStatus"]} />

      {!hasData ? <Card><EmptyState title="ยังไม่มีข้อความแชท" hint="เชื่อมช่องทางแชทที่หน้า Upload แล้วข้อมูลจะขึ้นที่นี่" /></Card> : (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard label="เวลาตอบครั้งแรก (มัธยฐาน)" value={res.medianMin == null ? "—" : dur(res.medianMin)} lowerIsBetter tip="เวลาจากข้อความแรกของลูกค้าถึงคำตอบแรก นับทุกบทสนทนาในช่วงที่เลือก" />
          <KpiCard label={`ตอบทันใน ${SLA_RULES.chatMinutes} นาที`} value={pct(res.within15, res.chats)} sub={`${res.within15}/${res.chats} แชท`} />
          <KpiCard label="ยังไม่ได้ตอบ" value={String(res.open)} lowerIsBetter />
          <KpiCard label="ลูกค้าเงียบที่ควรตาม" value={String(res.silent.length)} sub={`ร้อน ${res.silent.filter((s) => s.temp === "hot").length}`} lowerIsBetter />
          <KpiCard label="เงียบแล้วกลับมาคุย" value={String(res.recovered.length)} tip="เพจส่งข้อความล่าสุดแล้วลูกค้าเงียบนานตามที่เลือก ก่อนจะกลับมาทักอีกครั้งในช่วงที่เลือก" />
        </div>

        <Card title="แชทเข้ามาตามช่วงเวลา" subtitle="ดูว่าลูกค้าทักตอนไหนและเราตอบทันแค่ไหน — โดยเฉพาะนอกเวลาทำการ">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {(["work", "travel", "night"] as const).map((b) => { const x = res.byBand[b]; return (
                <div key={b} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                  {b === "night" && <Moon size={14} className="text-brand-2" />}<span className="flex-1">{BAND_TH[b]}</span>
                  <span className="tabnum text-muted">ทัก {x.started}</span><span className="tabnum text-muted">ตอบ {x.replied}</span>
                  <b className="tabnum w-14 text-right">{pct(x.within15, x.started)}</b></div>); })}
              <p className="text-xs text-muted">ตัวเลขขวาสุด = สัดส่วนที่ตอบทันภายใน {SLA_RULES.chatMinutes} นาที · นอกเวลาทำการ (ดึกและช่วงเดินทาง) รวม {res.byBand.travel.started + res.byBand.night.started} จาก {res.chats} แชท ({pct(res.byBand.travel.started + res.byBand.night.started, res.chats)})</p>
            </div>
            <div>
              <div className="flex h-28 items-end gap-0.5" role="img" aria-label="จำนวนแชทที่เริ่มในแต่ละชั่วโมง">
                {res.hourly.map((n, h) => <div key={h} title={`${String(h).padStart(2, "0")}:00 · ${n} แชท`} className="flex-1 rounded-t bg-brand-2/70" style={{ height: `${Math.max(2, (n / maxH) * 100)}%` }} />)}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
              <p className="mt-1 text-xs text-muted">จำนวนแชทที่ลูกค้าเริ่มทักในแต่ละชั่วโมง</p>
            </div>
          </div>
        </Card>

        <Card title={`แชทค้าง (ลูกค้ารอเกิน ${SLA_RULES.staleHours} ชั่วโมง)`} subtitle="ระบบหาให้อัตโนมัติ ไม่ต้องย้อนเปิดดูแชท · ข้อความปิดบทสนทนา เช่น ขอบคุณ/โอเค/สติกเกอร์ ไม่นับเป็นแชทค้าง" right={<Badge tone={res.stale.length ? "red" : "green"}>{res.stale.length} แชท</Badge>}>
          {res.stale.length === 0 ? <EmptyState title="ไม่มีแชทค้าง" hint="ลูกค้าทุกคนที่ทักมาได้รับการตอบภายในเวลา" /> : (
            <ul className="divide-y divide-line text-sm">{res.stale.slice(0, 30).map((e) => (
              <li key={`${e.leadId}-${e.inAt}`} className="flex flex-wrap items-center gap-2 py-2"><b>{e.leadName}</b><span className="text-muted">{repName(e.repId)} · {pageName(e.pageId)}</span>
                {e.holiday && <Badge tone="gray">วันหยุด ไม่หักแต้ม</Badge>}
                <span className="ml-auto text-muted">ลูกค้าทักเมื่อ {e.inAt.slice(0, 10)} {e.inAt.slice(11, 16)} · รอ {hrs(Math.floor(e.minutes / 60))}</span></li>))}</ul>)}
        </Card>

        <Card title="ลูกค้าที่ควรติดตาม" subtitle="เราส่งข้อความล่าสุดแล้วลูกค้าเงียบ · ลีดที่นัดแล้วหรือปิดแล้วไม่นับ · เรียงจากลูกค้าที่พร้อมที่สุดก่อน"
          right={<Select value={temp} onChange={(v) => setTemp(v as "all" | Temp)} options={[{ value: "all", label: `ทั้งหมด (${res.silent.length})` }, { value: "hot", label: `ร้อน (${res.silent.filter((s) => s.temp === "hot").length})` }, { value: "warm", label: `อุ่น (${res.silent.filter((s) => s.temp === "warm").length})` }, { value: "cold", label: `เย็น (${res.silent.filter((s) => s.temp === "cold").length})` }]} />}>
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.lead.id} searchText={(r) => `${r.lead.name} ${r.lastText}`} searchPlaceholder="ค้นหาชื่อหรือข้อความ" pageSize={10} defaultSort={{ key: "t", dir: "asc" }}
            emptyTitle="ไม่มีลูกค้าเงียบในตอนนี้" emptyHint="ลองเปลี่ยนเกณฑ์ความเงียบหรือขยายช่วงวันที่" />
          <p className="mt-2 text-xs text-muted">ร้อน = นัด/ผ่านเกณฑ์แล้ว มีเบอร์ หรือเพิ่งถามราคา/นัด · เย็น = ลูกค้าไม่ตอบเกิน 7 วัน หรือไม่เคยตอบกลับ · เป็นกฎอัตโนมัติ ปรับคำได้ในไฟล์ src/lib/followup.ts</p>
        </Card>

        <Card title="เงียบแล้วกลับมาคุย" subtitle="ลูกค้าที่หายไปตามเกณฑ์ แล้วกลับมาทักเราอีกครั้ง" right={<Badge tone="green"><MessageCircleReply size={12} /> {res.recovered.length} ราย</Badge>}>
          {res.recovered.length === 0 ? <EmptyState title="ยังไม่มี" hint="จะแสดงเมื่อมีลูกค้าที่หายไปแล้วกลับมาในช่วงที่เลือก" /> : (
            <ul className="divide-y divide-line text-sm">{res.recovered.slice(0, 30).map((r, n) => (
              <li key={`${r.lead.id}-${n}`} className="flex flex-wrap items-center gap-2 py-2"><b>{r.lead.name}</b><span className="text-muted">{repName(r.lead.repId)}</span>
                <span className="ml-auto text-muted">หายไป {hrs(r.gapHours)} · กลับมา {r.backAt.slice(0, 10)} {r.backAt.slice(11, 16)}</span></li>))}</ul>)}
        </Card>
      </>)}
    </div>
  );
}
