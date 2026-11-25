import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// Static page: proxy.ts redirects signed-in visitors away from /login.
export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-900">Sign in</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-500">Use the account your administrator created for you.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
