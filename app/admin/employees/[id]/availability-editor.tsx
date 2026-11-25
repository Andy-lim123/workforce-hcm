import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { inputClass } from "@/components/ui";
import { DAY_LABELS } from "@/lib/labels";
import { OVERNIGHT_HELP } from "@/lib/scheduling";
import { addAvailability, removeAvailability, updateAvailability } from "../actions";

type Window = { id: string; start_time: string; end_time: string };
type Day = { label: string; windows: Window[] };

const hhmm = (t: string) => t.slice(0, 5);

// Recurring weekly availability. Every change goes through a Server Action that validates the
// time range and same-day overlaps; the inputs here only help the user get it right first time.
export function AvailabilityEditor({ employeeId, byDay }: { employeeId: string; byDay: Day[] }) {
  return (
    <div className="space-y-5">
      <ul className="divide-y divide-zinc-100">
        {byDay.map(({ label, windows }, day) => (
          <li key={label} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2 text-sm">
            <span className="w-24 pt-0.5 font-medium text-zinc-700">{label}</span>
            <div className="flex flex-1 flex-col items-end gap-1">
              {windows.length ? (
                windows.map((w) => (
                  <details key={w.id} className="w-full text-right">
                    <summary className="cursor-pointer list-none text-zinc-900 hover:text-teal-700">
                      {hhmm(w.start_time)}–{hhmm(w.end_time)}
                      <span className="ml-2 text-xs font-medium text-teal-700">Edit</span>
                    </summary>
                    <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left">
                      <ActionForm action={updateAvailability.bind(null, employeeId, w.id)} className="space-y-2">
                        <input type="hidden" name="day_of_week" value={day} />
                        <TimeRange idPrefix={w.id} start={hhmm(w.start_time)} end={hhmm(w.end_time)} />
                        <SubmitButton variant="secondary">Save window</SubmitButton>
                      </ActionForm>
                      <ActionForm action={removeAvailability.bind(null, employeeId, w.id)}>
                        <ConfirmSubmit
                          label="Remove window"
                          title={`Remove ${label} ${hhmm(w.start_time)}–${hhmm(w.end_time)}?`}
                          message="The employee will no longer be shown as available in this window."
                          confirmLabel="Remove"
                        />
                      </ActionForm>
                    </div>
                  </details>
                ))
              ) : (
                <span className="pt-0.5 text-zinc-400">Unavailable</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ActionForm action={addAvailability.bind(null, employeeId)} resetOnSuccess className="space-y-3 border-t border-zinc-200 pt-4">
        <p className="text-sm font-medium text-zinc-900">Add a window</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="new-day" className="mb-1.5 block text-sm font-medium text-zinc-800">Day</label>
            <select id="new-day" name="day_of_week" defaultValue="1" className={`${inputClass} w-auto`}>
              {DAY_LABELS.map((label, day) => (
                <option key={label} value={day}>{label}</option>
              ))}
            </select>
          </div>
          <TimeRange idPrefix="new" start="09:00" end="17:00" />
          <SubmitButton pendingText="Adding…">Add window</SubmitButton>
        </div>
      </ActionForm>
      <p className="text-xs text-zinc-500">
        Times are in Asia/Manila. A window must end after it starts on the same day. {OVERNIGHT_HELP}
      </p>
    </div>
  );
}

function TimeRange({ idPrefix, start, end }: { idPrefix: string; start: string; end: string }) {
  return (
    <div className="flex items-end gap-2">
      <div>
        <label htmlFor={`${idPrefix}-start`} className="mb-1.5 block text-sm font-medium text-zinc-800">From</label>
        <input id={`${idPrefix}-start`} name="start_time" type="time" required defaultValue={start} className={`${inputClass} w-auto`} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-end`} className="mb-1.5 block text-sm font-medium text-zinc-800">To</label>
        <input id={`${idPrefix}-end`} name="end_time" type="time" required defaultValue={end} className={`${inputClass} w-auto`} />
      </div>
    </div>
  );
}
