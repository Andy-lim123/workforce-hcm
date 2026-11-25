import type { Metadata } from "next";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Alert, Card, EmptyState, Field, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { createPosition, deletePosition, updatePosition } from "./actions";

export const metadata: Metadata = { title: "Positions" };

export default function Page() {
  return (
    <RequireRole role="admin">
      <PageHeader title="Positions" description="Job positions within each department." />
      <Positions />
    </RequireRole>
  );
}

type Department = { id: string; name: string };

async function Positions() {
  const supabase = await createClient();
  const [{ data: departments }, { data: positions, error }] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, description, department_id, employees(count)").order("title"),
  ]);
  const depts = departments ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {error ? (
          <Alert tone="error">Could not load positions. Refresh the page to try again.</Alert>
        ) : !depts.length ? (
          <EmptyState
            title="No departments yet"
            description="Positions belong to a department."
            action={<Link href="/admin/departments" className="text-sm font-medium text-teal-700 hover:underline">Add a department</Link>}
          />
        ) : (
          depts.map((d) => {
            const rows = (positions ?? []).filter((p) => p.department_id === d.id);
            return (
              <section key={d.id} id={`dept-${d.id}`} className="scroll-mt-6">
                <h2 className="mb-2 text-sm font-semibold text-zinc-900">{d.name}</h2>
                {rows.length ? (
                  <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
                    {rows.map((p) => {
                      const count = p.employees[0]?.count ?? 0;
                      return (
                        <li key={p.id} className="px-5 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-zinc-900">{p.title}</p>
                              {p.description && <p className="text-xs text-zinc-500">{p.description}</p>}
                            </div>
                            <Link href={`/admin/employees?position=${p.id}`} className="text-sm text-teal-700 hover:underline">
                              {count} {count === 1 ? "employee" : "employees"}
                            </Link>
                          </div>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm font-medium text-zinc-600 hover:text-zinc-900">
                              Edit<span className="sr-only"> {p.title}</span>
                            </summary>
                            <div className="mt-3 space-y-4">
                              <ActionForm action={updatePosition.bind(null, p.id)} className="space-y-3">
                                <PositionFields idPrefix={p.id} departments={depts} title={p.title} description={p.description}
                                  departmentId={p.department_id} lockDepartment={count > 0} />
                                <SubmitButton>Save position</SubmitButton>
                              </ActionForm>
                              <ActionForm action={deletePosition.bind(null, p.id)}>
                                {count > 0 ? (
                                  <p className="text-xs text-zinc-500">
                                    Held by {count} employee(s). Reassign them before deleting this position.
                                  </p>
                                ) : (
                                  <ConfirmSubmit
                                    label="Delete position"
                                    title={`Delete “${p.title}”?`}
                                    message="This cannot be undone. Shifts that asked for this position keep their department but no longer require a position."
                                    confirmLabel="Delete"
                                  />
                                )}
                              </ActionForm>
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-4 text-sm text-zinc-500">
                    No positions in this department yet.
                  </p>
                )}
              </section>
            );
          })
        )}
      </div>

      {depts.length > 0 && (
        <div>
          <Card title="Add position">
            <ActionForm action={createPosition} resetOnSuccess className="space-y-3">
              <PositionFields idPrefix="new" departments={depts} />
              <SubmitButton pendingText="Adding…">Add position</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}
    </div>
  );
}

function PositionFields({
  idPrefix,
  departments,
  title,
  description,
  departmentId,
  lockDepartment,
}: {
  idPrefix: string;
  departments: Department[];
  title?: string;
  description?: string | null;
  departmentId?: string;
  lockDepartment?: boolean;
}) {
  return (
    <>
      <Field label="Title" htmlFor={`${idPrefix}-title`} required>
        <input id={`${idPrefix}-title`} name="title" required maxLength={80} defaultValue={title} className={inputClass} />
      </Field>
      <Field
        label="Department"
        htmlFor={`${idPrefix}-department`}
        required
        hint={lockDepartment ? "Reassign this position's employees before moving it to another department." : undefined}
      >
        <select id={`${idPrefix}-department`} name="department_id" required defaultValue={departmentId ?? ""} disabled={lockDepartment} className={inputClass}>
          <option value="" disabled>Select a department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {/* Disabled selects are not submitted; send the current value instead. */}
        {lockDepartment && <input type="hidden" name="department_id" value={departmentId} />}
      </Field>
      <Field label="Description" htmlFor={`${idPrefix}-description`}>
        <textarea id={`${idPrefix}-description`} name="description" rows={2} maxLength={500} defaultValue={description ?? ""} className={inputClass} />
      </Field>
    </>
  );
}
