"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store";
import { Badge, Btn, Card, Column, DataTable, EmptyState, KpiCard } from "@/components/ui";
import FilterBar from "@/components/FilterBar";
import { CommentEvent, SLA_RULES, commentEvent } from "@/lib/sla";
import { nowStamp } from "@/lib/dates";

const hm = (iso: string) => iso.slice(0, 10) + " " + iso.slice(11, 16);
const dur = (m: number) => (m >= 120 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`);
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** Synced rows already hold the Facebook/Instagram permalink; imported rows may hold a bare post id. */
const postHref = (postId: string) => (/^https?:\/\//i.test(postId) ? postId : `https://www.facebook.com/${postId}`);
const postSite = (postId: string) => (/instagram\.com/i.test(postId) ? "Instagram" : "Facebook");

export default function CommentsPage() {
  const { data, filters } = useStore();
  const [view, setView] = useState<"all" | "late" | "open">("all");
  const now = useMemo(() => nowStamp().slice(0, 16), []);
  const pageName = (id: string) => data.pages.find((p) => p.id === id)?.name ?? id;

  const rows = useMemo(() => data.comments
    .filter((c) => c.at.slice(0, 10) >= filters.start && c.at.slice(0, 10) <= filters.end && (filters.pageId === "all" || c.pageId === filters.pageId))
    .map((c) => commentEvent(c, now))
    .sort((a, b) => b.comment.at.localeCompare(a.comment.at)), [data.comments, filters.start, filters.end, filters.pageId, now]);

  const shown = view === "late" ? rows.filter((r) => r.late) : view === "open" ? rows.filter((r) => r.open) : rows;
  const repliedMinutes = rows.filter((r) => !r.open).map((r) => r.minutes);
  const avgMin = repliedMinutes.length ? Math.round(repliedMinutes.reduce((s, m) => s + m, 0) / repliedMinutes.length) : null;

  const cols: Column<CommentEvent>[] = [
    { key: "t", header: "คอมเมนต์เมื่อ", sort: (e) => e.comment.at, render: (e) => hm(e.comment.at) },
    { key: "p", header: "เพจ", sort: (e) => pageName(e.comment.pageId), render: (e) => pageName(e.comment.pageId) },
    { key: "c", header: "ผู้คอมเมนต์", sort: (e) => e.comment.commenter, render: (e) => e.comment.commenter || "—" },
    { key: "x", header: "ข้อความ", sort: (e) => e.comment.text, render: (e) => <span className="block max-w-[320px] truncate text-muted" title={e.comment.text}>{e.comment.text || "—"}</span> },
    { key: "po", header: "โพสต์", sort: (e) => e.comment.postId, render: (e) => e.comment.postId
      ? <a href={postHref(e.comment.postId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-brand hover:underline" title={`เปิดโพสต์บน ${postSite(e.comment.postId)}`}>เปิดโพสต์ <ExternalLink size={12} /></a>
      : "—" },
    { key: "w", header: "ใช้เวลา", align: "right", sort: (e) => e.minutes, render: (e) => (e.open ? <Badge tone="red">ยังไม่ตอบ · {dur(e.minutes)}</Badge> : dur(e.minutes)) },
    { key: "ra", header: "ตอบเมื่อ", sort: (e) => e.comment.repliedAt, render: (e) => (e.comment.repliedAt ? hm(e.comment.repliedAt) : "—") },
    { key: "d", header: `ผล (หัก ${pts(SLA_RULES.commentPenalty)} แต้ม/คน)`, align: "right", sort: (e) => e.deduct, render: (e) => (e.deduct ? <b className="text-red-500">−{pts(e.deduct)}</b> : e.late ? <span className="text-xs text-muted">ไม่หัก (นอกช่วงเวลา/วันหยุด)</span> : <span className="text-xs text-muted">ทัน</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">คอมเมนต์ใต้โพสต์</h1>
        <p className="text-sm text-muted">ตอบภายใน {SLA_RULES.commentMinutes} นาที (เฉพาะ 10:00–19:00) เกินเวลาหัก {pts(SLA_RULES.commentPenalty)} แต้มจากเซลล์ทุกคนในทีมของเพจนั้น</p>
        <Link href="/sla" className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-gray-50">ไปหน้าตรวจการตอบแชท</Link>
      </div>
      <FilterBar hide={["rep", "adStatus"]} />

      {data.comments.length === 0 ? (
        <EmptyState title="ยังไม่มีข้อมูลคอมเมนต์" hint="ไปที่หน้า Upload เลือก “คอมเมนต์ใต้โพสต์” (หรือกรอกแท็บ post_comments ใน Google Sheet) ระบบต้องรู้เวลาที่ลูกค้าคอมเมนต์ เวลาที่เพจตอบ และลิงก์ของโพสต์" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="คอมเมนต์ในช่วงที่เลือก" value={rows.length.toLocaleString()} />
            <KpiCard label="ตอบช้า" value={String(rows.filter((r) => r.late).length)} lowerIsBetter />
            <KpiCard label="ยังไม่ตอบ" value={String(rows.filter((r) => r.open).length)} lowerIsBetter sub={rows.some((r) => r.open) ? "นับเวลาถึงปัจจุบัน" : undefined} />
            <KpiCard label="เวลาตอบเฉลี่ย" value={avgMin == null ? "—" : dur(avgMin)} lowerIsBetter />
          </div>

          <Card title="รายการคอมเมนต์" subtitle={`${shown.length} จาก ${rows.length} คอมเมนต์ · กด “เปิดโพสต์” เพื่อดูโพสต์ต้นทาง`}
            right={<div className="flex gap-1">
              <Btn size="sm" variant={view === "all" ? "primary" : "secondary"} onClick={() => setView("all")}>ทั้งหมด</Btn>
              <Btn size="sm" variant={view === "late" ? "primary" : "secondary"} onClick={() => setView("late")}>ตอบช้า</Btn>
              <Btn size="sm" variant={view === "open" ? "primary" : "secondary"} onClick={() => setView("open")}>ยังไม่ตอบ</Btn>
            </div>}>
            <DataTable columns={cols} rows={shown} rowKey={(e) => e.comment.id} defaultSort={{ key: "t", dir: "desc" }}
              searchText={(e) => `${e.comment.commenter} ${e.comment.text} ${pageName(e.comment.pageId)} ${e.comment.postId}`}
              searchPlaceholder="ค้นหาผู้คอมเมนต์ ข้อความ หรือโพสต์" pageSize={12}
              emptyTitle={view === "all" ? "ไม่มีคอมเมนต์ในช่วงนี้" : "ไม่มีรายการตามตัวกรองที่เลือก"} caption="คอมเมนต์ใต้โพสต์" exportName="post-comments" />
          </Card>
        </>
      )}
    </div>
  );
}
