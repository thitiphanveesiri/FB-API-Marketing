// SERVER ONLY. Reads tabs from a Google Sheet with a service account (no extra dependencies).
import { createSign } from "crypto";
import { readFile } from "fs/promises";
import { TAB_NAMES } from "./sheetSchema";
import { RawTabs } from "./sheetMapper";

const SCOPE_RO = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SCOPE_RW = "https://www.googleapis.com/auth/spreadsheets";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

export function sheetsConfigured(): boolean {
  return !!process.env.SHEETS_LOCAL_JSON || !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

const tokenCache: Record<string, { token: string; exp: number } | undefined> = {};
export async function accessToken(write = false): Promise<string> {
  const scope = write ? SCOPE_RW : SCOPE_RO; const hit = tokenCache[scope];
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const key = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({ iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64u(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache[scope] = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Reads every known tab that exists in the spreadsheet. Missing optional tabs are simply absent from the result. */
export async function readTabs(): Promise<RawTabs> {
  if (process.env.SHEETS_LOCAL_JSON) return JSON.parse(await readFile(process.env.SHEETS_LOCAL_JSON, "utf8")) as RawTabs; // dev/testing only
  const id = process.env.GOOGLE_SHEET_ID!;
  const auth = { Authorization: `Bearer ${await accessToken()}` };
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`, { headers: auth, cache: "no-store" });
  if (!meta.ok) throw new Error(`Cannot open the spreadsheet (${meta.status}). Check GOOGLE_SHEET_ID and that the sheet is shared with the service account.`);
  const titles = ((await meta.json()) as { sheets: { properties: { title: string } }[] }).sheets.map((s) => s.properties.title);
  const wanted = titles.filter((t) => TAB_NAMES.includes(t.trim().toLowerCase()));
  if (wanted.length === 0) return {};
  const qs = wanted.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join("&");
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${qs}&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, { headers: auth, cache: "no-store" });
  if (!res.ok) throw new Error(`Reading the sheet failed (${res.status}).`);
  const j = (await res.json()) as { valueRanges: { range: string; values?: (string | number | boolean)[][] }[] };
  const out: RawTabs = {};
  j.valueRanges.forEach((vr, i) => { out[wanted[i].trim().toLowerCase()] = (vr.values ?? []).map((row) => row.map((c) => String(c))); });
  return out;
}
