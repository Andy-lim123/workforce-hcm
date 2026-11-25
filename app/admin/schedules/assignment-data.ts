import { createHash } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import type { AssignmentContext, AssignedShift, AvailabilityLike, EmployeeLike, ShiftStatus } from "@/lib/scheduling";

// Server-side data for assigning employees (Phase 3.3a), shared by the shift page and the Server Action so both judge
// exactly the same facts. Plain module, no "use server": it is imported only from server code. Nothing here decides a
// rule; validateAssignment in lib/scheduling.ts does.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const ROW_LIMIT = 1000; // PostgREST's default cap: a result this long may be truncated, so it is treated as an error

export type ShiftState = {
  shift: {
    id: string;
    title: string;
    department_id: string;
    position_id: string | null;
    starts_at: string;
    ends_at: string;
    required_headcount: number;
    status: ShiftStatus;
    updated_at: string;
  };
  assignedIds: string[];
  attendanceCount: number;
};

export type EmployeeData = {
  employee: EmployeeLike;
  code: string;
  name: string;
  position: string | null;
  availability: AvailabilityLike[];
  /** Every assignment of this employee, including this shift when they are already on it. */
  otherShifts: AssignedShift[];
};

export async function loadShiftState(supabase: Supabase, shiftId: string): Promise<ShiftState | "missing" | "error"> {
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, title, department_id, position_id, starts_at, ends_at, required_headcount, status, updated_at")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) return "error";
  if (!shift) return "missing";

  const { data: rows, error: rowsError } = await supabase.from("shift_assignments").select("id, employee_id").eq("shift_id", shiftId);
  if (rowsError || !rows) return "error";

  let attendanceCount = 0;
  if (rows.length) {
    const { count, error: attendanceError } = await supabase
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .in("shift_assignment_id", rows.map((r) => r.id));
    if (attendanceError) return "error";
    attendanceCount = count ?? 0;
  }
  return { shift, assignedIds: rows.map((r) => r.employee_id), attendanceCount };
}

/** Employees with their availability and all their assignments: either the given ids, or a whole department. */
export async function loadEmployeeData(
  supabase: Supabase,
  source: { ids: string[] } | { departmentId: string },
): Promise<EmployeeData[] | "error"> {
  const columns = "id, employee_code, first_name, last_name, status, department_id, position_id, max_weekly_hours, position:positions(title)";
  let employees;
  if ("ids" in source) {
    if (!source.ids.length) return [];
    const result = await supabase.from("employees").select(columns).in("id", source.ids);
    if (result.error) return "error";
    employees = result.data;
  } else {
    const result = await supabase.from("employees").select(columns).eq("department_id", source.departmentId);
    if (result.error) return "error";
    employees = result.data;
  }
  if (!employees.length) return [];

  const ids = employees.map((e) => e.id);
  const [availability, assignments] = await Promise.all([
    supabase.from("employee_availability").select("employee_id, day_of_week, start_time, end_time").in("employee_id", ids),
    supabase.from("shift_assignments").select("employee_id, shift:shifts(id, starts_at, ends_at, status)").in("employee_id", ids),
  ]);
  if (availability.error || assignments.error) return "error";
  if ((availability.data?.length ?? 0) >= ROW_LIMIT || (assignments.data?.length ?? 0) >= ROW_LIMIT) return "error";

  return employees.map((e) => ({
    employee: { id: e.id, status: e.status, department_id: e.department_id, position_id: e.position_id, max_weekly_hours: e.max_weekly_hours },
    code: e.employee_code,
    name: `${e.first_name} ${e.last_name}`,
    position: e.position?.title ?? null,
    availability: (availability.data ?? []).filter((a) => a.employee_id === e.id),
    otherShifts: (assignments.data ?? []).flatMap((a) => (a.employee_id === e.id && a.shift ? [a.shift] : [])),
  }));
}

/** The input to validateAssignment for one employee on this shift. */
export function assignmentContext(state: ShiftState, data: EmployeeData, options: { excludeThisShift?: boolean } = {}): AssignmentContext {
  const { shift } = state;
  return {
    shift: {
      id: shift.id,
      department_id: shift.department_id,
      position_id: shift.position_id,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      required_headcount: shift.required_headcount,
      status: shift.status,
    },
    employee: data.employee,
    availability: data.availability,
    otherShifts: options.excludeThisShift ? data.otherShifts.filter((o) => o.id !== shift.id) : data.otherShifts,
    assignedCount: state.assignedIds.filter((id) => id !== data.employee.id).length,
  };
}

/**
 * A stale-state safeguard, NOT a concurrency guarantee: it identifies what the admin was shown (the shift version and
 * status, who is assigned, this employee's row, availability and other shifts). The Server Action recomputes it from fresh
 * data and refuses a mismatch. It cannot see changes made after that read.
 */
export function fingerprintAssignment(state: ShiftState, data: EmployeeData): string {
  const stable = {
    shift: { id: state.shift.id, updated_at: state.shift.updated_at, status: state.shift.status },
    assigned: [...state.assignedIds].sort(),
    attendance: state.attendanceCount,
    employee: data.employee,
    availability: [...data.availability].sort(
      (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time),
    ),
    otherShifts: [...data.otherShifts].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
