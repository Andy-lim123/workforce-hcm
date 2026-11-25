import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatDayHeading, formatTimeRange, headcountState, shiftsByDay, type HeadcountState, type ShiftStatus } from "@/lib/scheduling";

export type WeekShift = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  required_headcount: number;
  status: ShiftStatus;
  department: { id: string; name: string } | null;
  position: { title: string } | null;
  assigned: number;
};

const HEADCOUNT: Record<HeadcountState, { tone: "green" | "amber" | "red" | "zinc"; text: (a: number, r: number) => string }> = {
  unfilled: { tone: "red", text: (a, r) => `${a}/${r} · unfilled` },
  under: { tone: "amber", text: (a, r) => `${a}/${r} · short ${r - a}` },
  filled: { tone: "green", text: (a, r) => `${a}/${r} · filled` },
  over: { tone: "amber", text: (a, r) => `${a}/${r} · +${a - r} over` },
  cancelled: { tone: "zinc", text: (a, r) => `${a}/${r}` },
};

const STATUS: Record<ShiftStatus, { tone: "teal" | "zinc" | "red"; label: string }> = {
  published: { tone: "teal", label: "Published" },
  draft: { tone: "zinc", label: "Draft" },
  cancelled: { tone: "red", label: "Cancelled" },
};

// Read-only seven-day Manila week. Shifts sit on the day they start. Nothing here is interactive:
// creating, editing, assigning and publishing arrive in later milestones.
export function WeekGrid({ weekStart, shifts, today }: { weekStart: string; shifts: WeekShift[]; today: string }) {
  const days = shiftsByDay(shifts, weekStart);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {[...days].map(([date, list]) => (
        <section key={date} aria-labelledby={`day-${date}`} className="min-w-0 rounded-xl border border-zinc-200 bg-white">
          <header className="flex items-baseline justify-between gap-2 border-b border-zinc-200 px-3 py-2">
            <h3 id={`day-${date}`} className="text-sm font-semibold text-zinc-900">
              {formatDayHeading(date)}
            </h3>
            {date === today ? (
              <span className="text-xs font-medium text-teal-700">Today</span>
            ) : (
              <span className="text-xs text-zinc-400">{list.length} {list.length === 1 ? "shift" : "shifts"}</span>
            )}
          </header>
          {list.length ? (
            <ul className="space-y-2 p-2">
              {list.map((s) => {
                const state = headcountState(s.assigned, s.required_headcount, s.status);
                const headcount = HEADCOUNT[state];
                const status = STATUS[s.status];
                return (
                  <li
                    key={s.id}
                    className={`rounded-lg border px-2.5 py-2 text-xs ${
                      s.status === "draft" ? "border-dashed border-zinc-300 bg-zinc-50" : "border-zinc-200 bg-white"
                    } ${s.status === "cancelled" ? "opacity-60" : ""}`}
                  >
                    <p className="font-semibold text-zinc-900">{formatTimeRange(s.starts_at, s.ends_at)}</p>
                    <p className={`mt-0.5 text-zinc-800 ${s.status === "cancelled" ? "line-through" : ""}`}>
                      <Link href={`/admin/schedules/${s.id}`} className="hover:text-teal-700 hover:underline">
                        {s.title}
                        <span className="sr-only"> at {formatTimeRange(s.starts_at, s.ends_at)}, open shift</span>
                      </Link>
                    </p>
                    <p className="text-zinc-500">
                      {s.department?.name ?? "No department"}
                      {s.position ? ` · ${s.position.title}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <Badge tone={headcount.tone}>{headcount.text(s.assigned, s.required_headcount)}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-zinc-400">No shifts</p>
          )}
        </section>
      ))}
    </div>
  );
}
