import type { Metadata } from "next";
import "./globals.css";
import { PRE_PAINT_SCRIPT } from "@/lib/prePaint";

export const metadata: Metadata = {
  title: "Marketing Intelligence Dashboard",
  description: "Facebook Ads performance, chat quality and lead management",
};

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
