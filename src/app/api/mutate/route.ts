import { connection, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfigured, resolveUser, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getCached, invalidateCache, setCached } from "@/lib/sheetCache";
import { readTabs, sheetsConfigured } from "@/lib/googleSheets";
import { mapSheets } from "@/lib/sheetMapper";
import { Denied, Op, planOp } from "@/lib/mutations";
import { upsertRows } from "@/lib/sheetsWrite";
import { loadChannels, saveChannel } from "@/lib/channels";

const noStore = { headers: { "Cache-Control": "no-store" } };
const stamp = () => { // "YYYY-MM-DD HH:MM" in the business time zone, not the server's
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TZ || "Asia/Bangkok", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

export async function POST(req: Request) {
  await connection();
  if (!sheetsConfigured()) return NextResponse.json({ ok: false, message: "No Google Sheet is connected." }, { status: 503, ...noStore });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ ok: false, message: "Bad origin" }, { status: 403, ...noStore });
  let session = null as { email: string; name: string } | null;
  if (authConfigured()) { session = verifySession((await cookies()).get(SESSION_COOKIE)?.value); if (!session) return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401, ...noStore }); }
  else if (process.env.ALLOW_PUBLIC !== "1") return NextResponse.json({ ok: false, message: "Sign-in is not configured." }, { status: 503, ...noStore });
  try {
    const op = (await req.json()) as Op;
    const mapped = getCached() ?? mapSheets(await readTabs());
    setCached(mapped);
    const me = session ? resolveUser(mapped.dataset, session.email, session.name) : mapped.dataset.users.find((u) => u.role === "Administrator") ?? null;
    if (!me) return NextResponse.json({ ok: false, message: "This account has no access." }, { status: 403, ...noStore });
    const writes = planOp(op, me, mapped.dataset, stamp());
    const results = [];
    for (const w of writes) results.push(await upsertRows(w.tab, w.keyCols, w.rows, w.mode));
    // a merged page must not be written to again: point the chat channels at the page the data now lives on
    if (op.t === "pages.merge") for (const c of await loadChannels(true)) if (c.sheetPageId === op.from) await saveChannel({ channelId: c.channelId, channel: c.channel, sheetPageId: op.to });
    invalidateCache();
    return NextResponse.json({ ok: true, results }, noStore);
  } catch (e) {
    if (e instanceof Denied) return NextResponse.json({ ok: false, message: e.message }, { status: e.status, ...noStore });
    console.error("[api/mutate]", e);
    invalidateCache();
    return NextResponse.json({ ok: false, message: "Saving to the Google Sheet failed. Check that the service account is an Editor of the sheet." }, { status: 502, ...noStore });
  }
}
