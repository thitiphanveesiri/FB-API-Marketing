"use client";
import { useEffect, useRef, useState } from "react";
import { Images, RefreshCw } from "lucide-react";
import { Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";
import { pullAds, type AdsTotals } from "@/lib/syncClient";
import { refreshCreativeLinks } from "@/lib/creativeClient";

interface Acct { channelId: string; name: string; accountId: string }

/** Administrators only: pull campaigns, ads, daily results and ad images from the Meta ad account into the Google Sheet. */
export default function AdsSyncCard() {
  const { data, user, reloadData, toast } = useStore();
  const [accts, setAccts] = useState<Acct[] | null>(null); const [ch, setCh] = useState(""); const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(""); const [done, setDone] = useState<AdsTotals | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [acctError, setAcctError] = useState("");
  const [picBusy, setPicBusy] = useState(false); const [picNote, setPicNote] = useState("");
  const stop = useRef(false);

  useEffect(() => {
    if (user.role !== "Administrator") return;
    let live = true;
    fetch("/api/ads-sync", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!live) return;
      const a: Acct[] = j.ok ? j.accounts : [];
      setAccts(a); if (a[0]) setCh(a[0].channelId);
      setAcctError(j.ok ? "" : j.message || "อ่านรายการบัญชีโฆษณาไม่สำเร็จ");
    }).catch((e) => { if (live) { setAccts([]); setAcctError(e instanceof Error ? `เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ${e.message}` : "อ่านรายการบัญชีโฆษณาไม่สำเร็จ"); } });
    return () => { live = false; };
  }, [user.role]);
  if (user.role !== "Administrator" || !accts) return null;
  if (acctError) return (
    <Card title="ดึงข้อมูลโฆษณาจาก Meta โดยตรง">
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{acctError}</p>
    </Card>
  );
  if (accts.length === 0) return null;

  const run = async () => {
    stop.current = false; setBusy(true); setDone(null); setNotes([]);
    const tot: AdsTotals = { ads: 0, campaigns: 0, rows: 0, warnings: [] };
    try {
      await pullAds(ch, Number(days) || 30, { stop, log: setLog }, tot);
      setDone(tot); setNotes(tot.warnings ?? []);
      setLog(stop.current ? "หยุดแล้ว (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)" : "ดึงข้อมูลเสร็จแล้ว");
      toast(stop.current ? "หยุดการดึงข้อมูล" : "ดึงข้อมูลโฆษณาเสร็จแล้ว");
    } catch (e) { setNotes(tot.warnings ?? []); setLog(`ผิดพลาด: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"} (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)`); }
    finally { setBusy(false); await reloadData(true); }
  };

  // Meta signs every picture link it returns and the signature dies in a few days. This re-reads the links for the ads whose link
  // has expired and stores the new ones in the sheet — the same thing the thumbnails do by themselves, but for the whole account.
  const refreshPics = async () => {
    setPicBusy(true); setPicNote("");
    try {
      const r = await refreshCreativeLinks();
      setPicNote(r.fixed ? `ต่อลิงก์รูปใหม่ให้ ${r.fixed} โฆษณา จาก ${r.checked} โฆษณาที่ลิงก์หมดอายุ (บันทึกใส่ Google Sheet แล้ว)` : (r.message ?? "ไม่พบลิงก์ที่หมดอายุ — ถ้ารูปยังไม่ขึ้น ให้ดึงข้อมูลโฆษณาซ้ำ"));
      if (r.fixed) await reloadData(true);
    } finally { setPicBusy(false); }
  };

  return (
    <Card title="ดึงข้อมูลโฆษณาจาก Meta โดยตรง" subtitle="แคมเปญ โฆษณา ผลรายวัน (ใช้จ่าย รีช การแสดงผล คลิก ข้อความที่เริ่มคุย ยอดซื้อ) และภาพโฆษณา — ไม่ต้องดาวน์โหลดไฟล์">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          {accts.length > 1 && <Select label="บัญชีโฆษณา" value={ch} onChange={setCh} options={accts.map((a) => ({ value: a.channelId, label: a.name || a.accountId }))} />}
          <Select label="ย้อนหลัง" value={days} onChange={setDays} options={[{ value: "7", label: "7 วัน" }, { value: "14", label: "14 วัน" }, { value: "30", label: "30 วัน" }, { value: "60", label: "60 วัน" }, { value: "90", label: "90 วัน" }, { value: "180", label: "180 วัน (6 เดือน)" }, { value: "365", label: "365 วัน (1 ปี)" }, { value: "730", label: "730 วัน (2 ปี)" }]} />
          <Btn variant="primary" onClick={run} disabled={busy}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "กำลังดึง…" : "ดึงข้อมูลโฆษณาตอนนี้"}</Btn>
          {busy && <Btn onClick={() => { stop.current = true; }}>หยุด</Btn>}
          <Btn onClick={refreshPics} disabled={busy || picBusy} title="ดึงลิงก์รูปโฆษณาใหม่จาก Meta สำหรับโฆษณาที่ลิงก์เดิมหมดอายุ"><Images size={14} /> {picBusy ? "กำลังรีเฟรช…" : "รีเฟรชรูปโฆษณา"}</Btn>
        </div>
        {log && <p className="text-sm" role="status">{log}</p>}
        {picNote && <p className="text-xs text-muted" role="status">{picNote}</p>}
        {notes.length > 0 && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          <p className="font-medium">หมายเหตุ</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>}
        {done && <div className="rounded-lg bg-brand-faint px-3 py-2 text-sm">
          <p>ได้ {done.ads} โฆษณา ({done.campaigns} แคมเปญ) และสถิติรายวัน {done.rows} แถว</p>
          {pageSplit(done.byPage, data.pages) && <p className="mt-1 text-xs text-muted">แยกตามเพจ: {pageSplit(done.byPage, data.pages)}</p>}
        </div>}
        <p className="text-xs text-muted">ดึงซ้ำได้ ข้อมูลวันเดิมจะถูกอัปเดตทับ ไม่ซ้ำ · วันที่นับตามเขตเวลาของบัญชีโฆษณา · ลิงก์รูปจาก Meta หมดอายุได้ในไม่กี่วัน ระบบต่อลิงก์ใหม่ให้อัตโนมัติตอนเปิดหน้ารายงาน หรือกด “รีเฟรชรูปโฆษณา”</p>
      </div>
    </Card>
  );
}

/** "เพจ A 12 · เพจ B 8" — which page each pulled ad was filed under, so a wrong page is visible right after the sync. */
function pageSplit(byPage: Record<string, number> | undefined, pages: { id: string; name: string }[]): string {
  const entries = Object.entries(byPage ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  const shown = entries.slice(0, 4).map(([id, n]) => `${pages.find((p) => p.id === id)?.name ?? id} ${n}`).join(" · ");
  return entries.length > 4 ? `${shown} …` : shown;
}
