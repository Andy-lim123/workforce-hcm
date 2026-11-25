import { createHash } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import { fromManila, planWeekPublish, resolveWeek, weekBoundsUtc, type WeekPublishPlan } from "@/lib/scheduling";
import { isUuid } from "@/lib/validation";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const WEEK_PUBLISH_MAX = 200;

export type WeekScope = { weekStart: string; department: string };

/** Accepts only a real Monday date and an empty or valid department id; anything else is a tampered request. */
export function parseWeekScope(week: unknown, department: unknown): WeekScope | null {
  if (typeof week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  try {
    fromManila(week, "12:00");
  } catch {
    return null;
  }
  const resolved = resolveWeek(week, new Date());
  if (resolved.invalid || resolved.weekStart !== week) return null;
  if (department !== "" && department !== null && department !== undefined && !(typeof department === "string" && isUuid(department))) return null;
  return { weekStart: week, department: typeof department === "string" ? department : "" };
}

/** Reads the week's shifts fresh, with assignments and attendance, and plans what publishing would do. */
export async function loadWeekPlan(supabase: Supabase, scope: WeekScope, now: Date): Promise<WeekPublishPlan | "error"> {
  const { start, end } = weekBoundsUtc(scope.weekStart);
  let query = supabase
    .from("shifts")
    .select("id, status, ends_at, updated_at, required_headcount, shift_assignments(employee_id, attendance_records(count))")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  if (scope.department) query = query.eq("department_id", scope.department);
  const { data, error } = await query;
  if (error || !data) return "error";

  return planWeekPublish(
    data.map((s) => ({
      id: s.id,
      status: s.status,
      ends_at: s.ends_at,
      updated_at: s.updated_at,
      required_headcount: s.required_headcount,
      assigned: s.shift_assignments.length,
      attendanceCount: s.shift_assignments.reduce((n, a) => n + (a.attendance_records[0]?.count ?? 0), 0),
      employeeIds: s.shift_assignments.map((a) => a.employee_id),
    })),
    now,
  );
}

/** SHA-256 over the scope and every eligible shift's id, version and assigned count: a stale-state safeguard, not a lock. */
export function fingerprintWeekPlan(scope: WeekScope, plan: WeekPublishPlan): string {
  const lines = plan.eligible.map((s) => `${s.id}|${s.updated_at}|${s.assigned}`);
  return createHash("sha256").update([scope.weekStart, scope.department, ...lines].join("\n")).digest("hex");
}
