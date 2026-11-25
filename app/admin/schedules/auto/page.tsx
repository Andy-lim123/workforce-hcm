import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { Alert, BackLink, Badge, Card, EmptyState, buttonClass, inputClass } from "@/components/ui";
import { arrangePreview } from "@/lib/auto-preview";
import { MAX_PROPOSALS, proposeSchedule } from "@/lib/auto-schedule";
import * as rules from "@/lib/scheduling";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { loadPreviewData } from "./auto-data";
import { RecalculateButton } from "./recalculate-button";

export const metadata: Metadata = { title: "Auto-schedule preview" };

// PREVIEW ONLY (Phase 4.2). This page reads, calculates and displays. It has no Server Action, no form that submits
// changes, and nothing on it can assign, publish or edit.

export default function Page({ searchParams }: PageProps<"/admin/schedules/auto">) {
  return (
    <RequireRole role="admin">
      <BackLink href="/admin/schedules">Schedules</BackLink>
      <PageHeader title="Auto-schedule preview" description="Suggested people for open places on draft shifts, and why the other places stay empty." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Calculating the proposal…</p>}>
        <ProposalPreview searchParams={searchParams} />
      </Suspense>
    </RequireRole>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const hours = (min: number) => (min / 60).toFixed(1);

async function ProposalPreview({ searchParams }: { searchParams: PageProps<"/admin/schedules/auto">["searchParams"] }) {
  const raw = await searchParams;
  const supabase = await createClient();

  // "now" is read after the request data, so it is never baked into a prerendered shell.
  const now = new Date();
  // Without a week in the address, show next week: the one still being planned.
  const nextWeek = rules.addDays(rules.weekStartManila(now), 7);
  const { weekStart, invalid } = rules.resolveWeek(first(raw.week) || nextWeek, now);
  const departmentParam = first(raw.department);
  const department = isUuid(departmentParam) ? departmentParam : "";

  const data = await loadPreviewData(supabase, weekStart);
  const href = (week: string) => `/admin/schedules/auto?week=${week}${department ? `&department=${department}` : ""}`;

  const controls = (departments: { id: string; name: string }[]) => (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <form action="/admin/schedules/auto" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="week" className="mb-1 block text-xs font-medium text-zinc-600">
            Week containing
          </label>
          <input key={weekStart} id="week" name="week" type="date" defaultValue={weekStart} className={`${inputClass} w-auto`} />
        </div>
        <div>
          <label htmlFor="department" className="mb-1 block text-xs font-medium text-zinc-600">
            Department
          </label>
          <select key={department} id="department" name="department" defaultValue={department} className={`${inputClass} w-auto`}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass.secondary}>
          Show
        </button>
      </form>
      <nav aria-label="Week navigation" className="flex flex-wrap gap-2">
        <Link href={href(rules.addDays(weekStart, -7))} className={buttonClass.secondary}>
          ← Previous<span className="sr-only"> week</span>
        </Link>
        <Link href={href(rules.addDays(weekStart, 7))} className={buttonClass.secondary}>
          Next<span className="sr-only"> week</span> →
        </Link>
        <RecalculateButton />
      </nav>
    </div>
  );

  if (data === "error")
    return (
      <div className="space-y-4">
        {controls([])}
        <Alert tone="error">Could not load the scheduling data, so no proposal was calculated. Try Recalculate.</Alert>
      </div>
    );

  const proposal = proposeSchedule({ weekStart, departmentId: department || undefined, shifts: data.shifts, employees: data.employees, now }, rules);
  const preview = arrangePreview(proposal, data.shifts);
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]));
  const deptName = new Map(data.departments.map((d) => [d.id, d.name]));
  const codeOf = new Map(data.employees.map((e) => [e.employee.id, e.code]));
  const person = (id: string) => data.names.get(id) ?? codeOf.get(id) ?? "Unknown employee";
  const { totals, departments } = preview;
  const { skipped } = proposal.summary;
  const skippedText = [
    skipped.filled && `${skipped.filled} draft shift(s) already full`,
    skipped.published && `${skipped.published} published shift(s)`,
    skipped.cancelled && `${skipped.cancelled} cancelled shift(s)`,
    skipped.ended && `${skipped.ended} already ended`,
    skipped.attendance && `${skipped.attendance} with attendance records`,
  ].filter(Boolean);
  const gaining = proposal.workload.filter((w) => w.after.shifts !== w.before.shifts);
  const unchanged = proposal.workload.filter((w) => w.after.shifts === w.before.shifts);
  const time = rules.toManilaParts(now);

  const workloadTable = (rows: typeof proposal.workload) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm sm:min-w-[480px]">
        <thead className="text-xs text-zinc-500">
          <tr className="border-b border-zinc-200">
            <th scope="col" className="py-2 pr-2 font-medium">Employee</th>
            <th scope="col" className="hidden px-2 py-2 font-medium sm:table-cell">Department</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Hours now</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">With proposal</th>
            <th scope="col" className="hidden py-2 pl-2 text-right font-medium sm:table-cell">Weekly max</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((w) => (
            <tr key={w.employeeId}>
              <th scope="row" className="py-2 pr-2 font-medium text-zinc-900">
                {person(w.employeeId)} <span className="font-mono text-xs font-normal text-zinc-500">{w.employeeCode}</span>
                <span className="block text-xs font-normal text-zinc-500 sm:hidden">
                  {deptName.get(w.departmentId ?? "") ?? "—"} · max {hours(w.maxMinutes)} h
                </span>
              </th>
              <td className="hidden px-2 py-2 text-zinc-600 sm:table-cell">{deptName.get(w.departmentId ?? "") ?? "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{hours(w.before.minutes)} h · {w.before.shifts}</td>
              <td className={`px-2 py-2 text-right tabular-nums ${w.after.shifts !== w.before.shifts ? "font-semibold text-teal-800" : ""}`}>
                {hours(w.after.minutes)} h · {w.after.shifts}
              </td>
              <td className="hidden py-2 pl-2 text-right tabular-nums sm:table-cell">
                {hours(w.maxMinutes)} h{w.after.minutes >= w.maxMinutes && w.after.shifts !== w.before.shifts ? " (full)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      {controls(data.departments)}
      {invalid && <Alert tone="info">That week is not a valid date, so the current week is shown.</Alert>}

      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{rules.weekRangeLabel(weekStart)}</h2>
        <p className="text-xs text-zinc-500">
          {department ? deptName.get(department) : "All departments"} · calculated {time.date} {time.time}:{String(now.getUTCSeconds()).padStart(2, "0")} (Manila)
        </p>
      </div>

      <div role="note" className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <strong>Proposal only. Nobody has been assigned.</strong> This page cannot change the schedule, and employees do not see these suggestions.
      </div>

      {totals.open === 0 ? (
        <EmptyState
          title="No open places to fill"
          description={skippedText.length ? `This week has ${skippedText.join(", ")}.` : "This week has no shifts for this selection."}
        />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Proposal summary">
            <Stat label="Open positions" value={totals.open} note={`on ${totals.shifts} draft shift(s)`} />
            <Stat label="Proposed assignments" value={totals.proposed} note="suggested, not assigned" tone="teal" />
            <Stat label="Uncovered positions" value={totals.uncovered} note={totals.uncovered ? "no one suggested" : "every open place has a suggestion"} tone={totals.uncovered ? "red" : "teal"} />
          </dl>
          {totals.uncovered > 0 && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>
                This schedule would still be incomplete: {totals.uncovered} of {totals.open} open positions have nobody.
              </strong>{" "}
              Reasons are shown under each shift. The method does not guarantee the best possible coverage.
            </div>
          )}
          {proposal.summary.limitReached && <Alert tone="info">The limit of {MAX_PROPOSALS} proposed assignments per run was reached.</Alert>}

          {[...departments].sort((a, b) => (deptName.get(a.departmentId) ?? "").localeCompare(deptName.get(b.departmentId) ?? "")).map((d) => (
            <section key={d.departmentId} aria-label={deptName.get(d.departmentId)} className="rounded-xl border border-zinc-200 bg-white">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-zinc-900">{deptName.get(d.departmentId) ?? "No department"}</h3>
                <p className="flex flex-wrap gap-1.5">
                  <Badge tone="zinc">{d.open} open</Badge>
                  <Badge tone="teal">{d.proposed} proposed</Badge>
                  <Badge tone={d.uncovered ? "red" : "green"}>{d.uncovered} uncovered</Badge>
                </p>
              </header>
              <ul className="divide-y divide-zinc-100">
                {d.shifts.map((row) => {
                  const s = shiftById.get(row.shiftId)!;
                  return (
                    <li key={row.shiftId} className="space-y-2 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium text-zinc-900">
                          {rules.formatDayHeading(rules.toManilaParts(s.starts_at).date)} · {rules.formatTimeRange(s.starts_at, s.ends_at)} · {s.title}
                        </p>
                        <Link href={`/admin/schedules/${s.id}`} className="text-xs font-medium text-teal-700 hover:underline">
                          Shift details<span className="sr-only">: {s.title} {rules.formatDayHeading(rules.toManilaParts(s.starts_at).date)}</span>
                        </Link>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {s.position ?? "Any position"} · now {row.assigned} of {row.required} assigned
                        {row.assigned ? `: ${s.assignedIds.map(person).join(", ")}` : ""}
                      </p>
                      {row.proposed.length > 0 && (
                        <ul className="flex flex-wrap gap-2" aria-label="Proposed">
                          {row.proposed.map((p) => (
                            <li key={p.employeeId} className="rounded-md border border-dashed border-teal-600/60 bg-teal-50 px-2 py-1 text-teal-900">
                              <span className="text-xs font-semibold uppercase">Proposed</span> {person(p.employeeId)}{" "}
                              <span className="font-mono text-xs">{p.employeeCode}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {row.uncovered && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
                          <p>
                            <strong>{row.uncovered.open} uncovered.</strong> {row.uncovered.explanation}
                          </p>
                          {row.uncovered.excluded.length > 0 && <p className="mt-0.5 text-xs">One employee can be counted under more than one reason.</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <Card title="Workload impact">
            {gaining.length ? (
              <>
                <p className="mb-2 text-xs text-zinc-500">Hours and number of shifts this week, now and if every proposal were assigned.</p>
                {workloadTable(gaining)}
              </>
            ) : (
              <p className="text-sm text-zinc-600">No employee would gain a shift.</p>
            )}
            {unchanged.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-zinc-700">{unchanged.length} employee(s) with no change</summary>
                <div className="mt-2">{workloadTable(unchanged)}</div>
              </details>
            )}
          </Card>

          {skippedText.length > 0 && <p className="text-xs text-zinc-500">Not considered: {skippedText.join(", ")}.</p>}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: number; note: string; tone?: "teal" | "red" }) {
  const color = tone === "teal" ? "text-teal-800" : tone === "red" ? "text-red-700" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2 sm:p-4">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold sm:text-3xl ${color}`}>{value}</dd>
      <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
    </div>
  );
}
