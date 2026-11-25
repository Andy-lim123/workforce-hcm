"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import type { ActionState } from "@/components/action-form";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function parse(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const department_id = String(formData.get("department_id") ?? "");
  if (!title) return { error: "Enter a position title." };
  if (title.length > 80) return { error: "Keep the title under 80 characters." };
  if (description.length > 500) return { error: "Keep the description under 500 characters." };
  if (!isUuid(department_id)) return { error: "Choose a department." };
  return { data: { title, department_id, description: description || null } };
}

async function assignedCount(supabase: Supabase, positionId: string) {
  const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("position_id", positionId);
  return count ?? 0;
}

const duplicate = (title: string) => `This department already has a position called “${title}”.`;

export async function createPosition(prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const { data, error: invalid } = parse(formData);
  if (!data) return { error: invalid };

  const supabase = await createClient();
  const { error } = await supabase.from("positions").insert(data);
  if (error) {
    if (error.code === "23505") return { error: duplicate(data.title) };
    if (error.code === "23503") return { error: "That department no longer exists." };
    return { error: "Could not add the position." };
  }

  refresh();
  return { success: `Position “${data.title}” added.`, done: (prev.done ?? 0) + 1 };
}

export async function updatePosition(id: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown position." };
  const { data, error: invalid } = parse(formData);
  if (!data) return { error: invalid };

  const supabase = await createClient();
  const { data: current } = await supabase.from("positions").select("department_id").eq("id", id).maybeSingle();
  if (!current) return { error: "This position no longer exists." };

  // Employees keep their department, so moving a staffed position would split it across departments.
  if (current.department_id !== data.department_id) {
    const count = await assignedCount(supabase, id);
    if (count) return { error: `Reassign the ${count} employee(s) in this position before moving it to another department.` };
  }

  const { error } = await supabase.from("positions").update(data).eq("id", id);
  if (error) return { error: error.code === "23505" ? duplicate(data.title) : "Could not save the position." };

  refresh();
  return { success: "Position saved.", done: (prev.done ?? 0) + 1 };
}

export async function deletePosition(id: string, prev: ActionState): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown position." };

  const supabase = await createClient();
  const count = await assignedCount(supabase, id);
  if (count) return { error: `This position is held by ${count} employee(s). Reassign them before deleting it.` };

  // Shifts that required this position keep their department and lose only the position (FK: set null).
  const { data, error } = await supabase.from("positions").delete().eq("id", id).select("id");
  if (error) return { error: "Could not delete the position." };
  if (!data.length) return { error: "This position no longer exists." };

  refresh();
  return { success: "Position deleted.", done: (prev.done ?? 0) + 1 };
}
