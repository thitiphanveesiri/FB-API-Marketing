// CLIENT helpers shared by the sync cards (chat pull and ads pull run from the same button).
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export interface PullCtl { stop: { current: boolean }; log: (s: string) => void }
export interface AdsTotals { ads: number; campaigns: number; rows: number; warnings?: string[]; byPage?: Record<string, number> }

interface SyncResponse {
  ok?: boolean;
  message?: string;
  rateLimited?: boolean;
  next?: { phase?: string; after?: string; chatList?: "light" | "no-platform" | "ig-node"; igChats?: { id: string; updated_time: string }[]; commentBatch?: { id: string; url?: string; after?: string; basic?: boolean }[]; commentPostId?: string; commentPostUrl?: string; commentAfter?: string; commentsFeedDone?: boolean; commentBasic?: boolean; fallback?: boolean; tier?: number; win?: number; lim?: number };
  counts?: {
    ads?: number;
    campaigns?: number;
    rows?: number;
    chats?: number;
    newLeads?: number;
    messages?: number;
    comments?: number;
    posts?: number;
    postsWithReportedComments?: number;
    postsWithoutCommentSummary?: number;
    commentPagesRead?: number;
    commentItemsReceived?: number;
    commentsOutsideRange?: number;
    pageCommentsSkipped?: number;
  };
  warning?: string;
  byPage?: Record<string, number>;
}

export async function readSyncResponse(response: Response): Promise<SyncResponse> {
  const body = await response.text();
  try { return JSON.parse(body) as SyncResponse; }
  catch {
    const message = response.status === 504 || response.status === 524
      ? `เซิร์ฟเวอร์ใช้เวลานานเกินไป (HTTP ${response.status}) — ลดช่วงวันที่หรือดึงทีละเพจแล้วลองใหม่`
      : `เซิร์ฟเวอร์ตอบกลับไม่ใช่ JSON (HTTP ${response.status})`;
    return { ok: false, message };
  }
}

/** Pull one ad account (campaigns + ads + daily results) in small batches. Throws with Meta's message when it cannot continue;
 *  whatever was pulled before the error is already saved. */
/** Meta limits are per app + ad account. Waiting a minute helps, but waiting for ever does not: give up after this many waits and say so. */
export const MAX_RATE_WAITS = 3;

export async function pullAds(channelId: string, days: number, ctl: PullCtl, tot: AdsTotals, tag = ""): Promise<void> {
  type St = { phase: string; after?: string; fallback?: boolean; tier?: number; win?: number; lim?: number };
  let state: St = { phase: "ads" }, failures = 0, rateWaits = 0, calls = 0;
  const t0 = Date.now(), at = { ads: tot.ads, rows: tot.rows }, secs = () => Math.round((Date.now() - t0) / 1000);
  while (state.phase !== "done" && !ctl.stop.current) {
    calls++;
    // totals are shared by every ad account, so show this account's own count instead of the running sum
    const what = state.phase === "ads" ? `กำลังดึงรายการโฆษณาและภาพ… (${tot.ads - at.ads} โฆษณา)` : `กำลังดึงสถิติรายวัน… (${tot.rows - at.rows} แถว${state.win ? `, ช่วงที่ ${state.win + 1}` : ""})`;
    ctl.log(`${tag}${what} · ครั้งที่ ${calls} · ผ่านไป ${secs()} วิ`);
    const r = await fetch("/api/ads-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId, days: Math.min(90, Math.max(1, days || 30)), state }) });
    const j = await readSyncResponse(r);
    if (j.rateLimited) {
      if (++rateWaits > MAX_RATE_WAITS) throw new Error(`${j.message || "Meta จำกัดจำนวนคำขอ"} — รอ ${MAX_RATE_WAITS} รอบแล้วยังถูกจำกัด หยุดดึงเพื่อไม่ให้ค้าง ลองใหม่อีกครั้งในอีกสักพัก หรือลดช่วงย้อนหลัง (ข้อมูลที่ดึงไปแล้วถูกบันทึกไว้)`);
      for (let w = 60; w > 0 && !ctl.stop.current; w--) { ctl.log(`${tag}Meta จำกัดคำขอ — ลองต่อใน ${w} วินาที (รอบที่ ${rateWaits}/${MAX_RATE_WAITS})`); await wait(1000); }
      continue;
    }
    if (!j.ok) {
      // A timeout (504) repeats itself if the same request is sent again, so ask for something lighter; other server errors get a short retry.
      if ((r.status === 504 || r.status === 524) && ++failures < 4) { state = state.phase === "ads" ? { ...state, tier: Math.min(9, (state.tier ?? 0) + 1) } : { ...state, lim: Math.min(5, (state.lim ?? 0) + 1) }; ctl.log(`${tag}เซิร์ฟเวอร์ใช้เวลานานเกินไป — ลองใหม่ด้วยคำขอที่เบาลง`); continue; }
      if (++failures < 4 && r.status >= 500 && r.status !== 504 && r.status !== 524) { await wait(3000 * failures); continue; }
      throw new Error(j.message || "ดึงข้อมูลไม่สำเร็จ");
    }
    failures = 0;
    tot.ads += j.counts?.ads ?? 0; tot.campaigns += j.counts?.campaigns ?? 0; tot.rows += j.counts?.rows ?? 0;
    for (const [pageId, count] of Object.entries(j.byPage ?? {})) { tot.byPage ??= {}; tot.byPage[pageId] = (tot.byPage[pageId] ?? 0) + count; }
    if (j.warning) { tot.warnings ??= []; if (!tot.warnings.includes(j.warning)) tot.warnings.push(j.warning); }
    state = j.next?.phase ? { phase: j.next.phase, after: j.next.after, fallback: j.next.fallback, tier: j.next.tier, win: j.next.win, lim: j.next.lim } : { phase: "done" };
  }
  // Finished without an error but nothing came back: say so (instead of a silent "0")
  if (!ctl.stop.current && tot.ads === at.ads && tot.rows === at.rows) { tot.warnings ??= []; tot.warnings.push(`${tag.replace(/ · $/, "") || "บัญชีนี้"}: ดึงเสร็จแล้วแต่ไม่ได้ข้อมูลเลย (0 โฆษณา 0 แถว) — ดูเหตุผลที่ระบบแจ้งไว้ในหมายเหตุ`); }
  else if (!ctl.stop.current && tot.ads > at.ads && tot.rows === at.rows) { tot.warnings ??= []; tot.warnings.push(`${tag.replace(/ · $/, "") || "บัญชีนี้"}: ได้รายการโฆษณาแต่ไม่มีสถิติรายวันในช่วง ${days} วันที่เลือก (อาจไม่มียอดใช้จ่ายในช่วงนี้) — ลองขยายช่วงย้อนหลัง`); }
}
