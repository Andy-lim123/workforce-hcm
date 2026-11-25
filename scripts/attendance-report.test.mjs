import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceRate, hoursText, overtimeMinutes, percentText, summarize, workedMinutes } from "../lib/attendance-report.ts";

const row = (o = {}) => ({
  department: "Support", employeeId: "e1", employeeName: "Ana", employeeCode: "EMP-1", status: "present",
  clockIn: "2026-11-16T06:00:00Z", clockOut: "2026-11-16T14:00:00Z",
  scheduledStart: "2026-11-16T06:00:00Z", scheduledEnd: "2026-11-16T14:00:00Z", ...o,
});

test("worked and overtime minutes: on time, late out, early in, shorter than scheduled", () => {
  assert.equal(workedMinutes(row()), 480);
  assert.equal(overtimeMinutes(row()), 0);
  assert.equal(overtimeMinutes(row({ clockOut: "2026-11-16T15:30:00Z" })), 90);
  assert.equal(overtimeMinutes(row({ clockIn: "2026-11-16T05:50:00Z" })), 10); // duration based: early in counts
  assert.equal(overtimeMinutes(row({ clockOut: "2026-11-16T12:00:00Z" })), 0); // never negative
});

test("records without both clock times have no worked time or overtime", () => {
  assert.equal(workedMinutes(row({ status: "absent", clockIn: null, clockOut: null })), null);
  assert.equal(overtimeMinutes(row({ status: "absent", clockIn: null, clockOut: null })), 0);
  assert.equal(workedMinutes(row({ clockOut: "2026-11-16T05:00:00Z" })), null); // out before in is not counted
});

test("summarize: per department totals, statuses, still open, leaders", () => {
  const rows = [
    row(),
    row({ clockOut: "2026-11-16T16:00:00Z" }), // +120 min, Ana
    row({ employeeId: "e2", employeeName: "Ben", employeeCode: "EMP-2", status: "late", clockOut: "2026-11-16T14:30:00Z" }), // +30
    row({ department: "Retail", employeeId: "e3", employeeName: "Cy", employeeCode: "EMP-3", status: "absent", clockIn: null, clockOut: null }),
    row({ department: "Retail", employeeId: "e3", employeeName: "Cy", employeeCode: "EMP-3", status: "excused", clockIn: null, clockOut: null }),
    row({ department: "Retail", employeeId: "e4", employeeName: "Di", employeeCode: "EMP-4", clockOut: null }), // still open
  ];
  const s = summarize(rows);
  assert.deepEqual(s.departments.map((d) => d.department), ["Retail", "Support"]);
  const support = s.departments.find((d) => d.department === "Support");
  assert.equal(support.records, 3);
  assert.equal(support.late, 1);
  assert.equal(support.workedMin, 480 + 600 + 510);
  assert.equal(support.overtimeMin, 150);
  assert.equal(support.overtimeRecords, 2);
  const retail = s.departments.find((d) => d.department === "Retail");
  assert.deepEqual([retail.absent, retail.excused, retail.stillOpen, retail.workedMin], [1, 1, 1, 0]);
  assert.equal(s.total.records, 6);
  assert.deepEqual(s.overtimeLeaders.map((l) => [l.code, l.overtimeMin]), [["EMP-1", 120], ["EMP-2", 30]]);
});

test("attendance rate leaves excused out; formatting", () => {
  assert.equal(attendanceRate({ present: 8, late: 1, absent: 1 }), 0.9);
  assert.equal(attendanceRate({ present: 0, late: 0, absent: 0 }), null);
  assert.equal(percentText(0.9), "90%");
  assert.equal(percentText(null), "—");
  assert.equal(hoursText(90), "1.5 h");
});
