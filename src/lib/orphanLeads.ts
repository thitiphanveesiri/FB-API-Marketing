// Leads whose page_id has no row in the pages tab are skipped when the sheet is read (they never reach the Inbox or Board). This finds them.
import type { RawTabs } from "./sheetMapper";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const grid = (tabs: RawTabs, name: string) => { const k = Object.keys(tabs).find((t) => norm(t) === name); return k ? tabs[k] : []; };

export interface Orphan { pageId: string; leadIds: string[] }
/** page_ids used by leads but missing from the pages tab, with the lead ids that point to each. */
export function findOrphanLeads(tabs: RawTabs): Orphan[] {
  const pages = grid(tabs, "pages"), leads = grid(tabs, "leads");
  const ph = (pages[0] ?? []).map(norm), pi = ph.indexOf("page_id");
  const known = new Set(pi < 0 ? [] : pages.slice(1).map((r) => String(r[pi] ?? "").trim()).filter(Boolean));
  const lh = (leads[0] ?? []).map(norm), li = lh.indexOf("lead_id"), lp = lh.indexOf("page_id");
  if (li < 0 || lp < 0) return [];
  const by = new Map<string, string[]>();
  for (const r of leads.slice(1)) {
    const id = String(r[li] ?? "").trim(), page = String(r[lp] ?? "").trim();
    if (!id || known.has(page)) continue; // a blank page_id is also unusable, so it is listed too
    (by.get(page) ?? by.set(page, []).get(page)!).push(id);
  }
  return [...by.entries()].map(([pageId, leadIds]) => ({ pageId, leadIds }));
}
