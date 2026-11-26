"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import FilterBar from "@/components/FilterBar";
import { cn } from "@/components/ui";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import { fmtDate } from "@/lib/dates";
import { previousRange, rangeOf } from "@/lib/queries";

const TABS = [
  { href: "/dashboard/ads", label: "Ads Performance" },
  { href: "/dashboard/ads-chat", label: "Ads & Chat" },
  { href: "/dashboard/sales", label: "Sales Performance" },
  { href: "/dashboard/trend", label: "Trend" },
  { href: "/dashboard/dropped", label: "Dropped" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, filters } = useStore();
  const r = rangeOf(filters);
  const p = previousRange(r);
  const tabs = TABS.filter((t) => roleCan.salesTabs(user.role) || t.href.endsWith("/ads") || t.href.endsWith("/trend"));
  const active = TABS.find((t) => path === t.href) ?? TABS[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand">Marketing analytics</p>
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{active.label}</h2>
          <p className="mt-1 text-sm text-muted">Performance overview across campaigns, pages, and sales activity.</p>
        </div>
        <div className="inline-flex w-fit flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Reporting period · compared to previous</span>
          <span className="text-xs font-semibold tabnum text-ink sm:text-sm">{fmtDate(r.start)} – {fmtDate(r.end)} <span className="font-normal text-muted">vs</span> {fmtDate(p.start)} – {fmtDate(p.end)}</span>
        </div>
      </div>

      <FilterBar />

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 shadow-sm" aria-label="Dashboard views">
        {tabs.map((t) => {
          const on = path === t.href;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors sm:px-4", on ? "bg-brand-faint text-brand shadow-sm" : "text-muted hover:bg-gray-50 hover:text-ink")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
