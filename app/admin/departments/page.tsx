import type { Metadata } from "next";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Alert, Card, EmptyState, Field, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { createDepartment, deleteDepartment, updateDepartment } from "./actions";

export const metadata: Metadata = { title: "Departments" };

export default function Page() {
  return (
    <RequireRole role="admin">
      <PageHeader title="Departments" description="Organise teams into departments." />
      <Departments />
    </RequireRole>
  );
}

async function Departments() {
  const supabase = await createClient();
  const { data: departments, error } = await supabase
    .from("departments")
    .select("id, name, description, employees(count), positions(count), shifts(count)")
    .order("name");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {error ? (
          <Alert tone="error">Could not load departments. Refresh the page to try again.</Alert>
        ) : !departments?.length ? (
          <EmptyState title="No departments yet" description="Add your first department using the form." />
        ) : (
          departments.map((d) => {
            const employees = d.employees[0]?.count ?? 0;
            const positions = d.positions[0]?.count ?? 0;
            const shifts = d.shifts[0]?.count ?? 0;
            const inUse = employees + positions + shifts > 0;
            return (
              <article key={d.id} className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">{d.name}</h2>
                    {d.description && <p className="mt-0.5 text-sm text-zinc-500">{d.description}</p>}
                  </div>
                  <div className="flex gap-4 text-sm">
                    <Link href={`/admin/employees?department=${d.id}`} className="text-teal-700 hover:underline">
                      {employees} {employees === 1 ? "employee" : "employees"}
                    </Link>
                    <Link href={`/admin/positions#dept-${d.id}`} className="text-teal-700 hover:underline">
                      {positions} {positions === 1 ? "position" : "positions"}
                    </Link>
                  </div>
                </div>
                <details className="group mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-600 hover:text-zinc-900">
                    Edit<span className="sr-only"> {d.name}</span>
                  </summary>
                  <ActionForm action={updateDepartment.bind(null, d.id)} className="mt-3 space-y-3">
                    <DepartmentFields idPrefix={d.id} name={d.name} description={d.description} />
                    <SubmitButton>Save department</SubmitButton>
                  </ActionForm>
                  <ActionForm action={deleteDepartment.bind(null, d.id)} className="mt-4 border-t border-zinc-100 pt-4">
                    {inUse ? (
                      <p className="text-xs text-zinc-500">
                        Cannot be deleted while it has {[employees && `${employees} employee(s)`, positions && `${positions} position(s)`, shifts && `${shifts} shift(s)`].filter(Boolean).join(", ")}.
                        Reassign or remove them first.
                      </p>
                    ) : (
                      <ConfirmSubmit
                        label="Delete department"
                        title={`Delete “${d.name}”?`}
                        message="This cannot be undone. The department has no employees, positions or shifts."
                        confirmLabel="Delete"
                      />
                    )}
                  </ActionForm>
                </details>
              </article>
            );
          })
        )}
      </div>

      <div>
        <Card title="Add department">
          <ActionForm action={createDepartment} resetOnSuccess className="space-y-3">
            <DepartmentFields idPrefix="new" />
            <SubmitButton pendingText="Adding…">Add department</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

function DepartmentFields({ idPrefix, name, description }: { idPrefix: string; name?: string; description?: string | null }) {
  return (
    <>
      <Field label="Name" htmlFor={`${idPrefix}-name`} required>
        <input id={`${idPrefix}-name`} name="name" required maxLength={80} defaultValue={name} className={inputClass} />
      </Field>
      <Field label="Description" htmlFor={`${idPrefix}-description`}>
        <textarea id={`${idPrefix}-description`} name="description" rows={2} maxLength={500} defaultValue={description ?? ""} className={inputClass} />
      </Field>
    </>
  );
}
