import type { Metadata } from "next";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { BackLink, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { fromManila, toManilaParts } from "@/lib/scheduling";
import { isUuid } from "@/lib/validation";
import { createShift } from "../actions";
import { ShiftForm } from "../shift-form";

export const metadata: Metadata = { title: "New shift" };

export default function Page({ searchParams }: PageProps<"/admin/schedules/new">) {
  return (
    <RequireRole role="admin">
      <BackLink href="/admin/schedules">Schedules</BackLink>
      <PageHeader title="New shift" description="Creates a draft shift. Dates and times are Asia/Manila. Assign people after creating it." />
      <NewShift searchParams={searchParams} />
    </RequireRole>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function NewShift({ searchParams }: { searchParams: PageProps<"/admin/schedules/new">["searchParams"] }) {
  const raw = await searchParams;
  const supabase = await createClient();
  const [{ data: departments }, { data: positions }] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, department_id").order("title"),
  ]);

  // Optional prefill from the week view: ?date=YYYY-MM-DD (any valid date) and ?department=<id>.
  const dateParam = first(raw.date);
  let date = toManilaParts(new Date()).date;
  try {
    if (dateParam) date = toManilaParts(fromManila(dateParam, "12:00")).date;
  } catch {
    // an invalid ?date= falls back to today
  }
  const departmentParam = first(raw.department);
  const department = isUuid(departmentParam) && departments?.some((d) => d.id === departmentParam) ? departmentParam : "";

  return (
    <div className="max-w-3xl">
      <Card>
        <ShiftForm
          action={createShift}
          departments={departments ?? []}
          positions={positions ?? []}
          submitLabel="Create draft shift"
          cancelHref="/admin/schedules"
          initial={{
            title: "",
            department_id: department,
            position_id: "",
            start_date: date,
            start_time: "09:00",
            end_date: date,
            end_time: "17:00",
            required_headcount: "1",
            notes: "",
          }}
        />
      </Card>
    </div>
  );
}
