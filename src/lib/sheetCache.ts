// Per-instance cache of the mapped sheet. Writes invalidate it so the next read is fresh.
import type { MapResult } from "./sheetMapper";
let cache: { at: number; mapped: MapResult } | null = null;
export const TTL_MS = 60_000;
export const getCached = () => (cache && Date.now() - cache.at < TTL_MS ? cache.mapped : null);
export const setCached = (mapped: MapResult) => { cache = { at: Date.now(), mapped }; };
export const invalidateCache = () => { cache = null; };
