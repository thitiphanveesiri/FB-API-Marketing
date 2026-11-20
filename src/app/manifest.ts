import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BEQ", short_name: "BEQ", description: "แชท โฆษณา และ SLA ของทีมขาย",
    start_url: "/inbox", scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#087a58", lang: "th",
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
