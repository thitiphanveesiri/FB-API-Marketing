"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";

interface Acct { channelId: string; name: string; accountId: string }
interface Totals { ads: number; campaigns: number; rows: number }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Administrators only: pull campaigns, ads, daily results and ad images from the Meta ad account into the Google Sheet. */
export default function AdsSyncCard() {
  const { user, reloadData, toast } = useStore();
  const [accts, setAccts] = useState<Acct[] | null>(null); const [ch, setCh] = useState(""); const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(""); const [done, setDone] = useState<Totals | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    if (user.role !== "Administrator") return;
    let live = true;
    fetch("/api/ads-sync", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!live) return; const a: Acct[] = j.ok ? j.accounts : []; setAccts(a); if (a[0]) setCh(a[0].channelId); }).catch(() => live && setAccts([]));
    return () => { live = false; };
  }, [user.role]);
  if (user.role !== "Administrator" || !accts || accts.length === 0) return null;

  const run = async () => {
    stop.current = false; setBusy(true); setDone(null);
    const tot: Totals = { ads: 0, campaigns: 0, rows: 0 };
    let state: { phase: string; after?: string } = { phase: "ads" }, failures = 0;
    try {
      while (state.phase !== "done" && !stop.current) {
        setLog(state.phase === "ads" ? `กำลังดึงรายการโฆษณาและภาพ… (${tot.ads} โฆษณา)` : `กำลังดึงสถิติรายวัน… (${tot.rows} แถว)`);
        const r = await fetch("/api/ads-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId: ch, days: Number(days) || 30, state }) });
        const j = await r.json().catch(() => ({ ok: false, message: "ตอบกลับไม่ถูกต้อง" }));
        if (j.rateLimited) { for (let s = 60; s > 0 && !stop.current; s--) { setLog(`Meta ขอให้รอ — ลองต่อใน ${s} วินาที…`); await wait(1000); } continue; }
        if (!j.ok) { if (++failures < 3 && r.status >= 500) { await wait(2000); continue; } throw new Error(j.message || "ดึงข้อมูลไม่สำเร็จ"); }
        failures = 0; tot.ads += j.counts.ads; tot.campaigns += j.counts.campaigns; tot.rows += j.counts.rows; state = j.next;
      }
      setDone(tot); setLog(stop.current ? "หยุดแล้ว (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)" : "ดึงข้อมูลเสร็จแล้ว");
      toast(stop.current ? "หยุดการดึงข้อมูล" : "ดึงข้อมูลโฆษณาเสร็จแล้ว");
    } catch (e) { setLog(`ผิดพลาด: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"} (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)`); }
    finally { setBusy(false); await reloadData(true); }
  };

  return (
    <Card title="ดึงข้อมูลโฆษณาจาก Meta โดยตรง" subtitle="แคมเปญ โฆษณา ผลรายวัน (ใช้จ่าย รีช การแสดงผล คลิก ข้อความที่เริ่มคุย ยอดซื้อ) และภาพโฆษณา — ไม่ต้องดาวน์โหลดไฟล์">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          {accts.length > 1 && <Select label="บัญชีโฆษณา" value={ch} onChange={setCh} options={accts.map((a) => ({ value: a.channelId, label: a.name || a.accountId }))} />}
          <Select label="ย้อนหลัง" value={days} onChange={setDays} options={[{ value: "7", label: "7 วัน" }, { value: "14", label: "14 วัน" }, { value: "30", label: "30 วัน" }, { value: "60", label: "60 วัน" }, { value: "90", label: "90 วัน" }]} />
          <Btn variant="primary" onClick={run} disabled={busy}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "กำลังดึง…" : "ดึงข้อมูลโฆษณาตอนนี้"}</Btn>
          {busy && <Btn onClick={() => { stop.current = true; }}>หยุด</Btn>}
        </div>
        {log && <p className="text-sm" role="status">{log}</p>}
        {done && <p className="rounded-lg bg-brand-faint px-3 py-2 text-sm">ได้ {done.ads} โฆษณา ({done.campaigns} แคมเปญ) และสถิติรายวัน {done.rows} แถว</p>}
        <p className="text-xs text-muted">ดึงซ้ำได้ ข้อมูลวันเดิมจะถูกอัปเดตทับ ไม่ซ้ำ · วันที่นับตามเขตเวลาของบัญชีโฆษณา · ภาพโฆษณาเป็นลิงก์จาก Meta ที่หมดอายุได้ ดึงใหม่เพื่อรีเฟรชภาพ</p>
      </div>
    </Card>
  );
}
