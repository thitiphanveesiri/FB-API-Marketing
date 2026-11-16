// CLIENT helpers shared by the sync cards (chat pull and ads pull run from the same button).
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export interface PullCtl { stop: { current: boolean }; log: (s: string) => void }
export interface AdsTotals { ads: number; campaigns: number; rows: number; warnings?: string[] }

interface SyncResponse {
  ok?: boolean;
  message?: string;
  rateLimited?: boolean;
  next?: { phase?: string; after?: string; fallback?: boolean };
  counts?: { ads?: number; campaigns?: number; rows?: number; chats?: number; newLeads?: number; messages?: number; comments?: number };
  warning?: string;
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
export async function pullAds(channelId: string, days: number, ctl: PullCtl, tot: AdsTotals, tag = ""): Promise<void> {
  let state: { phase: string; after?: string; fallback?: boolean } = { phase: "ads" }, failures = 0;
  while (state.phase !== "done" && !ctl.stop.current) {
    ctl.log(tag + (state.phase === "ads" ? `กำลังดึงรายการโฆษณาและภาพ… (${tot.ads} โฆษณา)` : `กำลังดึงสถิติรายวัน… (${tot.rows} แถว)`));
    const r = await fetch("/api/ads-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelId, days: Math.min(90, Math.max(1, days || 30)), state }) });
    const j = await readSyncResponse(r);
    if (j.rateLimited) { for (let s = 60; s > 0 && !ctl.stop.current; s--) { ctl.log(`ระบบจำกัดคำขอ — ลองต่อใน ${s} วินาที…`); await wait(1000); } continue; }
    if (!j.ok) { if (++failures < 3 && r.status >= 500) { await wait(2000); continue; } throw new Error(j.message || "ดึงข้อมูลไม่สำเร็จ"); }
    failures = 0;
    tot.ads += j.counts?.ads ?? 0; tot.campaigns += j.counts?.campaigns ?? 0; tot.rows += j.counts?.rows ?? 0;
    if (j.warning) { tot.warnings ??= []; if (!tot.warnings.includes(j.warning)) tot.warnings.push(j.warning); }
    state = j.next?.phase ? { phase: j.next.phase, after: j.next.after, fallback: j.next.fallback } : { phase: "done" };
  }
}
