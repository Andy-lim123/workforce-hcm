import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type Role = Database["public"]["Enums"]["app_role"];

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
};

export function homeFor(role: Role) {
  return role === "admin" ? "/admin" : "/me";
}

// Authoritative per-request identity check. getUser() asks the Auth server, so a revoked
// session is rejected even while its JWT has not expired. Reads cookies: call inside <Suspense>.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  return { id: profile.id, email: profile.email, fullName: profile.full_name, role: profile.role };
});

// Server-side gate: signed-out users go to /login, users with the wrong role go to their home.
export async function requireRole(role: Role): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}
