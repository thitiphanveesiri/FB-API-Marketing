// SERVER ONLY. Keep each Facebook page mapped to its matching system page.
import type { FbPage } from "./types";
import type { Channel } from "./channels";
import { upsertRows } from "./sheetsWrite";
import { saveChannel } from "./channels";

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const systemPageIdFor = (fbPageId: string) => `FB-${fbPageId}`;

export type PagePick = { id: string; create: false } | { id: string; create: true; name: string };

export function pickSystemPage(
  pages: Pick<FbPage, "id" | "name">[],
  channels: Pick<Channel, "channelId" | "sheetPageId">[],
  fbPageId: string,
  fbName: string,
): PagePick {
  const exists = (id: string) => !!id && pages.some((page) => page.id === id);
  const mapped = channels.find((channel) => channel.channelId === `facebook:${fbPageId}`)?.sheetPageId ?? "";
  if (exists(mapped)) return { id: mapped, create: false };
  const own = systemPageIdFor(fbPageId);
  if (exists(own)) return { id: own, create: false };
  const same = fbName ? pages.filter((page) => norm(page.name) === norm(fbName)) : [];
  if (same.length === 1) return { id: same[0].id, create: false };
  return { id: own, create: true, name: fbName.trim() || `Facebook ${fbPageId}` };
}

export async function fetchPageName(fbPageId: string, token: string, base = process.env.FB_GRAPH_BASE || "https://graph.facebook.com"): Promise<string> {
  try {
    const response = await fetch(`${base}/v21.0/${fbPageId}?${new URLSearchParams({ fields: "name", access_token: token })}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const result = (await response.json().catch(() => ({}))) as { name?: string };
    return response.ok ? (result.name ?? "").trim() : "";
  } catch { return ""; }
}

export async function ensureSystemPage(input: {
  pages: Pick<FbPage, "id" | "name">[];
  channels: Channel[];
  fbPageId: string;
  name: string;
  remember?: boolean;
}): Promise<{ id: string; created: boolean }> {
  const pick = pickSystemPage(input.pages, input.channels, input.fbPageId, input.name);
  if (pick.create) await upsertRows("pages", ["page_id"], [{ page_id: pick.id, name: pick.name, active: true }], "insert");
  const channel = input.channels.find((item) => item.channelId === `facebook:${input.fbPageId}`);
  if (input.remember !== false && channel && channel.sheetPageId !== pick.id) {
    await saveChannel({ channelId: channel.channelId, channel: "facebook", sheetPageId: pick.id });
  }
  return { id: pick.id, created: pick.create };
}
