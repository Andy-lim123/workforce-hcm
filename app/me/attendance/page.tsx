import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Attendance" };

export default function Page() {
  return <Placeholder role="employee" title="Attendance" description="Your clock-in history." phase={6} />;
}
