"use client";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useStore } from "@/lib/store";
import { Btn, Select, TextInput } from "./ui";
import { Preset } from "@/lib/queries";
import { ANCHOR } from "@/lib/dates";
import { campaignOnPage, scopeFor } from "@/lib/queries";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "90d", label: "Last 90 Days" },
  { id: "custom", label: "Custom" },
];

export default function FilterBar({ hide = [] }: { hide?: ("rep" | "adStatus")[] }) {
  const { data, filters, setFilters, setPreset, resetFilters, user } = useStore();
  const scope = scopeFor(user);
  const camps = data.campaigns.filter((c) => campaignOnPage(c, data.ads, filters.pageId) && (!scope.agencyId || c.agencyId === scope.agencyId));
  const reps = data.users.filter((u) => u.role === "Sales Representative");
  const dateErr = filters.start > filters.end ? "Start must be before end" : "";

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5" aria-label="Report filters">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-faint text-brand"><SlidersHorizontal size={17} /></span>
          <div>
            <h3 className="text-sm font-semibold text-ink">Report filters</h3>
            <p className="text-xs text-muted">Narrow the results shown below</p>
          </div>
        </div>
        <Btn variant="ghost" size="sm" onClick={resetFilters}><RotateCcw size={14} /> Reset filters</Btn>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Date range</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Date range presets">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => setPreset(p.id)} aria-pressed={filters.preset === p.id}
              className={`h-9 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors ${filters.preset === p.id ? "bg-brand text-white shadow-sm" : "border border-line bg-surface text-muted hover:bg-gray-50 hover:text-ink"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <TextInput label="Start date" type="date" max={ANCHOR} value={filters.start} onChange={(e) => e.target.value && setFilters({ start: e.target.value })} error={dateErr} className="w-full" />
        <TextInput label="End date" type="date" max={ANCHOR} value={filters.end} onChange={(e) => e.target.value && setFilters({ end: e.target.value })} className="w-full" />
        <Select label="Page" value={filters.pageId} onChange={(v) => setFilters({ pageId: v, campaignId: "all" })} className="w-full"
          options={[{ value: "all", label: "All Pages" }, ...data.pages.map((p) => ({ value: p.id, label: p.name }))]} />
        <Select label="Campaign" value={filters.campaignId} onChange={(v) => setFilters({ campaignId: v })} className="w-full"
          options={[{ value: "all", label: "All Campaigns" }, ...camps.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select label="Agency" value={scope.agencyId ?? filters.agencyId} disabled={!!scope.agencyId} onChange={(v) => setFilters({ agencyId: v })} className="w-full"
          options={[{ value: "all", label: "All Agencies" }, ...data.agencies.map((a) => ({ value: a.id, label: a.name }))]} />
        {!hide.includes("rep") && (
          <Select label="Sales Rep" value={scope.repId ?? filters.repId} disabled={!!scope.repId} onChange={(v) => setFilters({ repId: v })} className="w-full"
            options={[{ value: "all", label: "All Reps" }, ...reps.map((a) => ({ value: a.id, label: a.name }))]} />
        )}
        {!hide.includes("adStatus") && (
          <Select label="Ad status" value={filters.adStatus} onChange={(v) => setFilters({ adStatus: v })} className="w-full"
            options={[{ value: "all", label: "All statuses" }, ...["Active", "Paused", "Learning", "Ended"].map((s) => ({ value: s, label: s }))]} />
        )}
      </div>
    </section>
  );
}
