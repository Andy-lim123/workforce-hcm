"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth";

export type SignInState = { error?: string; email?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function messageFor(code: string | undefined) {
  switch (code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Confirm your email address before signing in.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Wait a moment and try again.";
    case "user_banned":
      return "This account has been disabled. Contact your administrator.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL.test(email)) return { error: "Enter a valid email address.", email };
  if (!password) return { error: "Enter your password.", email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: messageFor(error.code), email };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  redirect(homeFor(profile?.role ?? "employee"));
}

export async function signOut() {
  const supabase = await createClient();
  // Default scope "global" revokes refresh tokens on every device. If the Auth server is
  // unreachable, still clear this browser's cookies so the user is not left signed in.
  const { error } = await supabase.auth.signOut();
  if (error) await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
