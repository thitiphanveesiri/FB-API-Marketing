// Pure. Matches the salesperson name written in an uploaded file to a user in Settings, so a slightly different
// spelling does not create a duplicate Sales Representative. Honors honorifics (คุณ / Mr. …), a missing surname
// and small typos; two names that are equally close are left unmatched instead of guessing.
export interface NamedUser { id: string; name: string }
export interface RepMatch { id: string; name: string; score: number }

const HONORIFIC_TH = /^(?:คุณ|นาย|นางสาว|นาง|น\.ส\.)\s*/;
const HONORIFIC_EN = /^(?:mr|mrs|ms|miss)\.?\s+/i;
export const repKey = (name: string) => String(name ?? "").replace(/\s+/g, " ").trim().replace(HONORIFIC_TH, "").replace(HONORIFIC_EN, "").trim().toLowerCase();

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** 1 = same name, 0.9 = the same first word ("บดินทร์" ≈ "บดินทร์ แจ่ม"), otherwise the typo similarity. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = a.split(" "), bt = b.split(" ");
  if (at.length === 1 && bt.length > 1 && at[0].length >= 3 && at[0] === bt[0]) return 0.9;
  if (bt.length === 1 && at.length > 1 && bt[0].length >= 3 && at[0] === bt[0]) return 0.9;
  if (Math.max(a.length, b.length) < 4) return 0; // too short for a typo to be meaningful
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

export const REP_MATCH_MIN = 0.82;

export function matchUser(input: string, users: NamedUser[]): RepMatch | null {
  const k = repKey(input);
  if (!k) return null;
  let best: RepMatch | null = null, runnerUp = 0;
  for (const user of users) {
    const score = similarity(k, repKey(user.name));
    if (!best || score > best.score) { runnerUp = Math.max(runnerUp, best?.score ?? 0); best = { id: user.id, name: user.name, score }; }
    else if (score > runnerUp) runnerUp = score;
  }
  if (!best || best.score < REP_MATCH_MIN) return null;
  if (runnerUp >= best.score - 0.05) return null; // two people fit equally well
  return best;
}
