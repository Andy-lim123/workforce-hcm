// Automatic scheduling PROPOSAL (Phase 4.1; AUTOMATIC_SCHEDULING_PLAN.md). A pure calculation: it reads the data it is
// given and returns suggested assignments. It writes nothing and cannot create an assignment.
//
// No rule lives here. Eligibility, the target-shift conditions and the week boundary come from lib/scheduling.ts, passed in
// as `rules` (only types are imported, so the unit tests run this file directly).
//
// Method (greedy, deterministic):
//   1. Targets: shifts of the week (optionally one department) that could be published (draft, not ended, no attendance)
//      and still need people.
//   2. A candidate has NO blocker and NO warning against everything already assigned PLUS everything proposed so far.
//   3. Take the hardest shift first: fewest (candidates minus open places); then earlier start; then shift id.
//   4. Give one place to the candidate with: the lowest share of weekly maximum after this shift, then the fewest shifts
//      that week, then the least flexibility (eligible for the fewest other open shifts), then employee code.
//   5. Repeat until nothing can be filled or the limit is reached. Open places stay open, with the reasons.
//
// shortcut: greedy only, so a place can stay empty although moving one proposal would fill it. The approved one-move repair
// step is deliberately not built yet (decision D6: only after the engine and the preview work).

import type { AssignedShift, AvailabilityLike, EmployeeLike, RuleId, ShiftLike } from "./scheduling";

export const MAX_PROPOSALS = 150;

export type Rules = Pick<typeof import("./scheduling"), "validateAssignment" | "publishGuard" | "weekStartManila">;

export type ScheduleShift = ShiftLike & { assignedIds: readonly string[]; attendanceCount: number };

export type ScheduleEmployee = {
  employee: EmployeeLike;
  code: string;
  availability: readonly AvailabilityLike[];
  /** All of this employee's existing assignments, any week (needed for overlap, rest and weekly hours). */
  assignments: readonly AssignedShift[];
};

export type ScheduleInput = {
  /** Manila Monday, "YYYY-MM-DD". */
  weekStart: string;
  departmentId?: string;
  shifts: readonly ScheduleShift[];
  employees: readonly ScheduleEmployee[];
  now: Date;
  /** Lower than MAX_PROPOSALS only; a higher value is ignored. */
  limit?: number;
};

export type ProposedAssignment = { shiftId: string; employeeId: string; employeeCode: string };

export type UncoveredShift = {
  shiftId: string;
  open: number;
  /** "limit": candidates remained but the run limit was reached. */
  cause: "no_eligible_employee" | "limit";
  /** Employees of the shift's department, and how many each rule excluded (one employee can count under several). */
  departmentEmployees: number;
  excluded: { rule: RuleId; count: number }[];
  explanation: string;
};

export type Workload = {
  employeeId: string;
  employeeCode: string;
  departmentId: string | null;
  maxMinutes: number;
  before: { minutes: number; shifts: number };
  after: { minutes: number; shifts: number };
};

export type SkippedShifts = { filled: number; published: number; cancelled: number; ended: number; attendance: number };

export type Proposal = {
  assignments: ProposedAssignment[];
  uncovered: UncoveredShift[];
  workload: Workload[];
  summary: { targetShifts: number; openPlaces: number; filledPlaces: number; limit: number; limitReached: boolean; skipped: SkippedShifts };
};

const REASONS: Record<RuleId, string> = {
  already_assigned: "already on this shift",
  employee_inactive: "inactive",
  employee_on_leave: "on leave",
  department_mismatch: "in another department",
  overlap: "with an overlapping shift",
  outside_availability: "outside their availability",
  insufficient_rest: "without enough rest",
  exceeds_weekly_hours: "over their weekly hours",
  position_mismatch: "in a different position",
  over_headcount: "over the required headcount",
};

const minutes = (s: { starts_at: string; ends_at: string }) => Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // locale independent, so results never depend on the machine

export function proposeSchedule(input: ScheduleInput, rules: Rules): Proposal {
  const limit = Math.max(0, Math.min(Math.floor(input.limit ?? MAX_PROPOSALS), MAX_PROPOSALS));
  const shifts = [...input.shifts].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || byText(a.id, b.id));
  const employees = [...input.employees].sort((a, b) => byText(a.code, b.code) || byText(a.employee.id, b.employee.id));

  const skipped: SkippedShifts = { filled: 0, published: 0, cancelled: 0, ended: 0, attendance: 0 };
  const targets: ScheduleShift[] = [];
  for (const shift of shifts) {
    if (rules.weekStartManila(shift.starts_at) !== input.weekStart) continue; // other weeks only matter as existing assignments
    if (input.departmentId && shift.department_id !== input.departmentId) continue;
    if (shift.status === "cancelled") skipped.cancelled++;
    else if (shift.status === "published") skipped.published++;
    else if (shift.attendanceCount > 0) skipped.attendance++;
    else if (rules.publishGuard(shift, shift.attendanceCount, input.now)) skipped.ended++;
    else if (shift.assignedIds.length >= shift.required_headcount) skipped.filled++;
    else targets.push(shift);
  }

  // Working state, copied so the input is never changed. Assignments named by a shift are added to the employee's list
  // if the caller's list lacks them, so no existing assignment can be overlooked.
  const mine = new Map(employees.map((e) => [e.employee.id, [...e.assignments]]));
  for (const shift of shifts) {
    for (const id of shift.assignedIds) {
      const list = mine.get(id);
      if (list && !list.some((a) => a.id === shift.id))
        list.push({ id: shift.id, starts_at: shift.starts_at, ends_at: shift.ends_at, status: shift.status });
    }
  }
  const headcount = new Map(shifts.map((s) => [s.id, s.assignedIds.length]));
  const open = (s: ScheduleShift) => s.required_headcount - headcount.get(s.id)!;

  const weekOf = (employeeId: string) => {
    const week = mine.get(employeeId)!.filter((a) => a.status !== "cancelled" && rules.weekStartManila(a.starts_at) === input.weekStart);
    return { minutes: week.reduce((sum, a) => sum + minutes(a), 0), shifts: week.length };
  };
  const judge = (shift: ScheduleShift, e: ScheduleEmployee) =>
    rules.validateAssignment({
      shift,
      employee: e.employee,
      availability: e.availability,
      otherShifts: mine.get(e.employee.id)!,
      assignedCount: headcount.get(shift.id)!,
    });
  const eligible = (shift: ScheduleShift) =>
    employees.filter((e) => {
      const result = judge(shift, e);
      return result.blockers.length === 0 && result.warnings.length === 0;
    });

  const before = new Map(employees.map((e) => [e.employee.id, weekOf(e.employee.id)]));
  const openPlaces = targets.reduce((sum, s) => sum + open(s), 0);
  const assignments: ProposedAssignment[] = [];

  while (assignments.length < limit) {
    const options = targets
      .filter((s) => open(s) > 0)
      .map((shift) => ({ shift, candidates: eligible(shift) }))
      .filter((o) => o.candidates.length > 0);
    if (!options.length) break;
    // `targets` is already in start-then-id order and sort() is stable, so ties keep that order.
    options.sort((a, b) => a.candidates.length - open(a.shift) - (b.candidates.length - open(b.shift)));
    const { shift, candidates } = options[0];

    const duration = minutes(shift);
    const ranked = candidates.map((e) => {
      const week = weekOf(e.employee.id);
      return {
        e,
        after: week.minutes + duration,
        max: e.employee.max_weekly_hours * 60,
        shifts: week.shifts,
        flexibility: options.filter((o) => o.shift.id !== shift.id && o.candidates.includes(e)).length,
      };
    });
    // Share comparison by cross-multiplication: equal shares compare as exactly equal. A candidate always has max > 0.
    ranked.sort((a, b) => a.after * b.max - b.after * a.max || a.shifts - b.shifts || a.flexibility - b.flexibility || byText(a.e.code, b.e.code));
    const chosen = ranked[0].e;

    mine.get(chosen.employee.id)!.push({ id: shift.id, starts_at: shift.starts_at, ends_at: shift.ends_at, status: shift.status });
    headcount.set(shift.id, headcount.get(shift.id)! + 1);
    assignments.push({ shiftId: shift.id, employeeId: chosen.employee.id, employeeCode: chosen.code });
  }

  const uncovered: UncoveredShift[] = targets
    .filter((s) => open(s) > 0)
    .map((shift) => {
      const department = employees.filter((e) => e.employee.department_id === shift.department_id);
      const counts = new Map<RuleId, number>();
      let free = 0;
      for (const e of department) {
        const result = judge(shift, e);
        const found = [...result.blockers, ...result.warnings];
        if (!found.length) free++;
        for (const rule of new Set(found.map((v) => v.rule))) counts.set(rule, (counts.get(rule) ?? 0) + 1);
      }
      const excluded = [...counts].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count || byText(a.rule, b.rule));
      const cause = free > 0 ? ("limit" as const) : ("no_eligible_employee" as const);
      const detail = excluded.map((x) => `${x.count} ${REASONS[x.rule]}`).join(", ");
      const explanation =
        cause === "limit"
          ? `The limit of ${limit} proposed assignments was reached while ${free} eligible employee(s) remained.`
          : department.length === 0
            ? "This department has no employees."
            : `None of the ${department.length} department employee(s) is eligible without a warning: ${detail}.`;
      return { shiftId: shift.id, open: open(shift), cause, departmentEmployees: department.length, excluded, explanation };
    });

  const departments = new Set(targets.map((s) => s.department_id));
  const workload: Workload[] = employees
    .filter((e) => e.employee.department_id !== null && departments.has(e.employee.department_id))
    .map((e) => ({
      employeeId: e.employee.id,
      employeeCode: e.code,
      departmentId: e.employee.department_id,
      maxMinutes: e.employee.max_weekly_hours * 60,
      before: before.get(e.employee.id)!,
      after: weekOf(e.employee.id),
    }));

  const order = new Map(targets.map((s, i) => [s.id, i]));
  assignments.sort((a, b) => order.get(a.shiftId)! - order.get(b.shiftId)! || byText(a.employeeCode, b.employeeCode));

  return {
    assignments,
    uncovered,
    workload,
    summary: {
      targetShifts: targets.length,
      openPlaces,
      filledPlaces: assignments.length,
      limit,
      limitReached: assignments.length >= limit && uncovered.some((u) => u.cause === "limit"),
      skipped,
    },
  };
}
