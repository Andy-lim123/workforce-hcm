import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/placeholder";
import { RequireRole } from "@/components/app-shell";
import { Alert } from "@/components/ui";
import { hoursText, summarize } from "@/lib/attendance-report";
import { createClient } from "@/lib/supabase/server";
import { addDays, headcountState, toManilaParts, weekBoundsUtc, weekRangeLabel, weekStartManila } from "@/lib/scheduling";
import { loadAttendanceRows } from "./reports/attendance-data";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminDashboard() {
  return (
    <RequireRole role="admin">
      <PageHeader title="Dashboard" description="Workforce overview for this week, with attendance and overtime for the last 30 days." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Figures />
      </Suspense>
    </RequireRole>
  );
}

async function Figures() {
  const supabase = await createClient();

  // "now" is read after the request-bound work starts, so it is never baked into a prerendered shell.
  const now = new Date();
  const weekStart = weekStartManila(now);
  const { start, end } = weekBoundsUtc(weekStart);

  const [employees, shifts, attendance] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("shifts")
      .select("id, status, required_headcount, assignments:shift_assignments(count)")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString()),
    loadAttendanceRows(supabase, addDays(toManilaParts(now).date, -30)),
  ]);

  if (employees.error || shifts.error || !shifts.data || attendance === "error")
    return <Alert tone="error">Could not load the dashboard figures. Refresh the page to try again.</Alert>;

  const live = shifts.data.filter((s) => s.status !== "cancelled");
  const short = live.filter((s) => ["unfilled", "under"].includes(headcountState(s.assignments[0]?.count ?? 0, s.required_headcount, s.status))).length;
  const draft = live.filter((s) => s.status === "draft").length;
  const { total } = summarize(attendance.rows);

  const cards = [
    { label: "Active employees", value: String(employees.count ?? 0), note: "Currently employed", href: "/admin/employees" },
    { label: "Shifts this week", value: String(live.length), note: `${weekRangeLabel(weekStart)}${draft ? ` · ${draft} draft` : ""}`, href: "/admin/schedules" },
    { label: "Unfilled shifts", value: String(short), note: short ? "Fewer people than required" : "Every shift is covered", href: "/admin/schedules", tone: short ? "amber" : "green" },
    { label: "Overtime hours", value: hoursText(total.overtimeMin), note: `Last 30 days · ${total.late} late arrival(s)`, href: "/admin/reports", tone: total.overtimeMin ? "amber" : undefined },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="rounded-xl border border-zinc-200 bg-white p-3 hover:border-teal-600/50 sm:p-5">
          <p className="text-sm text-zinc-500">{c.label}</p>
          <p className={`mt-2 text-2xl font-semibold ${"tone" in c && c.tone === "amber" ? "text-amber-700" : "tone" in c && c.tone === "green" ? "text-emerald-700" : "text-zinc-900"}`}>{c.value}</p>
          <p className="mt-1 text-xs text-zinc-500">{c.note}</p>
        </Link>
      ))}
    </div>
  );
}
