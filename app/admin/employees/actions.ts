"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findOverlap, isUuid, parseEmployee, parseWindow, type EmployeeInput } from "@/lib/validation";
import { DAY_LABELS } from "@/lib/labels";
import type { ActionState } from "@/components/action-form";

// Every action re-checks the caller on the server (requireRole redirects non-admins), and all
// table writes go through the caller's own session, so RLS applies as a second gate.

const ok = (prev: ActionState, success: string): ActionState => ({ success, done: (prev.done ?? 0) + 1 });

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function checkPosition(supabase: Supabase, input: EmployeeInput): Promise<ActionState | null> {
  const { data } = await supabase
    .from("positions")
    .select("department_id")
    .eq("id", input.position_id)
    .maybeSingle();
  if (!data) return { fieldErrors: { position_id: "This position no longer exists." }, error: "Check the highlighted fields." };
  if (data.department_id !== input.department_id)
    return { fieldErrors: { position_id: "This position belongs to a different department." }, error: "Check the highlighted fields." };
  return null;
}

function uniqueViolation(error: { code?: string; message: string; details?: string | null }): ActionState | null {
  if (error.code !== "23505") return null;
  const text = `${error.message} ${error.details ?? ""}`;
  if (text.includes("employee_code"))
    return { fieldErrors: { employee_code: "Another employee already uses this ID." }, error: "Check the highlighted fields." };
  if (text.includes("email"))
    return { fieldErrors: { email: "Another employee already uses this email address." }, error: "Check the highlighted fields." };
  return { error: "This record conflicts with an existing one." };
}

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const { data: input, errors } = parseEmployee(formData);
  if (!input) return { fieldErrors: errors, error: "Check the highlighted fields." };

  const supabase = await createClient();
  const positionError = await checkPosition(supabase, input);
  if (positionError) return positionError;

  const { data, error } = await supabase.from("employees").insert(input).select("id").single();
  if (error) return uniqueViolation(error) ?? { error: "Could not save the employee. Please try again." };

  redirect(`/admin/employees/${data.id}?created=1`);
}

export async function updateEmployee(id: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(id)) return { error: "Unknown employee." };
  const { data: input, errors } = parseEmployee(formData);
  if (!input) return { fieldErrors: errors, error: "Check the highlighted fields." };

  const supabase = await createClient();
  const positionError = await checkPosition(supabase, input);
  if (positionError) return positionError;

  const { data, error } = await supabase.from("employees").update(input).eq("id", id).select("id");
  if (error) return uniqueViolation(error) ?? { error: "Could not save the changes. Please try again." };
  if (!data.length) return { error: "This employee no longer exists." };

  refresh();
  return ok(prev, "Changes saved.");
}

export async function setSkill(employeeId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const skillId = formData.get("skill_id");
  const proficiency = Number(formData.get("proficiency"));
  if (!isUuid(employeeId) || !isUuid(skillId)) return { error: "Choose a skill." };
  if (!Number.isInteger(proficiency) || proficiency < 1 || proficiency > 5) return { error: "Choose a proficiency from 1 to 5." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_skills")
    .upsert({ employee_id: employeeId, skill_id: skillId, proficiency });
  if (error) return { error: error.code === "23503" ? "That skill or employee no longer exists." : "Could not save the skill." };

  refresh();
  return ok(prev, "Skill saved.");
}

export async function removeSkill(employeeId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const skillId = formData.get("skill_id");
  if (!isUuid(employeeId) || !isUuid(skillId)) return { error: "Unknown skill." };

  const supabase = await createClient();
  const { error } = await supabase.from("employee_skills").delete().match({ employee_id: employeeId, skill_id: skillId });
  if (error) return { error: "Could not remove the skill." };

  refresh();
  return ok(prev, "Skill removed.");
}

// ---------------------------------------------------------------------------
// Weekly availability. Validation runs here on the server; see parseWindow for the policy.
// ---------------------------------------------------------------------------

async function saveWindow(employeeId: string, windowId: string | null, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(employeeId) || (windowId !== null && !isUuid(windowId))) return { error: "Unknown availability window." };
  const { data: input, error: invalid } = parseWindow(formData);
  if (!input) return { error: invalid };

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("employee_availability")
    .select("id, day_of_week, start_time, end_time")
    .eq("employee_id", employeeId);
  if (loadError) return { error: "Could not check existing availability. Please try again." };
  if (windowId && !existing.some((w) => w.id === windowId)) return { error: "This availability window no longer exists." };

  // shortcut: check-then-write, so two simultaneous saves could still overlap; a Postgres
  // exclusion constraint would close that gap (schema change, pending approval).
  const clash = findOverlap(existing, input, windowId ?? undefined);
  if (clash)
    return {
      error: `This overlaps the existing ${DAY_LABELS[input.day_of_week]} window ${clash.start_time.slice(0, 5)}–${clash.end_time.slice(0, 5)}. Edit that window or choose different times.`,
    };

  const { error } = windowId
    ? await supabase.from("employee_availability").update(input).eq("id", windowId).eq("employee_id", employeeId)
    : await supabase.from("employee_availability").insert({ ...input, employee_id: employeeId });
  if (error) return { error: error.code === "23514" ? "The end time must be after the start time." : "Could not save availability." };

  refresh();
  return ok(prev, windowId ? "Availability updated." : "Availability window added.");
}

export async function addAvailability(employeeId: string, prev: ActionState, formData: FormData) {
  return saveWindow(employeeId, null, prev, formData);
}

export async function updateAvailability(employeeId: string, windowId: string, prev: ActionState, formData: FormData) {
  return saveWindow(employeeId, windowId, prev, formData);
}

export async function removeAvailability(employeeId: string, windowId: string, prev: ActionState): Promise<ActionState> {
  await requireRole("admin");
  if (!isUuid(employeeId) || !isUuid(windowId)) return { error: "Unknown availability window." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_availability")
    .delete()
    .eq("id", windowId)
    .eq("employee_id", employeeId)
    .select("id");
  if (error) return { error: "Could not remove the window." };
  if (!data.length) return { error: "This availability window no longer exists." };

  refresh();
  return ok(prev, "Availability window removed.");
}

// ---------------------------------------------------------------------------
// Login accounts. Auth admin calls need the secret key, so they run only here on the server.
// ---------------------------------------------------------------------------

const NOT_CONFIGURED: ActionState = {
  error: "Account management is not configured. Add SUPABASE_SECRET_KEY to .env.local and restart the server.",
};

async function loadEmployee(supabase: Supabase, id: string) {
  if (!isUuid(id)) return null;
  const { data } = await supabase
    .from("employees")
    .select("id, email, first_name, last_name, profile_id")
    .eq("id", id)
    .maybeSingle();
  return data;
}

// Generates a one-time invitation (or, for a verified login that never set a password, a
// password-setup link) through the Auth admin API. The token is returned to the admin once in
// this response and is not stored or logged. The link carries it in the URL fragment (#), which
// browsers never send to a server, so it does not reach request logs or Referer headers.
// The employee sets their own password; verifying the invite confirms the email, and the
// database trigger links the login to this employee record only then. Roles are never set here:
// every new profile is 'employee'.
export async function createInviteLink(employeeId: string, prev: ActionState): Promise<ActionState> {
  await requireRole("admin");
  const admin = createAdminClient();
  if (!admin) return NOT_CONFIGURED;

  const supabase = await createClient();
  const employee = await loadEmployee(supabase, employeeId);
  if (!employee) return { error: "This employee no longer exists." };

  const origin = (await headers()).get("origin");
  if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) return { error: "Could not determine this site's address." };

  // Decide between a fresh invite and a password-setup link for an existing, verified login.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("email", employee.email.toLowerCase())
    .maybeSingle();
  let type: "invite" | "recovery" = "invite";
  if (profile) {
    if (profile.role !== "employee") return { error: "That email belongs to an administrator login." };
    if (employee.profile_id && employee.profile_id !== profile.id) return { error: "This employee is linked to a different login." };
    const { data: auth } = await admin.auth.admin.getUserById(profile.id);
    if (!auth.user) return { error: "Could not check the existing login. Please try again." };
    if (auth.user.email_confirmed_at) {
      if (auth.user.user_metadata?.password_set !== false)
        return {
          error: employee.profile_id
            ? "This employee has already activated their login. They can sign in with their own password."
            : "A verified login already exists for this email. Use “Link existing login” instead.",
        };
      type = "recovery"; // accepted the invite but never chose a password
    }
  } else if (employee.profile_id) {
    return { error: "This employee's login could not be found." };
  }

  const fullName = `${employee.first_name} ${employee.last_name}`;
  const { data, error } =
    type === "invite"
      ? await admin.auth.admin.generateLink({
          type: "invite",
          email: employee.email,
          options: { data: { full_name: fullName, password_set: false } },
        })
      : await admin.auth.admin.generateLink({ type: "recovery", email: employee.email });
  if (error || !data.properties?.hashed_token) {
    return { error: "Could not generate the link. Please try again." };
  }

  // No refresh(): re-rendering would unmount this form and drop the link before it is copied.
  const fragment = new URLSearchParams({ token_hash: data.properties.hashed_token, type });
  return {
    success:
      type === "invite"
        ? `Invitation created for ${employee.email}. Copy the link now; it is shown only once, works once, and expires. The status changes to “Invited” when you reload the page.`
        : `Password setup link created for ${employee.email}. Copy it now; it is shown only once, works once, and expires.`,
    link: `${origin}/auth/accept#${fragment}`,
    done: (prev.done ?? 0) + 1,
  };
}

// Links an existing, email-verified employee login whose email matches this employee record.
export async function linkLogin(employeeId: string, prev: ActionState): Promise<ActionState> {
  await requireRole("admin");
  const admin = createAdminClient();
  if (!admin) return NOT_CONFIGURED;

  const supabase = await createClient();
  const employee = await loadEmployee(supabase, employeeId);
  if (!employee) return { error: "This employee no longer exists." };
  if (employee.profile_id) return { error: "This employee already has a linked login." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("email", employee.email.toLowerCase()) // Supabase Auth stores emails lowercased
    .maybeSingle();
  if (!profile) return { error: "No login exists for this email address yet." };
  if (profile.role !== "employee") return { error: "That login belongs to an administrator and cannot be linked." };

  const { data: auth, error: authError } = await admin.auth.admin.getUserById(profile.id);
  if (authError || !auth.user) return { error: "Could not check the login. Please try again." };
  if (!auth.user.email_confirmed_at)
    return { error: "That login has not verified its email address yet. It links automatically once verified." };

  const { error } = await supabase.from("employees").update({ profile_id: profile.id }).eq("id", employeeId).is("profile_id", null);
  if (error) {
    if (error.code === "23505") return { error: "That login is already linked to another employee." };
    return { error: "Could not link the login." };
  }

  refresh();
  return ok(prev, "Login linked.");
}

const BAN_FOREVER = "876000h"; // ~100 years: Supabase has no permanent ban flag

export async function setAccess(employeeId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const admin = createAdminClient();
  if (!admin) return NOT_CONFIGURED;
  const enable = formData.get("access") === "enable";

  const supabase = await createClient();
  const employee = await loadEmployee(supabase, employeeId);
  if (!employee?.profile_id) return { error: "This employee has no login." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", employee.profile_id).single();
  if (profile?.role !== "employee") return { error: "Administrator access cannot be changed here." };

  const { error } = await admin.auth.admin.updateUserById(employee.profile_id, {
    ban_duration: enable ? "none" : BAN_FOREVER,
  });
  if (error) return { error: `Could not update access: ${error.message}` };

  refresh();
  return ok(prev, enable ? "Access restored." : "Access disabled. The employee can no longer sign in.");
}
