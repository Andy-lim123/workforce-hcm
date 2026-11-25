import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default function Page() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">Choose your password</h1>
          <Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}>
            <SignedInOnly />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

// Only reachable with the session created by a verified invitation or password-setup link.
async function SignedInOnly() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <>
      <p className="mt-1 mb-5 text-sm text-zinc-500">
        Signed in as <span className="font-medium text-zinc-900">{user.email}</span>.
      </p>
      <SetPasswordForm email={user.email} />
    </>
  );
}
