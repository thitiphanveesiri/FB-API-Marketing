const SHAPE = /^v\d+\.\d+$/;

/** Graph API version from META_API_VERSION (accepts "21.0" or "v21.0"), else the caller's default. */
export function metaApiVersion(fallback = "v21.0"): string {
  const raw = (process.env.META_API_VERSION ?? "").trim();
  if (!raw) return fallback;
  const v = `v${raw.replace(/^v/i, "")}`;
  return SHAPE.test(v) ? v : fallback;
}
