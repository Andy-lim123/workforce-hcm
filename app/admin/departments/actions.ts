"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import type { ActionState } from "@/components/action-form";

function parse(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { error: "Enter a department name." };
  if (name.length > 80) return { error: "Keep the name under 80 characters." };
  if (description.length > 500) return { error: "Keep the description under 500 characters." };
  return { data: { name, description: description || null } };
}

export async function createDepartment(prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const { data, error: invalid } = parse(formData);
  if (!data) return { error: invalid };

  const supabase = await createClient();
  const { error } = await supabase.from("departments").insert(data);
  if (error) return { error: error.code === "23505" ? `A department named “${data.name}” already exists.` : "Could not add the department." };

  refresh();
  return { success: `Department “${data.name}” added.`, done: (prev.done ?? 0) + 1 };
}

// Deleting a department would cascade to its positions and shifts (and null out employees'
// department), so it is refused while anything still references it.
export async function deleteDepartment(id: string, prev: ActionState): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown department." };

  const supabase = await createClient();
  const count = (table: "employees" | "positions" | "shifts") =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("department_id", id);
  const [employees, positions, shifts] = await Promise.all([count("employees"), count("positions"), count("shifts")]);
  if (employees.error || positions.error || shifts.error) return { error: "Could not check this department. Please try again." };

  const blockers = [
    employees.count && `${employees.count} employee(s): move them to another department`,
    positions.count && `${positions.count} position(s): move or delete them on the Positions page`,
    shifts.count && `${shifts.count} shift(s): these keep the department's schedule history`,
  ].filter(Boolean);
  if (blockers.length) return { error: `This department cannot be deleted while it has ${blockers.join("; ")}.` };

  const { data, error } = await supabase.from("departments").delete().eq("id", id).select("id");
  if (error) return { error: "Could not delete the department." };
  if (!data.length) return { error: "This department no longer exists." };

  refresh();
  return { success: "Department deleted.", done: (prev.done ?? 0) + 1 };
}

export async function updateDepartment(id: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown department." };
  const { data, error: invalid } = parse(formData);
  if (!data) return { error: invalid };

  const supabase = await createClient();
  const { data: rows, error } = await supabase.from("departments").update(data).eq("id", id).select("id");
  if (error) return { error: error.code === "23505" ? `A department named “${data.name}” already exists.` : "Could not save the department." };
  if (!rows.length) return { error: "This department no longer exists." };

  refresh();
  return { success: "Department saved.", done: (prev.done ?? 0) + 1 };
}
