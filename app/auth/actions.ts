"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth";

export type AuthFormState = { error?: string };

// Verifies a one-time invitation or password-setup token with Supabase Auth. Supabase checks
// that the token exists, is unused and unexpired, then consumes it; a reused or expired link
// fails here. On success the session cookies are set and the user must choose a password.
export async function acceptLink(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = formData.get("type");
  if (!tokenHash || (type !== "invite" && type !== "recovery")) return { error: "This link is incomplete. Ask your administrator for a new one." };

  const supabase = await createClient();
  // Accepting a link replaces any session already open in this browser.
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return {
      error:
        error.code === "otp_expired"
          ? "This link has expired or has already been used. Ask your administrator for a new one."
          : "This link is not valid. Ask your administrator for a new one.",
    };
  }
  redirect("/auth/set-password");
}

export async function setPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 12) return { error: "Use at least 12 characters." };
  if (password.length > 72) return { error: "Use at most 72 characters." };
  if (password !== confirm) return { error: "The passwords do not match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has ended. Open your invitation link again." };

  // password_set is shown to admins as the account's activation state; it grants nothing.
  const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
  if (error) {
    if (error.code === "weak_password") return { error: "This password is too weak or has appeared in a data breach. Choose another." };
    if (error.code === "same_password") return { error: "Choose a password you have not used for this account before." };
    return { error: "Could not save your password. Please try again." };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  redirect(homeFor(profile?.role ?? "employee"));
}
