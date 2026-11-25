// Scheduling rules for the Workforce Management System (Phase 3.0).
//
// Pure functions: no I/O and no project or framework imports, so Node runs them directly in tests
// (scripts/scheduling.test.mjs, scripts/check-seed-schedule.mjs) and Phase 4 auto-scheduling can
// reuse them unchanged. The rules and availability semantics are specified in PHASE3_PLAN.md
// sections 3 and 4; change them there and in PROJECT_CONTEXT.md at the same time.

// ---------------------------------------------------------------------------
// Types (structural: any row with these fields works, including Supabase rows)
// ---------------------------------------------------------------------------

export type ShiftStatus = "draft" | "published" | "cancelled";
export type EmployeeStatus = "active" | "on_leave" | "inactive";

export type ShiftLike = {
  id: string;
  department_id: string;
  position_id: string | null;
  starts_at: string; // ISO timestamp, UTC
  ends_at: string;
  required_headcount: number;
  status: ShiftStatus;
};

export type EmployeeLike = {
  id: string;
  status: EmployeeStatus;
  department_id: string | null;
  position_id: string | null;
  max_weekly_hours: number;
};

/** One recurring weekly window. day_of_week: 0 = Sunday … 6 = Saturday. Times are Manila "HH:MM" or "HH:MM:SS". */
export type AvailabilityLike = { day_of_week: number; start_time: string; end_time: string };

/** Another shift the same employee is assigned to. */
export type AssignedShift = { id: string; starts_at: string; ends_at: string; status: ShiftStatus };

// ---------------------------------------------------------------------------
// Rule ids. OVERRIDABLE_RULES must equal the rule list in the schedule_overrides CHECK
// constraint (PHASE3_PROPOSED_SQL.md part A); a unit test keeps them in step once the migration exists.
// ---------------------------------------------------------------------------

export const BLOCKER_RULES = [
  "already_assigned",
  "employee_inactive",
  "employee_on_leave",
  "department_mismatch",
  "overlap",
] as const;

export const WARNING_RULES = [
  "outside_availability",
  "insufficient_rest",
  "exceeds_weekly_hours",
  "position_mismatch",
  "over_headcount",
] as const;

export const OVERRIDABLE_RULES = WARNING_RULES;
export const RULE_IDS = [...BLOCKER_RULES, ...WARNING_RULES] as const;

export type BlockerRule = (typeof BLOCKER_RULES)[number];
export type WarningRule = (typeof WARNING_RULES)[number];
export type RuleId = BlockerRule | WarningRule;

/**
 * `measure` is how bad a warning is, where bigger is worse (rest shortfall in minutes, minutes over the
 * weekly maximum, people over headcount). Boolean rules leave it undefined. validateShiftEdit callers use it
 * to tell "the same problem" from "a worse problem" after an edit.
 */
export type Violation = { rule: RuleId; level: "blocker" | "warning"; message: string; measure?: number };
export type ValidationResult = { blockers: Violation[]; warnings: Violation[] };

export const MIN_REST_HOURS = 10;

// ---------------------------------------------------------------------------
// Availability semantics (the single definition; see PHASE3_PLAN.md section 3)
// ---------------------------------------------------------------------------

/**
 * A window that ends at this time means "available from its start through the end of the day and
 * overnight until the following morning". Imported by the validator, the availability editor's
 * help text and the parseWindow message, so they cannot drift apart.
 */
export const END_OF_DAY_WINDOW = "23:59";

export const OVERNIGHT_HELP =
  `End a window at ${END_OF_DAY_WINDOW} to be available overnight: the employee can then be scheduled ` +
  `on a shift that starts inside the window and finishes the next morning.`;

// ---------------------------------------------------------------------------
// Manila time. Timestamps stay UTC in the database; weeks, days and times are computed here.
// ---------------------------------------------------------------------------

// shortcut: fixed +08:00 offset. Correct for Asia/Manila (no daylight saving); replace with an
// Intl-based conversion if the organisation's timezone ever observes daylight saving.
const MANILA_OFFSET_MIN = 8 * 60;
const MS_PER_MIN = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number) => String(n).padStart(2, "0");

export type LocalParts = {
  date: string; // YYYY-MM-DD in Manila
  time: string; // HH:MM in Manila
  dow: number; // 0 = Sunday … 6 = Saturday, Manila
  minutes: number; // minutes since Manila midnight
};

export function toManilaParts(instant: string | Date): LocalParts {
  const ms = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid timestamp: ${String(instant)}`);
  const d = new Date(ms + MANILA_OFFSET_MIN * MS_PER_MIN);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    dow: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** The UTC instant for a Manila wall-clock date ("YYYY-MM-DD") and time ("HH:MM"). */
export function fromManila(date: string, time: string): Date {
  if (!DATE.test(date) || !HHMM.test(time)) throw new RangeError(`Invalid Manila date/time: ${date} ${time}`);
  const result = new Date(`${date}T${time}:00+08:00`);
  // The round trip also rejects impossible dates such as 2026-02-30, which the Date parser rolls over.
  if (Number.isNaN(result.getTime()) || toManilaParts(result).date !== date)
    throw new RangeError(`Invalid Manila date/time: ${date} ${time}`);
  return result;
}

const utcDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(date: string, days: number): string {
  const d = new Date(utcDay(date) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole calendar days from `a` to `b` (both "YYYY-MM-DD"). */
export const daysBetween = (a: string, b: string) => Math.round((utcDay(b) - utcDay(a)) / 86_400_000);

/** Monday ("YYYY-MM-DD") of the Manila week containing `instant`. Weeks run Monday to Sunday. */
export function weekStartManila(instant: string | Date): string {
  const p = toManilaParts(instant);
  return addDays(p.date, -((p.dow + 6) % 7));
}

/** UTC bounds of a Manila week: start inclusive, end exclusive. `weekStart` must be a Monday. */
export function weekBoundsUtc(weekStart: string): { start: Date; end: Date } {
  return { start: fromManila(weekStart, "00:00"), end: fromManila(addDays(weekStart, 7), "00:00") };
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ms = (iso: string) => Date.parse(iso);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const durationMin = (a: { starts_at: string; ends_at: string }) => Math.round((ms(a.ends_at) - ms(a.starts_at)) / MS_PER_MIN);
const overlaps = (a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) =>
  ms(a.starts_at) < ms(b.ends_at) && ms(b.starts_at) < ms(a.ends_at);
const hours = (min: number) => (min / 60).toFixed(1);
const when = (iso: string) => {
  const p = toManilaParts(iso);
  return `${p.date} ${p.time}`;
};

/** True when the shift is covered by the employee's availability under the rules in PHASE3_PLAN.md section 3. */
export function coveredByAvailability(
  shift: { starts_at: string; ends_at: string },
  windows: readonly AvailabilityLike[],
): boolean {
  const start = toManilaParts(shift.starts_at);
  const end = toManilaParts(shift.ends_at);
  const dayGap = daysBetween(start.date, end.date);
  if (durationMin(shift) > 24 * 60 || dayGap > 1) return false; // rule 4: never covered

  const onDay = windows.filter((w) => w.day_of_week === start.dow && minutesOf(w.start_time) <= start.minutes);
  if (dayGap === 0) return onDay.some((w) => minutesOf(w.end_time) >= end.minutes); // rule 1
  return onDay.some((w) => minutesOf(w.end_time) >= minutesOf(END_OF_DAY_WINDOW)); // rule 2; rule 3 falls out
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type AssignmentContext = {
  shift: ShiftLike;
  employee: EmployeeLike;
  availability: readonly AvailabilityLike[];
  /** The employee's assignments (any date). Entries with this shift's id mean "already assigned". */
  otherShifts: readonly AssignedShift[];
  /** People already on this shift, not counting this employee. */
  assignedCount: number;
  minRestHours?: number;
};

export function validateAssignment(ctx: AssignmentContext): ValidationResult {
  const { shift, employee, availability, assignedCount } = ctx;
  const restMin = (ctx.minRestHours ?? MIN_REST_HOURS) * 60;
  const blockers: Violation[] = [];
  const warnings: Violation[] = [];
  const block = (rule: BlockerRule, message: string) => blockers.push({ rule, level: "blocker", message });
  const warn = (rule: WarningRule, message: string, measure?: number) => warnings.push({ rule, level: "warning", message, measure });

  const mine = ctx.otherShifts.filter((o) => o.id !== shift.id);
  const live = mine.filter((o) => o.status !== "cancelled");

  if (ctx.otherShifts.some((o) => o.id === shift.id)) block("already_assigned", "This employee is already on this shift.");
  if (employee.status === "inactive") block("employee_inactive", "This employee is inactive.");
  if (employee.status === "on_leave") block("employee_on_leave", "This employee is on leave.");
  if (employee.department_id !== shift.department_id) block("department_mismatch", "This employee belongs to a different department than the shift.");

  const clash = live.find((o) => overlaps(o, shift));
  if (clash) block("overlap", `Overlaps another shift (${when(clash.starts_at)} to ${when(clash.ends_at)}).`);

  if (!coveredByAvailability(shift, availability))
    warn("outside_availability", "The shift is outside this employee's weekly availability.");

  // One warning, for the tightest gap to any neighbouring shift.
  let tightest: { gap: number; other: AssignedShift } | undefined;
  for (const o of live) {
    if (overlaps(o, shift)) continue; // already a blocker
    const gap = ms(o.ends_at) <= ms(shift.starts_at)
      ? Math.round((ms(shift.starts_at) - ms(o.ends_at)) / MS_PER_MIN)
      : Math.round((ms(o.starts_at) - ms(shift.ends_at)) / MS_PER_MIN);
    if (gap < restMin && (!tightest || gap < tightest.gap)) tightest = { gap, other: o };
  }
  if (tightest)
    warn(
      "insufficient_rest",
      `Only ${hours(tightest.gap)} h between this shift and the one at ${when(tightest.other.starts_at)} (minimum ${ctx.minRestHours ?? MIN_REST_HOURS} h).`,
      restMin - tightest.gap,
    );

  const week = weekStartManila(shift.starts_at);
  const weekMin =
    durationMin(shift) + live.filter((o) => weekStartManila(o.starts_at) === week).reduce((sum, o) => sum + durationMin(o), 0);
  if (weekMin > employee.max_weekly_hours * 60)
    warn("exceeds_weekly_hours", `The week of ${week} would total ${hours(weekMin)} h; the maximum is ${employee.max_weekly_hours} h.`, weekMin - employee.max_weekly_hours * 60);

  if (shift.position_id && employee.position_id !== shift.position_id)
    warn("position_mismatch", "This employee holds a different position than the shift asks for.");

  if (assignedCount + 1 > shift.required_headcount)
    warn("over_headcount", `This would make ${assignedCount + 1} people on a shift that needs ${shift.required_headcount}.`, assignedCount + 1 - shift.required_headcount);

  return { blockers, warnings };
}

/**
 * Whether an assignment may go ahead given the warnings the admin chose to override.
 * Blockers always refuse; they cannot be overridden.
 */
export function checkOverrides(result: ValidationResult, overrides: readonly string[]): { ok: boolean; refused: Violation[] } {
  const refused = [...result.blockers, ...result.warnings.filter((w) => !overrides.includes(w.rule))];
  return { ok: refused.length === 0, refused };
}

export type Assignee = {
  employee: EmployeeLike;
  availability: readonly AvailabilityLike[];
  /** The employee's assignments excluding this shift. */
  otherShifts: readonly AssignedShift[];
};

/**
 * Re-checks everyone assigned to a shift after its time, department or position changed.
 * Pass the shift with its NEW values. Nothing is ever removed automatically; the caller shows the results.
 */
export function validateShiftEdit(shift: ShiftLike, assignees: readonly Assignee[]): { employeeId: string; result: ValidationResult }[] {
  return assignees.map((a) => ({
    employeeId: a.employee.id,
    result: validateAssignment({
      shift,
      employee: a.employee,
      availability: a.availability,
      otherShifts: a.otherShifts.filter((o) => o.id !== shift.id),
      assignedCount: assignees.length - 1,
    }),
  }));
}

// ---------------------------------------------------------------------------
// Week view helpers (Phase 3.1). Pure, so they are unit-tested and reusable by later milestones.
// ---------------------------------------------------------------------------

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The Manila Monday that starts the week to show. `param` is the ?week= value: any valid "YYYY-MM-DD"
 * date selects the week that contains it. Missing means the current week; an invalid value falls back
 * to the current week and sets `invalid` so the page can say so.
 */
export function resolveWeek(param: string | undefined, now: Date): { weekStart: string; currentWeek: string; invalid: boolean } {
  const currentWeek = weekStartManila(now);
  if (param === undefined || param === "") return { weekStart: currentWeek, currentWeek, invalid: false };
  try {
    return { weekStart: weekStartManila(fromManila(param, "12:00")), currentWeek, invalid: false };
  } catch {
    return { weekStart: currentWeek, currentWeek, invalid: true };
  }
}

/** "Mon 23 Nov" for a "YYYY-MM-DD" date. */
export function formatDayHeading(date: string): string {
  const d = new Date(utcDay(date));
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "23 Nov – 29 Nov 2026"; the year appears on both ends when the week crosses New Year. */
export function weekRangeLabel(weekStart: string): string {
  const a = new Date(utcDay(weekStart));
  const b = new Date(utcDay(addDays(weekStart, 6)));
  const part = (d: Date, year: boolean) => `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
  return `${part(a, a.getUTCFullYear() !== b.getUTCFullYear())} – ${part(b, true)}`;
}

/** Manila "HH:MM–HH:MM", with "(+1)" when the shift ends on a later date. */
export function formatTimeRange(startIso: string, endIso: string): string {
  const s = toManilaParts(startIso);
  const e = toManilaParts(endIso);
  const gap = daysBetween(s.date, e.date);
  return `${s.time}–${e.time}${gap > 0 ? ` (+${gap})` : ""}`;
}

export type HeadcountState = "cancelled" | "unfilled" | "under" | "filled" | "over";

export function headcountState(assigned: number, required: number, status: ShiftStatus): HeadcountState {
  if (status === "cancelled") return "cancelled";
  if (assigned === 0) return "unfilled";
  if (assigned < required) return "under";
  return assigned > required ? "over" : "filled";
}

/** Shifts bucketed by the Manila date they START on (a 22:00–06:00 shift belongs to its start day), sorted by start time. */
export function shiftsByDay<T extends { id: string; starts_at: string }>(shifts: readonly T[], weekStart: string): Map<string, T[]> {
  const days = new Map(weekDays(weekStart).map((d) => [d, [] as T[]]));
  for (const s of shifts) days.get(toManilaParts(s.starts_at).date)?.push(s);
  for (const list of days.values()) list.sort((a, b) => ms(a.starts_at) - ms(b.starts_at) || a.id.localeCompare(b.id));
  return days;
}

// ---------------------------------------------------------------------------
// Shift lifecycle helpers (Phase 3.2): parsing the shift form and judging an edit.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_SHIFT_HOURS = 24;
export const MAX_HEADCOUNT = 50;

export type ShiftValues = {
  title: string;
  department_id: string;
  position_id: string | null;
  starts_at: string; // ISO, UTC
  ends_at: string;
  required_headcount: number;
  notes: string | null;
};

export const SHIFT_FIELD_LABELS: Record<keyof ShiftValues, string> = {
  title: "Title",
  department_id: "Department",
  position_id: "Position",
  starts_at: "Start",
  ends_at: "End",
  required_headcount: "Required headcount",
  notes: "Notes",
};

/** Fields that cannot change once a shift has attendance records. Title, notes and headcount can. */
export const ATTENDANCE_LOCKED: readonly (keyof ShiftValues)[] = ["department_id", "position_id", "starts_at", "ends_at"];

function readInstant(formData: FormData, dateKey: string, timeKey: string, errors: Record<string, string>): Date | null {
  const date = String(formData.get(dateKey) ?? "").trim();
  const time = String(formData.get(timeKey) ?? "").trim();
  let ok = true;
  try {
    fromManila(date, "00:00");
  } catch {
    errors[dateKey] = "Enter a valid date.";
    ok = false;
  }
  if (!HHMM.test(time)) {
    errors[timeKey] = "Enter a time as HH:MM.";
    ok = false;
  }
  return ok ? fromManila(date, time) : null;
}

/**
 * Parses the shift form. Dates and times are Asia/Manila wall-clock values (separate start and end dates, so an
 * overnight shift is explicit); the result holds UTC ISO timestamps. Server Actions call this; the UI never decides.
 */
export function parseShift(formData: FormData): { data?: ShiftValues; errors: Record<string, string> } {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const errors: Record<string, string> = {};

  const title = text("title");
  if (title.length < 2 || title.length > 80) errors.title = "Enter a title of 2 to 80 characters.";

  const department_id = text("department_id");
  if (!UUID.test(department_id)) errors.department_id = "Choose a department.";

  const positionRaw = text("position_id");
  if (positionRaw && !UUID.test(positionRaw)) errors.position_id = "Choose a valid position or none.";

  const required_headcount = Number(text("required_headcount"));
  if (!Number.isInteger(required_headcount) || required_headcount < 1 || required_headcount > MAX_HEADCOUNT)
    errors.required_headcount = `Enter a whole number from 1 to ${MAX_HEADCOUNT}.`;

  const notes = text("notes");
  if (notes.length > 500) errors.notes = "Keep notes under 500 characters.";

  const start = readInstant(formData, "start_date", "start_time", errors);
  const end = readInstant(formData, "end_date", "end_time", errors);
  if (start && end) {
    if (end.getTime() <= start.getTime())
      errors.end_time = "The shift must end after it starts. For an overnight shift, set the end date to the next day.";
    else if (end.getTime() - start.getTime() > MAX_SHIFT_HOURS * 3_600_000)
      errors.end_time = `A shift cannot be longer than ${MAX_SHIFT_HOURS} hours.`;
  }

  if (Object.keys(errors).length || !start || !end) return { errors };
  return {
    errors,
    data: {
      title,
      department_id,
      position_id: positionRaw || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      required_headcount,
      notes: notes || null,
    },
  };
}

/** Which fields differ between two sets of shift values (timestamps compare as instants). */
export function changedFields(before: ShiftValues, after: ShiftValues): (keyof ShiftValues)[] {
  return (Object.keys(SHIFT_FIELD_LABELS) as (keyof ShiftValues)[]).filter((k) =>
    k === "starts_at" || k === "ends_at" ? ms(before[k] as string) !== ms(after[k] as string) : (before[k] ?? null) !== (after[k] ?? null),
  );
}

/**
 * Compares an employee's problems before and after a shift edit. `added` is what the edit introduces: a problem
 * that did not exist, or the same warning made worse (bigger `measure`). `unchanged` problems are tolerated and shown.
 */
export function diffViolations(
  before: ValidationResult,
  after: ValidationResult,
): { added: Violation[]; unchanged: Violation[]; resolved: Violation[] } {
  const prev = new Map([...before.blockers, ...before.warnings].map((v) => [v.rule, v]));
  const next = [...after.blockers, ...after.warnings];
  const added: Violation[] = [];
  const unchanged: Violation[] = [];
  for (const v of next) {
    const p = prev.get(v.rule);
    if (!p || (v.measure ?? 0) > (p.measure ?? 0)) added.push(v);
    else unchanged.push(v);
  }
  const nextRules = new Set(next.map((v) => v.rule));
  return { added, unchanged, resolved: [...prev.values()].filter((p) => !nextRules.has(p.rule)) };
}

export type EditAssessment = {
  employeeId: string;
  before: ValidationResult;
  after: ValidationResult;
  added: Violation[];
  unchanged: Violation[];
  resolved: Violation[];
};

/** Judges every assignee of a shift against its old and new values. Nothing here changes any data. */
export function assessShiftEdit(oldShift: ShiftLike, newShift: ShiftLike, assignees: readonly Assignee[]): EditAssessment[] {
  const before = validateShiftEdit(oldShift, assignees);
  const after = validateShiftEdit(newShift, assignees);
  return after.map((a, i) => ({
    employeeId: a.employeeId,
    before: before[i].result,
    after: a.result,
    ...diffViolations(before[i].result, a.result),
  }));
}

// ---------------------------------------------------------------------------
// Assignment helpers (Phase 3.3a): shift-level guards and display helpers. The rules themselves stay in
// validateAssignment; nothing here re-implements them.
// ---------------------------------------------------------------------------

/**
 * Reasons a shift cannot take a new assignment at all, whatever the employee. Enforced by the Server Action
 * (the S1 function does not check shift state), and mirrored in the page so the panel explains itself.
 */
export function assignmentGuard(
  shift: { status: ShiftStatus; ends_at: string },
  attendanceCount: number,
  now: Date,
): string | null {
  if (shift.status === "cancelled") return "This shift is cancelled, so no one can be assigned.";
  if (attendanceCount > 0) return "This shift has attendance records, so its assignments are fixed.";
  if (ms(shift.ends_at) <= now.getTime()) return "This shift has already ended, so no one can be assigned.";
  return null;
}

/** Why a shift cannot be published right now, or null. Only a draft that has not ended can be published. */
export function publishGuard(shift: { status: ShiftStatus; ends_at: string }, attendanceCount: number, now: Date): string | null {
  if (shift.status === "cancelled") return "This shift is cancelled, so it cannot be published.";
  if (shift.status === "published") return "This shift is already published.";
  if (attendanceCount > 0) return "This shift has attendance records, so it cannot be published again.";
  if (ms(shift.ends_at) <= now.getTime()) return "This shift has already ended, so it cannot be published.";
  return null;
}

/** Why a shift cannot be unpublished right now, or null. Attendance records would be hidden from the employee, so they lock it. */
export function unpublishGuard(shift: { status: ShiftStatus }, attendanceCount: number): string | null {
  if (shift.status === "cancelled") return "This shift is cancelled, so it cannot be unpublished.";
  if (shift.status === "draft") return "This shift is already a draft.";
  if (attendanceCount > 0) return "This shift has attendance records, so it cannot be unpublished.";
  return null;
}

export type WeekShiftInput = {
  id: string;
  status: ShiftStatus;
  ends_at: string;
  updated_at: string;
  required_headcount: number;
  assigned: number;
  attendanceCount: number;
  employeeIds: string[];
};

export type WeekPublishPlan = {
  /** Draft shifts that can be published now, in a stable order (by id). */
  eligible: { id: string; updated_at: string; assigned: number }[];
  /** Eligible shifts with fewer people than required (empty shifts included). */
  understaffed: number;
  /** Eligible shifts with nobody assigned. */
  empty: number;
  /** Distinct employees who will see at least one of the eligible shifts. */
  employees: number;
  skipped: { published: number; cancelled: number; ended: number; attendance: number };
};

/** What publishing a week would do. Pure: the same rules as publishGuard, applied to every shift of the week. */
export function planWeekPublish(shifts: WeekShiftInput[], now: Date): WeekPublishPlan {
  const plan: WeekPublishPlan = { eligible: [], understaffed: 0, empty: 0, employees: 0, skipped: { published: 0, cancelled: 0, ended: 0, attendance: 0 } };
  const people = new Set<string>();
  for (const s of [...shifts].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.status === "cancelled") plan.skipped.cancelled++;
    else if (s.status === "published") plan.skipped.published++;
    else if (s.attendanceCount > 0) plan.skipped.attendance++;
    else if (publishGuard(s, s.attendanceCount, now)) plan.skipped.ended++;
    else {
      plan.eligible.push({ id: s.id, updated_at: s.updated_at, assigned: s.assigned });
      if (s.assigned < s.required_headcount) plan.understaffed++;
      if (s.assigned === 0) plan.empty++;
      s.employeeIds.forEach((e) => people.add(e));
    }
  }
  plan.employees = people.size;
  return plan;
}

export type AssignmentVerdict = "eligible" | "warning" | "blocked";

/** eligible = no problems; warning = only warnings (refused in 3.3a, overridable later); blocked = any hard blocker. */
export function assignmentVerdict(result: ValidationResult): AssignmentVerdict {
  if (result.blockers.length) return "blocked";
  return result.warnings.length ? "warning" : "eligible";
}

/** Minutes already worked by an employee in the Manila week of `weekOf` (shifts counted in the week they start), cancelled shifts excluded. */
export function assignedMinutesInWeek(weekOf: string, others: readonly AssignedShift[]): number {
  const week = weekStartManila(weekOf);
  return others.filter((o) => o.status !== "cancelled" && weekStartManila(o.starts_at) === week).reduce((sum, o) => sum + durationMin(o), 0);
}

// ---------------------------------------------------------------------------
// Warning overrides (Phase 3.3b). An override is permission to bypass ONE specific warning the server calculated, for one
// employee on one shift. It is never a master key: matchOverrides accepts a submission only when it covers exactly the
// fresh warning set, and refuses everything when there is a hard blocker.
//
// What the DATABASE enforces on an audit row (verified against the applied S1 SQL): rule is one of the five warning ids;
// char_length(btrim(reason)) is 10 to 500 (btrim removes spaces only); detail is at most 500 characters; required columns
// are not null. It does NOT check that the rule is a real warning for that assignment, forbids no duplicates, and accepts
// repeated-character or tab-only reasons. Those are APPLICATION rules, enforced here.
// ---------------------------------------------------------------------------

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export const OVERRIDE_RULE_LABELS: Record<WarningRule, string> = {
  outside_availability: "Outside weekly availability",
  insufficient_rest: "Insufficient rest",
  exceeds_weekly_hours: "Exceeds weekly hours",
  position_mismatch: "Position mismatch",
  over_headcount: "Over required headcount",
};

const labelOf = (rule: string) => (OVERRIDE_RULE_LABELS as Record<string, string>)[rule] ?? rule;
const safe = (text: string) => JSON.stringify(text.slice(0, 40));

/**
 * Trims the reason and checks it. Length counts characters (code points) after trimming ALL whitespace, which is at least
 * as strict as the database CHECK. The repeated-single-character rule is application-only.
 */
export function validateReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Enter a reason." };
  const reason = raw.trim();
  if (!reason) return { ok: false, error: "Enter a reason." };
  const length = Array.from(reason).length;
  if (length < REASON_MIN) return { ok: false, error: `Use at least ${REASON_MIN} characters.` };
  if (length > REASON_MAX) return { ok: false, error: `Use at most ${REASON_MAX} characters.` };
  if (/^([\s\S])\1*$/u.test(reason)) return { ok: false, error: "Write a real reason, not one repeated character." };
  return { ok: true, reason };
}

export type OverridePayload = { rule: WarningRule; reason: string; detail: string };

/**
 * Turns the reasons the admin submitted into the payload for assign_employee, or explains why not.
 * Rule ids and `detail` come from the fresh server-side warnings; the browser supplies reasons only. Refused when:
 * there is any hard blocker (checked first); there are no warnings; a rule is duplicated, unknown, not a fresh warning, or
 * missing; or any reason is invalid.
 */
export function matchOverrides(
  result: ValidationResult,
  submitted: readonly { rule: string; reason: unknown }[],
): { ok: true; payload: OverridePayload[] } | { ok: false; error: string } {
  if (result.blockers.length)
    return { ok: false, error: `Hard blockers cannot be overridden: ${result.blockers.map((v) => v.message).join(" ")}` };
  if (!result.warnings.length) return { ok: false, error: "There are no warnings to override. Use the normal Assign button." };

  const fresh = new Map(result.warnings.map((w) => [w.rule as string, w]));
  const seen = new Set<string>();
  for (const s of submitted) {
    if (seen.has(s.rule)) return { ok: false, error: `A reason for ${labelOf(s.rule)} was submitted more than once.` };
    seen.add(s.rule);
    if (!(RULE_IDS as readonly string[]).includes(s.rule)) return { ok: false, error: `Unknown rule ${safe(s.rule)}.` };
    if (!fresh.has(s.rule))
      return { ok: false, error: `${labelOf(s.rule)} is not a warning for this assignment, so it cannot be overridden.` };
  }
  const missing = [...fresh.keys()].filter((rule) => !seen.has(rule));
  if (missing.length) return { ok: false, error: `Give a reason for each warning. Missing: ${missing.map(labelOf).join(", ")}.` };

  const payload: OverridePayload[] = [];
  for (const rule of WARNING_RULES) {
    const warning = fresh.get(rule);
    if (!warning) continue;
    const checked = validateReason(submitted.find((s) => s.rule === rule)?.reason);
    if (!checked.ok) return { ok: false, error: `${labelOf(rule)}: ${checked.error}` };
    payload.push({ rule, reason: checked.reason, detail: warning.message.slice(0, 500) });
  }
  return { ok: true, payload };
}
