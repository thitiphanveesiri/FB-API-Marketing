import DashboardLayoutClient from "./DashboardLayoutClient";

export const instant = false;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
