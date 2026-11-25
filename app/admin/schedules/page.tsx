import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { Alert, EmptyState, buttonClass, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDayHeading, headcountState, resolveWeek, toManilaParts, weekBoundsUtc, weekRangeLabel } from "@/lib/scheduling";
import { isUuid } from "@/lib/validation";
import { ActionForm, ConfirmSubmit } from "@/components/action-form";
import { publishWeek, sendTomorrowReminders } from "./actions";
import { WeekGrid, type WeekShift } from "./week-grid";
import { fingerprintWeekPlan, loadWeekPlan } from "./week-publish";

export const metadata: Metadata = { title: "Schedules" };

export default function Page({ searchParams }: PageProps<"/admin/schedules">) {
  return (
    <RequireRole role="admin">
      <PageHeader title="Schedules" description="Weekly shift schedule: staffing, status and who is short." />
      <WeekView searchParams={searchParams} />
      <Suspense fallback={null}>
        <ReminderCard />
      </Suspense>
    </RequireRole>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function WeekView({ searchParams }: { searchParams: PageProps<"/admin/schedules">["searchParams"] }) {
  const raw = await searchParams;
  const supabase = await createClient();

  // "now" is read after the request data above, so it is never baked into a prerendered shell.
  const now = new Date();
  const { weekStart, currentWeek, invalid } = resolveWeek(first(raw.week), now);
  const departmentParam = first(raw.department);
  const department = isUuid(departmentParam) ? departmentParam : "";
  const { start, end } = weekBoundsUtc(weekStart);

  let query = supabase
    .from("shifts")
    .select(
      "id, title, starts_at, ends_at, required_headcount, status, department:departments(id, name), position:positions(title), assignments:shift_assignments(count)",
    )
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at")
    .order("id");
  if (department) query = query.eq("department_id", department);

  const [{ data, error }, { data: departments }] = await Promise.all([
    query,
    supabase.from("departments").select("id, name").order("name"),
  ]);

  const shifts: WeekShift[] = (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    required_headcount: s.required_headcount,
    status: s.status,
    department: s.department,
    position: s.position,
    assigned: s.assignments[0]?.count ?? 0,
  }));

  const href = (week: string | null, dept = department) => {
    const params = new URLSearchParams();
    if (week) params.set("week", week);
    if (dept) params.set("department", dept);
    const qs = params.toString();
    return qs ? `/admin/schedules?${qs}` : "/admin/schedules";
  };

  const live = shifts.filter((s) => s.status !== "cancelled");
  const required = live.reduce((sum, s) => sum + s.required_headcount, 0);
  const filled = live.reduce((sum, s) => sum + Math.min(s.assigned, s.required_headcount), 0);
  const short = live.filter((s) => ["unfilled", "under"].includes(headcountState(s.assigned, s.required_headcount, s.status))).length;
  const count = (status: WeekShift["status"]) => shifts.filter((s) => s.status === status).length;
  const placed = shifts.filter((s) => {
    const day = toManilaParts(s.starts_at).date;
    return day >= weekStart && day <= addDays(weekStart, 6);
  }).length;
  const selectedDepartment = departments?.find((d) => d.id === department);

  // Weekly publishing (3.4b): what publishing this week (and department filter) would do, read fresh from the database.
  const scope = { weekStart, department };
  const plan = !error && shifts.some((s) => s.status === "draft") ? await loadWeekPlan(supabase, scope, now) : null;
  const weekPlan = plan && plan !== "error" && plan.eligible.length ? plan : null;
  const scopeLabel = `${selectedDepartment ? selectedDepartment.name : "all departments"}, ${weekRangeLabel(weekStart)}`;
  const skippedParts = plan && plan !== "error"
    ? [
        plan.skipped.ended && `${plan.skipped.ended} already ended`,
        plan.skipped.cancelled && `${plan.skipped.cancelled} cancelled`,
        plan.skipped.published && `${plan.skipped.published} already published`,
        plan.skipped.attendance && `${plan.skipped.attendance} with attendance records`,
      ].filter(Boolean)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{weekRangeLabel(weekStart)}</h2>
          <p className="text-xs text-zinc-500">
            {weekStart === currentWeek ? "This week" : weekStart > currentWeek ? "A future week" : "A past week"} · Monday to Sunday, Asia/Manila
            {selectedDepartment ? ` · ${selectedDepartment.name}` : ""}
          </p>
        </div>
        <nav aria-label="Week navigation" className="flex flex-wrap gap-2">
          <Link
            href={`/admin/schedules/new?date=${weekStart}${department ? `&department=${department}` : ""}`}
            className={buttonClass.primary}
          >
            New shift
          </Link>
          <Link href={`/admin/schedules/auto?week=${weekStart}${department ? `&department=${department}` : ""}`} className={buttonClass.secondary}>
            Auto-schedule preview
          </Link>
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

      <form action="/admin/schedules" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="week" className="mb-1 block text-xs font-medium text-zinc-600">
            Go to week containing
          </label>
          <input id="week" name="week" type="date" defaultValue={weekStart} className={`${inputClass} w-auto`} />
        </div>
        <div>
          <label htmlFor="department" className="mb-1 block text-xs font-medium text-zinc-600">
            Department
          </label>
          <select id="department" name="department" defaultValue={selectedDepartment?.id ?? ""} className={`${inputClass} w-auto`}>
            <option value="">All departments</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass.secondary}>
          Apply
        </button>
        {department && (
          <Link href={href(weekStart, "")} className="px-2 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-900">
            All departments
          </Link>
        )}
      </form>

      {invalid && <Alert tone="info">That week is not a valid date, so the current week is shown.</Alert>}

      {error ? (
        <Alert tone="error">Could not load the schedule. Refresh the page to try again.</Alert>
      ) : (
        <>
          {placed !== shifts.length && (
            <Alert tone="error">
              {shifts.length - placed} shift(s) in this week could not be placed on a day. This should not happen; check the shift times.
            </Alert>
          )}

          {shifts.length ? (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Week summary">
                <Stat label="Shifts" value={String(shifts.length)} note={`${count("published")} published · ${count("draft")} draft${count("cancelled") ? ` · ${count("cancelled")} cancelled` : ""}`} />
                <Stat label="Positions filled" value={`${filled}/${required}`} note={required ? `${Math.round((filled / required) * 100)}% of required headcount` : "No required headcount"} />
                <Stat label="Understaffed shifts" value={String(short)} note={short ? "Fewer people than required" : "Every shift is covered"} tone={short ? "amber" : "green"} />
                <Stat label="Fully staffed" value={String(live.length - short)} note={`of ${live.length} active shifts`} />
              </dl>
              {(
                <section aria-labelledby="week-publish" className="rounded-xl border border-zinc-200 bg-white p-4">
                  <h3 id="week-publish" className="text-sm font-semibold text-zinc-900">
                    Publish this week
                  </h3>
                  <ActionForm action={publishWeek} className="mt-2 space-y-3">
                    {weekPlan ? (
                    <>
                    <input type="hidden" name="week" value={weekStart} />
                    <input type="hidden" name="department" value={department} />
                    <input type="hidden" name="fingerprint" value={fingerprintWeekPlan(scope, weekPlan)} />
                    {weekPlan.understaffed > 0 && <input type="hidden" name="understaffed_ack" value="yes" />}
                    <p className="text-sm text-zinc-600">
                      {weekPlan.eligible.length} draft shift(s) in {scopeLabel} can be published. Assigned employees ({weekPlan.employees}) will see them
                      immediately.
                      {skippedParts.length ? ` Not included: ${skippedParts.join(", ")}.` : ""}
                    </p>
                    {weekPlan.understaffed > 0 && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        {weekPlan.understaffed} of these shift(s) are understaffed, {weekPlan.empty} with nobody assigned. You can still publish them.
                      </p>
                    )}
                    <ConfirmSubmit
                      label={`Publish ${weekPlan.eligible.length} shift(s)`}
                      variant="primary"
                      tone="primary"
                      title={`Publish ${weekPlan.eligible.length} shift(s)?`}
                      message={`${scopeLabel}. ${weekPlan.employees} assigned employee(s) will see their shifts immediately.${weekPlan.understaffed ? ` ${weekPlan.understaffed} shift(s) are understaffed (${weekPlan.empty} with nobody assigned).` : ""}${skippedParts.length ? ` Not included: ${skippedParts.join(", ")}.` : ""} Individual shifts can be unpublished later, one at a time.`}
                      confirmLabel="Publish"
                    />
                    </>
                    ) : (
                      <p className="text-sm text-zinc-600">
                        No draft shifts to publish in {scopeLabel}.{skippedParts.length ? ` Not included: ${skippedParts.join(", ")}.` : ""}
                      </p>
                    )}
                  </ActionForm>
                </section>
              )}
              <WeekGrid weekStart={weekStart} shifts={shifts} today={toManilaParts(now).date} />
            </>
          ) : (
            <EmptyState
              title={department ? "No shifts for this department this week" : "No shifts this week"}
              description="Try another week, or show all departments."
              action={
                <div className="flex justify-center gap-2">
                  {department && (
                    <Link href={href(weekStart, "")} className={buttonClass.secondary}>
                      All departments
                    </Link>
                  )}
                  <Link href={href(null, "")} className={buttonClass.secondary}>
                    This week
                  </Link>
                </div>
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "amber" | "green" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold ${color}`}>{value}</dd>
      <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
    </div>
  );
}

// Manual Telegram reminders for tomorrow's published shifts, all departments. The counts here are for the confirmation; the
// action re-reads everything when it sends.
async function ReminderCard() {
  await connection(); // today's date must come from the request, never from a prerendered shell
  const tomorrow = addDays(toManilaParts(new Date()).date, 1);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .select("id, shift_assignments(employee_id)")
    .eq("status", "published")
    .gte("starts_at", weekBoundsUtc(tomorrow).start.toISOString())
    .lt("starts_at", weekBoundsUtc(addDays(tomorrow, 1)).start.toISOString());
  const people = [...new Set((data ?? []).flatMap((s) => s.shift_assignments.map((a) => a.employee_id)))];
  const links = await supabase.from("employee_telegram").select("employee_id");
  const linkedIds = new Set((links.data ?? []).map((l) => l.employee_id));
  const linked = people.filter((id) => linkedIds.has(id)).length;

  return (
    <section aria-labelledby="reminders" className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 id="reminders" className="text-sm font-semibold text-zinc-900">
        Telegram reminders for tomorrow
      </h3>
      {error || links.error ? (
        <p className="mt-2 text-sm text-red-700">Could not load tomorrow&apos;s shifts. Refresh the page to try again.</p>
      ) : (
        <ActionForm action={sendTomorrowReminders} className="mt-2 space-y-3">
          <input type="hidden" name="date" value={tomorrow} />
          <p className="text-sm text-zinc-600">
            {formatDayHeading(tomorrow)}: {data.length} published shift(s), {people.length} employee(s) assigned, {linked} linked to Telegram. All
            departments, one message per employee.
          </p>
          {people.length > 0 && (
            <ConfirmSubmit
              label="Send tomorrow's reminders"
              variant="secondary"
              tone="primary"
              title="Send tomorrow's reminders?"
              message={`${linked} of ${people.length} employee(s) will get one Telegram message about ${formatDayHeading(tomorrow)}. Sending again sends the same reminder again.`}
              confirmLabel="Send reminders"
            />
          )}
        </ActionForm>
      )}
    </section>
  );
}
