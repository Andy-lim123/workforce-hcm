import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return <Placeholder role="employee" title="Profile" description="Your personal details." phase={2} />;
}
