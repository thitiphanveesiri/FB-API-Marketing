import { StoreProvider } from "@/lib/store";
import AppShell from "@/components/AppShell";

export const instant = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
