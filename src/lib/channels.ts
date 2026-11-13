// SERVER ONLY. Chat-channel connections (tokens live in the Google Sheet "channels" tab; they are never sent to the browser).
import { createHmac, randomBytes } from "crypto";
import { readTabs } from "./googleSheets";
import { upsertRows } from "./sheetsWrite";
import { fbConfigs, type FbPageCfg } from "./fbSync";

export type ChannelKind = "facebook" | "line" | "whatsapp" | "ads"; // "ads" = Meta Marketing API (ad account)
export interface Channel { channelId: string; channel: ChannelKind; accountId: string; name: string; accessToken: string; appSecret: string; verifyToken: string; sheetPageId: string; active: boolean; updatedAt: string }
export interface PublicChannel { channelId: string; channel: ChannelKind; accountId: string; name: string; sheetPageId: string; active: boolean; updatedAt: string; hasToken: boolean; tokenTail: string; hasSecret: boolean; verifyToken: string }

const TTL = 30_000;
let cache: { at: number; list: Channel[] } | null = null;
export const invalidateChannels = () => { cache = null; };

export async function loadChannels(fresh = false): Promise<Channel[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.list;
  const grid = (await readTabs()).channels ?? [];
  const head = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const at = (r: string[], n: string) => { const i = head.indexOf(n); return i < 0 ? "" : String(r[i] ?? "").trim(); };
  const list = grid.slice(1).filter((r) => at(r, "channel_id")).map((r): Channel => ({
    channelId: at(r, "channel_id"), channel: (at(r, "channel").toLowerCase() || "facebook") as ChannelKind, accountId: at(r, "account_id"), name: at(r, "name"),
    accessToken: at(r, "access_token"), appSecret: at(r, "app_secret"), verifyToken: at(r, "verify_token"), sheetPageId: at(r, "sheet_page_id"),
    active: at(r, "active").toLowerCase() !== "false", updatedAt: at(r, "updated_at"),
  }));
  cache = { at: Date.now(), list };
  return list;
}

export const toPublic = (c: Channel): PublicChannel => ({
  channelId: c.channelId, channel: c.channel, accountId: c.accountId, name: c.name, sheetPageId: c.sheetPageId, active: c.active, updatedAt: c.updatedAt,
  hasToken: !!c.accessToken, tokenTail: c.accessToken ? c.accessToken.slice(-4) : "", hasSecret: !!c.appSecret, verifyToken: c.verifyToken,
});

export const newVerifyToken = () => `vt_${randomBytes(12).toString("hex")}`;

/** A verify token that exists BEFORE any page is connected, so it can be pasted into Meta first. Same value on every deploy: FB_WEBHOOK_VERIFY_TOKEN
 *  if set, otherwise derived from AUTH_SECRET (never shown as the secret itself). "" when neither is configured. */
export function defaultVerifyToken(): string {
  const env = process.env.FB_WEBHOOK_VERIFY_TOKEN?.trim(); if (env) return env;
  const s = process.env.AUTH_SECRET?.trim(); if (!s) return "";
  return `vt_${createHmac("sha256", s).update("fb-webhook-verify").digest("hex").slice(0, 24)}`;
}

export async function saveChannel(c: Partial<Channel> & { channelId: string; channel: ChannelKind }) {
  const row: Record<string, string | boolean> = { channel_id: c.channelId, channel: c.channel, updated_at: new Date().toISOString() };
  if (c.accountId !== undefined) row.account_id = c.accountId;
  if (c.name !== undefined) row.name = c.name;
  if (c.accessToken) row.access_token = c.accessToken;      // blank = keep the stored one
  if (c.appSecret) row.app_secret = c.appSecret;
  if (c.verifyToken) row.verify_token = c.verifyToken;
  if (c.sheetPageId !== undefined) row.sheet_page_id = c.sheetPageId;
  if (c.active !== undefined) row.active = c.active;
  await upsertRows("channels", ["channel_id"], [row], "upsert");
  invalidateChannels();
}

/** Facebook pages usable for backfilling (env variables first, then pages connected on the Upload page). */
export async function fbSyncConfigs(): Promise<FbPageCfg[]> {
  const out = [...fbConfigs()];
  try {
    for (const c of await loadChannels()) if (c.channel === "facebook" && c.active && c.accessToken && c.accountId && !out.some((o) => o.fbPageId === c.accountId))
      out.push({ fbPageId: c.accountId, token: c.accessToken, sheetPageId: c.sheetPageId || undefined });
  } catch { /* sheet unreachable: env pages only */ }
  return out;
}
