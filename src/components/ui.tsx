"use client";
import clsx from "clsx";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Download, ChevronLeft, ChevronRight, Info, Search, X, XCircle, Inbox as InboxIcon,
} from "lucide-react";
import { ButtonHTMLAttributes, ReactNode, useEffect, useMemo, useState } from "react";
import { useStore, ConfirmState } from "@/lib/store";

export const cn = clsx;

/* ---------- basic surfaces ---------- */
export function Card({ title, subtitle, right, children, className, bodyClass, tip }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string; tip?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface shadow-card", className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">{title}{tip && <InfoTip text={tip} />}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={cn("p-5", bodyClass)}>{children}</div>
    </section>
  );
}

export type Tone = "green" | "amber" | "red" | "blue" | "gray" | "violet";
const toneCls: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-600 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  gray: "bg-gray-100 text-gray-600 ring-gray-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", toneCls[tone], className)}>{children}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Btn({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-brand text-white shadow-sm hover:bg-[#066a4d]",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-gray-50",
        variant === "ghost" && "text-muted hover:bg-gray-100 hover:text-ink",
        variant === "danger" && "bg-red-500 text-white hover:bg-red-600",
        className,
      )}
    />
  );
}

export function Avatar({ name, hue = 160, size = 32 }: { name: string; hue?: number; size?: number }) {
  const ini = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 45% 42%)` }}
      aria-hidden
    >
      {ini}
    </span>
  );
}
export const hueOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info size={13} className="text-gray-400 hover:text-brand" aria-label={text} />
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 hidden w-60 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-pop ring-1 ring-white/10 group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function DemoBadge({ label = "Demo Data" }: { label?: string }) {
  const { source } = useStore();
  return source === "sheets" ? <Badge tone="green">Google Sheets</Badge> : <Badge tone="amber">{label}</Badge>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="rounded-full bg-brand-faint p-3 text-brand"><InboxIcon size={22} /></div>
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-gray-100", className)} />;
}

/** Brief skeleton on first paint so loading states are visible and consistent. */
export function useBrief(ms = 350) {
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), ms); return () => clearTimeout(t); }, [ms]);
  return loading;
}

/* ---------- form controls ---------- */
export function Select({ label, value, onChange, options, className, disabled }: {
  label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; disabled?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium text-muted", className)}>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm font-normal text-ink focus:border-brand-2 disabled:bg-gray-50 disabled:text-gray-400"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
export function TextInput({ label, error, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-medium text-muted", className)}>
      {label}
      <input {...p} className={cn("h-9 rounded-lg border bg-surface px-2.5 text-sm font-normal text-ink placeholder:text-gray-400 focus:border-brand-2", error ? "border-red-300" : "border-line")} />
      {error && <span className="text-xs font-normal text-red-500">{error}</span>}
    </label>
  );
}
export function TextArea({ label, error, className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-medium text-muted", className)}>
      {label}
      <textarea {...p} className={cn("rounded-lg border bg-surface px-2.5 py-2 text-sm font-normal text-ink placeholder:text-gray-400 focus:border-brand-2", error ? "border-red-300" : "border-line")} />
      {error && <span className="text-xs font-normal text-red-500">{error}</span>}
    </label>
  );
}
export function SearchBox({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2.5 text-sm placeholder:text-gray-400 focus:border-brand-2" />
    </div>
  );
}

/* ---------- overlays ---------- */
export function Modal({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-2xl bg-surface shadow-pop" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full flex-col bg-surface shadow-pop" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/** Mount once: renders toasts and the promise-based confirm dialog. */
export function FeedbackHost() {
  const { toasts, dismissToast, confirmState, clearConfirm } = useStore();
  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm shadow-pop">
            {t.tone === "error" ? <XCircle size={18} className="mt-0.5 text-red-500" /> : t.tone === "info" ? <Info size={18} className="mt-0.5 text-blue-600" /> : <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />}
            <p className="flex-1">{t.text}</p>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
          </div>
        ))}
      </div>
      {confirmState && <ConfirmDialog key={confirmState.title + confirmState.message} state={confirmState} onDone={clearConfirm} />}
    </>
  );
}

function ConfirmDialog({ state, onDone }: { state: ConfirmState; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const done = (ok: boolean) => {
    if (ok && state.requireReason && reason.trim().length < 3) { setErr("Please enter a short reason."); return; }
    state.resolve({ ok, reason: reason.trim() || undefined });
    onDone();
  };
  return (
    <Modal open onClose={() => done(false)} title={state.title} width={440}
      footer={<><Btn onClick={() => done(false)}>Cancel</Btn><Btn variant={state.tone === "danger" ? "danger" : "primary"} onClick={() => done(true)}>{state.confirmLabel ?? "Confirm"}</Btn></>}>
      <p className="text-sm text-ink">{state.message}</p>
      {state.requireReason && <TextArea className="mt-3" label="Reason (saved to activity history)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} error={err} />}
    </Modal>
  );
}

/* ---------- KPI ---------- */
export function Delta({ value, lowerIsBetter = false }: { value: number | null; lowerIsBetter?: boolean }) {
  if (value == null) return <span className="text-xs text-gray-400" title="No comparable data in the previous period">n/a</span>;
  const up = value >= 0;
  const good = Math.abs(value) < 0.05 ? null : lowerIsBetter ? !up : up;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabnum", good == null ? "text-gray-500" : good ? "text-emerald-600" : "text-red-500")}>
      {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(value).toFixed(1)}%
    </span>
  );
}
export function Sparkline({ data, color = "#10b981", width = 90, height = 28 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 3 - ((v - min) / span) * (height - 6)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
export function KpiCard({ label, value, delta, lowerIsBetter, spark, tip, onClick, sub, active }: {
  label: string; value: string; delta?: number | null; lowerIsBetter?: boolean; spark?: number[]; tip?: string; onClick?: () => void; sub?: string; active?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-xs font-medium text-muted">{label}{tip && <InfoTip text={tip} />}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-[22px] font-semibold leading-tight text-ink tabnum">{value}</div>
        {spark && <Sparkline data={spark} color={delta != null && (lowerIsBetter ? delta > 0 : delta < 0) ? "#dc6b6b" : "#10b981"} />}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        {delta !== undefined && <><Delta value={delta} lowerIsBetter={lowerIsBetter} /><span>vs previous period</span></>}
        {sub && <span>{sub}</span>}
      </div>
    </>
  );
  const cls = cn("rounded-xl border bg-surface p-3.5 text-left", active ? "border-brand-2 ring-2 ring-brand-soft" : "border-line", onClick && "transition hover:border-brand-2 hover:shadow-card");
  return onClick ? <button onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>;
}

/* ---------- data table ---------- */
export interface Column<T> {
  key: string;
  header: ReactNode;
  tip?: string;
  align?: "left" | "right" | "center";
  sort?: (r: T) => number | string | null;
  render: (r: T) => ReactNode;
  minW?: number;
  sticky?: boolean;
}
export function DataTable<T>({
  columns, rows, rowKey, searchText, searchPlaceholder, toolbar, pageSize = 10, defaultSort, onRowClick, rowClass, emptyTitle = "No results", emptyHint, loading, caption, exportName,
}: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; searchText?: (r: T) => string; searchPlaceholder?: string; toolbar?: ReactNode;
  pageSize?: number; defaultSort?: { key: string; dir: "asc" | "desc" }; onRowClick?: (r: T) => void; rowClass?: (r: T) => string | undefined;
  emptyTitle?: string; emptyHint?: string; loading?: boolean; caption?: string; exportName?: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  const processed = useMemo(() => {
    let out = rows;
    const needle = q.trim().toLowerCase();
    if (needle && searchText) out = out.filter((r) => searchText(r).toLowerCase().includes(needle));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sort) {
        const get = col.sort;
        out = [...out].sort((a, b) => {
          const x = get(a), y = get(b);
          if (x == null && y == null) return 0;
          if (x == null) return 1; // nulls always last
          if (y == null) return -1;
          const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
          return sort.dir === "asc" ? c : -c;
        });
      }
    }
    return out;
  }, [rows, q, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(processed.length / size));
  const cur = Math.min(page, pages - 1);
  const slice = processed.slice(cur * size, cur * size + size);

  const doExport = () => {
    // Exports every column that has a sort accessor (the underlying value, not the formatted cell), respecting search + sort.
    const cs = columns.filter((c) => c.sort);
    const esc = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = cs.map((c) => esc(typeof c.header === "string" ? c.header : c.key)).join(",");
    const body = processed.map((r) => cs.map((c) => esc(c.sort!(r))).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${exportName ?? caption ?? "table"}.csv`.replace(/\s+/g, "-").toLowerCase(); a.click(); URL.revokeObjectURL(url);
  };

  const toggle = (key: string) => setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "desc" }));

  return (
    <div>
      {(
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchText && <SearchBox className="w-full sm:w-64" value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder={searchPlaceholder} />}
          {toolbar}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted tabnum">{processed.length.toLocaleString()} {processed.length === 1 ? "row" : "rows"}
            <button onClick={doExport} disabled={processed.length === 0} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-medium text-ink hover:bg-gray-50 disabled:opacity-40" title="Download the rows currently shown (after search and sort) as CSV"><Download size={12} /> Export CSV</button></span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-gray-50/80 text-xs text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  style={{ minWidth: c.minW }}
                  className={cn("whitespace-nowrap px-3 py-2.5 font-semibold", c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left", c.sticky && "sticky left-0 z-10 bg-gray-50")}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.sort ? (
                      <button onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:text-ink">
                        {c.header}
                        {sort?.key === c.key ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-40" />}
                      </button>
                    ) : c.header}
                    {c.tip && <InfoTip text={c.tip} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-line"><td colSpan={columns.length} className="p-3"><Skeleton className="h-6" /></td></tr>
                ))
              : slice.map((r) => (
                  <tr
                    key={rowKey(r)}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn("border-t border-line transition-colors", onRowClick && "cursor-pointer hover:bg-brand-faint/60", rowClass?.(r))}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-3 py-2.5 align-middle", c.align === "right" ? "text-right tabnum" : c.align === "center" ? "text-center" : "", c.sticky && "sticky left-0 z-[1] bg-inherit")}>{c.render(r)}</td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && processed.length === 0 && <EmptyState title={emptyTitle} hint={emptyHint ?? "Try changing the search or filters."} />}
      </div>
      {!loading && processed.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <label className="flex items-center gap-1.5">Rows per page
            <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} className="h-7 rounded-md border border-line bg-surface px-1.5">
              {[10, 25, 50].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <span className="mr-2 tabnum">{cur * size + 1}–{Math.min(processed.length, cur * size + size)} of {processed.length}</span>
            <button aria-label="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="rounded-md border border-line p-1 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft size={15} /></button>
            <button aria-label="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="rounded-md border border-line p-1 hover:bg-gray-50 disabled:opacity-40"><ChevronRight size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- shared status colouring ---------- */
import { LeadQuality, LeadStatus } from "@/lib/types";
import { ChatQuality } from "@/lib/metrics";
export const STATUS_TONE: Record<LeadStatus, Tone> = {
  "Not Responded": "gray", "Very Poor": "red", Average: "amber", Qualified: "green",
  "Appointment Booked": "blue", "Connection Created": "violet", New: "blue", "In-Process": "amber", Intake: "violet", Converted: "green",
};
export const STATUS_COLOR: Record<LeadStatus, string> = {
  "Not Responded": "#9ca3af", "Very Poor": "#dc6b6b", Average: "#e0a431", Qualified: "#10b981",
  "Appointment Booked": "#3b82f6", "Connection Created": "#8b5cf6", New: "#60a5fa", "In-Process": "#f59e0b", Intake: "#a78bfa", Converted: "#087a58",
};
export function StatusBadge({ status }: { status: LeadStatus | LeadQuality }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
export function ChatQualityBadge({ q }: { q: ChatQuality }) {
  const tone: Record<ChatQuality, Tone> = { Excellent: "green", Good: "blue", Average: "amber", Poor: "red", "No data": "gray" };
  return <Badge tone={tone[q]}>{q}</Badge>;
}
export function AdThumb({ hue, type, size = 40 }: { hue: number; type: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-end justify-end rounded-lg" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 55% 78%), hsl(${(hue + 40) % 360} 50% 62%))` }} title={`${type} creative (placeholder)`}>
      <span className="m-0.5 rounded bg-surface/80 px-1 text-[9px] font-semibold text-gray-700">{type[0]}</span>
    </span>
  );
}

export function Facebook({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.97.93-1.97 1.89v2.26h3.35l-.53 3.49h-2.82V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}
