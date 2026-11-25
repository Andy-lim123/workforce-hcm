import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDayHeading, formatTimeRange, toManilaParts, weekBoundsUtc, weekStartManila } from "@/lib/scheduling";

export const metadata: Metadata = { title: "My dashboard" };

const UPCOMING = 4;

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <EmployeeDashboard />
    </Suspense>
  );
}

async function EmployeeDashboard() {
  const user = await requireRole("employee");
  const name = user.fullName || user.email;
  const supabase = await createClient();

  // "now" is read after the request data, so it is never baked into a prerendered shell.
  const now = new Date();
  const weekStart = weekStartManila(now);
  const { start, end } = weekBoundsUtc(weekStart);

  // Only this person's own published shifts (RLS says the same; the filters make the query correct for any session).
  const { data: me, error: meError } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  const { data, error } = me
    ? await supabase
        .from("shift_assignments")
        .select("id, shift:shifts!inner(id, title, starts_at, ends_at, department:departments(name))")
        .eq("employee_id", me.id)
        .eq("shift.status", "published")
        .gte("shift.starts_at", start.toISOString())
        .lt("shift.starts_at", weekBoundsUtc(addDays(weekStart, 63)).start.toISOString())
    : { data: [], error: null };

  const shifts = (data ?? []).map((a) => a.shift).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const [next, ...later] = shifts.filter((s) => Date.parse(s.ends_at) > now.getTime());
  const thisWeek = shifts.filter((s) => Date.parse(s.starts_at) < end.getTime());
  const hours = thisWeek.reduce((sum, s) => sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3_600_000, 0);

  const today = toManilaParts(now);
  const greeting = today.minutes < 12 * 60 ? "Good morning" : today.minutes < 18 * 60 ? "Good afternoon" : "Good evening";
  const dayLabel = (iso: string) => {
    const date = toManilaParts(iso).date;
    return date === today.date ? "Today" : date === addDays(today.date, 1) ? "Tomorrow" : formatDayHeading(date);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <header>
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{formatDayHeading(today.date)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          {greeting}, {name}
        </h1>
      </header>

      {meError || error ? (
        <Alert tone="error">Could not load your shifts. Refresh the page to try again.</Alert>
      ) : (
        <>
          <section aria-labelledby="next-shift" className="rounded-2xl border border-teal-700/30 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 id="next-shift" className="text-sm font-medium text-zinc-500">
                Your next shift
              </h2>
              {next && (
                <Badge tone={Date.parse(next.starts_at) <= now.getTime() ? "amber" : "teal"}>
                  {Date.parse(next.starts_at) <= now.getTime() ? "In progress" : "Upcoming"}
                </Badge>
              )}
            </div>
            {next ? (
              <>
                <p className="mt-3 text-sm font-semibold text-teal-800">{dayLabel(next.starts_at)}</p>
                <p className="text-3xl font-semibold tracking-tight text-zinc-900">{formatTimeRange(next.starts_at, next.ends_at)}</p>
                <p className="mt-2 text-sm text-zinc-800">{next.title}</p>
                <p className="text-xs text-zinc-500">{next.department?.name ?? "No department"} · Philippine time</p>
              </>
            ) : (
              <>
                <p className="mt-3 text-lg font-semibold text-zinc-500">None scheduled</p>
                <p className="mt-1 text-xs text-zinc-500">Shifts appear once your administrator publishes the schedule.</p>
              </>
            )}
            <Link
              href="/me/schedule"
              className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
            >
              View my schedule
            </Link>
          </section>

          <dl aria-label="This week" className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <dt className="text-xs font-medium text-zinc-500">Shifts this week</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">{thisWeek.length}</dd>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <dt className="text-xs font-medium text-zinc-500">Scheduled hours</dt>
              <dd className="mt-1 text-2xl font-semibold text-zinc-900">{hours.toFixed(1)} h</dd>
            </div>
          </dl>

          {later.length > 0 && (
            <section aria-labelledby="upcoming">
              <h2 id="upcoming" className="mb-2 text-sm font-semibold text-zinc-900">
                Upcoming shifts
              </h2>
              <ul className="space-y-2">
                {later.slice(0, UPCOMING).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/me/schedule?week=${weekStartManila(s.starts_at)}`}
                      className="block rounded-2xl border border-zinc-200 bg-white p-4 hover:border-teal-600/50"
                    >
                      <p className="text-xs font-semibold text-teal-800 uppercase">{dayLabel(s.starts_at)}</p>
                      <p className="mt-1 text-base font-semibold text-zinc-900">{formatTimeRange(s.starts_at, s.ends_at)}</p>
                      <p className="text-xs text-zinc-500">
                        {s.title} · {s.department?.name ?? "No department"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
