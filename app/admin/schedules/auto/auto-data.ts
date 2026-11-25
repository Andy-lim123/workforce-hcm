import type { createClient } from "@/lib/supabase/server";
import type { ScheduleEmployee, ScheduleShift } from "@/lib/auto-schedule";
import { addDays, weekBoundsUtc } from "@/lib/scheduling";

// Data for the automatic scheduling preview. SERVER ONLY and READ ONLY: four selects through the signed-in admin's own
// session (row-level security applies). Nothing here writes.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const ROW_LIMIT = 1000; // PostgREST's default cap: a result this long may be cut off, so it is treated as an error

export type PreviewShiftRow = ScheduleShift & { title: string; position: string | null };

export type PreviewData = {
  shifts: PreviewShiftRow[];
  employees: ScheduleEmployee[];
  names: Map<string, string>;
  departments: { id: string; name: string }[];
};

export async function loadPreviewData(supabase: Supabase, weekStart: string): Promise<PreviewData | "error"> {
  // A week either side is enough for rest and overlap checks (a shift lasts at most a day; the minimum rest is hours).
  const from = weekBoundsUtc(addDays(weekStart, -7)).start.toISOString();
  const to = weekBoundsUtc(addDays(weekStart, 7)).end.toISOString();

  const [shifts, employees, availability, departments] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, title, department_id, position_id, starts_at, ends_at, required_headcount, status, position:positions(title), shift_assignments(employee_id, attendance_records(count))")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at")
      .limit(ROW_LIMIT),
    supabase.from("employees").select("id, employee_code, first_name, last_name, status, department_id, position_id, max_weekly_hours").limit(ROW_LIMIT),
    supabase.from("employee_availability").select("employee_id, day_of_week, start_time, end_time").limit(ROW_LIMIT),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  if (shifts.error || employees.error || availability.error || departments.error) return "error";
  if ([shifts.data, employees.data, availability.data].some((rows) => rows.length >= ROW_LIMIT)) return "error";

  const rows: PreviewShiftRow[] = shifts.data.map((s) => ({
    id: s.id,
    title: s.title,
    position: s.position?.title ?? null,
    department_id: s.department_id,
    position_id: s.position_id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    required_headcount: s.required_headcount,
    status: s.status,
    assignedIds: s.shift_assignments.map((a) => a.employee_id),
    attendanceCount: s.shift_assignments.reduce((n, a) => n + (a.attendance_records[0]?.count ?? 0), 0),
  }));

  return {
    shifts: rows,
    departments: departments.data,
    names: new Map(employees.data.map((e) => [e.id, `${e.first_name} ${e.last_name}`])),
    employees: employees.data.map((e) => ({
      employee: { id: e.id, status: e.status, department_id: e.department_id, position_id: e.position_id, max_weekly_hours: e.max_weekly_hours },
      code: e.employee_code,
      availability: availability.data.filter((a) => a.employee_id === e.id),
      assignments: rows.filter((s) => s.assignedIds.includes(e.id)).map((s) => ({ id: s.id, starts_at: s.starts_at, ends_at: s.ends_at, status: s.status })),
    })),
  };
}
