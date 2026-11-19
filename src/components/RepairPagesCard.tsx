"use client";
import { useCallback, useEffect, useState } from "react";
import { Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";

interface Orphan { pageId: string; count: number }
interface PageOpt { id: string; name: string }

/** Administrators only: leads filed under a page that is missing from the pages tab are invisible; move them to a real page. */
export default function RepairPagesCard() {
  const { user, reloadData, toast } = useStore();
  const [orphans, setOrphans] = useState<Orphan[]>([]); const [pages, setPages] = useState<PageOpt[]>([]);
  const [to, setTo] = useState<Record<string, string>>({}); const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try { const j = await (await fetch("/api/repair-pages", { cache: "no-store" })).json(); if (j.ok) { setOrphans(j.orphans); setPages(j.pages); } } catch { /* the card simply stays hidden */ }
  }, []);
  useEffect(() => {
    if (user.role !== "Administrator") return;
    let live = true;
    fetch("/api/repair-pages", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!live || !j.ok) return;
      setOrphans(j.orphans); setPages(j.pages);
    }).catch(() => { /* the card simply stays hidden */ });
    return () => { live = false; };
  }, [user.role]);
  if (user.role !== "Administrator" || orphans.length === 0) return null;

  const move = async (from: string) => {
    const dest = to[from]; if (!dest || dest === from) return;
    setBusy(from);
    try {
      for (let guard = 0; guard < 50; guard++) {
        const r = await fetch("/api/repair-pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, to: dest }) });
        const j = await r.json().catch(() => ({}));
        if (j.rateLimited) { toast("Google Sheets จำกัดคำขอ รอ 1 นาทีแล้วกดย้ายอีกครั้ง"); break; }
        if (!j.ok) { toast(j.message || "ย้ายลีดไม่สำเร็จ"); break; }
        if (j.done) { toast("ย้ายลีดเรียบร้อยแล้ว"); break; }
      }
    } finally { setBusy(""); await load(); await reloadData(true); }
  };
  return (
    <Card title="แชทที่ชี้ไปเพจที่ไม่มีในชีต" subtitle="ลีดเหล่านี้อยู่ในชีตแต่ page_id ไม่ตรงกับเพจใดในแท็บ pages — ตอนนี้ขึ้นใน Inbox ใต้ชื่อ “PG-… (ไม่พบในแท็บ Pages)” เลือกเพจที่ถูกต้องแล้วกดย้าย ข้อมูลจะไปรวมกับเพจจริง (ระบบย้ายทีละ 300 แถวจนครบ)">
      <div className="space-y-3">
        {orphans.map((o) => (
          <div key={o.pageId || "blank"} className="flex flex-wrap items-end gap-2">
            <p className="text-sm"><b>{o.count}</b> แชทที่ชี้ไปเพจ <code>{o.pageId || "(ว่าง)"}</code></p>
            <Select label="ย้ายไปเพจ" value={to[o.pageId] ?? ""} onChange={(v) => setTo((s) => ({ ...s, [o.pageId]: v }))} options={[{ value: "", label: "— เลือกเพจ —" }, ...pages.map((p) => ({ value: p.id, label: p.name }))]} disabled={!!busy} />
            <Btn variant="primary" onClick={() => void move(o.pageId)} disabled={!!busy || !to[o.pageId] || to[o.pageId] === o.pageId}>{busy === o.pageId ? "กำลังย้าย…" : "ย้ายลีด"}</Btn>
          </div>
        ))}
      </div>
    </Card>
  );
}
