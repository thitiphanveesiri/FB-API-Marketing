import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PRE_PAINT_SCRIPT } from "@/lib/prePaint";

export const metadata: Metadata = {
  title: "Marketing Intelligence Dashboard",
  description: "Facebook Ads performance, chat quality and lead management",
  icons: { apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Marketing", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#087a58", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} /></head>
      <body>
        {children}
      </body>
    </html>
  );
}
