"use client";
import { useMemo } from "react";
import { useStore } from "./store";
import { adsFor, allLeadsFor, perfFor, previousRange, rangeOf } from "./queries";
import { aggregate, derive, leadStats } from "./metrics";
import { eachDay } from "./dates";

/** One place that turns the global filters into the slices every dashboard view needs. */
export function useDash() {
  const { data, eff } = useStore();
  return useMemo(() => {
    const range = rangeOf(eff);
    const prev = previousRange(range);
    const ads = adsFor(data, eff);
    const perf = perfFor(data, ads, range);
    const perfPrev = perfFor(data, ads, prev);
    const leads = allLeadsFor(data, eff, range); // includes dropped, so rates use the full cohort
    const leadsPrev = allLeadsFor(data, eff, prev);
    const agg = aggregate(perf);
    const aggPrev = aggregate(perfPrev);
    return {
      data, eff, range, prev, ads, perf, perfPrev, leads, leadsPrev,
      agg, aggPrev, d: derive(agg), dPrev: derive(aggPrev),
      ls: leadStats(leads), lsPrev: leadStats(leadsPrev),
      days: eachDay(range.start, range.end),
      prevDays: eachDay(prev.start, prev.end),
    };
  }, [data, eff]);
}
export type Dash = ReturnType<typeof useDash>;
