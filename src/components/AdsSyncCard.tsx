"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";
import { pullAds, type AdsTotals } from "@/lib/syncClient";

interface Acct { channelId: string; name: string; accountId: string }

/** Administrators only: pull campaigns, ads, daily results and ad images from the Meta ad account into the Google Sheet. */
export default function AdsSyncCard() {
  const { user, reloadData, toast } = useStore();
  const [accts, setAccts] = useState<Acct[] | null>(null); const [ch, setCh] = useState(""); const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(""); const [done, setDone] = useState<AdsTotals | null>(null);
  const [acctError, setAcctError] = useState("");
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
    stop.current = false; setBusy(true); setDone(null);
    const tot: AdsTotals = { ads: 0, campaigns: 0, rows: 0, warnings: [] };
    try {
      await pullAds(ch, Number(days) || 30, { stop, log: setLog }, tot);
      setDone(tot);
      const warning = tot.warnings?.length ? ` หมายเหตุ: ${tot.warnings.join(" · ")}` : "";
      setLog((stop.current ? "หยุดแล้ว (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)" : "ดึงข้อมูลเสร็จแล้ว") + warning);
      toast(stop.current ? "หยุดการดึงข้อมูล" : "ดึงข้อมูลโฆษณาเสร็จแล้ว");
    } catch (e) { const warning = tot.warnings?.length ? ` หมายเหตุ: ${tot.warnings.join(" · ")}` : ""; setLog(`ผิดพลาด: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"} (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)${warning}`); }
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
