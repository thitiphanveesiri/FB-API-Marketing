// SERVER ONLY. Administrators only. Answers "why 502?" without Vercel logs: checks the Google Sheet read, every Facebook page
// token and every linked Instagram account, then reports which connection is broken and what to do about it.
import { connection, NextResponse } from "next/server";
import { adminOnly, noStore } from "@/lib/adminGate";
import { loadChannels, type Channel } from "@/lib/channels";
import { FbError, graph, metaFetchWith } from "@/lib/fbSync";

export const maxDuration = 60;
interface Check { id: string; name: string; ok: boolean; detail: string }

const graphBase = () => process.env.FB_GRAPH_BASE || "https://graph.facebook.com";

function why(e: unknown): string {
  if (!(e instanceof FbError)) return e instanceof Error ? e.message.slice(0, 160) : "ไม่ทราบสาเหตุ";
  if (e.code === 190) return "โทเคนเพจหมดอายุหรือถูกยกเลิก — ไปที่ Upload → เชื่อมช่องทางแชท → แก้ไขเพจ แล้วบันทึก Access Token ใหม่";
  if (e.code === 10 || e.code === 200) return "โทเคนนี้ไม่มีสิทธิ์กับเพจ — ต้องมี pages_read_engagement / pages_manage_metadata และ instagram_manage_messages สำหรับ IG";
  if (e.code === 100) return "ไม่พบเพจ หรือโทเคนไม่ใช่ของเพจนี้ — ตรวจว่า Page ID กับ Access Token มาจากเพจเดียวกัน";
  if (e.rateLimited) return "Meta จำกัดจำนวนคำขอชั่วคราว — รอสักครู่แล้วตรวจใหม่";
  if (e.code === 1 || e.code === 2) return "Meta ตอบช้าเกิน 8 วินาทีหรือขัดข้องชั่วคราว — ลองตรวจอีกครั้ง";
  return e.message;
}

export async function GET(req: Request) {
  await connection();
  // A failed sheet read answers here as 502 with its own reason — that alone explains a 502 on every pull.
  const g = await adminOnly(req, false); if ("err" in g) return g.err;

  let channels: Channel[] = [], sheet = "อ่าน Google Sheet ได้ปกติ (และมีสิทธิ์เขียนถ้าเคยดึงสำเร็จ)";
  try { channels = await loadChannels(true); }
  catch (e) { sheet = `อ่าน Google Sheet ไม่ได้: ${e instanceof Error ? e.message.slice(0, 160) : "ไม่ทราบสาเหตุ"}`; }

  const fb = channels.filter((c) => c.channel === "facebook" && c.active && c.accessToken && c.accountId);
  const igs = channels.filter((c) => c.channel === "instagram" && c.active && c.accountId);
  const f = metaFetchWith(8000);

  const pages = await Promise.all(fb.map(async (c): Promise<Check> => {
    try {
      const j = (await graph(encodeURIComponent(c.accountId), { fields: "name,instagram_business_account{id,username}" }, c.accessToken, f, graphBase(), 900, 1)) as { name?: string; instagram_business_account?: { id?: string; username?: string } };
      const ig = j.instagram_business_account;
      return { id: c.accountId, name: j.name || c.name || c.accountId, ok: true, detail: ig ? `โทเคนใช้ได้ · Instagram @${ig.username ?? ig.id}` : "โทเคนใช้ได้ · เพจนี้ยังไม่ผูกบัญชี Instagram" };
    } catch (e) { return { id: c.accountId, name: c.name || c.accountId, ok: false, detail: why(e) }; }
  }));

  const instagram = await Promise.all(igs.map(async (c): Promise<Check> => {
    const token = fb.find((x) => `facebook:${x.accountId}` === c.channelId)?.accessToken ?? "";
    const name = c.name || c.channelId;
    if (!token) return { id: c.accountId, name, ok: false, detail: "ไม่พบโทเคนเพจ Facebook ของเพจนี้ — เชื่อมเพจ Facebook ก่อน" };
    try {
      const j = (await graph(encodeURIComponent(c.accountId), { fields: "username" }, token, f, graphBase(), 900, 1)) as { username?: string };
      return { id: c.accountId, name, ok: true, detail: `อ่านบัญชีได้ · @${j.username ?? c.accountId}` };
    } catch (e) { return { id: c.accountId, name, ok: false, detail: why(e) }; }
  }));

  const bad = [...pages, ...instagram].filter((x) => !x.ok);
  const count = (list: Check[]) => `${list.length} รายการ (มีปัญหา ${list.filter((x) => !x.ok).length})`;
  const message = [
    `ตรวจสอบแล้ว · Google Sheet: ${sheet}`,
    `Facebook ${count(pages)}`,
    `Instagram ${count(instagram)}`,
    bad.length ? `พบปัญหา: ${bad.map((x) => `${x.name}: ${x.detail}`).join(" | ")}` : "ทุกการเชื่อมต่อปกติ — ถ้ายังได้ 502 ให้ดู Logs ของ Vercel (Deployments → Functions)",
  ].join(" · ");

  return NextResponse.json({ ok: true, message, sheet, pages, instagram }, noStore);
}
