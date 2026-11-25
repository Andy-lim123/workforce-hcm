import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Alert, BackLink, Badge, Card, DescriptionList } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { readNotice, reportText } from "@/lib/telegram-messages";
import { STATUS_LABELS, STATUS_TONES, formatDateTime } from "@/lib/labels";
import {
  OVERRIDE_RULE_LABELS,
  assignedMinutesInWeek,
  assignmentGuard,
  assignmentVerdict,
  formatDayHeading,
  formatTimeRange,
  headcountState,
  publishGuard,
  toManilaParts,
  unpublishGuard,
  validateAssignment,
  weekStartManila,
} from "@/lib/scheduling";
import { isUuid } from "@/lib/validation";
import { assignEmployee, assignEmployeeWithOverrides, cancelShift, publishShift, unpublishShift, updateShift } from "../actions";
import { OverrideFields } from "../override-form";
import { assignmentContext, fingerprintAssignment, loadEmployeeData, type EmployeeData, type ShiftState } from "../assignment-data";
import { ShiftForm } from "../shift-form";

export const metadata: Metadata = { title: "Shift" };

export default function Page({ params, searchParams }: PageProps<"/admin/schedules/[id]">) {
  return (
    <RequireRole role="admin">
      <ShiftDetail params={params} searchParams={searchParams} />
    </RequireRole>
  );
}

const SHIFT_STATUS = {
  published: { tone: "teal", label: "Published" },
  draft: { tone: "zinc", label: "Draft" },
  cancelled: { tone: "red", label: "Cancelled" },
} as const;

async function ShiftDetail({ params, searchParams }: Pick<PageProps<"/admin/schedules/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data: shift }, { data: rows }, { data: departments }, { data: positions }] = await Promise.all([
    supabase
      .from("shifts")
      .select(
        "id, title, department_id, position_id, starts_at, ends_at, required_headcount, status, notes, created_at, updated_at, department:departments(name), position:positions(title)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("shift_assignments")
      .select("id, employee:employees(id, employee_code, first_name, last_name, status)")
      .eq("shift_id", id),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, department_id").order("title"),
  ]);
  if (!shift) notFound();

  const assignmentIds = (rows ?? []).map((r) => r.id);
  const { count: attendance } = assignmentIds.length
    ? await supabase.from("attendance_records").select("id", { count: "exact", head: true }).in("shift_assignment_id", assignmentIds)
    : { count: 0 };
  const attendanceCount = attendance ?? 0;

  const people = (rows ?? [])
    .flatMap((r) => (r.employee ? [r.employee] : []))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
  const state = headcountState(people.length, shift.required_headcount, shift.status);
  const start = toManilaParts(shift.starts_at);
  const end = toManilaParts(shift.ends_at);
  const status = SHIFT_STATUS[shift.status];
  const cancelled = shift.status === "cancelled";
  const weekHref = `/admin/schedules?week=${weekStartManila(shift.starts_at)}`;

  // Assignment data (Phase 3.3a). The Server Action recomputes everything from fresh server data when you assign;
  // what is shown here is for the admin to read and is never trusted by the action.
  const assignedIds = people.map((p) => p.id);
  const shiftState: ShiftState = { shift, assignedIds, attendanceCount };
  const guard = cancelled ? null : assignmentGuard(shift, attendanceCount, new Date());
  const [deptLoaded, assignedLoaded, { count: totalEmployees }] = cancelled
    ? [[] as EmployeeData[], [] as EmployeeData[], { count: 0 }]
    : await Promise.all([
        guard ? Promise.resolve([] as EmployeeData[]) : loadEmployeeData(supabase, { departmentId: shift.department_id }),
        loadEmployeeData(supabase, { ids: assignedIds }),
        supabase.from("employees").select("id", { count: "exact", head: true }),
      ]);
  const assignmentDataError = deptLoaded === "error" || assignedLoaded === "error";
  const deptData = deptLoaded === "error" ? [] : deptLoaded;
  const assignedData = assignedLoaded === "error" ? [] : assignedLoaded;
  const dataById = new Map([...deptData, ...assignedData].map((d) => [d.employee.id, d]));

  // Existing issues of the people already on the shift (read-only information).
  const assignedIssues = new Map(
    people.map((p) => {
      const d = dataById.get(p.id);
      const result = d ? validateAssignment(assignmentContext(shiftState, d, { excludeThisShift: true })) : null;
      return [p.id, result ? [...result.blockers, ...result.warnings].map((v) => v.message) : []] as const;
    }),
  );

  const verdictOrder = { eligible: 0, warning: 1, blocked: 2 } as const;
  const candidates = deptData
    .filter((d) => !assignedIds.includes(d.employee.id))
    .map((d) => {
      const result = validateAssignment(assignmentContext(shiftState, d));
      return {
        d,
        result,
        verdict: assignmentVerdict(result),
        weekMin: assignedMinutesInWeek(shift.starts_at, d.otherShifts.filter((o) => o.id !== shift.id)),
        fingerprint: fingerprintAssignment(shiftState, d),
      };
    })
    .sort((a, b) => verdictOrder[a.verdict] - verdictOrder[b.verdict] || a.weekMin - b.weekMin || a.d.name.localeCompare(b.d.name));
  const excludedCount = Math.max(0, (totalEmployees ?? 0) - deptData.length);
  const hours = (min: number) => (min / 60).toFixed(1);

  // Override history for this shift: read-only. The table is append-only (no update or delete grant) and admin-only (RLS).
  const { data: overrideRows } = await supabase
    .from("schedule_overrides")
    .select("id, created_at, rule, reason, detail, overridden_by_email, employee_code, employee:employees(first_name, last_name)")
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false });

  const stateText = {
    unfilled: `${people.length}/${shift.required_headcount} · unfilled`,
    under: `${people.length}/${shift.required_headcount} · short ${shift.required_headcount - people.length}`,
    filled: `${people.length}/${shift.required_headcount} · filled`,
    over: `${people.length}/${shift.required_headcount} · +${people.length - shift.required_headcount} over`,
    cancelled: `${people.length}/${shift.required_headcount}`,
  }[state];
  const stateTone = { unfilled: "red", under: "amber", filled: "green", over: "amber", cancelled: "zinc" }[state] as "red" | "amber" | "green" | "zinc";

  const publishBlock = shift.status === "draft" ? publishGuard(shift, attendanceCount, new Date()) : null;
  const unpublishBlock = shift.status === "published" ? unpublishGuard(shift, attendanceCount) : null;
  const understaffed = people.length < shift.required_headcount;

  // Result of an assignment or cancellation, signed by the server for this shift. Anything edited or expired shows nothing.
  const notice = readNotice(query.notice, shift.id, process.env.SUPABASE_SECRET_KEY ?? "", new Date());

  const cancelMessage =
    `${people.length ? `Affected employees: ${people.map((p) => p.first_name + " " + p.last_name).join(", ")}. ` : "No one is assigned. "}` +
    `Their assignments are kept for the record. ` +
    (shift.status === "published" ? "Employees will no longer see this shift. " : "") +
    "A cancelled shift cannot be edited or reopened.";

  return (
    <>
      <BackLink href={weekHref}>Schedules</BackLink>
      <PageHeader
        title={shift.title}
        description={`${formatDayHeading(start.date)} · ${formatTimeRange(shift.starts_at, shift.ends_at)} · ${shift.department?.name ?? "No department"}${shift.position ? ` · ${shift.position.title}` : ""}`}
      />

      {notice && (
        <div className="mb-6">
          <Alert tone={notice.report.outcome === "done" && !notice.report.failed && !notice.report.unknown ? "success" : "info"}>
            {notice.kind === "assigned" ? "Assignment saved." : "Shift cancelled. Its assignments were kept for the record."} {reportText(notice.report)}
          </Alert>
        </div>
      )}

      {query.created && (
        <div className="mb-6">
          <Alert tone="success">Draft shift created. You can assign people below, then publish it when it is ready.</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!cancelled && (
            <Card title="Assign an employee">
              {guard ? (
                <Alert tone="info">{guard}</Alert>
              ) : assignmentDataError ? (
                <Alert tone="error">Could not load employee data. Refresh the page to try again.</Alert>
              ) : (
                <div className="space-y-3">
                  <details className="text-xs text-zinc-500">
                    <summary className="cursor-pointer py-1 font-medium text-zinc-700">How assigning works</summary>
                    <p className="mt-1">
                    Employees from {shift.department?.name ?? "this department"} who are not on this shift
                    {excludedCount ? `. ${excludedCount} employee(s) from other departments are not listed because they cannot be assigned (department mismatch)` : ""}.
                    Anyone with a blocker cannot be assigned, and a blocker can never be overridden. Anyone with only warnings can be
                    assigned by overriding each warning with a reason, which is recorded permanently.
                    All checks run again on the server when you assign. Two people assigning at the same moment can still conflict
                    until stronger database protection is added.
                    </p>
                  </details>
                  {candidates.length ? (
                    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                      {candidates.map(({ d, result, verdict, weekMin, fingerprint }) => (
                        <li key={d.employee.id} className="px-3 py-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-zinc-900">
                                {d.name} <span className="font-mono text-xs font-normal text-zinc-500">{d.code}</span>
                              </p>
                              <p className="text-xs text-zinc-500">
                                {d.position ?? "No position"} · {STATUS_LABELS[d.employee.status]} · {hours(weekMin)} h of {d.employee.max_weekly_hours} h assigned that week
                              </p>
                            </div>
                            <Badge tone={verdict === "eligible" ? "green" : verdict === "warning" ? "amber" : "red"}>
                              {verdict === "eligible" ? "Eligible" : verdict === "warning" ? "Warning · override needed" : "Blocked"}
                            </Badge>
                          </div>
                          {(result.blockers.length > 0 || result.warnings.length > 0) && (
                            <ul className="mt-2 space-y-0.5 text-xs">
                              {result.blockers.map((v) => (
                                <li key={v.message} className="text-red-700">
                                  <span className="font-medium">Blocked:</span> {v.message}
                                </li>
                              ))}
                              {result.warnings.map((v) => (
                                <li key={v.message} className="text-amber-700">
                                  <span className="font-medium">Warning:</span> {v.message}
                                </li>
                              ))}
                            </ul>
                          )}
                          {verdict === "eligible" && (
                            <ActionForm action={assignEmployee.bind(null, shift.id, d.employee.id)} className="mt-2">
                              <input type="hidden" name="fingerprint" value={fingerprint} />
                              {shift.status === "published" ? (
                                <>
                                  <input type="hidden" name="published_ack" value="yes" />
                                  <ConfirmSubmit
                                    label="Assign"
                                    variant="primary"
                                    tone="primary"
                                    title={`Assign ${d.name}?`}
                                    message={`${d.name} will see this shift as soon as it is assigned. Assignments cannot be removed in this version.`}
                                    confirmLabel="Assign"
                                  />
                                </>
                              ) : (
                                <SubmitButton pendingText="Assigning…">Assign</SubmitButton>
                              )}
                            </ActionForm>
                          )}
                          {verdict === "warning" && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium text-teal-700 hover:underline">
                                Override the warnings and assign…
                              </summary>
                              <ActionForm action={assignEmployeeWithOverrides.bind(null, shift.id, d.employee.id)} className="mt-2">
                                <OverrideFields
                                  name={d.name}
                                  fingerprint={fingerprint}
                                  published={shift.status === "published"}
                                  warnings={result.warnings.map((v) => ({
                                    rule: v.rule,
                                    label: OVERRIDE_RULE_LABELS[v.rule as keyof typeof OVERRIDE_RULE_LABELS] ?? v.rule,
                                    message: v.message,
                                  }))}
                                />
                              </ActionForm>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500">
                      Everyone in this department is already on this shift.
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {cancelled ? (
            <Alert tone="info">This shift is cancelled and can no longer be edited. Its assignments are kept for the record.</Alert>
          ) : (
            <Card title="Edit shift">
              <ShiftForm
                action={updateShift.bind(null, shift.id)}
                departments={departments ?? []}
                positions={positions ?? []}
                submitLabel="Save changes"
                cancelHref={`/admin/schedules/${shift.id}`}
                published={shift.status === "published"}
                lockSchedule={attendanceCount > 0}
                expectedUpdatedAt={shift.updated_at}
                initial={{
                  title: shift.title,
                  department_id: shift.department_id,
                  position_id: shift.position_id ?? "",
                  start_date: start.date,
                  start_time: start.time,
                  end_date: end.date,
                  end_time: end.time,
                  required_headcount: String(shift.required_headcount),
                  notes: shift.notes ?? "",
                }}
              />
            </Card>
          )}

          {!cancelled && (
            <Card title={shift.status === "published" ? "Published" : "Publish shift"}>
              {shift.status === "published" ? (
                unpublishBlock ? (
                  <p className="text-sm text-zinc-600">{unpublishBlock}</p>
                ) : (
                  <ActionForm action={unpublishShift.bind(null, shift.id)} className="space-y-3">
                    <input type="hidden" name="expected_updated_at" value={shift.updated_at} />
                    <input type="hidden" name="expected_assigned" value={people.length} />
                    <p className="text-sm text-zinc-600">
                      Employees on this shift can see it. Unpublishing hides it from them and makes it a draft again; assignments are kept.
                    </p>
                    <ConfirmSubmit
                      label="Unpublish"
                      variant="secondary"
                      tone="primary"
                      title={`Unpublish “${shift.title}”?`}
                      message={`${people.length ? `${people.length} assigned employee(s) will no longer see this shift.` : "No one is assigned."} Assignments are kept. You can publish it again.`}
                      confirmLabel="Unpublish"
                    />
                  </ActionForm>
                )
              ) : publishBlock ? (
                <p className="text-sm text-zinc-600">{publishBlock}</p>
              ) : (
                <ActionForm action={publishShift.bind(null, shift.id)} className="space-y-3">
                  <input type="hidden" name="expected_updated_at" value={shift.updated_at} />
                  <input type="hidden" name="expected_assigned" value={people.length} />
                  {understaffed && <input type="hidden" name="understaffed_ack" value="yes" />}
                  {understaffed && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Understaffed: {people.length} of {shift.required_headcount} people assigned. You can still publish it.
                    </p>
                  )}
                  <p className="text-sm text-zinc-600">
                    Publishing makes this shift visible to the {people.length} assigned employee(s). You can unpublish it later.
                  </p>
                  <ConfirmSubmit
                    label="Publish"
                    variant="primary"
                    tone="primary"
                    title={`Publish “${shift.title}”?`}
                    message={`${people.length ? `${people.map((p) => p.first_name + " " + p.last_name).join(", ")} will see this shift immediately.` : "No one is assigned, so no employee will see it yet."}${understaffed ? ` It has ${people.length} of ${shift.required_headcount} people, so it is understaffed.` : ""}`}
                    confirmLabel="Publish"
                  />
                </ActionForm>
              )}
            </Card>
          )}

          {!cancelled && (
            <Card title="Cancel shift">
              {attendanceCount > 0 ? (
                <p className="text-sm text-zinc-600">This shift has {attendanceCount} attendance record(s), so it cannot be cancelled.</p>
              ) : (
                <ActionForm action={cancelShift.bind(null, shift.id)} className="space-y-3">
                  <p className="text-sm text-zinc-600">
                    Cancelling keeps every assignment but marks the shift cancelled. It cannot be undone in this version.
                  </p>
                  <ConfirmSubmit label="Cancel this shift" title={`Cancel “${shift.title}”?`} message={cancelMessage} confirmLabel="Cancel shift" />
                </ActionForm>
              )}
            </Card>
          )}

          <Card title={`Override history (${overrideRows?.length ?? 0})`}>
            {overrideRows?.length ? (
              <ul className="divide-y divide-zinc-100">
                {overrideRows.map((o) => (
                  <li key={o.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-zinc-900">
                        {OVERRIDE_RULE_LABELS[o.rule as keyof typeof OVERRIDE_RULE_LABELS] ?? o.rule}
                        <span className="font-normal text-zinc-600">
                          {" "}
                          · {o.employee ? `${o.employee.first_name} ${o.employee.last_name}` : "Employee removed"}{" "}
                          <span className="font-mono text-xs text-zinc-500">{o.employee_code}</span>
                        </span>
                      </p>
                      <p className="text-xs text-zinc-500">{formatDateTime(o.created_at)}</p>
                    </div>
                    <p className="mt-1 text-zinc-800">“{o.reason}”</p>
                    {o.detail && <p className="text-xs text-zinc-500">Warning at the time: {o.detail}</p>}
                    <p className="text-xs text-zinc-500">Recorded by {o.overridden_by_email}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No warnings have been overridden on this shift.</p>
            )}
            <p className="mt-3 text-xs text-zinc-500">History is read-only: entries cannot be edited or deleted.</p>
          </Card>
        </div>

        <div className="order-first space-y-6 lg:order-none">
          <Card title="Status">
            <div className="flex flex-wrap gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              <Badge tone={stateTone}>{stateText}</Badge>
            </div>
            <div className="mt-4">
              <DescriptionList
                items={[
                  ["Starts", `${start.date} ${start.time} (Manila)`],
                  ["Ends", `${end.date} ${end.time} (Manila)`],
                  ["Created", formatDateTime(shift.created_at)],
                  ["Last updated", formatDateTime(shift.updated_at)],
                ]}
              />
            </div>
          </Card>

          <Card title={`Assigned employees (${people.length})`}>
            {people.length ? (
              <ul className="divide-y divide-zinc-100">
                {people.map((p) => {
                  const issues = assignedIssues.get(p.id) ?? [];
                  return (
                    <li key={p.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <Link href={`/admin/employees/${p.id}`} className="font-medium text-teal-700 hover:underline">
                            {p.first_name} {p.last_name}
                          </Link>{" "}
                          <span className="font-mono text-xs text-zinc-500">{p.employee_code}</span>
                        </span>
                        <Badge tone={STATUS_TONES[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                      </div>
                      {!cancelled &&
                        (issues.length ? (
                          <ul className="mt-1 ml-4 list-disc text-xs text-amber-700">
                            {issues.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-emerald-700">No rule problems.</p>
                        ))}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No one is assigned to this shift yet.</p>
            )}
            <p className="mt-3 text-xs text-zinc-500">Assignments cannot be removed in this version.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
