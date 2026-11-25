import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invitation", referrer: "no-referrer" };

export default function Page() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">Activate your account</h1>
          <p className="mt-1 mb-5 text-sm text-zinc-500">Confirm the invitation, then choose your own password.</p>
          <AcceptForm />
        </div>
      </div>
    </main>
  );
}
