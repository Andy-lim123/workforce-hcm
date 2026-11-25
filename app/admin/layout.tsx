import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: { template: "%s · Admin · Workforce", default: "Admin · Workforce" } };

const nav = [
  { href: "/admin", label: "Dashboard", short: "Home" },
  { href: "/admin/employees", label: "Employees" },
  { href: "/admin/departments", label: "Departments", more: true },
  { href: "/admin/positions", label: "Positions", more: true },
  { href: "/admin/schedules", label: "Schedules" },
  { href: "/admin/reports", label: "Reports" },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <AppShell areaLabel="Administrator" nav={nav}>
      {children}
    </AppShell>
  );
}
