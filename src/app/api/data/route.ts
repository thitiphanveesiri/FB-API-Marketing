import { connection, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { authConfigured, resolveUser, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { scopeDataset } from "@/lib/authz";
import type { Dataset } from "@/lib/seed";

const noStore = { headers: { "Cache-Control": "no-store" } };
// Tiny per-instance cache of the SHEET (not of any user's response) so many viewers don't each hit the Sheets API quota.
let cache: { at: number; mapped: ReturnType<typeof mapSheets> } | null = null;
const TTL_MS = 60_000;

export async function GET(req: Request) {
  await connection(); // per-request: env vars, cookies and the sheet must be read at request time
  const sheets = sheetsConfigured();
  const auth = authConfigured();
  if (sheets && !auth && process.env.ALLOW_PUBLIC !== "1")
    return NextResponse.json({ source: "error", message: "Sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET (see docs/DEPLOY.md). The sheet data stays locked until then." }, { status: 503, ...noStore });

  const session = auth ? verifySession((await cookies()).get(SESSION_COOKIE)?.value) : null;
  if (auth && !session) return NextResponse.json({ source: "unauthenticated" }, { status: 401, ...noStore });

  if (!sheets) { // demo data lives in the browser; auth (if on) still gates the pages
    return NextResponse.json({ source: "demo", me: session ? { email: session.email, name: session.name } : null }, noStore);
  }
  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    if (fresh || !cache || Date.now() - cache.at >= TTL_MS) cache = { at: Date.now(), mapped: mapSheets(await readTabs()) };
    const { dataset, warnings, counts, missingTabs } = cache.mapped;
    let scoped: Dataset = dataset;
    let me = null as { id: string; role: string } | null;
    if (session) {
      const u = resolveUser(dataset, session.email, session.name);
      if (!u) return NextResponse.json({ source: "forbidden", email: session.email }, { status: 403, ...noStore });
      scoped = scopeDataset(dataset, u);
      if (!scoped.users.some((x) => x.id === u.id)) scoped = { ...scoped, users: [u, ...scoped.users] };
      me = { id: u.id, role: u.role };
    }
    const isAdmin = !me || me.role === "Administrator";
    return NextResponse.json({ source: "sheets", me, dataset: scoped, warnings: isAdmin ? warnings.slice(0, 200) : [], warningCount: isAdmin ? warnings.length : 0,
      counts: isAdmin ? counts : undefined, missingTabs: isAdmin ? missingTabs : [], fetchedAt: new Date().toISOString() }, noStore);
  } catch (e) {
    console.error("[api/data]", e); // details stay in server logs; the browser gets a generic message
    return NextResponse.json({ source: "error", message: "Could not read the Google Sheet. Check the Vercel environment variables, the sheet ID and sharing." }, { status: 502, ...noStore });
  }
}
