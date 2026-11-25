import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: { template: "%s · Workforce", default: "My dashboard · Workforce" } };

const nav = [
  { href: "/me", label: "Dashboard", short: "Home" },
  { href: "/me/schedule", label: "My schedule", short: "Schedule" },
  { href: "/me/telegram", label: "Telegram" },
  // Availability, Attendance and Profile are not built yet, so they are not linked from the menu. The routes still exist.
];

export default function EmployeeLayout({ children }: LayoutProps<"/me">) {
  return (
    <AppShell areaLabel="Employee" nav={nav}>
      {children}
    </AppShell>
  );
}
