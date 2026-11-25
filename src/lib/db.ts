// SERVER ONLY. Postgres backend, used when DATABASE_URL is set (unset it to go back to Google Sheets).
// One generic table holds every tab, so each tab keeps its exact columns and any extra column still works; `sheetMapper` is unchanged.
// shortcut: no typed columns / foreign keys yet, add them per tab once the app runs on this table (plan phase 4).
// For realtime in Supabase: alter publication supabase_realtime add table sheet_rows;
import { Pool } from "pg";
import { norm, type Obj, type UpsertMode } from "./sheetOps";
import { SHEET_TABS } from "./sheetSchema";
import type { RawTabs } from "./sheetMapper";

export type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
export interface WriteResult { updated: number; appended: number; skipped: number }

export const dbConfigured = () => !!process.env.DATABASE_URL;

const SCHEMA = [
  "create table if not exists sheet_rows (tab text not null, key text, seq bigint generated always as identity primary key, data jsonb not null default '{}')",
  "create unique index if not exists sheet_rows_tab_key on sheet_rows (tab, key) where key is not null",
  "create index if not exists sheet_rows_tab_seq on sheet_rows (tab, seq)",
  // Supabase publishes public tables through its REST API: with RLS on and no policy, the public anon key reads nothing (this table holds
  // channel tokens). The app connects as the database owner, which bypasses RLS.
  "alter table sheet_rows enable row level security",
];

let injected: Q | null = null, pool: Pool | null = null, ready: Promise<unknown> | null = null;
/** Tests plug an in-memory Postgres in here. */
export const useDb = (q: Q | null) => { injected = q; ready = null; };

async function db(): Promise<Q> {
  const q: Q = injected ?? ((sql, params) => (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX) || 3,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? undefined : { rejectUnauthorized: false },
  })).query(sql, params as unknown[]) as never);
  ready ??= (async () => { for (const sql of SCHEMA) await q(sql); })().catch((e) => { ready = null; throw e; });
  await ready;
  return q;
}

/** The key columns each tab is written with (same sets the sync/mutation code uses); only the importer below needs it. */
export const TAB_KEYS: Record<string, string[]> = {
  pages: ["page_id"], agencies: ["agency_id"], users: ["user_id"], campaigns: ["campaign_id"], ads: ["ad_id"], ad_performance: ["ad_id", "date"],
  leads: ["lead_id"], messages: ["message_id"], auto_replies: [], lead_log: [], evaluations: ["eval_id"], page_insights: ["page_id", "date"],
  post_comments: ["comment_id"], posts: ["post_id"], push_subs: ["endpoint"], notification_log: ["notification_id"], channels: ["channel_id"], import_log: ["import_id"],
};

const keyOf = (keyCols: string[], o: Record<string, unknown>) => {
  const parts = [...keyCols].sort().map((k) => String(o[k] ?? "").trim());
  return parts.join("") === "" ? null : parts.join("\u0001"); // blank key = always a new row, like the sheet
};
const clean = (o: Obj) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [norm(k), String(v ?? "")]));

/** Every tab as a grid (header row + rows), the shape the mapper already reads. */
export async function dbRead(): Promise<RawTabs> {
  const { rows } = await (await db())("select tab, data from sheet_rows order by seq");
  const byTab = new Map<string, Record<string, string>[]>();
  for (const r of rows) { const l = byTab.get(r.tab as string) ?? []; l.push(r.data as Record<string, string>); byTab.set(r.tab as string, l); }
  const out: RawTabs = {};
  for (const t of SHEET_TABS) {
    const list = byTab.get(t.tab) ?? [], headers = t.cols.map((c) => c.name);
    for (const d of list) for (const k of Object.keys(d)) if (!headers.includes(k)) headers.push(k);
    out[t.tab] = [headers, ...list.map((d) => headers.map((h) => d[h] ?? ""))];
  }
  return out;
}

export async function dbUpsert(tab: string, keyCols: string[], objs: Obj[], mode: UpsertMode): Promise<WriteResult> {
  const q = await db(), keys: (string | null)[] = [], datas: Record<string, string>[] = [], at = new Map<string, number>();
  let skipped = 0;
  for (const o of objs) { // the same key twice in one batch: merge (upsert) or keep the first (insert), as the sheet writer does
    const key = keyOf(keyCols, o), d = clean(o), i = key == null ? undefined : at.get(key);
    if (i != null) { if (mode === "insert") skipped++; else Object.assign(datas[i], d); continue; }
    if (key != null) at.set(key, keys.length);
    keys.push(key); datas.push(d);
  }
  if (!keys.length) return { updated: 0, appended: 0, skipped };
  const args = [tab, keys, datas.map((d) => JSON.stringify(d))];
  const from = "from unnest($2::text[], $3::text[]) as t(k, d)";
  if (mode === "updateOnly") {
    const r = await q(`update sheet_rows r set data = r.data || t.d::jsonb ${from} where r.tab = $1 and r.key = t.k`, args);
    return { updated: r.rowCount ?? 0, appended: 0, skipped: skipped + keys.length - (r.rowCount ?? 0) };
  }
  const conflict = mode === "insert" ? "do nothing" : "do update set data = sheet_rows.data || excluded.data";
  const r = await q(`insert into sheet_rows (tab, key, data) select $1, t.k, t.d::jsonb ${from} on conflict (tab, key) where key is not null ${conflict} returning (xmax = 0) as inserted`, args);
  const appended = r.rows.filter((x) => x.inserted).length;
  return { appended, updated: mode === "insert" ? 0 : r.rows.length - appended, skipped: skipped + (mode === "insert" ? keys.length - appended : 0) };
}

/** Rewrite a row and its key in place (legacy push credentials). */
export async function dbRewrite(tab: string, keyCol: string, oldKey: string, obj: Obj): Promise<void> {
  const q = await db(), newKey = String(obj[keyCol] ?? "").trim();
  const r = await q("update sheet_rows set data = data || $3::jsonb, key = coalesce(nullif($4, ''), key) where tab = $1 and key = $2", [tab, oldKey, JSON.stringify(clean(obj)), newKey]);
  if (r.rowCount) return;
  if (newKey && (await q("select 1 from sheet_rows where tab = $1 and key = $2", [tab, newKey])).rows.length) return;
  throw new Error(`Cannot find ${tab}.${keyCol} row to rewrite`);
}

/** Copies Sheets grids into the table (first duplicate key wins, like the sheet) and returns rows per tab for checking. */
export async function dbImport(tabs: RawTabs): Promise<Record<string, { sheet: number; db: number }>> {
  const q = await db(), out: Record<string, { sheet: number; db: number }> = {};
  for (const t of SHEET_TABS) {
    const grid = tabs[t.tab] ?? [], headers = (grid[0] ?? []).map(norm);
    const objs = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "")]).filter(([h]) => h))).filter((o) => Object.values(o).some((v) => String(v).trim()));
    for (let i = 0; i < objs.length; i += 1000) await dbUpsert(t.tab, TAB_KEYS[t.tab] ?? [], objs.slice(i, i + 1000), "insert");
    const sheetKeys = TAB_KEYS[t.tab].length ? new Set(objs.map((o) => keyOf(TAB_KEYS[t.tab], o)).filter((k) => k != null)).size + objs.filter((o) => keyOf(TAB_KEYS[t.tab], o) == null).length : objs.length;
    out[t.tab] = { sheet: sheetKeys, db: Number((await q("select count(*)::int as n from sheet_rows where tab = $1", [t.tab])).rows[0].n) };
  }
  return out;
}
