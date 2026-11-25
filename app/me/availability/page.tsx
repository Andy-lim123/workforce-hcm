import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Availability" };

export default function Page() {
  return <Placeholder role="employee" title="Availability" description="Tell your manager when you can work." phase={2} />;
}
