import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];
export type EmployeeStatus = Enums["employee_status"];
export type EmploymentType = Enums["employment_type"];

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  inactive: "Inactive",
};

export const STATUS_TONES: Record<EmployeeStatus, "green" | "amber" | "zinc"> = {
  active: "green",
  on_leave: "amber",
  inactive: "zinc",
};

export const TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
};

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The demo organisation's timezone; dates like "today" are computed here, not in the server's zone.
export const ORG_TIMEZONE = "Asia/Manila";

export function todayInOrg() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE }).format(new Date());
}

export function formatDate(isoDate: string) {
  // Date-only values: format in UTC so the calendar day never shifts.
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: ORG_TIMEZONE }).format(new Date(iso));
}
