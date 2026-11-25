"use client";

import { useActionState, useState } from "react";
import { signIn, type SignInState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-zinc-800">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-zinc-800">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="block w-full rounded-md border border-zinc-300 bg-white py-2 pl-3 pr-16 text-sm text-zinc-900 shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-zinc-500 hover:text-zinc-800"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
