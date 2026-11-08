import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import AppShell from "@/components/AppShell";
import { PRE_PAINT_SCRIPT } from "@/lib/prePaint";

export const metadata: Metadata = {
  title: "Marketing Intelligence Dashboard",
  description: "Facebook Ads performance, chat quality and lead management (demo data)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} /></head>
      <body>
        <StoreProvider>
          <AppShell>{children}</AppShell>
        </StoreProvider>
      </body>
    </html>
  );
}
