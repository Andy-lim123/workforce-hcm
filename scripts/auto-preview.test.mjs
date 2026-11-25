import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangePreview } from "../lib/auto-preview.ts";
import { proposeSchedule } from "../lib/auto-schedule.ts";
import * as rules from "../lib/scheduling.ts";

const at = (date, time) => rules.fromManila(date, time).toISOString();
const shift = (id, department_id, date, o = {}) => ({
  id, department_id, position_id: null, status: "draft", required_headcount: 1, assignedIds: [], attendanceCount: 0,
  starts_at: at(date, "09:00"), ends_at: at(date, "17:00"), ...o,
});
const person = (code, department_id) => ({
  code, assignments: [], availability: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, start_time: "00:00", end_time: "23:59" })),
  employee: { id: code, status: "active", department_id, position_id: null, max_weekly_hours: 40 },
});

test("preview totals add up; a department with nobody eligible is listed with its reasons; full shifts are not", () => {
  const shifts = [
    shift("b", "d1", "2026-12-02", { required_headcount: 3 }),
    shift("a", "d1", "2026-12-01"),
    shift("c", "d2", "2026-12-01", { required_headcount: 2 }),
    shift("full", "d1", "2026-12-03", { assignedIds: ["x"] }),
  ];
  const proposal = proposeSchedule({ weekStart: "2026-11-30", shifts, employees: [person("E1", "d1"), person("E2", "d1")], now: new Date("2026-11-25T00:00:00Z") }, rules);
  const preview = arrangePreview(proposal, shifts);
  assert.deepEqual(preview.totals, { shifts: 3, open: 6, proposed: 3, uncovered: 3 });
  assert.equal(preview.totals.proposed + preview.totals.uncovered, preview.totals.open);
  const d2 = preview.departments.find((d) => d.departmentId === "d2");
  assert.deepEqual([d2.open, d2.proposed, d2.uncovered], [2, 0, 2]);
  assert.equal(d2.shifts[0].uncovered.explanation, "This department has no employees.");
  const d1 = preview.departments.find((d) => d.departmentId === "d1");
  assert.deepEqual(d1.shifts.map((s) => s.shiftId), ["a", "b"]); // start order, the full shift left out
  assert.equal(arrangePreview(proposal, []).totals.open, 0);
});
