"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";
import { type AdsTotals, pullAds, readSyncResponse, wait } from "@/lib/syncClient";

interface Cfg { fbPageId: string; sheetPageId: string; name?: string }
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
interface Totals { chats: number; newLeads: number; messages: number; comments: number }
interface Acct { channelId: string; name: string; accountId: string }

/** Administrators only: pull chats + comments (with their times) straight from the Facebook Page into the Google Sheet. */
export default function FbSyncCard() {
  const { data, user, reloadData, toast } = useStore();
  const [pages, setPages] = useState<Cfg[] | null>(null);
  const [which, setWhich] = useState("all"); const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(""); const [done, setDone] = useState<Totals | null>(null);
  const [ads, setAds] = useState<Acct[]>([]); const [withAds, setWithAds] = useState(true); const [adsDone, setAdsDone] = useState<AdsTotals | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    if (user.role !== "Administrator") return;
    let live = true;
    fetch("/api/fb-sync", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!live) return; setPages(j.ok ? j.pages : []);
    }).catch(() => live && setPages([]));
    fetch("/api/ads-sync", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (live && j.ok) setAds(j.accounts); }).catch(() => undefined);
    return () => { live = false; };
  }, [user.role]);
  if (user.role !== "Administrator" || pages === null) return null;

  const sysName = (id: string) => data.pages.find((x) => x.id === id)?.name ?? id;
  /** Each Facebook page is filed under the system page it was connected to; if none was chosen, a system page with the same name is used. */
  const resolved = pages.map((p) => {
    const nameMatches = p.name ? data.pages.filter((x) => norm(x.name) === norm(p.name!)) : [];
    const byName = nameMatches.length === 1 ? nameMatches[0] : undefined;
    const sheet = (p.sheetPageId && data.pages.some((x) => x.id === p.sheetPageId) ? p.sheetPageId : "") || byName?.id || "";
    return { fb: p.fbPageId, sheet, label: p.name || (sheet ? sysName(sheet) : "") || p.fbPageId };
  });
  const chosen = which === "all" ? resolved : resolved.filter((r) => r.fb === which);
  /** Chats + comments of the chosen pages (one after another, each in its own small batches so one page cannot time out another), then the ad accounts. */
  const run = async () => {
    const skipped = chosen.filter((t) => !t.sheet), targets = chosen.filter((t) => t.sheet);
    if (!targets.length) { toast("เพจนี้ยังไม่ได้ผูกกับเพจในระบบ — เชื่อมใหม่ในการ์ด “เชื่อมช่องทางแชท” (เลือกเพจในระบบ) ก่อน"); return; }
    stop.current = false; setBusy(true); setDone(null); setAdsDone(null);
    const tot: Totals = { chats: 0, newLeads: 0, messages: 0, comments: 0 }, adsTot: AdsTotals = { ads: 0, campaigns: 0, rows: 0, warnings: [] };
    const failed: string[] = [];
    try {
      for (const [n, t] of targets.entries()) {
        if (stop.current) break;
        const tag = targets.length > 1 ? `[${n + 1}/${targets.length}] ${t.label} · ` : `${t.label} · `;
        try { await pull(t.fb, t.sheet, tot, tag); } catch (e) { failed.push(`${t.label}: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`); }
      }
      // ads: once per ad account (an account can serve several pages; each ad is filed under the page it posts as)
      if (withAds && ads.length && !stop.current) {
        for (const [n, a] of ads.entries()) {
          if (stop.current) break;
          try { await pullAds(a.channelId, Number(days) || 30, { stop, log: setLog }, adsTot, ads.length > 1 ? `[โฆษณา ${n + 1}/${ads.length}] ${a.name || a.accountId} · ` : "โฆษณา · "); }
          catch (e) { failed.push(`โฆษณา ${a.name || a.accountId}: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`); }
        }
        setAdsDone(adsTot);
      }
      setDone(tot);
      const warning = (adsTot.warnings?.length ? ` หมายเหตุ: ${adsTot.warnings.join(" · ")}` : "") + (skipped.length ? ` · ข้ามเพจที่ยังไม่ได้ผูกกับเพจในระบบ: ${skipped.map((t) => t.label).join(", ")}` : "");
      setLog((failed.length ? `เสร็จบางเพจ — ผิดพลาด: ${failed.join(" | ")} (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)` : stop.current ? "หยุดแล้ว (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)" : "ดึงข้อมูลเสร็จแล้ว") + warning);
      toast(failed.length ? "ดึงบางเพจไม่สำเร็จ" : stop.current ? "หยุดการดึงข้อมูล" : "ดึงข้อมูลจากเพจเสร็จแล้ว");
    } finally { setBusy(false); await reloadData(true); }
  };
  const pull = async (fbId: string, sheetId: string, tot: Totals, tag: string) => {
    let state: { phase: string; after?: string } = { phase: "chats" }, failures = 0;
    {
      while (state.phase !== "done" && !stop.current) {
        setLog(tag + (state.phase === "chats" ? `กำลังดึงแชท… (${tot.chats} แชท, ${tot.messages} ข้อความ)` : `กำลังดึงคอมเมนต์… (${tot.comments} คอมเมนต์)`));
        const r = await fetch("/api/fb-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fbPageId: fbId, sheetPageId: sheetId, days: Number(days) || 7, state }) });
        const j = await readSyncResponse(r);
        if (j.rateLimited) { for (let s = 60; s > 0 && !stop.current; s--) { setLog(`ระบบจำกัดคำขอ — ลองต่อใน ${s} วินาที…`); await wait(1000); } continue; }
        if (!j.ok) { if (++failures < 3 && r.status >= 500) { await wait(2000); continue; } throw new Error(j.message || "ดึงข้อมูลไม่สำเร็จ"); }
        failures = 0; tot.chats += j.counts?.chats ?? 0; tot.newLeads += j.counts?.newLeads ?? 0; tot.messages += j.counts?.messages ?? 0; tot.comments += j.counts?.comments ?? 0; state = { phase: j.next?.phase ?? "done", after: j.next?.after };
      }
    }
  };

  return (
    <Card title="ดึงข้อมูลจาก Facebook โดยตรง (แชท + คอมเมนต์ + โฆษณา)" subtitle="กดครั้งเดียวได้แชททีละข้อความ คอมเมนต์ พร้อมเวลา (ใช้คิดคะแนน SLA) และสถิติโฆษณา โดยไม่ต้องอัปโหลดไฟล์">
      {pages.length === 0 ? (
        <p className="text-sm text-muted">ยังไม่ได้เชื่อมเพจ: วาง Access Token ในการ์ด “เชื่อมช่องทางแชท” ด้านบน หรือเพิ่มตัวแปร <b>FB_PAGE_ID</b> และ <b>FB_PAGE_TOKEN</b> ใน Vercel (Settings → Environment Variables) แล้ว Redeploy — ดูขั้นตอนใน docs/DEPLOY.md หัวข้อ 6c</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            {pages.length > 1 && <Select label="เพจ Facebook" value={which} onChange={setWhich} options={[{ value: "all", label: `ทุกเพจ (${pages.length})` }, ...resolved.map((r) => ({ value: r.fb, label: r.label }))]} disabled={busy} />}
            <Select label="ย้อนหลัง" value={days} onChange={setDays} options={[{ value: "3", label: "3 วัน" }, { value: "7", label: "7 วัน" }, { value: "14", label: "14 วัน" }, { value: "30", label: "30 วัน" }, { value: "60", label: "60 วัน" }, { value: "90", label: "90 วัน" }]} disabled={busy} />
            <Btn variant="primary" onClick={() => void run()} disabled={busy}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "กำลังดึง…" : which === "all" && pages.length > 1 ? "ดึงข้อมูลทั้งหมด" : "ดึงข้อมูลตอนนี้"}</Btn>
            {busy && <Btn onClick={() => { stop.current = true; }}>หยุด</Btn>}
          </div>
          {ads.length > 0
            ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withAds} onChange={(e) => setWithAds(e.target.checked)} disabled={busy} className="accent-[#087a58]" /> ดึงโฆษณาพร้อมกัน ({ads.length} บัญชี: {ads.map((a) => a.name || a.accountId).join(", ")}) · ย้อนหลังตามช่วงที่เลือก (สูงสุด 90 วัน)</label>
            : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">ยังไม่ได้เชื่อมบัญชีโฆษณา จึงไม่มีข้อมูลโฆษณา (Dashboard โฆษณาจะว่าง) — วาง <b>โทเคนผู้ใช้ที่มีสิทธิ์ ads_read</b> ในการ์ด “เชื่อมช่องทางแชท” ระบบจะเชื่อมบัญชีโฆษณาให้เองพร้อมเพจ หรือกรอก Ad Account ID เองในการ์ดโฆษณาด้านล่าง</p>}
          {chosen.some((t) => !t.sheet) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">ยังไม่ได้ผูกกับเพจในระบบ (จะถูกข้าม): {chosen.filter((t) => !t.sheet).map((t) => t.label).join(", ")} — เชื่อมใหม่ในการ์ด “เชื่อมช่องทางแชท”</p>}
          {log && <p className="text-sm" role="status">{log}</p>}
          {done && <p className="rounded-lg bg-brand-faint px-3 py-2 text-sm">ได้ {done.chats} แชท ({done.messages} ข้อความ, ลีดใหม่ {done.newLeads}) และ {done.comments} คอมเมนต์{adsDone ? ` · โฆษณา ${adsDone.ads} รายการ (${adsDone.campaigns} แคมเปญ) สถิติรายวัน ${adsDone.rows} แถว` : ""} · ไปดูผลที่หน้า <b>SLA</b> (ต้องมอบหมายเซลล์ให้แต่ละแชทที่หน้า Board ก่อน จึงจะมีคะแนน)</p>}
          <p className="text-xs text-muted">ครั้งแรกเริ่มที่ 7 วันก่อนเพื่อทดสอบ · ดึงซ้ำได้ ข้อความเดิมจะไม่ซ้ำ · แชทจะถูกจับคู่กับลีดเดิมด้วยชื่อลูกค้า (ถ้าชื่อซ้ำกันหลายคนจะสร้างลีดใหม่)</p>
        </div>
      )}
    </Card>
  );
}
