// Chat helper: answers questions about ads, pages and sales reps from the data already loaded (and already scoped to the user's role).
// Every number is computed here from the data, never guessed by an AI. A question it cannot place gets a help text with examples.
import type { Dataset } from "./dataset";
import { addDays } from "./dates";
import { aggregate, derive, fmtInt, fmtMins, fmtMoney, fmtPct, leadStats, salesRows } from "./metrics";
import { pageOfAd } from "./queries";

export interface Question { period: { start: string; end: string; label: string }; threshold?: { op: ">" | "<"; n: number }; text: string }

const num = (s: string) => Number(s.replace(/,/g, ""));
const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/** Reads the period out of the words ("วันนี้", "7 วัน", "เดือนนี้" …); default is the last 30 days. */
export function parseQuestion(text: string, today: string): Question {
  const t = text.toLowerCase();
  let start = addDays(today, -29), end = today, label = "30 วันล่าสุด";
  const days = /(\d{1,3})\s*(วัน|day)/.exec(t);
  if (has(t, "เมื่อวาน", "yesterday")) { start = end = addDays(today, -1); label = "เมื่อวาน"; }
  else if (has(t, "วันนี้", "today")) { start = end = today; label = "วันนี้"; }
  else if (has(t, "เดือนที่แล้ว", "last month")) {
    const first = `${today.slice(0, 7)}-01`; end = addDays(first, -1); start = `${end.slice(0, 7)}-01`; label = "เดือนที่แล้ว";
  } else if (has(t, "เดือนนี้", "this month")) { start = `${today.slice(0, 7)}-01`; label = "เดือนนี้"; }
  else if (has(t, "สัปดาห์", "อาทิตย์", "week")) { start = addDays(today, -6); label = "7 วันล่าสุด"; }
  else if (days) { const n = Math.min(365, Math.max(1, Number(days[1]))); start = addDays(today, -(n - 1)); label = `${n} วันล่าสุด`; }
  const th = /(มากกว่า|เกิน|สูงกว่า|over|more than|>)\s*([\d,]+)|(น้อยกว่า|ต่ำกว่า|under|less than|<)\s*([\d,]+)/.exec(t);
  const threshold = th ? (th[2] ? { op: ">" as const, n: num(th[2]) } : { op: "<" as const, n: num(th[4]) }) : undefined;
  return { period: { start, end, label }, threshold, text: t };
}

const inRange = (d: string, q: Question) => d >= q.period.start && d <= q.period.end;
const longestFirst = <T extends { name: string }>(xs: T[]) => [...xs].filter((x) => x.name.trim().length >= 2).sort((a, b) => b.name.length - a.name.length);

export const HELP = [
  "ถามได้เช่น:",
  "• ภาพรวมแอดทั้งหมด 30 วัน",
  "• แอด <ชื่อหรือรหัสแอด> ใช้เงินเท่าไหร่ ได้กี่ลีด",
  "• เพจ <ชื่อเพจ> ยิงแอดไปเท่าไหร่",
  "• เซลล์คนไหนตอบช้า / ตอบเร็ว / ปิดการขายได้",
  "• แอดที่ใช้เงินมากกว่า 5000 เดือนนี้",
  "• แอดไหนต้นทุนต่อแชทน้อยที่สุด",
].join("\n");

export function answer(text: string, d: Dataset, today: string): string {
  const q = parseQuestion(text, today);
  const t = q.text;
  const ads = d.ads, campaigns = new Map(d.campaigns.map((c) => [c.id, c]));
  const perf = d.perf.filter((p) => inRange(p.date, q));
  const leads = d.leads.filter((l) => inRange(l.createdAt, q));
  const head = `(${q.period.label}: ${q.period.start} – ${q.period.end})`;
  const adLine = (id: string, name: string) => {
    const a = aggregate(perf.filter((p) => p.adId === id)), dv = derive(a), ls = leadStats(leads.filter((l) => l.adId === id));
    return `${name}: ใช้ ${fmtMoney(a.spend)} · แชท ${fmtInt(a.messages)} (ต้นทุน/แชท ${fmtMoney(dv.costPerMessage)}) · ลีด ${ls.valid} · มีคุณสมบัติ ${ls.qualified} · ปิดได้ ${ls.converted}`;
  };

  // 1) a named ad (by id or name) — most specific first
  const ad = ads.find((a) => t.includes(a.id.toLowerCase())) ?? longestFirst(ads).find((a) => t.includes(a.name.toLowerCase()));
  if (ad && !has(t, "เซลล์", "sale")) return `${head}\n${adLine(ad.id, ad.name)}${has(t, "กำไร", "profit", "รายได้", "ยอดขาย") ? "\n\nกำไรยังตอบไม่ได้: ระบบยังไม่มียอดเงินที่ลูกค้าจ่ายจริง (ต้องซิงค์จาก BEQ Toolkit)" : ""}`;

  // 2) a named page: ad money and chats on that page
  const page = longestFirst(d.pages).find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.id.toLowerCase()));
  if (page && !has(t, "เซลล์", "sale")) {
    const pageAds = ads.filter((a) => pageOfAd(a, campaigns.get(a.campaignId)) === page.id).map((a) => a.id);
    const a = aggregate(perf.filter((p) => pageAds.includes(p.adId))), ls = leadStats(leads.filter((l) => l.pageId === page.id));
    return `${head}\nเพจ ${page.name}: ${pageAds.length} แอด · ใช้ ${fmtMoney(a.spend)} · แชทจากแอด ${fmtInt(a.messages)} · ลีด ${ls.valid} · มีคุณสมบัติ ${ls.qualified} · ปิดได้ ${ls.converted}`;
  }

  // 3) sales reps: speed, closing, score (a rep's name narrows it to one person)
  if (has(t, "เซลล์", "sale", "พนักงาน", "ตอบช้า", "ตอบเร็ว", "คะแนน", "ปิดการขาย", "ปิดได้")) {
    const reps = d.users.filter((u) => u.role === "Sales Representative");
    const named = reps.find((u) => t.includes(u.name.toLowerCase()));
    const rows = salesRows(leads, (named ? [named] : reps).map((u) => u.id)).filter((r) => r.assigned > 0);
    if (!rows.length) return `${head}\nไม่มีลีดที่ผูกกับเซลล์ในช่วงนี้`;
    const slow = has(t, "ช้า", "slow"), nameOf = (id: string) => d.users.find((u) => u.id === id)?.name ?? id;
    const sorted = [...rows].sort((a, b) => has(t, "ปิด") ? b.converted - a.converted : slow ? (b.avgResponseMin ?? -1) - (a.avgResponseMin ?? -1) : (a.avgResponseMin ?? 1e9) - (b.avgResponseMin ?? 1e9));
    return `${head}\n` + sorted.map((r, i) => `${i + 1}. ${nameOf(r.repId)}: ตอบแรกเฉลี่ย ${fmtMins(r.avgResponseMin)} · ลีด ${r.assigned} · มีคุณสมบัติ ${r.qualified} · ปิดได้ ${r.converted} · คะแนน ${r.score ?? "— (ลีดน้อยกว่า 3)"}`).join("\n");
  }

  // 4) ads ranked or filtered by money / cost
  if (has(t, "แอด", "ads", "โฆษณา", "ต้นทุน", "ใช้เงิน", "เสียเงิน", "ค่าโฆษณา", "ภาพรวม", "performance")) {
    const rows = ads.map((a) => ({ a, agg: aggregate(perf.filter((p) => p.adId === a.id)) })).filter((r) => r.agg.rows > 0);
    if (!rows.length) return `${head}\nไม่มีข้อมูลโฆษณาในช่วงนี้ (หรือบทบาทของคุณไม่เห็นตัวเลขโฆษณา)`;
    const total = aggregate(perf), dv = derive(total), ls = leadStats(leads);
    const overall = `ภาพรวม: ${rows.length} แอด · ใช้ ${fmtMoney(total.spend)} · แชท ${fmtInt(total.messages)} (ต้นทุน/แชท ${fmtMoney(dv.costPerMessage)}) · ลีด ${ls.valid} · มีคุณสมบัติ ${ls.qualified} (${fmtPct(ls.qualifiedRate)}) · ปิดได้ ${ls.converted}`;
    const byCost = has(t, "ต้นทุน", "cost"), asc = has(t, "น้อยที่สุด", "ถูกที่สุด", "ต่ำสุด", "ดีที่สุด");
    const metric = (r: (typeof rows)[number]) => (byCost ? derive(r.agg).costPerMessage ?? Infinity : r.agg.spend);
    let list = rows;
    if (q.threshold) list = rows.filter((r) => (q.threshold!.op === ">" ? metric(r) > q.threshold!.n : metric(r) < q.threshold!.n));
    list = [...list].sort((x, y) => (asc ? metric(x) - metric(y) : metric(y) - metric(x))).slice(0, 5);
    const label = byCost ? "ต้นทุน/แชท" : "ใช้เงิน";
    const body = list.length ? list.map((r, i) => `${i + 1}. ${r.a.name}: ${label} ${fmtMoney(metric(r))} · แชท ${fmtInt(r.agg.messages)}`).join("\n") : "ไม่มีแอดที่ตรงเงื่อนไข";
    return `${head}\n${overall}\n\n${q.threshold || asc || byCost ? `แอดที่เรียงตาม${label}:\n${body}` : `แอดที่ใช้เงินมากสุด:\n${body}`}`;
  }

  if (has(t, "กำไร", "profit", "รายได้", "ยอดขาย")) return "กำไรยังตอบไม่ได้: ระบบมีค่าโฆษณา ลีด และจำนวนที่ปิดได้ แต่ยังไม่มียอดเงินที่ลูกค้าจ่ายจริง (ต้องซิงค์จาก BEQ Toolkit)";
  return HELP;
}
