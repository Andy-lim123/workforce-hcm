"use client";

import { useActionState, useState, startTransition } from "react";
import Link from "next/link";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui";
import type { ShiftActionState, ShiftPreview } from "./actions";

export type ShiftFormValues = {
  title: string;
  department_id: string;
  position_id: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  required_headcount: string;
  notes: string;
};

type Option = { id: string; name: string };
type PositionOption = { id: string; title: string; department_id: string };

// Create and edit share this form. Everything is re-validated on the server by lib/scheduling.ts; the browser only
// helps. Times are Asia/Manila. For a published shift the first submit returns a preview of what changes and who is
// affected, and nothing is saved until the admin confirms that exact preview.
export function ShiftForm({
  action,
  initial,
  departments,
  positions,
  submitLabel,
  cancelHref,
  published = false,
  lockSchedule = false,
  expectedUpdatedAt,
}: {
  action: (prev: ShiftActionState, formData: FormData) => Promise<ShiftActionState>;
  initial: ShiftFormValues;
  departments: Option[];
  positions: PositionOption[];
  submitLabel: string;
  cancelHref: string;
  published?: boolean;
  /** The shift has attendance records: department, position and times are fixed. */
  lockSchedule?: boolean;
  /** Edit only: the shift's updated_at when this page loaded, so a stale form is refused. */
  expectedUpdatedAt?: string;
}) {
  const [state, formAction, pending] = useActionState<ShiftActionState, FormData>(action, {});
  const [departmentId, setDepartmentId] = useState(initial.department_id);
  const [positionId, setPositionId] = useState(initial.position_id);
  const errors = state.fieldErrors ?? {};
  const deptPositions = positions.filter((p) => p.department_id === departmentId);

  // Locked fields are disabled for display and re-sent as hidden values, so the server still sees the current ones.
  const lock = (name: keyof ShiftFormValues, value: string) =>
    lockSchedule ? <input type="hidden" name={name} value={value} /> : null;

  const input = (name: keyof ShiftFormValues, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={name}
      name={lockSchedule && ["start_date", "start_time", "end_date", "end_time"].includes(name) ? undefined : name}
      defaultValue={initial[name]}
      disabled={lockSchedule && ["start_date", "start_time", "end_date", "end_time"].includes(name)}
      aria-invalid={errors[name] ? true : undefined}
      aria-describedby={errors[name] ? `${name}-error` : undefined}
      className={inputClass}
      {...props}
    />
  );

  return (
    <form
      noValidate
      action={formAction}
      onSubmit={(event) => {
        // Submit without React's automatic form reset, so entries survive an error or a preview.
        event.preventDefault();
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
      className="space-y-6"
    >
      {expectedUpdatedAt && <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}

      {state.blocked && (
        <section aria-label="Problems this change would create" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">New problems for assigned employees</p>
          <ul className="mt-2 space-y-2">
            {state.blocked.map((b) => (
              <li key={b.id}>
                <span className="font-medium">
                  {b.name} <span className="font-mono text-xs">{b.code}</span>
                </span>
                <ul className="ml-4 list-disc">
                  {b.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lockSchedule && (
        <Alert tone="info">
          This shift has attendance records, so its department, position and times are locked. You can still change the title, notes and headcount.
        </Alert>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="title" error={errors.title} required>
            {input("title", { maxLength: 80, autoComplete: "off", required: true })}
          </Field>
        </div>

        <Field label="Department" htmlFor="department_id" error={errors.department_id} required>
          <select
            id="department_id"
            name={lockSchedule ? undefined : "department_id"}
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPositionId("");
            }}
            disabled={lockSchedule}
            aria-invalid={errors.department_id ? true : undefined}
            className={inputClass}
            required
          >
            <option value="">Select a department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {lock("department_id", initial.department_id)}
        </Field>

        <Field label="Position" htmlFor="position_id" error={errors.position_id} hint="Optional. Leave empty if any position can work this shift.">
          <select
            id="position_id"
            name={lockSchedule ? undefined : "position_id"}
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            disabled={lockSchedule || !departmentId}
            aria-invalid={errors.position_id ? true : undefined}
            className={inputClass}
          >
            <option value="">{departmentId ? "No specific position" : "Choose a department first"}</option>
            {deptPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {lock("position_id", initial.position_id)}
        </Field>

        <Field label="Start date" htmlFor="start_date" error={errors.start_date} required>
          {input("start_date", { type: "date", required: true })}
          {lock("start_date", initial.start_date)}
        </Field>
        <Field label="Start time" htmlFor="start_time" error={errors.start_time} required>
          {input("start_time", { type: "time", required: true })}
          {lock("start_time", initial.start_time)}
        </Field>
        <Field label="End date" htmlFor="end_date" error={errors.end_date} required hint="For an overnight shift, choose the next day.">
          {input("end_date", { type: "date", required: true })}
          {lock("end_date", initial.end_date)}
        </Field>
        <Field label="End time" htmlFor="end_time" error={errors.end_time} required hint="Asia/Manila. At most 24 hours long.">
          {input("end_time", { type: "time", required: true })}
          {lock("end_time", initial.end_time)}
        </Field>

        <Field label="Required headcount" htmlFor="required_headcount" error={errors.required_headcount} required>
          {input("required_headcount", { type: "number", min: 1, max: 50, step: 1, inputMode: "numeric", required: true })}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={500}
              defaultValue={initial.notes}
              aria-invalid={errors.notes ? true : undefined}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      {state.preview && <PreviewPanel preview={state.preview} pending={pending} />}

      <div className="flex justify-end gap-2 border-t border-zinc-200 pt-6">
        <Link href={cancelHref} className={buttonClass.secondary}>
          {state.preview ? "Discard changes" : "Cancel"}
        </Link>
        <button type="submit" disabled={pending} className={state.preview ? buttonClass.secondary : buttonClass.primary}>
          {pending ? "Checking…" : published ? "Review changes" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function PreviewPanel({ preview, pending }: { preview: ShiftPreview; pending: boolean }) {
  return (
    <section aria-label="Review changes before saving" className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <div>
        <p className="font-semibold text-amber-900">Confirm changes to a published shift</p>
        <p className="mt-0.5 text-amber-900">
          Employees assigned to this shift can see it. Nothing is saved until you confirm. No assignments or attendance records are removed.
        </p>
      </div>

      <div>
        <p className="mb-1 font-medium text-zinc-900">What changes</p>
        <ul className="divide-y divide-amber-200 rounded-md border border-amber-200 bg-white">
          {preview.changes.map((c) => (
            <li key={c.label} className="px-3 py-2">
              <span className="font-medium text-zinc-900">{c.label}</span>
              <p className="text-zinc-600">
                <span className="line-through">{c.from}</span> <span aria-hidden>→</span> <span className="sr-only">changed to</span>
                <span className="font-medium text-zinc-900"> {c.to}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 font-medium text-zinc-900">
          Affected employees ({preview.employees.length})
        </p>
        {preview.employees.length ? (
          <ul className="divide-y divide-amber-200 rounded-md border border-amber-200 bg-white">
            {preview.employees.map((e) => (
              <li key={e.id} className="px-3 py-2">
                <span className="font-medium text-zinc-900">{e.name}</span> <span className="font-mono text-xs text-zinc-500">{e.code}</span>
                {e.unchanged.length ? (
                  <div className="mt-1 text-zinc-600">
                    <p className="text-xs font-medium">Existing issues, not made worse by this change:</p>
                    <ul className="ml-4 list-disc">
                      {e.unchanged.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700">No rule problems before or after this change.</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-amber-200 bg-white px-3 py-2 text-zinc-600">No one is assigned to this shift.</p>
        )}
      </div>

      <button type="submit" name="confirm_fingerprint" value={preview.fingerprint} disabled={pending} className={buttonClass.primary}>
        {pending ? "Saving…" : "Confirm and save"}
      </button>
    </section>
  );
}
