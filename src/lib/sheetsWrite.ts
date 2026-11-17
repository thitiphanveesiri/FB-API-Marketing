// SERVER ONLY. Writes rows to the Google Sheet (service account must be an EDITOR) or to the local JSON file used in tests.
import { readFile, writeFile, rename } from "fs/promises";
import { applyPlan, norm, Obj, planUpsert, UpsertMode } from "./sheetOps";
import { SHEET_TABS } from "./sheetSchema";
import { accessToken, forgetSheetTitles, sheetTitles, sheetsFetch } from "./googleSheets";

export interface WriteResult { updated: number; appended: number; skipped: number }
let chain: Promise<unknown> = Promise.resolve();
/** One write at a time per server instance, so read-plan-write cycles cannot interleave. */
export function serialized<T>(fn: () => Promise<T>): Promise<T> { const r = chain.then(fn, fn); chain = r.catch(() => undefined); return r; }

const A1 = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const colLetter = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export async function upsertRows(tab: string, keyCols: string[], objs: Obj[], mode: UpsertMode): Promise<WriteResult> {
  if (!SHEET_TABS.some((t) => t.tab === tab)) throw new Error(`Unknown tab ${tab}`);
  if (objs.length === 0) return { updated: 0, appended: 0, skipped: 0 };
  return serialized(async () => {
    if (process.env.SHEETS_LOCAL_JSON) { // dev/testing backend
      const file = process.env.SHEETS_LOCAL_JSON;
      const all = JSON.parse(await readFile(file, "utf8")) as Record<string, string[][]>;
      const plan = planUpsert(all[tab] ?? [], keyCols, objs, mode);
      all[tab] = applyPlan(all[tab] ?? [], plan);
      await writeFile(`${file}.tmp`, JSON.stringify(all)); await rename(`${file}.tmp`, file);
      return { updated: plan.updated, appended: plan.appended, skipped: plan.skipped };
    }
    const id = process.env.GOOGLE_SHEET_ID!;
    const auth = { Authorization: `Bearer ${await accessToken(true)}`, "Content-Type": "application/json" };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
    const call = async (url: string, init?: RequestInit) => {
      const r = await sheetsFetch(url, { ...init, headers: { ...auth, ...(init?.headers ?? {}) }, cache: "no-store" });
      if (!r.ok) throw new Error(`Google Sheets ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return r.json();
    };
    // find the real tab title (case-insensitive) or create it
    let title = (await sheetTitles(auth)).find((t) => t.trim().toLowerCase() === tab) ?? (await sheetTitles(auth, true)).find((t) => t.trim().toLowerCase() === tab); // not in the remembered list: look again before creating
    let grid: string[][] = [];
    if (!title) { await call(`${base}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }) }); title = tab; forgetSheetTitles(); }
    else grid = ((await call(`${base}/values/${encodeURIComponent(A1(title))}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`)) as { values?: (string | number | boolean)[][] }).values?.map((r) => r.map((c) => String(c))) ?? [];
    const plan = planUpsert(grid, keyCols, objs, mode);
    const data: { range: string; values: unknown[][] }[] = [];
    for (const h of plan.headerAdds) data.push({ range: `${A1(title)}!${colLetter(h.col)}1`, values: [[h.name]] });
    for (const u of plan.updates) data.push({ range: `${A1(title)}!${colLetter(u.col)}${u.row}`, values: [[u.value]] });
    for (let i = 0; i < data.length; i += 500) await call(`${base}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: data.slice(i, i + 500) }) });
    for (let i = 0; i < plan.appends.length; i += 1000)
      await call(`${base}/values/${encodeURIComponent(`${A1(title)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: plan.appends.slice(i, i + 1000) }) });
    return { updated: plan.updated, appended: plan.appended, skipped: plan.skipped };
  });
}

/** Rewrite a row and its key in place, used to remove legacy plaintext push credentials. */
export async function rewriteRow(tab: string, keyCol: string, oldKey: string, obj: Obj): Promise<void> {
  if (!SHEET_TABS.some((t) => t.tab === tab)) throw new Error(`Unknown tab ${tab}`);
  return serialized(async () => {
    if (process.env.SHEETS_LOCAL_JSON) {
      const file = process.env.SHEETS_LOCAL_JSON;
      const all = JSON.parse(await readFile(file, "utf8")) as Record<string, string[][]>;
      const grid = all[tab] ?? [];
      const headers = grid[0] ?? [];
      const keyIndex = headers.findIndex((header) => norm(header) === norm(keyCol));
      const rowIndex = keyIndex < 0 ? -1 : grid.findIndex((row, i) => i > 0 && String(row[keyIndex] ?? "").trim() === oldKey);
      if (rowIndex < 0 && keyIndex >= 0 && String(obj[keyCol] ?? "").trim() &&
        grid.slice(1).some((row) => String(row[keyIndex] ?? "").trim() === String(obj[keyCol]).trim())) return;
      if (rowIndex < 0) throw new Error(`Cannot find ${tab}.${keyCol} row to rewrite`);
      const row = [...grid[rowIndex]];
      for (const [name, value] of Object.entries(obj)) {
        let col = headers.findIndex((header) => norm(header) === norm(name));
        if (col < 0) { col = headers.length; headers.push(name); }
        row[col] = String(value ?? "");
      }
      while (row.length < headers.length) row.push("");
      grid[0] = headers;
      grid[rowIndex] = row;
      all[tab] = grid;
      await writeFile(`${file}.tmp`, JSON.stringify(all)); await rename(`${file}.tmp`, file);
      return;
    }

    const id = process.env.GOOGLE_SHEET_ID!;
    const auth = { Authorization: `Bearer ${await accessToken(true)}`, "Content-Type": "application/json" };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
    const call = async (url: string, init?: RequestInit) => {
      const response = await sheetsFetch(url, { ...init, headers: { ...auth, ...(init?.headers ?? {}) }, cache: "no-store" });
      if (!response.ok) throw new Error(`Google Sheets ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return response.json();
    };
    const title = (await sheetTitles(auth)).find((name) => name.trim().toLowerCase() === tab);
    if (!title) throw new Error(`Cannot find ${tab} tab to rewrite`);
    const result = (await call(`${base}/values/${encodeURIComponent(A1(title))}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`)) as { values?: (string | number | boolean)[][] };
    const grid = result.values?.map((row) => row.map(String)) ?? [];
    const headers = grid[0] ?? [];
    const keyIndex = headers.findIndex((header) => norm(header) === norm(keyCol));
    const rowIndex = keyIndex < 0 ? -1 : grid.findIndex((row, i) => i > 0 && String(row[keyIndex] ?? "").trim() === oldKey);
    if (rowIndex < 0 && keyIndex >= 0 && String(obj[keyCol] ?? "").trim() &&
      grid.slice(1).some((row) => String(row[keyIndex] ?? "").trim() === String(obj[keyCol]).trim())) return;
    if (rowIndex < 0) throw new Error(`Cannot find ${tab}.${keyCol} row to rewrite`);
    const row = [...grid[rowIndex]];
    for (const [name, value] of Object.entries(obj)) {
      let col = headers.findIndex((header) => norm(header) === norm(name));
      if (col < 0) {
        col = headers.length;
        headers.push(name);
        await call(`${base}/values/${encodeURIComponent(`${A1(title)}!${colLetter(col)}1`)}?valueInputOption=RAW`, {
          method: "PUT", body: JSON.stringify({ values: [[name]] }),
        });
      }
      row[col] = String(value ?? "");
    }
    while (row.length < headers.length) row.push("");
    await call(`${base}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: [{ range: `${A1(title)}!A${rowIndex + 1}:${colLetter(headers.length - 1)}${rowIndex + 1}`, values: [row] }] }),
    });
  });
}
