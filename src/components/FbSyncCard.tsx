"use client";
import { useEffect, useRef, useState } from "react";
import { Images, MessageCircle, MessageSquare, RefreshCw, Share2, ShieldCheck } from "lucide-react";
import { Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";
import { type AdsTotals, MAX_RATE_WAITS, pullAds, readSyncResponse, wait } from "@/lib/syncClient";
import { refreshCreativeLinks } from "@/lib/creativeClient";

interface Cfg { fbPageId: string; sheetPageId: string; name?: string; instagram?: boolean }
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
interface Totals {
  chats: number;
  newLeads: number;
  messages: number;
  comments: number;
  posts?: number;
  postsWithReportedComments: number;
  postsWithoutCommentSummary: number;
  commentPagesRead: number;
  commentItemsReceived: number;
  commentsOutsideRange: number;
  pageCommentsSkipped: number;
  warnings?: string[];
}
interface Acct { channelId: string; name: string; accountId: string }

type SyncTarget = "all" | "ads" | "chats" | "comments";
type PlatformFilter = "all" | "facebook" | "instagram";

/** Administrators only: pull chats + comments (with their times) straight from the Facebook Page into the Google Sheet. */
export default function FbSyncCard() {
  const { data, user, reloadData, toast } = useStore();
  const [pages, setPages] = useState<Cfg[] | null>(null);
  const [which, setWhich] = useState("all"); const [days, setDays] = useState("7");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(""); const [done, setDone] = useState<Totals | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [ads, setAds] = useState<Acct[]>([]); const [withAds, setWithAds] = useState(true); const [adsDone, setAdsDone] = useState<AdsTotals | null>(null);
  const [picBusy, setPicBusy] = useState(false); const [picNote, setPicNote] = useState("");
  const [cfgError, setCfgError] = useState(""); const [acctError, setAcctError] = useState("");
  const stop = useRef(false);

  useEffect(() => {
    if (user.role !== "Administrator") return;
    let live = true;
    fetch("/api/fb-sync", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!live) return;
      setPages(j.ok ? j.pages : []);
      setCfgError(j.ok ? "" : j.message || `อ่านรายการเพจไม่สำเร็จ (HTTP ${j.status ?? 0})`);
    }).catch((e) => { if (live) { setPages([]); setCfgError(e instanceof Error ? `เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ${e.message}` : "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"); } });
    fetch("/api/ads-sync", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!live) return;
      if (j.ok) { setAds(j.accounts); setAcctError(""); }
      else setAcctError(j.message || "อ่านรายการบัญชีโฆษณาไม่สำเร็จ");
    }).catch((e) => { if (live) setAcctError(e instanceof Error ? e.message : "อ่านรายการบัญชีโฆษณาไม่สำเร็จ"); });
    return () => { live = false; };
  }, [user.role]);
  if (user.role !== "Administrator" || pages === null) return null;

  const sysName = (id: string) => data.pages.find((x) => x.id === id)?.name ?? id;
  /** Each Facebook page is filed under the system page it was connected to; if none was chosen, a system page with the same name is used. */
  const resolved = pages.map((p) => {
    const nameMatches = p.name ? data.pages.filter((x) => norm(x.name) === norm(p.name!)) : [];
    const byName = nameMatches.length === 1 ? nameMatches[0] : undefined;
    const sheet = (p.sheetPageId && data.pages.some((x) => x.id === p.sheetPageId) ? p.sheetPageId : "") || byName?.id || "";
    return { fb: p.fbPageId, instagram: !!p.instagram, sheet, label: p.name || (sheet ? sysName(sheet) : "") || `เพจ ${p.fbPageId}` };
  });
  const chosen = which === "all" ? resolved : resolved.filter((r) => r.fb === which);
  const igCount = chosen.filter((r) => r.instagram).length;
  /** Chats, comments, or ads of the chosen pages/accounts. */
  const run = async (target: SyncTarget = "all") => {
    if (target !== "ads" && !chosen.length) return;
    if (target === "ads" && !ads.length) {
      setLog("ไม่มีบัญชีโฆษณาที่เชื่อมต่ออยู่");
      return;
    }
    stop.current = false; setBusy(true); setDone(null); setAdsDone(null); setNotes([]);
    // The list was read when this page opened; a page can be disconnected since then and the server would answer "not configured".
    // So re-read it before starting: pull only the pages that are still connected, and say which ones were skipped.
    const live = await fetch("/api/fb-sync", { cache: "no-store" }).then((r) => r.json() as Promise<{ ok?: boolean; pages?: Cfg[] }>).catch(() => null);
    let targets = chosen, skipped: string[] = [];
    if (live?.ok && Array.isArray(live.pages)) {
      setPages(live.pages);
      const byId = new Map(live.pages.map((p) => [p.fbPageId, p]));
      skipped = chosen.filter((t) => !byId.has(t.fb)).map((t) => t.label);
      targets = chosen.filter((t) => byId.has(t.fb)).map((t) => {
        const p = byId.get(t.fb)!;
        return { ...t, instagram: !!p.instagram, sheet: p.sheetPageId && data.pages.some((x) => x.id === p.sheetPageId) ? p.sheetPageId : t.sheet };
      });
    }
    if (target !== "ads" && !targets.length) { setBusy(false); setLog("เพจที่เลือกถูกยกเลิกการเชื่อมต่อแล้ว — เชื่อมเพจใหม่ที่การ์ดด้านบน หรือรีเฟรชหน้านี้ก่อนดึงข้อมูล"); return; }
    if (platform === "instagram") {
      targets = targets.filter((t) => t.instagram);
      if (target !== "ads" && !targets.length) { setBusy(false); setLog("ไม่มีเพจที่เชื่อม Instagram ในรายการที่เลือก — เชื่อมเพจที่ผูกบัญชี Instagram Business ด้วยโทเคนผู้ใช้ในการ์ด “เชื่อมช่องทางแชท” ก่อน แล้วกดตรวจสอบการเชื่อมต่อ"); return; }
    }
    const tot: Totals = { chats: 0, newLeads: 0, messages: 0, comments: 0, posts: 0, postsWithReportedComments: 0, postsWithoutCommentSummary: 0, commentPagesRead: 0, commentItemsReceived: 0, commentsOutsideRange: 0, pageCommentsSkipped: 0 }, adsTot: AdsTotals = { ads: 0, campaigns: 0, rows: 0, warnings: [], byPage: {} };
    const failed: string[] = [];
    try {
      if (target !== "ads") {
        for (const [n, t] of targets.entries()) {
          if (stop.current) break;
          const tag = targets.length > 1 ? `[${n + 1}/${targets.length}] ${t.label} · ` : `${t.label} · `;
          const scope = target === "chats" ? "chats" : target === "comments" ? "comments" : "all";
          if (platform !== "instagram") {
            try { await pull(t.fb, t.sheet, tot, tag, undefined, scope); } catch (e) { failed.push(`${t.label}: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`); }
          }
          // the Instagram account linked to this page: its direct messages/comments are pulled right after the page
          if (t.instagram && platform !== "facebook" && !stop.current) {
            try { await pull(t.fb, t.sheet, tot, `${tag}Instagram · `, "instagram", scope); } catch (e) { failed.push(`${t.label} (Instagram): ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`); }
          }
        }
      }
      // ads: once per ad account (an account can serve several pages; each ad is filed under the page it posts as)
      if ((target === "ads" || (target === "all" && withAds)) && ads.length && !stop.current) {
        for (const [n, a] of ads.entries()) {
          if (stop.current) break;
          try { await pullAds(a.channelId, Number(days) || 30, { stop, log: setLog }, adsTot, ads.length > 1 ? `[โฆษณา ${n + 1}/${ads.length}] ${a.name || a.accountId} · ` : "โฆษณา · "); }
          catch (e) { failed.push(`โฆษณา ${a.name || a.accountId}: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`); }
        }
        setAdsDone(adsTot);
      }
      if (target !== "ads") setDone(tot);
      setNotes([...(skipped.length ? [`ข้ามเพจที่ถูกยกเลิกการเชื่อมต่อไปแล้ว: ${skipped.join(", ")}`] : []), ...[...(tot.warnings ?? []), ...(adsTot.warnings ?? [])].filter((n, i, all) => all.indexOf(n) === i)]);
      setLog(failed.length ? `เสร็จบางเพจ — ผิดพลาด: ${failed.join(" | ")} (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้) · กด “ตรวจสอบการเชื่อมต่อ” เพื่อดูว่า Sheet หรือโทเคนเพจมีปัญหา` : stop.current ? "หยุดแล้ว (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)" : "ดึงข้อมูลเสร็จแล้ว");
      toast(failed.length ? "ดึงบางส่วนไม่สำเร็จ" : stop.current ? "หยุดการดึงข้อมูล" : "ดึงข้อมูลเสร็จเรียบร้อยแล้ว");
    } finally { setBusy(false); await reloadData(true); }
  };
  /** Tells which connection is broken (Sheet / page token / Instagram) before - or instead of - guessing why a pull answered 502. */
  const checkConnections = async () => {
    setChecking(true); setLog("กำลังตรวจสอบการเชื่อมต่อ (Google Sheet + โทเคนเพจ + Instagram)…");
    try {
      const r = await fetch("/api/fb-sync/health", { cache: "no-store" });
      const j = await readSyncResponse(r);
      setLog(j.ok ? j.message || "ตรวจสอบเสร็จแล้ว" : `ตรวจสอบไม่สำเร็จ: ${j.message || `HTTP ${r.status}`}`);
    } catch (e) {
      setLog(`ตรวจสอบไม่สำเร็จ: ${e instanceof Error ? e.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"}`);
    } finally { setChecking(false); }
  };

  // Re-read ad image links from Meta for ads whose temporary links have expired
  const refreshPics = async () => {
    setPicBusy(true); setPicNote("");
    try {
      const r = await refreshCreativeLinks();
      setPicNote(r.fixed ? `ต่อลิงก์รูปใหม่ให้ ${r.fixed} โฆษณา จาก ${r.checked} โฆษณาที่ลิงก์หมดอายุ (บันทึกใส่ Google Sheet แล้ว)` : (r.message ?? "ไม่พบลิงก์ที่หมดอายุ — ถ้ารูปยังไม่ขึ้น ให้ดึงข้อมูลโฆษณาซ้ำ"));
      if (r.fixed) await reloadData(true);
    } finally { setPicBusy(false); }
  };
  const pull = async (fbId: string, sheetId: string, tot: Totals, tag: string, channel?: "instagram", scope: "all" | "chats" | "comments" = "all") => {
    // Instagram listing can burn both node timeouts per attempt, so it gets one retry instead of three.
    const maxFailures = channel ? 2 : 4;
    const initialPhase = scope === "comments" ? "comments" : "chats";
    let state: { phase: string; after?: string; chatList?: "light" | "no-platform" | "ig-node"; igChats?: { id: string; updated_time: string }[]; commentBatch?: { id: string; url?: string; after?: string; basic?: boolean }[]; commentPostId?: string; commentPostUrl?: string; commentAfter?: string; commentsFeedDone?: boolean; commentBasic?: boolean } = { phase: initialPhase }, failures = 0, rateWaits = 0, commentSteps = 0;
    {
      while (state.phase !== "done" && !stop.current) {
        if (state.phase === "comments") commentSteps++;
        setLog(tag + (state.phase === "chats" ? `กำลังดึงแชท… (${tot.chats} แชท, ${tot.messages} ข้อความ)` : `กำลังดึงคอมเมนต์… (${tot.posts ?? 0} โพสต์, ${tot.comments} คอมเมนต์ · ชุดที่ ${commentSteps})`));
        const r = await fetch("/api/fb-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fbPageId: fbId, sheetPageId: sheetId || undefined, days: Number(days) || 7, state, scope, ...(channel ? { channel } : {}) }) });
        const j = await readSyncResponse(r);
        if (j.rateLimited) {
          if (++rateWaits > MAX_RATE_WAITS) throw new Error(`${j.message || "Meta จำกัดจำนวนคำขอ"} — รอ ${MAX_RATE_WAITS} รอบแล้วยังถูกจำกัด หยุดดึงเพื่อไม่ให้ค้าง ลองใหม่อีกครั้งในอีกสักพัก (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)`);
          for (let s = 60; s > 0 && !stop.current; s--) { setLog(`${tag}Meta จำกัดคำขอ — ลองต่อใน ${s} วินาที (รอบที่ ${rateWaits}/${MAX_RATE_WAITS})`); await wait(1000); }
          continue;
        }
        if (!j.ok) {
          if (++failures < maxFailures && r.status >= 500) {
            const delay = 3000 * failures;
            setLog(`${tag}เซิร์ฟเวอร์ตอบ HTTP ${r.status} — ลองใหม่ ${failures}/${maxFailures - 1} ใน ${delay / 1000} วินาที`);
            await wait(delay);
            continue;
          }
          throw new Error(j.message || "ดึงข้อมูลไม่สำเร็จ");
        }
        failures = 0; if (j.warning) { tot.warnings ??= []; if (!tot.warnings.includes(j.warning)) tot.warnings.push(j.warning); } tot.chats += j.counts?.chats ?? 0; tot.newLeads += j.counts?.newLeads ?? 0; tot.messages += j.counts?.messages ?? 0; tot.comments += j.counts?.comments ?? 0; tot.posts = (tot.posts ?? 0) + (j.counts?.posts ?? 0); tot.postsWithReportedComments += j.counts?.postsWithReportedComments ?? 0; tot.postsWithoutCommentSummary += j.counts?.postsWithoutCommentSummary ?? 0; tot.commentPagesRead += j.counts?.commentPagesRead ?? 0; tot.commentItemsReceived += j.counts?.commentItemsReceived ?? 0; tot.commentsOutsideRange += j.counts?.commentsOutsideRange ?? 0; tot.pageCommentsSkipped += j.counts?.pageCommentsSkipped ?? 0; state = { phase: j.next?.phase ?? "done", after: j.next?.after, chatList: j.next?.chatList, igChats: j.next?.igChats, commentBatch: j.next?.commentBatch, commentPostId: j.next?.commentPostId, commentPostUrl: j.next?.commentPostUrl, commentAfter: j.next?.commentAfter, commentsFeedDone: j.next?.commentsFeedDone, commentBasic: j.next?.commentBasic };
      }
    }
  };

  return (
    <Card title="ดึงข้อมูลจาก Facebook / Meta โดยตรง" subtitle="แยกดึงได้ตามประเภทข้อมูล: โฆษณาและเพจ, แชท Inbox, โพสต์และคอมเมนต์ พร้อมระบุแพลตฟอร์มและเพจที่ต้องการ">
      {pages.length === 0 ? (
        cfgError
          ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{cfgError}</p>
          : <p className="text-sm text-muted">ยังไม่ได้เชื่อมเพจ: วาง Access Token ในการ์ด “เชื่อมช่องทางแชท” ด้านบน หรือเพิ่มตัวแปร <b>FB_PAGE_ID</b> และ <b>FB_PAGE_TOKEN</b> ใน Vercel (Settings → Environment Variables) แล้ว Redeploy — ดูขั้นตอนใน docs/DEPLOY.md หัวข้อ 6c</p>
      ) : (
        <div className="space-y-4">
          {/* Controls: Page filter, Platform filter, Date range */}
          <div className="flex flex-wrap items-end gap-2.5 rounded-xl border border-line bg-gray-50/50 p-3">
            {pages.length > 1 && (
              <Select
                label="เพจเป้าหมาย"
                value={which}
                onChange={setWhich}
                options={[{ value: "all", label: `ทุกเพจ (${pages.length})` }, ...resolved.map((r) => ({ value: r.fb, label: r.label }))]}
                disabled={busy}
              />
            )}
            <Select
              label="แพลตฟอร์ม"
              value={platform}
              onChange={(val) => setPlatform(val as PlatformFilter)}
              options={[
                { value: "all", label: "ทุกแพลตฟอร์ม (Facebook + Instagram)" },
                { value: "facebook", label: "Facebook อย่างเดียว" },
                { value: "instagram", label: igCount > 0 ? `Instagram อย่างเดียว (${igCount} เพจที่มี IG)` : "Instagram อย่างเดียว (ยังไม่มีเพจเชื่อม IG)" },
              ]}
              disabled={busy}
            />
            <Select
              label="ย้อนหลัง"
              value={days}
              onChange={setDays}
              options={[{ value: "3", label: "3 วัน" }, { value: "7", label: "7 วัน" }, { value: "14", label: "14 วัน" }, { value: "30", label: "30 วัน" }, { value: "60", label: "60 วัน" }, { value: "90", label: "90 วัน" }]}
              disabled={busy}
            />
            <Btn onClick={() => void checkConnections()} disabled={busy || checking} className="ml-auto">
              <ShieldCheck size={14} className={checking ? "animate-pulse" : ""} /> {checking ? "กำลังตรวจสอบ…" : "ตรวจสอบการเชื่อมต่อ"}
            </Btn>
            <Btn onClick={refreshPics} disabled={busy || picBusy} title="ดึงลิงก์รูปโฆษณาใหม่จาก Meta สำหรับโฆษณาที่ลิงก์เดิมหมดอายุ">
              <Images size={14} className={picBusy ? "animate-spin" : ""} /> {picBusy ? "กำลังรีเฟรช…" : "รีเฟรชรูปโฆษณา"}
            </Btn>
            {busy && <Btn variant="danger" onClick={() => { stop.current = true; }}>หยุดการทำงาน</Btn>}
          </div>

          {/* Action Buttons: 3 Separated Buttons + Pull All */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col justify-between rounded-xl border border-line p-3 hover:bg-gray-50/80">
              <div className="mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">1. Ads & Page</span>
                <p className="text-sm font-medium">ดึง Ads และข้อมูลเพจ</p>
                <p className="text-xs text-muted">ดึงสถิติโฆษณา แคมเปญ ผลลัพธ์รายวัน และตรวจสร้าง/อัปเดตเพจ</p>
              </div>
              <Btn
                variant="primary"
                onClick={() => void run("ads")}
                disabled={busy || checking || ads.length === 0}
                className="w-full justify-center"
              >
                <Share2 size={14} /> ดึง Ads & เพจ
              </Btn>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-line p-3 hover:bg-gray-50/80">
              <div className="mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">2. Chat & Inbox</span>
                <p className="text-sm font-medium">ดึงแชท</p>
                <p className="text-xs text-muted">ดึงข้อความแชทรายข้อความ และสร้าง/อัปเดตลีด ({which === "all" ? "ทุกเพจ" : "เพจที่เลือก"}, {platform === "all" ? "ทุกแพลตฟอร์ม" : platform})</p>
              </div>
              <Btn
                variant="primary"
                onClick={() => void run("chats")}
                disabled={busy || checking || (platform === "instagram" && igCount === 0)}
                className="w-full justify-center"
              >
                <MessageSquare size={14} /> ดึงแชท
              </Btn>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-line p-3 hover:bg-gray-50/80">
              <div className="mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">3. Posts & Comments</span>
                <p className="text-sm font-medium">ดึงโพสต์ + Comment</p>
                <p className="text-xs text-muted">ดึงโพสต์และคอมเมนต์ใต้โพสต์พร้อมเวลาตอบ เพื่อคิดคะแนน SLA</p>
              </div>
              <Btn
                variant="primary"
                onClick={() => void run("comments")}
                disabled={busy || checking || (platform === "instagram" && igCount === 0)}
                className="w-full justify-center"
              >
                <MessageCircle size={14} /> ดึงโพสต์ + Comment
              </Btn>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-line bg-brand-faint/30 p-3 hover:bg-brand-faint/50">
              <div className="mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-brand">ทั้งหมด</span>
                <p className="text-sm font-medium">ดึงข้อมูลทั้งหมด</p>
                <p className="text-xs text-muted">ดึงทั้ง Ads, แชท และโพสต์+คอมเมนต์ในรอบเดียว</p>
              </div>
              <Btn
                onClick={() => void run("all")}
                disabled={busy || checking || (platform === "instagram" && igCount === 0)}
                className="w-full justify-center"
              >
                <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "กำลังดึง…" : "ดึงทั้งหมด"}
              </Btn>
            </div>
          </div>

          {/* Action Buttons: 3 Separated Buttons + Pull All */}

          {acctError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">อ่านรายการบัญชีโฆษณาไม่สำเร็จ: {acctError} (แชทและคอมเมนต์ยังดึงได้ตามปกติ)</p>}
          {ads.length > 0 ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={withAds} onChange={(e) => setWithAds(e.target.checked)} disabled={busy} className="accent-[#087a58]" />
              เมื่อกด “ดึงทั้งหมด” ให้ดึงโฆษณาพร้อมกันด้วย ({ads.length} บัญชี: {ads.map((a) => a.name || a.accountId).join(", ")})
            </label>
          ) : !acctError && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ยังไม่ได้เชื่อมบัญชีโฆษณา จึงไม่มีข้อมูลโฆษณา — วาง <b>โทเคนผู้ใช้ที่มีสิทธิ์ ads_read</b> ในการ์ด “เชื่อมช่องทางแชท” หรือกรอก Ad Account ID ในการ์ดโฆษณาด้านล่าง
            </p>
          )}

          {log && <p className="text-sm font-medium text-brand" role="status">{log}</p>}
          {picNote && <p className="text-xs text-muted" role="status">{picNote}</p>}
          {notes.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
              <p className="font-medium">หมายเหตุ</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
          {done && (
            <p className="rounded-lg bg-brand-faint px-3 py-2 text-sm">
              ได้ {done.chats} แชท ({done.messages} ข้อความ, ลีดใหม่ {done.newLeads}) และ {done.comments} คอมเมนต์จาก {done.posts ?? 0} โพสต์{done.comments === 0 ? ` · Meta รายงานโพสต์มีคอมเมนต์ ${done.postsWithReportedComments} โพสต์ (ไม่มี summary ${done.postsWithoutCommentSummary}); อ่านคอมเมนต์ ${done.commentItemsReceived} รายการจาก ${done.commentPagesRead} หน้า (เกินช่วงวันที่เลือก ${done.commentsOutsideRange}, เพจตอบเอง ${done.pageCommentsSkipped})` : ""}{adsDone ? ` · โฆษณา ${adsDone.ads} รายการ (${adsDone.campaigns} แคมเปญ) สถิติรายวัน ${adsDone.rows} แถว` : ""}{adsDone?.byPage && Object.keys(adsDone.byPage).length ? ` · โฆษณาแยกตามเพจ: ${Object.entries(adsDone.byPage).map(([id, count]) => `${sysName(id)} ${count}`).join(", ")}` : ""} · ไปดูผลที่หน้า <b>SLA</b> หรือ <b>Board</b>
            </p>
          )}
          {!done && adsDone && (
            <p className="rounded-lg bg-brand-faint px-3 py-2 text-sm">
              โฆษณา {adsDone.ads} รายการ ({adsDone.campaigns} แคมเปญ) สถิติรายวัน {adsDone.rows} แถว{adsDone?.byPage && Object.keys(adsDone.byPage).length ? ` · โฆษณาแยกตามเพจ: ${Object.entries(adsDone.byPage).map(([id, count]) => `${sysName(id)} ${count}`).join(", ")}` : ""} · ดูผลได้ที่หน้า <b>Dashboard → Ads</b>
            </p>
          )}
          <p className="text-xs text-muted">ครั้งแรกเริ่มที่ 7 วันก่อนเพื่อทดสอบ · ดึงซ้ำได้ ข้อความเดิมจะไม่ซ้ำ · แชทจะถูกจับคู่กับลีดเดิมด้วยชื่อลูกค้า (ถ้าชื่อซ้ำกันหลายคนจะสร้างลีดใหม่) · จำนวนโพสต์รวมเผื่อย้อนหลังอีก 14 วันเพื่อเก็บคอมเมนต์ในช่วงที่เลือกจากโพสต์เก่า</p>
        </div>
      )}
    </Card>
  );
}
