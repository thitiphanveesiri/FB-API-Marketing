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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h1 className="text-xl font-semibold">Dashboard</h1></div>
        <p className="text-xs text-muted">Showing {fmtDate(r.start)} – {fmtDate(r.end)} · compared with {fmtDate(p.start)} – {fmtDate(p.end)}</p>
      </div>
      <FilterBar />
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Dashboard views">
        {tabs.map((t) => {
          const on = path === t.href;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors", on ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
