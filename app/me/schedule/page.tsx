import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, EmptyState, buttonClass } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDayHeading, formatTimeRange, resolveWeek, shiftsByDay, toManilaParts, weekBoundsUtc, weekRangeLabel } from "@/lib/scheduling";

export const metadata: Metadata = { title: "My schedule" };

export default function Page({ searchParams }: PageProps<"/me/schedule">) {
  return (
    <>
      <PageHeader title="My schedule" description="Your published shifts, in Philippine time (Asia/Manila)." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <MySchedule searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const hoursOf = (s: { starts_at: string; ends_at: string }) => (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 3_600_000;

async function MySchedule({ searchParams }: { searchParams: PageProps<"/me/schedule">["searchParams"] }) {
  const raw = await searchParams;
  const user = await requireRole("employee");
  const supabase = await createClient();

  // "now" is read after the request data, so it is never baked into a prerendered shell.
  const now = new Date();
  const { weekStart, currentWeek, invalid } = resolveWeek(first(raw.week), now);
  const { start, end } = weekBoundsUtc(weekStart);
  const href = (week: string | null) => (week ? `/me/schedule?week=${week}` : "/me/schedule");

  // Only this person's own assignments. RLS already limits an employee to their own published shifts; the filters below say
  // the same thing in the query, so the page is correct for any session and a draft or cancelled shift can never be listed.
  const { data: me, error: meError } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  if (meError) return <Alert tone="error">Could not load your schedule. Refresh the page to try again.</Alert>;
  if (!me)
    return (
      <EmptyState
        title="Your account is not linked to an employee record yet"
        description="Ask your administrator to link your account. Your schedule will appear here once they do."
      />
    );

  const { data, error } = await supabase
    .from("shift_assignments")
    .select("id, shift:shifts!inner(id, title, starts_at, ends_at, status, department:departments(name), position:positions(title))")
    .eq("employee_id", me.id)
    .eq("shift.status", "published")
    .gte("shift.starts_at", start.toISOString())
    .lt("shift.starts_at", end.toISOString());
  if (error) return <Alert tone="error">Could not load your schedule. Refresh the page to try again.</Alert>;

  const shifts = data.map((a) => a.shift);
  const days = shiftsByDay(shifts, weekStart);
  const today = toManilaParts(now).date;
  const totalHours = shifts.reduce((sum, s) => sum + hoursOf(s), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{weekRangeLabel(weekStart)}</h2>
          <p className="text-xs text-zinc-500">
            {weekStart === currentWeek ? "This week" : weekStart > currentWeek ? "A future week" : "A past week"} · Monday to Sunday
          </p>
        </div>
        <nav aria-label="Week navigation" className="flex flex-wrap gap-2">
          <Link href={href(addDays(weekStart, -7))} className={buttonClass.secondary}>
            ← Previous<span className="sr-only"> week</span>
          </Link>
          {weekStart === currentWeek ? (
            <span aria-current="page" className={`${buttonClass.secondary} pointer-events-none opacity-50`}>
              This week
            </span>
          ) : (
            <Link href={href(null)} className={buttonClass.secondary}>
              This week
            </Link>
          )}
          <Link href={href(addDays(weekStart, 7))} className={buttonClass.secondary}>
            Next<span className="sr-only"> week</span> →
          </Link>
        </nav>
      </div>

      {invalid && <Alert tone="info">That week is not a valid date, so the current week is shown.</Alert>}

      <dl className="grid grid-cols-2 gap-3" aria-label="Week summary">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <dt className="text-xs font-medium text-zinc-500">Shifts</dt>
          <dd className="mt-1 text-xl font-semibold text-zinc-900">{shifts.length}</dd>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <dt className="text-xs font-medium text-zinc-500">Hours</dt>
          <dd className="mt-1 text-xl font-semibold text-zinc-900">{totalHours.toFixed(1)} h</dd>
        </div>
      </dl>

      {shifts.length ? (
        <ol className="space-y-3">
          {[...days.entries()]
            .filter(([, list]) => list.length)
            .map(([date, list]) => (
              <li key={date} className="rounded-xl border border-zinc-200 bg-white">
                <h3 className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-900">
                  <span>{formatDayHeading(date)}</span>
                  {date === today && <Badge tone="teal">Today</Badge>}
                </h3>
                <ul className="divide-y divide-zinc-100">
                  {list.map((s) => {
                    const state =
                      Date.parse(s.ends_at) <= now.getTime() ? "Completed" : Date.parse(s.starts_at) <= now.getTime() ? "In progress" : "Upcoming";
                    return (
                      <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div>
                          <p className="text-base font-semibold text-zinc-900">{formatTimeRange(s.starts_at, s.ends_at)}</p>
                          <p className="text-sm text-zinc-800">{s.title}</p>
                          <p className="text-xs text-zinc-500">
                            {s.department?.name ?? "No department"}
                            {s.position ? ` · ${s.position.title}` : ""} · {hoursOf(s).toFixed(1)} h
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="teal">Published</Badge>
                          <Badge tone={state === "Upcoming" ? "green" : state === "In progress" ? "amber" : "zinc"}>{state}</Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
        </ol>
      ) : (
        <EmptyState
          title="No shifts this week"
          description="Shifts appear here once your administrator publishes the schedule. Try another week."
          action={
            weekStart !== currentWeek ? (
              <Link href={href(null)} className={buttonClass.secondary}>
                This week
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
