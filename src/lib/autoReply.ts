// Pure (no React, no I/O). Decides whether a message the PAGE sent was automatic (greeting, away message, bot) instead of typed by a person.
// The rules live in the sheet tab `auto_replies`, so they can be tuned without a deploy, and they apply to the whole history at read time.
export type RuleMatch = "contains" | "exact" | "starts_with" | "app_id";
export const RULE_MATCHES: readonly RuleMatch[] = ["contains", "exact", "starts_with", "app_id"];
export interface AutoRule { match: RuleMatch; pattern: string; re?: RegExp; note: string }
export interface RuleWarning { row: number; message: string }
interface RuleRow { n: number; get: (col: string) => string }

/** Too-short patterns would also match what a person types ("ค่ะ", "สวัสดี"), and a wrongly "automated" reply stops counting as an answer. */
export const MIN_LEN: Record<Exclude<RuleMatch, "app_id">, number> = { contains: 6, starts_with: 4, exact: 2 };
const MAX_RULES = 200, MAX_PATTERN = 300, MAX_WILDCARDS = 3;

const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;
/** Same normalisation for patterns and for message text: no zero-width characters, single spaces, lower case. */
export const normalize = (s: string) => s.replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim().toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `*` in a pattern stands for any text (a customer's name, a time, a link). At most 3, so matching stays cheap. */
function toRegex(pattern: string, match: Exclude<RuleMatch, "app_id">): RegExp {
  const body = pattern.split("*").map(esc).join("[\\s\\S]*?");
  return new RegExp(match === "exact" ? `^${body}$` : match === "starts_with" ? `^${body}` : body);
}

export function parseAutoRules(rows: RuleRow[]): { rules: AutoRule[]; warnings: RuleWarning[] } {
  const rules: AutoRule[] = [], warnings: RuleWarning[] = [];
  for (const r of rows) {
    if (/^(false|no|n|0|off|ปิด|ไม่)$/i.test(r.get("active").trim())) continue; // blank = active
    const rawPattern = r.get("pattern").trim(); if (!rawPattern) continue;
    const mRaw = r.get("match").trim().toLowerCase() || "contains";
    const match = RULE_MATCHES.find((x) => x === mRaw);
    if (!match) { warnings.push({ row: r.n, message: `match "${r.get("match")}" ไม่รู้จัก — ใช้ได้: ${RULE_MATCHES.join(" | ")} (แถวนี้ถูกข้าม)` }); continue; }
    if (rules.length >= MAX_RULES) { warnings.push({ row: r.n, message: `มีกฎเกิน ${MAX_RULES} ข้อ — แถวนี้ถูกข้าม` }); continue; }
    if (rawPattern.length > MAX_PATTERN) { warnings.push({ row: r.n, message: `pattern ยาวเกิน ${MAX_PATTERN} ตัวอักษร — แถวนี้ถูกข้าม` }); continue; }
    const note = r.get("note");
    if (match === "app_id") {
      if (!/^\d{5,20}$/.test(rawPattern)) { warnings.push({ row: r.n, message: "app_id ต้องเป็นตัวเลข 5–20 หลัก (เลข App ID ของผู้ส่ง) — แถวนี้ถูกข้าม" }); continue; }
      rules.push({ match, pattern: rawPattern, note }); continue;
    }
    const pattern = normalize(rawPattern), stars = (pattern.match(/\*/g) ?? []).length, literal = pattern.replace(/\*/g, "");
    if (stars > MAX_WILDCARDS) { warnings.push({ row: r.n, message: `ใช้ * ได้ไม่เกิน ${MAX_WILDCARDS} ตัวต่อกฎ — แถวนี้ถูกข้าม` }); continue; }
    if (literal.length < MIN_LEN[match]) { warnings.push({ row: r.n, message: `pattern สั้นเกินไป (ต้องมีตัวอักษรจริงอย่างน้อย ${MIN_LEN[match]} ตัวสำหรับ ${match}) อาจไปตรงกับข้อความที่คนพิมพ์ — แถวนี้ถูกข้าม` }); continue; }
    rules.push({ match, pattern, re: toRegex(pattern, match), note });
  }
  return { rules, warnings };
}

export interface OutboundInfo { text: string; senderApp?: string; sentBy?: string }
/** The first rule that says this page message was automatic, or null. A message sent from the dashboard by a person is never automatic. */
export function matchAutoRule(m: OutboundInfo, rules: AutoRule[]): AutoRule | null {
  if (m.sentBy) return null;
  const text = normalize(m.text);
  for (const r of rules) {
    if (r.match === "app_id") { if (m.senderApp && m.senderApp === r.pattern) return r; }
    else if (text && r.re?.test(text)) return r;
  }
  return null;
}
export const isAutoReply = (m: OutboundInfo, rules: AutoRule[]) => matchAutoRule(m, rules) !== null;

/** Does this message count as the page answering the customer? Automatic replies don't stop the clock. */
export const countsAsReply = (m: { direction: string; senderType?: string }) => m.direction === "out" && m.senderType !== "automated";
