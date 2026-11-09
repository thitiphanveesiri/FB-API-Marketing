// Pure planner for writing rows into a sheet tab (a grid of strings). No network, no fs: easy to test.
export type Cell = string | number | boolean;
export type Obj = Record<string, Cell | null | undefined>;
export type UpsertMode = "upsert" | "insert" | "updateOnly"; // insert = skip rows whose key already exists
export interface Plan {
  headers: string[];            // header row after the plan is applied
  headerAdds: { col: number; name: string }[];
  updates: { row: number; col: number; value: Cell }[]; // row is the 1-based sheet row, col is 0-based
  appends: Cell[][];
  updated: number; appended: number; skipped: number;
}
export const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const cellOf = (v: Cell | null | undefined): Cell => (v == null ? "" : v);

export function planUpsert(grid: string[][], keyCols: string[], objs: Obj[], mode: UpsertMode): Plan {
  const headers = grid.length > 0 ? grid[0].map((h) => String(h ?? "")) : [];
  const headerAdds: Plan["headerAdds"] = [];
  const colOf = new Map<string, number>(); headers.forEach((h, i) => { const k = norm(h); if (k && !colOf.has(k)) colOf.set(k, i); });
  const col = (name: string) => {
    const k = norm(name); let c = colOf.get(k);
    if (c == null) { c = headers.length; headers.push(name); colOf.set(k, c); headerAdds.push({ col: c, name }); }
    return c;
  };
  const keyOf = (get: (name: string) => string) => keyCols.map(get).join("\u0001");
  const keyIdx = new Map<string, number>(); // key -> 1-based sheet row
  if (keyCols.length) {
    const kc = keyCols.map((k) => colOf.get(norm(k)));
    if (kc.every((c) => c != null)) grid.slice(1).forEach((r, i) => { const k = kc.map((c) => String(r[c!] ?? "").trim()).join("\u0001"); if (k.replace(/\u0001/g, "") !== "" && !keyIdx.has(k)) keyIdx.set(k, i + 2); });
  }
  const plan: Plan = { headers, headerAdds, updates: [], appends: [], updated: 0, appended: 0, skipped: 0 };
  const pending = new Map<string, Cell[]>(); // rows appended in this batch (so duplicates inside the batch merge instead of double-appending)
  for (const o of objs) {
    const key = keyCols.length ? keyOf((k) => String(o[k] ?? "").trim()) : "";
    const rowNo = keyCols.length ? keyIdx.get(key) : undefined;
    if (rowNo != null) {
      if (mode === "insert") { plan.skipped++; continue; }
      for (const [k, v] of Object.entries(o)) if (v !== undefined) plan.updates.push({ row: rowNo, col: col(k), value: cellOf(v) });
      plan.updated++; continue;
    }
    if (mode === "updateOnly") { plan.skipped++; continue; }
    const prev = keyCols.length ? pending.get(key) : undefined;
    if (prev) { if (mode === "insert") { plan.skipped++; continue; } for (const [k, v] of Object.entries(o)) if (v !== undefined) prev[col(k)] = cellOf(v); plan.updated++; continue; }
    const row: Cell[] = [];
    for (const [k, v] of Object.entries(o)) if (v !== undefined) row[col(k)] = cellOf(v);
    plan.appends.push(row); if (keyCols.length) pending.set(key, row);
    plan.appended++;
  }
  // pad rows to the final header width
  for (const r of plan.appends) for (let i = 0; i < headers.length; i++) if (r[i] === undefined) r[i] = "";
  return plan;
}

/** Applies a plan to a grid (used by the local JSON backend and by tests). */
export function applyPlan(grid: string[][], plan: Plan): string[][] {
  const g = grid.length ? grid.map((r) => [...r]) : [[]];
  g[0] = plan.headers.map(String);
  for (const u of plan.updates) { const r = g[u.row - 1] ?? (g[u.row - 1] = []); while (r.length <= u.col) r.push(""); r[u.col] = String(u.value); }
  for (const a of plan.appends) g.push(a.map((c) => String(c)));
  return g;
}
