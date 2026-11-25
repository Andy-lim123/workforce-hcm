"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";

// Re-renders the page on the server, which reads the data again and recalculates. It changes nothing.
export function RecalculateButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? "Recalculating…" : "Recalculate"}
    </button>
  );
}
