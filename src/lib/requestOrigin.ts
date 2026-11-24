function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function isSameOrigin(req: Request, publicUrl = process.env.AUTH_URL): boolean {
  const origin = originOf(req.headers.get("origin"));
  if (!origin) return !req.headers.has("origin");

  const requestUrl = (() => {
    try { return new URL(req.url); } catch { return null; }
  })();
  const allowed = new Set<string>();
  if (requestUrl) allowed.add(requestUrl.origin);
  const configuredOrigin = originOf(publicUrl);
  if (configuredOrigin) allowed.add(configuredOrigin);

  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : requestUrl?.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host")?.trim();
  if (host && protocol) {
    const hostOrigin = originOf(`${protocol}://${host}`);
    if (hostOrigin) allowed.add(hostOrigin);
  }
  return allowed.has(origin);
}
