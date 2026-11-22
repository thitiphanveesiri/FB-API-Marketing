import type { PageRule } from "./adsSync";

/** Campaign-name rules copied from the BEQ reference dashboard. The Page IDs below are B's IDs;
 *  when they are not present in A, the resolver finds a unique existing A Page by its name.
 *  No keyword column is required in Google Sheets. */
export const DEFAULT_FB_RULES: { fbPageId: string; keywords: string[] }[] = [
  { fbPageId: "109373461849494", keywords: ["danai", "dr-danai"] },
  { fbPageId: "122342237846683", keywords: ["beq"] },
];

type FbRule = { fbPageId: string; keywords: string[] };

function envRules(raw: string | undefined): FbRule[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const rules = parsed.flatMap((item: unknown): FbRule[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as { fbPageId?: unknown; keywords?: unknown };
      if (typeof value.fbPageId !== "string" || !Array.isArray(value.keywords)) return [];
      const fbPageId = value.fbPageId.replace(/\D/g, "");
      const keywords = value.keywords.map((keyword: unknown) => String(keyword).trim()).filter(Boolean);
      return fbPageId && keywords.length ? [{ fbPageId, keywords }] : [];
    });
    return rules.length ? rules : null;
  } catch {
    return null;
  }
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Resolve B's external Page IDs through A's connected-page map. If those IDs differ, a name keyword is accepted only
 *  when it points to exactly one existing system Page; ambiguous or missing Pages are skipped instead of guessed. */
export function defaultPageRules(
  pageMap: Record<string, string>,
  knownPageIds: Set<string>,
  env = process.env.AD_PAGE_RULES,
  pageNames: Record<string, string> = {},
): PageRule[] {
  const out: PageRule[] = [];
  for (const rule of envRules(env) ?? DEFAULT_FB_RULES) {
    const direct = pageMap[rule.fbPageId] ?? (knownPageIds.has(`FB-${rule.fbPageId}`) ? `FB-${rule.fbPageId}` : "");
    let target = direct && knownPageIds.has(direct) ? direct : "";
    if (!target) {
      const needles = rule.keywords.filter((keyword) => keyword !== "*").map(normalize).filter(Boolean);
      const aliases = rule.fbPageId === "109373461849494" ? [...needles, "ดนัย"] : needles;
      const matches = new Set(Object.entries(pageNames)
        .filter(([pageId, name]) => knownPageIds.has(pageId) && aliases.some((needle) => normalize(name).includes(needle)))
        .map(([pageId]) => pageId));
      if (matches.size === 1) target = [...matches][0];
    }
    if (target) out.push({ pageId: target, keywords: rule.keywords });
  }
  return out;
}
