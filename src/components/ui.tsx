"use client";
import clsx from "clsx";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Download, ChevronLeft, ChevronRight, Info, Search, X, XCircle, Inbox as InboxIcon,
} from "lucide-react";
import { ButtonHTMLAttributes, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, ConfirmState } from "@/lib/store";
import { LeadQuality, LeadStatus, statusTh } from "@/lib/types";
import { ChatQuality } from "@/lib/metrics";
import { askForFreshLink, useCreativeUrl } from "@/lib/creativeClient";
import { linkLooksExpired } from "@/lib/creativeUrl";
import { csvCell } from "@/lib/csv";

export const cn = clsx;

/* ---------- basic surfaces ---------- */
export function Card({ title, subtitle, right, children, className, bodyClass, tip }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string; tip?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface shadow-card transition-shadow", className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5">
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
export function Btn({ variant = "secondary", size = "md", className, type = "button", ...p }: BtnProps) {
  return (
    <button
      type={type}
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-gradient-to-b from-brand-2 to-brand text-white shadow-sm hover:from-brand hover:to-brand-hover",
        variant === "secondary" && "border border-line bg-surface text-ink hover:border-brand-2 hover:bg-brand-faint",
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
      <span tabIndex={0} role="img" aria-label={text} className="inline-flex rounded text-muted hover:text-brand focus-visible:text-brand"><Info size={13} aria-hidden /></span>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 hidden w-60 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-pop ring-1 ring-white/10 group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
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
      <input {...p} className={cn("h-9 rounded-lg border bg-surface px-2.5 text-sm font-normal text-ink placeholder:text-muted focus:border-brand-2", error ? "border-red-300" : "border-line")} />
      {error && <span className="text-xs font-normal text-red-500">{error}</span>}
    </label>
  );
}
export function TextArea({ label, error, className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-medium text-muted", className)}>
      {label}
      <textarea {...p} className={cn("rounded-lg border bg-surface px-2.5 py-2 text-sm font-normal text-ink placeholder:text-muted focus:border-brand-2", error ? "border-red-300" : "border-line")} />
      {error && <span className="text-xs font-normal text-red-500">{error}</span>}
    </label>
  );
}
export function SearchBox({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2.5 text-sm placeholder:text-muted focus:border-brand-2" />
    </div>
  );
}

/* ---------- overlays ---------- */
/** Escape closes, focus moves into the dialog and Tab stays inside it, then goes back to whatever opened it. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a fresh onClose every render; keeping it in a ref stops the effect (and the focus move) re-running on each keystroke.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const from = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const items = () => Array.from(box?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? []);
    (items()[0] ?? box)?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab") return;
      const f = items();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); from?.focus?.(); };
  }, [open]);
  return ref;
}

const closeBtn = "hit relative rounded-md p-1.5 text-muted hover:bg-gray-100 hover:text-ink";

export function Modal({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="relative flex max-h-[90vh] w-full flex-col rounded-2xl bg-surface shadow-pop outline-none" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={closeBtn}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} />
      <aside ref={ref} tabIndex={-1} className="absolute right-0 top-0 flex h-full w-full flex-col bg-surface shadow-pop outline-none" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={closeBtn}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/** Card shown while the pointer (or keyboard focus) rests on the trigger. Portalled so table scroll containers cannot clip it. */
export function HoverPreview({ content, children, className, focusable }: { content: ReactNode; children: ReactNode; className?: string; focusable?: boolean }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const hide = () => setPos(null);
  const show = () => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 16);
    // Open to the right of the trigger; flip left when it would run off-screen.
    let left = r.right + 10;
    if (left + width > window.innerWidth - 8) left = Math.max(8, r.left - width - 10);
    const top = Math.min(Math.max(8, r.top - 8), Math.max(8, window.innerHeight - 470));
    setPos({ top, left });
  };
  useEffect(() => {
    if (!pos) return;
    const h = () => setPos(null);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") h(); };
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("scroll", h, true); window.removeEventListener("resize", h); window.removeEventListener("keydown", k); };
  }, [pos]);
  return (
    <span ref={ref} className={cn("relative inline-block max-w-full align-middle", focusable && "rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-2", className)}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide}>
      {children}
      {pos && createPortal(
        <div role="tooltip" className="pointer-events-none fixed z-40 w-[380px] max-w-[calc(100vw-16px)]" style={{ top: pos.top, left: pos.left }}>{content}</div>,
        document.body,
      )}
    </span>
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
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="hit relative rounded p-0.5 text-muted hover:text-ink"><X size={15} /></button>
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
  if (value == null) return <span className="text-xs text-muted" title="No comparable data in the previous period">n/a</span>;
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
  const cls = cn("relative rounded-xl border bg-surface p-4 text-left transition-all", active ? "border-brand-2 bg-brand-faint/50 shadow-sm ring-1 ring-brand-soft" : "border-line", onClick && !active && "hover:-translate-y-0.5 hover:border-brand-2 hover:shadow-card");
  return onClick ? <button type="button" onClick={onClick} aria-pressed={!!active} className={cls}>{body}</button> : <div className={cls}>{body}</div>;
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
    const head = cs.map((c) => csvCell(typeof c.header === "string" ? c.header : c.key)).join(",");
    const body = processed.map((r) => cs.map((c) => csvCell(c.sort!(r))).join(",")).join("\r\n");
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
                    // Clickable rows must be reachable by keyboard too; ignore keys that bubble up from buttons/links inside the row.
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(r); } } : undefined}
                    className={cn("border-t border-line transition-colors", onRowClick && "cursor-pointer hover:bg-brand-faint/60 focus-visible:bg-brand-faint/60", rowClass?.(r))}
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
export const STATUS_TONE: Record<LeadStatus, Tone> = {
  "Not Responded": "red", "Very Poor": "red", Average: "green", Qualified: "green",
  "Appointment Booked": "green", "Connection Created": "violet", New: "blue", "In-Process": "amber", Intake: "violet", Converted: "green",
};
export const STATUS_COLOR: Record<LeadStatus, string> = {
  "Not Responded": "#f87171", "Very Poor": "#dc2626", Average: "#6ee7b7", Qualified: "#10b981",
  "Appointment Booked": "#059669", "Connection Created": "#8b5cf6", New: "#60a5fa", "In-Process": "#f59e0b", Intake: "#a78bfa", Converted: "#087a58",
};
export function StatusBadge({ status }: { status: LeadStatus | LeadQuality }) {
  return <Badge tone={STATUS_TONE[status]}>{statusTh(status)}</Badge>;
}
export function ChatQualityBadge({ q }: { q: ChatQuality }) {
  const tone: Record<ChatQuality, Tone> = { Excellent: "green", Good: "blue", Average: "amber", Poor: "red", "No data": "gray" };
  return <Badge tone={tone[q]}>{q}</Badge>;
}
/** Google Drive share links don't work in <img>; turn them into the thumbnail endpoint. Anything else is used as is. */
export function imageSrc(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=|thumbnail\?(?:[^#]*&)?id=)([\w-]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : url;
}
export function AdThumb({ hue, type, size = 40, src, hasVideo, adId }: { hue: number; type: string; size?: number; src?: string; hasVideo?: boolean; adId?: string }) {
  // A picture link from Meta is signed and stops answering after a few days, so a row that looked fine on sync day can be blank
  // now. Use the link this page already re-fetched, ask for a new one when the saved link has aged out or fails to load.
  const live = useCreativeUrl(adId, src);
  const [failed, setFailed] = useState<string | undefined>();
  useEffect(() => { if (adId && live && linkLooksExpired(live)) askForFreshLink(adId); }, [adId, live]);
  const img = live === failed ? undefined : imageSrc(live);
  return (
    <span className="relative inline-flex shrink-0 items-end justify-end overflow-hidden rounded-lg" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 55% 78%), hsl(${(hue + 40) % 360} 50% 62%))` }} title={img ? type : `${type} — ยังไม่ได้ใส่รูป/วิดีโอ`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- links are pasted by the user and can point anywhere */}
      {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => { setFailed(live); if (adId) askForFreshLink(adId); }} className="absolute inset-0 h-full w-full object-cover" />}
      <span className="relative m-0.5 rounded bg-surface/80 px-1 text-[9px] font-semibold text-gray-700">{hasVideo ? "▶" : type[0]}</span>
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

export function Instagram({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" />
    </svg>
  );
}

export function Line({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  );
}

export function WhatsApp({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export type ChannelMark = "facebook" | "instagram" | "line" | "whatsapp";
export const CHANNEL_MARK_COLOR: Record<ChannelMark, string> = { facebook: "#1877f2", instagram: "#e1306c", line: "#06c755", whatsapp: "#25d366" };

/** The real logo of a chat channel, in its brand colour unless `color` overrides it. */
export function ChannelIcon({ id, size = 14, color, className }: { id: ChannelMark; size?: number; color?: string; className?: string }) {
  const Mark = id === "instagram" ? Instagram : id === "line" ? Line : id === "whatsapp" ? WhatsApp : Facebook;
  return <span className={cn("inline-flex shrink-0 items-center justify-center", className)} style={{ color: color ?? CHANNEL_MARK_COLOR[id] }}><Mark size={size} /></span>;
}
