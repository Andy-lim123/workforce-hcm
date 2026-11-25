import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <RedirectToHome />
    </Suspense>
  );
}

async function RedirectToHome(): Promise<null> {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user.role) : "/login");
}
