import { connection, NextResponse } from "next/server";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";


// Tiny per-instance cache so many viewers don't each hit the Sheets API quota.
let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 60_000;

export async function GET(req: Request) {
  await connection(); // opt out of build-time prerendering: env vars and the sheet must be read per request
  if (!sheetsConfigured()) return NextResponse.json({ source: "demo" });
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);
  try {
    const { dataset, warnings, counts, missingTabs } = mapSheets(await readTabs());
    const body = { source: "sheets", dataset, warnings: warnings.slice(0, 200), warningCount: warnings.length, counts, missingTabs, fetchedAt: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    console.error("[api/data]", e); // details stay in server logs; the browser gets a generic message
    return NextResponse.json({ source: "error", message: "Could not read the Google Sheet. Check the Vercel environment variables, the sheet ID and sharing." }, { status: 502 });
  }
}
