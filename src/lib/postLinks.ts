const HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "instagram.com", "www.instagram.com"]);

export function postLink(postId: string): { href: string; site: "Facebook" | "Instagram" } | null {
  const value = postId.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    return /^[a-zA-Z0-9_-]+$/.test(value) ? { href: `https://www.facebook.com/${value}`, site: "Facebook" } : null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;
    return { href: url.toString(), site: url.hostname.toLowerCase().includes("instagram") ? "Instagram" : "Facebook" };
  } catch {
    return null;
  }
}
