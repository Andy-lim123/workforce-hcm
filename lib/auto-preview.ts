// Arranges a proposal for the preview screen (Phase 4.2). Pure, no calculation of its own: every number comes from the
// engine's result. Only types are imported, so the unit tests run it directly.
import type { Proposal, ScheduleShift, UncoveredShift } from "./auto-schedule";

export type PreviewShift = {
  shiftId: string;
  required: number;
  assigned: number;
  open: number;
  proposed: { employeeId: string; employeeCode: string }[];
  /** Places that would still be empty, with the engine's reasons. */
  uncovered: UncoveredShift | null;
};

export type PreviewDepartment = { departmentId: string; open: number; proposed: number; uncovered: number; shifts: PreviewShift[] };

export type Preview = {
  totals: { shifts: number; open: number; proposed: number; uncovered: number };
  departments: PreviewDepartment[];
};

/** Every shift that needs people, grouped by department, in start order. A shift with no proposal is listed too. */
export function arrangePreview(proposal: Proposal, shifts: readonly ScheduleShift[]): Preview {
  const proposed = new Map<string, PreviewShift["proposed"]>();
  for (const a of proposal.assignments) proposed.set(a.shiftId, [...(proposed.get(a.shiftId) ?? []), { employeeId: a.employeeId, employeeCode: a.employeeCode }]);
  const uncovered = new Map(proposal.uncovered.map((u) => [u.shiftId, u]));
  const targets = shifts
    .filter((s) => proposed.has(s.id) || uncovered.has(s.id))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : 1));

  const departments = new Map<string, PreviewDepartment>();
  for (const s of targets) {
    const people = proposed.get(s.id) ?? [];
    const left = uncovered.get(s.id) ?? null;
    const row: PreviewShift = {
      shiftId: s.id,
      required: s.required_headcount,
      assigned: s.assignedIds.length,
      open: people.length + (left?.open ?? 0),
      proposed: people,
      uncovered: left,
    };
    let d = departments.get(s.department_id);
    if (!d) departments.set(s.department_id, (d = { departmentId: s.department_id, open: 0, proposed: 0, uncovered: 0, shifts: [] }));
    d.open += row.open;
    d.proposed += people.length;
    d.uncovered += left?.open ?? 0;
    d.shifts.push(row);
  }
  const list = [...departments.values()];
  return {
    totals: {
      shifts: targets.length,
      open: list.reduce((n, d) => n + d.open, 0),
      proposed: list.reduce((n, d) => n + d.proposed, 0),
      uncovered: list.reduce((n, d) => n + d.uncovered, 0),
    },
    departments: list,
  };
}
