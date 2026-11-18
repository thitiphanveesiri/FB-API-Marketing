"use client";
import { RotateCcw } from "lucide-react";
import { useStore } from "@/lib/store";
import { Btn, Select, TextInput } from "./ui";
import { Preset } from "@/lib/queries";
import { ANCHOR } from "@/lib/dates";
import { scopeFor } from "@/lib/queries";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "90d", label: "Last 90 Days" },
  { id: "custom", label: "Custom" },
];

export default function FilterBar({ hide = [] }: { hide?: ("rep" | "adStatus")[] }) {
  const { data, filters, setFilters, setPreset, resetFilters, user } = useStore();
  const scope = scopeFor(user);
  const camps = data.campaigns.filter((c) => (filters.pageId === "all" || c.pageId === filters.pageId) && (!scope.agencyId || c.agencyId === scope.agencyId));
  const reps = data.users.filter((u) => u.role === "Sales Representative");
  const dateErr = filters.start > filters.end ? "Start must be before end" : "";

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Date range</p>
          <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Date range presets">
            {PRESETS.map((p) => (
              <button key={p.id} onClick={() => setPreset(p.id)} aria-pressed={filters.preset === p.id}
                className={`h-9 whitespace-nowrap px-3 text-sm transition-colors ${filters.preset === p.id ? "bg-brand text-white" : "bg-surface text-ink hover:bg-gray-50"} border-r border-line last:border-r-0`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <TextInput label="Start date" type="date" max={ANCHOR} value={filters.start} onChange={(e) => e.target.value && setFilters({ start: e.target.value })} error={dateErr} className="w-36" />
        <TextInput label="End date" type="date" max={ANCHOR} value={filters.end} onChange={(e) => e.target.value && setFilters({ end: e.target.value })} className="w-36" />
        <Select label="Page" value={filters.pageId} onChange={(v) => setFilters({ pageId: v, campaignId: "all" })} className="w-44"
          options={[{ value: "all", label: "All Pages" }, ...data.pages.map((p) => ({ value: p.id, label: p.name }))]} />
        <Select label="Campaign" value={filters.campaignId} onChange={(v) => setFilters({ campaignId: v })} className="w-44"
          options={[{ value: "all", label: "All Campaigns" }, ...camps.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select label="Agency" value={scope.agencyId ?? filters.agencyId} disabled={!!scope.agencyId} onChange={(v) => setFilters({ agencyId: v })} className="w-40"
          options={[{ value: "all", label: "All Agencies" }, ...data.agencies.map((a) => ({ value: a.id, label: a.name }))]} />
        {!hide.includes("rep") && (
          <Select label="Sales Rep" value={scope.repId ?? filters.repId} disabled={!!scope.repId} onChange={(v) => setFilters({ repId: v })} className="w-40"
            options={[{ value: "all", label: "All Reps" }, ...reps.map((a) => ({ value: a.id, label: a.name }))]} />
        )}
        {!hide.includes("adStatus") && (
          <Select label="Ad status" value={filters.adStatus} onChange={(v) => setFilters({ adStatus: v })} className="w-32"
            options={[{ value: "all", label: "All" }, ...["Active", "Paused", "Learning", "Ended"].map((s) => ({ value: s, label: s }))]} />
        )}
        <Btn variant="ghost" size="sm" onClick={resetFilters} className="mb-1"><RotateCcw size={14} /> Reset</Btn>
      </div>
    </div>
  );
}
