"use client";

import { useActionState } from "react";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui";
import { setPassword, type AuthFormState } from "../actions";

export function SetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(setPassword, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {/* Lets password managers save the new credential against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="New password" htmlFor="password" hint="At least 12 characters." required>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required className={inputClass} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" required>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={72} required className={inputClass} />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? "Saving…" : "Save password and continue"}
      </button>
    </form>
  );
}
