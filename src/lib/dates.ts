// Deterministic, timezone-free date helpers (YYYY-MM-DD strings).
export const ANCHOR = "2026-11-07"; // "today" for the demo dataset

export function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000);
}
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
export function weekStart(iso: string): string {
  const d = parse(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Monday=0
  return addDays(iso, -dow);
}
export function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function fmtShort(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${fmtDate(iso)} ${iso.slice(11, 16)}`;
}
/** Relative label against a reference "now" ISO datetime. */
export function relTime(iso: string, nowIso: string): string {
  const a = new Date(iso.length > 10 ? iso + "Z" : iso + "T00:00:00Z").getTime();
  const b = new Date(nowIso.length > 10 ? nowIso + "Z" : nowIso + "T00:00:00Z").getTime();
  const mins = Math.max(0, Math.round((b - a) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  const days = Math.floor(mins / 1440);
  return days < 30 ? `${days}d` : fmtShort(iso);
}
export const NOW_ISO = `${ANCHOR}T23:59:00`;
export function nowStamp(): string {
  // Real clock for user-made changes (client only).
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
