import { connection, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { authConfigured, resolveUser, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { scopeDataset } from "@/lib/authz";
import type { Dataset } from "@/lib/dataset";
import { getCached, setCached } from "@/lib/sheetCache";

const noStore = { headers: { "Cache-Control": "no-store" } };

/** sheet page id → Facebook page id from the channel connections: lets the Board open that page's inbox in Meta Business Suite.
 *  Page ids are public (they are in every page URL); tokens stay on the server. */
function facebookPageIds(channels: string[][] | undefined): Record<string, string> {
  const head = (channels?.[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const at = (row: string[], name: string) => { const i = head.indexOf(name); return i < 0 ? "" : String(row[i] ?? "").trim(); };
  const out: Record<string, string> = {};
  for (const row of channels?.slice(1) ?? []) {
    const page = at(row, "sheet_page_id"), id = at(row, "account_id");
    if (at(row, "channel").toLowerCase() === "facebook" && page && id && at(row, "active").toLowerCase() !== "false" && !out[page]) out[page] = id;
  }
  return out;
}

export async function GET(req: Request) {
  await connection(); // per-request: env vars, cookies and the sheet must be read at request time
  const sheets = sheetsConfigured();
  const auth = authConfigured();
  if (sheets && !auth && process.env.ALLOW_PUBLIC !== "1")
    return NextResponse.json({ source: "error", message: "Sign-in is not configured. Set AUTH_SECRET (32+ characters, see docs/DEPLOY.md). The sheet data stays locked until then." }, { status: 503, ...noStore });

  const session = auth ? verifySession((await cookies()).get(SESSION_COOKIE)?.value) : null;
  if (auth && !session) return NextResponse.json({ source: "unauthenticated" }, { status: 401, ...noStore });

  if (!sheets) return NextResponse.json({ source: "setup" }, noStore); // nothing connected yet: the app shows how to connect the Sheet
  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    let mapped = fresh ? null : getCached();
    const tabs = await readTabs(fresh); // 15 s cache: also holds the channel → Facebook page mapping
    if (!mapped) { mapped = mapSheets(tabs); setCached(mapped); }
    const { dataset, warnings, counts, missingTabs } = mapped;
    let scoped: Dataset = dataset;
    let me = null as { id: string; role: string } | null;
    if (session) {
      const u = resolveUser(dataset, session.uid);
      if (!u) return NextResponse.json({ source: "forbidden", email: session.name }, { status: 403, ...noStore });
      scoped = scopeDataset(dataset, u);
      if (!scoped.users.some((x) => x.id === u.id)) scoped = { ...scoped, users: [u, ...scoped.users] };
      me = { id: u.id, role: u.role };
    }
    const isAdmin = !me || me.role === "Administrator";
    return NextResponse.json({ source: "sheets", me, dataset: scoped, warnings: isAdmin ? warnings.slice(0, 200) : [], warningCount: isAdmin ? warnings.length : 0,
      counts: isAdmin ? counts : undefined, missingTabs: isAdmin ? missingTabs : [], fbPages: facebookPageIds(tabs.channels), fetchedAt: new Date().toISOString() }, noStore);
  } catch (e) {
    console.error("[api/data]", e); // details stay in server logs; the browser gets a generic message
    return NextResponse.json({ source: "error", message: "Could not read the Google Sheet. Check the Vercel environment variables, the sheet ID and sharing." }, { status: 502, ...noStore });
  }
}
