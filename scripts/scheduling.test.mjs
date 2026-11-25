// Unit tests for lib/scheduling.ts. Run with: npm test (Node 22.18+ strips TypeScript types).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BLOCKER_RULES,
  END_OF_DAY_WINDOW,
  OVERNIGHT_HELP,
  OVERRIDABLE_RULES,
  RULE_IDS,
  WARNING_RULES,
  addDays,
  checkOverrides,
  coveredByAvailability,
  daysBetween,
  fromManila,
  toManilaParts,
  validateAssignment,
  validateShiftEdit,
  weekBoundsUtc,
  weekDays,
  weekStartManila,
} from "../lib/scheduling.ts";
import { parseWindow } from "../lib/validation.ts";

// Reference week: Monday 2026-11-23 to Sunday 2026-11-29, Asia/Manila.
const iso = (date, time) => fromManila(date, time).toISOString();
const shift = (o = {}) => ({
  id: "s1", department_id: "d1", position_id: null,
  starts_at: iso("2026-11-23", "09:00"), ends_at: iso("2026-11-23", "17:00"),
  required_headcount: 2, status: "published", ...o,
});
const emp = (o = {}) => ({ id: "e1", status: "active", department_id: "d1", position_id: null, max_weekly_hours: 40, ...o });
const win = (dow, start, end) => ({ day_of_week: dow, start_time: start, end_time: end });
const MON = [win(1, "07:00:00", "23:00:00")];
const other = (id, d1, t1, d2, t2, status = "published") => ({ id, starts_at: iso(d1, t1), ends_at: iso(d2, t2), status });
const run = (o = {}) => validateAssignment({ shift: shift(), employee: emp(), availability: MON, otherShifts: [], assignedCount: 0, ...o });
const ids = (r) => ({ b: r.blockers.map((v) => v.rule), w: r.warnings.map((v) => v.rule) });

// --- Manila time ------------------------------------------------------------

test("Manila parts around the UTC date change: Sunday 23:30 vs Monday 00:30", () => {
  const sun = toManilaParts("2026-11-22T15:30:00Z");
  assert.deepEqual([sun.date, sun.time, sun.dow], ["2026-11-22", "23:30", 0]);
  const mon = toManilaParts("2026-11-22T16:30:00Z");
  assert.deepEqual([mon.date, mon.time, mon.dow], ["2026-11-23", "00:30", 1]);
  assert.equal(weekStartManila("2026-11-22T15:30:00Z"), "2026-11-16"); // still last week
  assert.equal(weekStartManila("2026-11-22T16:30:00Z"), "2026-11-23"); // new week
});

test("Manila week start for every weekday, month and year boundaries", () => {
  for (const d of weekDays("2026-11-23")) assert.equal(weekStartManila(iso(d, "12:00")), "2026-11-23");
  assert.equal(weekStartManila("2026-12-06T10:00:00Z"), "2026-11-30"); // Sunday 18:00 Manila
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-11-23", "2026-11-24"), 1);
});

test("Manila week bounds and conversion", () => {
  const { start, end } = weekBoundsUtc("2026-11-23");
  assert.equal(start.toISOString(), "2026-11-22T16:00:00.000Z");
  assert.equal(end.toISOString(), "2026-11-29T16:00:00.000Z");
  assert.equal(weekDays("2026-11-23").at(-1), "2026-11-29");
  assert.equal(fromManila("2026-11-23", "22:00").toISOString(), "2026-11-23T14:00:00.000Z");
  assert.throws(() => toManilaParts("nope"));
  assert.throws(() => fromManila("2026-02-30", "09:00"));
  assert.throws(() => fromManila("2026-11-23", "24:00"));
});

// --- Availability semantics -------------------------

test("availability rule 1: same-day shift needs one window covering start and end", () => {
  const s = shift(); // Mon 09:00-17:00
  assert.equal(coveredByAvailability(s, [win(1, "07:00", "23:00")]), true);
  assert.equal(coveredByAvailability(s, [win(1, "09:00", "17:00")]), true); // exact fit
  assert.equal(coveredByAvailability(s, [win(1, "09:30", "17:00")]), false); // starts late
  assert.equal(coveredByAvailability(s, [win(1, "07:00", "16:59")]), false); // ends early
  assert.equal(coveredByAvailability(s, [win(1, "07:00", "12:00"), win(1, "12:00", "23:00")]), false); // two windows never combine
  assert.equal(coveredByAvailability(s, [win(2, "07:00", "23:00")]), false); // other weekday
  assert.equal(coveredByAvailability(s, []), false);
  assert.equal(coveredByAvailability(s, [win(1, "07:00:00", "23:00:00")]), true); // HH:MM:SS from Postgres
});

test("availability rule 2: overnight shift needs a start-day window ending at the end-of-day marker", () => {
  const night = shift({ starts_at: iso("2026-11-23", "22:00"), ends_at: iso("2026-11-24", "06:00") });
  assert.equal(END_OF_DAY_WINDOW, "23:59");
  assert.equal(coveredByAvailability(night, [win(1, "21:00", "23:59")]), true);
  assert.equal(coveredByAvailability(night, [win(1, "21:00:00", "23:59:00")]), true);
  // The following day's windows are not consulted: no Tuesday window is needed...
  assert.equal(coveredByAvailability(night, [win(1, "21:00", "23:59")]), true);
  // ...and a Tuesday window does not rescue a Monday window that ends earlier.
  assert.equal(coveredByAvailability(night, [win(1, "21:00", "23:00"), win(2, "00:00", "06:00")]), false);
});

test("availability rule 3: a window ending before 23:59 never covers an overnight shift", () => {
  const night = shift({ starts_at: iso("2026-11-23", "22:00"), ends_at: iso("2026-11-24", "06:00") });
  assert.equal(coveredByAvailability(night, [win(1, "07:00", "23:00")]), false);
  assert.equal(coveredByAvailability(night, [win(1, "07:00", "23:58")]), false);
  assert.equal(coveredByAvailability(night, [win(1, "23:00", "23:59")]), false); // window starts after the shift does
  const toMidnight = shift({ starts_at: iso("2026-11-23", "16:00"), ends_at: iso("2026-11-24", "00:00") });
  assert.equal(coveredByAvailability(toMidnight, [win(1, "07:00", "23:00")]), false); // ends on the next date
  assert.equal(coveredByAvailability(toMidnight, [win(1, "07:00", "23:59")]), true);
});

test("availability rule 4: shifts over 24 h or ending 2+ days later are never covered", () => {
  const long = shift({ starts_at: iso("2026-11-23", "22:00"), ends_at: iso("2026-11-24", "23:00") }); // 25 h
  assert.equal(coveredByAvailability(long, [win(1, "00:00", "23:59")]), false);
  const days = shift({ starts_at: iso("2026-11-23", "22:00"), ends_at: iso("2026-11-25", "01:00") });
  assert.equal(coveredByAvailability(days, [win(1, "00:00", "23:59")]), false);
  const exactly24 = shift({ starts_at: iso("2026-11-23", "09:00"), ends_at: iso("2026-11-24", "09:00") });
  assert.equal(coveredByAvailability(exactly24, [win(1, "07:00", "23:59")]), true); // overnight rule applies
});

test("availability rule 5: no window on the start weekday means not available", () => {
  const night = shift({ starts_at: iso("2026-11-23", "22:00"), ends_at: iso("2026-11-24", "06:00") });
  assert.equal(coveredByAvailability(night, [win(2, "00:00", "23:59")]), false);
});

// --- Rules -------------------------------------------------------------------

test("a clean assignment has no blockers and no warnings", () => {
  assert.deepEqual(ids(run()), { b: [], w: [] });
});

test("blockers: inactive, on leave, department mismatch, already assigned", () => {
  assert.deepEqual(ids(run({ employee: emp({ status: "inactive" }) })).b, ["employee_inactive"]);
  assert.deepEqual(ids(run({ employee: emp({ status: "on_leave" }) })).b, ["employee_on_leave"]);
  assert.deepEqual(ids(run({ employee: emp({ department_id: "d2" }) })).b, ["department_mismatch"]);
  assert.deepEqual(ids(run({ employee: emp({ department_id: null }) })).b, ["department_mismatch"]);
  assert.deepEqual(ids(run({ otherShifts: [other("s1", "2026-11-23", "09:00", "2026-11-23", "17:00")] })).b, ["already_assigned"]);
});

test("overlap: real overlap blocks, touching shifts and cancelled shifts do not", () => {
  const r = run({ otherShifts: [other("o1", "2026-11-23", "12:00", "2026-11-23", "20:00")] });
  assert.deepEqual(ids(r).b, ["overlap"]);
  assert.deepEqual(ids(r).w, []); // overlap is not also reported as a rest problem
  const touching = run({ otherShifts: [other("o2", "2026-11-23", "17:00", "2026-11-24", "01:00")] });
  assert.deepEqual(ids(touching).b, []);
  const cancelled = run({ otherShifts: [other("o3", "2026-11-23", "12:00", "2026-11-23", "20:00", "cancelled")] });
  assert.deepEqual(ids(cancelled), { b: [], w: [] });
});

test("overnight overlap is detected across midnight", () => {
  const night = shift({ id: "n1", starts_at: iso("2026-11-23", "22:00"), ends_at: iso("2026-11-24", "06:00") });
  const r = validateAssignment({
    shift: night, employee: emp(), availability: [win(1, "21:00", "23:59")], assignedCount: 0,
    otherShifts: [other("o1", "2026-11-24", "05:00", "2026-11-24", "13:00")],
  });
  assert.deepEqual(ids(r).b, ["overlap"]);
});

test("rest: exactly 10 h passes, one minute less warns, on both sides of the shift", () => {
  assert.deepEqual(ids(run({ otherShifts: [other("o", "2026-11-22", "15:00", "2026-11-22", "23:00")] })).w, []); // gap 10:00
  assert.deepEqual(ids(run({ otherShifts: [other("o", "2026-11-22", "15:00", "2026-11-22", "23:01")] })).w, ["insufficient_rest"]);
  assert.deepEqual(ids(run({ otherShifts: [other("o", "2026-11-24", "03:00", "2026-11-24", "11:00")] })).w, []); // 10:00 after 17:00
  assert.deepEqual(ids(run({ otherShifts: [other("o", "2026-11-24", "02:59", "2026-11-24", "11:00")] })).w, ["insufficient_rest"]);
  assert.deepEqual(ids(run({ otherShifts: [other("o", "2026-11-22", "15:01", "2026-11-22", "23:01", "cancelled")] })).w, []);
});

test("rest warning counts across a week boundary", () => {
  const sunNight = other("o", "2026-11-22", "22:00", "2026-11-23", "06:00"); // ends 06:00, candidate starts 09:00
  assert.deepEqual(ids(run({ otherShifts: [sunNight] })).w, ["insufficient_rest"]);
});

test("weekly hours: exactly the maximum passes, one minute over warns", () => {
  const four = ["24", "25", "26", "27"].map((d) => other(`w${d}`, `2026-11-${d}`, "09:00", `2026-11-${d}`, "17:00")); // 32 h
  assert.deepEqual(ids(run({ otherShifts: four })).w, []); // 32 + 8 = 40
  const sat = [...four, other("w28", "2026-11-28", "09:00", "2026-11-28", "17:00")];
  assert.deepEqual(ids(run({ otherShifts: sat })).w, ["exceeds_weekly_hours"]); // 48
  const oneMinute = run({ shift: shift({ ends_at: iso("2026-11-23", "17:01") }), otherShifts: four });
  assert.deepEqual(ids(oneMinute).w, ["exceeds_weekly_hours"]); // 40 h 01
});

test("weekly hours bucket by the Manila week a shift starts in", () => {
  const previousSunday = other("p", "2026-11-22", "22:00", "2026-11-23", "06:00"); // starts in the previous week
  const heavy = ["24", "25", "26", "27"].map((d) => other(`w${d}`, `2026-11-${d}`, "09:00", `2026-11-${d}`, "17:00"));
  assert.ok(!ids(run({ otherShifts: [previousSunday, ...heavy] })).w.includes("exceeds_weekly_hours"));
  // A Sunday-night shift that ends on Monday belongs to the week it starts in.
  const sunCandidate = shift({ starts_at: iso("2026-11-29", "22:00"), ends_at: iso("2026-11-30", "06:00") });
  const nextMonday = other("m", "2026-11-30", "07:00", "2026-11-30", "15:00");
  const r = validateAssignment({
    shift: sunCandidate, employee: emp(), availability: [win(0, "21:00", "23:59")], assignedCount: 0,
    otherShifts: [...heavy, nextMonday],
  });
  assert.ok(!ids(r).w.includes("exceeds_weekly_hours")); // 32 + 8 = 40; next Monday is another week
  assert.ok(ids(r).w.includes("insufficient_rest")); // 06:00 to 07:00
});

test("position mismatch and headcount are warnings", () => {
  assert.deepEqual(ids(run({ shift: shift({ position_id: "p1" }), employee: emp({ position_id: "p1" }) })).w, []);
  assert.deepEqual(ids(run({ shift: shift({ position_id: "p1" }), employee: emp({ position_id: "p2" }) })).w, ["position_mismatch"]);
  assert.deepEqual(ids(run({ shift: shift({ position_id: null }), employee: emp({ position_id: "p2" }) })).w, []);
  assert.deepEqual(ids(run({ assignedCount: 1 })).w, []); // 1 + this one = 2 of 2
  assert.deepEqual(ids(run({ assignedCount: 2 })).w, ["over_headcount"]);
});

test("availability outside the window is a warning, not a blocker", () => {
  assert.deepEqual(ids(run({ availability: [] })), { b: [], w: ["outside_availability"] });
});

// --- Classification, overrides, shift edits ---------------------------------

test("rule lists: blockers and warnings are disjoint, unique, and overrides are the warnings", () => {
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
  assert.equal(RULE_IDS.length, BLOCKER_RULES.length + WARNING_RULES.length);
  assert.deepEqual([...OVERRIDABLE_RULES], [...WARNING_RULES]);
  assert.equal(OVERRIDABLE_RULES.length, 5);
});

test("checkOverrides: warnings need an override, blockers never pass", () => {
  const warnOnly = run({ availability: [], assignedCount: 2 }); // outside_availability + over_headcount
  assert.equal(checkOverrides(warnOnly, []).ok, false);
  assert.equal(checkOverrides(warnOnly, ["outside_availability"]).ok, false);
  assert.equal(checkOverrides(warnOnly, ["outside_availability", "over_headcount"]).ok, true);
  const blocked = run({ otherShifts: [other("o1", "2026-11-23", "12:00", "2026-11-23", "20:00")] });
  assert.equal(checkOverrides(blocked, ["overlap", ...WARNING_RULES]).ok, false);
});

test("validateShiftEdit re-checks every assignee against the new shift values", () => {
  const moved = shift({ starts_at: iso("2026-11-23", "14:00"), ends_at: iso("2026-11-23", "22:00") });
  const out = validateShiftEdit(moved, [
    { employee: emp({ id: "e1" }), availability: MON, otherShifts: [other("o1", "2026-11-23", "09:00", "2026-11-23", "17:00")] },
    { employee: emp({ id: "e2" }), availability: MON, otherShifts: [] },
  ]);
  assert.deepEqual(out.map((o) => o.employeeId), ["e1", "e2"]);
  assert.deepEqual(ids(out[0].result).b, ["overlap"]);
  assert.deepEqual(ids(out[1].result), { b: [], w: [] }); // 2 people, required 2: no headcount warning
});

// --- Drift guards: editor text, parseWindow message and validator share one definition ----

test("the overnight rule text is the same everywhere", () => {
  assert.ok(OVERNIGHT_HELP.includes(END_OF_DAY_WINDOW));
  const fd = new FormData();
  fd.set("day_of_week", "1"); fd.set("start_time", "22:00"); fd.set("end_time", "06:00");
  assert.ok(parseWindow(fd).error.includes(END_OF_DAY_WINDOW));
  assert.ok(!/two windows/i.test(parseWindow(fd).error));
  const editor = fs.readFileSync(new URL("../app/admin/employees/[id]/availability-editor.tsx", import.meta.url), "utf8");
  assert.ok(editor.includes("OVERNIGHT_HELP"), "editor must show OVERNIGHT_HELP");
  assert.ok(!/two\s+windows/i.test(editor), "editor must not mention the old two-window advice");
  const validation = fs.readFileSync(new URL("../lib/validation.ts", import.meta.url), "utf8");
  assert.ok(!/add two windows/i.test(validation));
});

// --- The audit table's rule list must match the overridable rules (S1 migration) ----------------

test("schedule_overrides CHECK list equals OVERRIDABLE_RULES", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261124101712_schedule_overrides_audit.sql", import.meta.url), "utf8");
  const list = sql.match(/rule\s+text not null check \(rule in \(([^)]*)\)/)?.[1];
  assert.ok(list, "rule CHECK list not found in the migration");
  const inSql = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(inSql, [...OVERRIDABLE_RULES].sort());
});

// --- Week view helpers (Phase 3.1) --------------------------------------------------------------
import { formatDayHeading, formatTimeRange, headcountState, resolveWeek, shiftsByDay, weekRangeLabel } from "../lib/scheduling.ts";

test("resolveWeek: any date in the week selects its Manila Monday", () => {
  const now = new Date("2026-11-24T04:00:00Z"); // Tuesday 12:00 Manila
  assert.deepEqual(resolveWeek(undefined, now), { weekStart: "2026-11-23", currentWeek: "2026-11-23", invalid: false });
  assert.deepEqual(resolveWeek("", now).weekStart, "2026-11-23");
  assert.equal(resolveWeek("2026-11-16", now).weekStart, "2026-11-16");
  assert.equal(resolveWeek("2026-11-22", now).weekStart, "2026-11-16"); // Sunday belongs to the previous Monday's week
  assert.equal(resolveWeek("2026-11-29", now).weekStart, "2026-11-23");
  assert.equal(resolveWeek("2026-11-30", now).weekStart, "2026-11-30");
});

test("resolveWeek: invalid input falls back to the current week and says so", () => {
  const now = new Date("2026-11-24T04:00:00Z");
  for (const bad of ["nope", "2026-02-30", "2026-13-01", "26-11-23", "2026-11-23T10:00", "<script>"]) {
    const r = resolveWeek(bad, now);
    assert.equal(r.invalid, true, bad);
    assert.equal(r.weekStart, "2026-11-23");
  }
});

test("resolveWeek: 'now' is read in Manila time, not UTC", () => {
  assert.equal(resolveWeek(undefined, new Date("2026-11-22T15:59:00Z")).currentWeek, "2026-11-16"); // Sunday 23:59 Manila
  assert.equal(resolveWeek(undefined, new Date("2026-11-22T16:00:00Z")).currentWeek, "2026-11-23"); // Monday 00:00 Manila
});

test("week navigation steps by exactly 7 days, across month and year ends", () => {
  assert.equal(addDays("2026-11-23", 7), "2026-11-30");
  assert.equal(addDays("2026-11-23", -7), "2026-11-16");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(weekStartManila(fromManila(addDays("2026-12-28", 7), "12:00")), "2027-01-04");
});

test("labels: day heading, week range, shift time range", () => {
  assert.equal(formatDayHeading("2026-11-23"), "Mon 23 Nov");
  assert.equal(formatDayHeading("2026-11-29"), "Sun 29 Nov");
  assert.equal(weekRangeLabel("2026-11-23"), "23 Nov – 29 Nov 2026");
  assert.equal(weekRangeLabel("2026-11-30"), "30 Nov – 6 Dec 2026");
  assert.equal(weekRangeLabel("2026-12-28"), "28 Dec 2026 – 3 Jan 2027");
  assert.equal(formatTimeRange(iso("2026-11-23", "06:00"), iso("2026-11-23", "14:00")), "06:00–14:00");
  assert.equal(formatTimeRange(iso("2026-11-23", "22:00"), iso("2026-11-24", "06:00")), "22:00–06:00 (+1)");
});

test("headcountState", () => {
  assert.equal(headcountState(0, 2, "published"), "unfilled");
  assert.equal(headcountState(1, 2, "draft"), "under");
  assert.equal(headcountState(2, 2, "published"), "filled");
  assert.equal(headcountState(3, 2, "published"), "over");
  assert.equal(headcountState(0, 2, "cancelled"), "cancelled");
  assert.equal(headcountState(1, 2, "cancelled"), "cancelled");
});

test("shiftsByDay: buckets by Manila START date and sorts by time", () => {
  const week = "2026-11-23";
  const list = [
    { id: "late", starts_at: iso("2026-11-23", "22:00") }, // overnight: stays on Monday
    { id: "early", starts_at: iso("2026-11-23", "06:00") },
    { id: "sun", starts_at: "2026-11-29T15:30:00Z" }, // Sunday 23:30 Manila, still Sunday in Manila
    { id: "nextMon", starts_at: "2026-11-29T16:00:00Z" }, // Monday 00:00 Manila: next week, not placed
    { id: "prevSun", starts_at: "2026-11-22T15:59:00Z" }, // previous week
  ];
  const days = shiftsByDay(list, week);
  assert.deepEqual([...days.keys()], ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  assert.deepEqual(days.get("2026-11-23").map((s) => s.id), ["early", "late"]);
  assert.deepEqual(days.get("2026-11-29").map((s) => s.id), ["sun"]);
  assert.equal([...days.values()].flat().length, 3); // the two out-of-week shifts are not placed
});

// --- Shift lifecycle (Phase 3.2) ----------------------------------------------------------------
import { ATTENDANCE_LOCKED, assessShiftEdit, changedFields, diffViolations, parseShift } from "../lib/scheduling.ts";

function shiftForm(o = {}) {
  const fd = new FormData();
  const v = {
    title: "Morning Support", department_id: "11111111-1111-4111-8111-111111111111", position_id: "",
    start_date: "2026-11-23", start_time: "06:00", end_date: "2026-11-23", end_time: "14:00",
    required_headcount: "3", notes: "", ...o,
  };
  for (const [k, val] of Object.entries(v)) fd.set(k, val);
  return fd;
}

test("parseShift: Manila wall-clock becomes UTC, notes and position are optional", () => {
  const { data, errors } = parseShift(shiftForm());
  assert.deepEqual(errors, {});
  assert.equal(data.starts_at, "2026-11-22T22:00:00.000Z"); // Mon 06:00 Manila = Sun 22:00 UTC
  assert.equal(data.ends_at, "2026-11-23T06:00:00.000Z");
  assert.equal(data.position_id, null);
  assert.equal(data.notes, null);
  assert.equal(data.required_headcount, 3);
});

test("parseShift: overnight shift uses an explicit later end date", () => {
  const ok = parseShift(shiftForm({ start_time: "22:00", end_date: "2026-11-24", end_time: "06:00" }));
  assert.equal(ok.data.ends_at, iso("2026-11-24", "06:00"));
  const sameDay = parseShift(shiftForm({ start_time: "22:00", end_time: "06:00" })); // end date left on the start date
  assert.match(sameDay.errors.end_time, /next day/);
});

test("parseShift: limits and invalid input are reported per field", () => {
  assert.match(parseShift(shiftForm({ end_time: "06:00" })).errors.end_time, /end after it starts/); // equal to start
  assert.match(parseShift(shiftForm({ end_date: "2026-11-24", end_time: "06:01" })).errors.end_time, /24 hours/); // 24h01
  assert.deepEqual(parseShift(shiftForm({ end_date: "2026-11-24", end_time: "06:00" })).errors, {}); // exactly 24h
  const bad = parseShift(shiftForm({
    title: "x", department_id: "nope", position_id: "nope", required_headcount: "0",
    start_date: "2026-02-30", end_time: "9am", notes: "n".repeat(501),
  })).errors;
  assert.deepEqual(Object.keys(bad).sort(), ["department_id", "end_time", "notes", "position_id", "required_headcount", "start_date", "title"]);
  assert.ok(parseShift(shiftForm({ required_headcount: "51" })).errors.required_headcount);
  assert.ok(parseShift(shiftForm({ required_headcount: "2.5" })).errors.required_headcount);
  assert.ok(parseShift(shiftForm({ required_headcount: "" })).errors.required_headcount);
  assert.ok(!parseShift(shiftForm({ required_headcount: "50" })).errors.required_headcount);
});

test("changedFields compares instants and normalises empty notes", () => {
  const a = parseShift(shiftForm()).data;
  assert.deepEqual(changedFields(a, { ...a }), []);
  assert.deepEqual(changedFields(a, { ...a, starts_at: new Date(Date.parse(a.starts_at)).toISOString() }), []);
  assert.deepEqual(changedFields(a, { ...a, title: "Other", ends_at: iso("2026-11-23", "15:00"), notes: "hi" }).sort(), ["ends_at", "notes", "title"]);
  assert.ok(ATTENDANCE_LOCKED.includes("starts_at") && ATTENDANCE_LOCKED.includes("department_id"));
  assert.ok(!ATTENDANCE_LOCKED.includes("title") && !ATTENDANCE_LOCKED.includes("required_headcount") && !ATTENDANCE_LOCKED.includes("notes"));
});

test("violations carry a severity measure (bigger is worse)", () => {
  const rest = run({ otherShifts: [other("o", "2026-11-22", "15:00", "2026-11-22", "23:01")] }).warnings.find((w) => w.rule === "insufficient_rest");
  assert.equal(rest.measure, 1); // one minute short of 10 h
  const tighter = run({
    otherShifts: [other("a", "2026-11-22", "15:00", "2026-11-22", "23:30"), other("b", "2026-11-22", "10:00", "2026-11-22", "20:00")],
  });
  assert.equal(tighter.warnings.filter((w) => w.rule === "insufficient_rest").length, 1); // one warning, for the tightest gap
  assert.equal(tighter.warnings.find((w) => w.rule === "insufficient_rest").measure, 30);
  assert.equal(run({ assignedCount: 2 }).warnings.find((w) => w.rule === "over_headcount").measure, 1);
});

test("diffViolations: new and worse problems are added, same or better are not", () => {
  const w = (rule, measure) => ({ rule, level: "warning", message: rule, measure });
  const b = (rule) => ({ rule, level: "blocker", message: rule });
  const before = { blockers: [], warnings: [w("insufficient_rest", 60), w("outside_availability")] };
  const same = diffViolations(before, { blockers: [], warnings: [w("insufficient_rest", 60), w("outside_availability")] });
  assert.deepEqual([same.added.length, same.unchanged.length, same.resolved.length], [0, 2, 0]);
  const worse = diffViolations(before, { blockers: [], warnings: [w("insufficient_rest", 61), w("outside_availability")] });
  assert.deepEqual(worse.added.map((v) => v.rule), ["insufficient_rest"]);
  const better = diffViolations(before, { blockers: [], warnings: [w("insufficient_rest", 10)] });
  assert.deepEqual([better.added.length, better.unchanged.length, better.resolved.map((v) => v.rule)], [0, 1, ["outside_availability"]]);
  const fresh = diffViolations({ blockers: [], warnings: [] }, { blockers: [b("overlap")], warnings: [w("exceeds_weekly_hours", 5)] });
  assert.deepEqual(fresh.added.map((v) => v.rule).sort(), ["exceeds_weekly_hours", "overlap"]);
});

test("assessShiftEdit: a time change that creates an overlap is added; an existing problem is not", () => {
  const old = shift(); // Mon 09:00-17:00
  const moved = shift({ starts_at: iso("2026-11-23", "14:00"), ends_at: iso("2026-11-23", "22:00") });
  const neighbour = other("o1", "2026-11-23", "18:00", "2026-11-23", "23:00");
  const out = assessShiftEdit(old, moved, [
    { employee: emp({ id: "e1" }), availability: MON, otherShifts: [neighbour] },
    { employee: emp({ id: "e2" }), availability: [], otherShifts: [] }, // already outside availability before and after
  ]);
  assert.deepEqual(out[0].added.map((v) => v.rule), ["overlap"]);
  assert.deepEqual(out[1].added, []);
  assert.deepEqual(out[1].unchanged.map((v) => v.rule), ["outside_availability"]);
});

test("assessShiftEdit: lowering headcount below the number assigned adds over_headcount for the assignees", () => {
  const old = shift({ required_headcount: 2 });
  const smaller = shift({ required_headcount: 1 });
  const two = [emp({ id: "e1" }), emp({ id: "e2" })].map((employee) => ({ employee, availability: MON, otherShifts: [] }));
  assert.ok(assessShiftEdit(old, smaller, two).every((a) => a.added.some((v) => v.rule === "over_headcount")));
  assert.ok(assessShiftEdit(old, old, two).every((a) => a.added.length === 0));
});

// --- Assignment helpers (Phase 3.3a) ------------------------------------------------------------
import { assignedMinutesInWeek, assignmentGuard, assignmentVerdict } from "../lib/scheduling.ts";

test("assignmentGuard: cancelled, attendance and ended shifts take no assignments", () => {
  const now = new Date("2026-11-24T04:00:00Z");
  const future = { status: "published", ends_at: iso("2026-11-25", "17:00") };
  assert.equal(assignmentGuard(future, 0, now), null);
  assert.equal(assignmentGuard({ status: "draft", ends_at: iso("2026-11-25", "17:00") }, 0, now), null);
  assert.match(assignmentGuard({ ...future, status: "cancelled" }, 0, now), /cancelled/);
  assert.match(assignmentGuard(future, 1, now), /attendance/);
  assert.match(assignmentGuard({ status: "published", ends_at: "2026-11-24T03:59:00Z" }, 0, now), /already ended/);
  assert.match(assignmentGuard({ status: "published", ends_at: "2026-11-24T04:00:00Z" }, 0, now), /already ended/); // ends exactly now
  assert.equal(assignmentGuard({ status: "published", ends_at: "2026-11-24T04:00:01Z" }, 0, now), null); // still running
});

test("assignmentGuard: a shift in progress can still take an assignment, an ended one with attendance cannot", () => {
  const now = new Date("2026-11-24T04:00:00Z"); // 12:00 Manila
  assert.equal(assignmentGuard({ status: "published", ends_at: iso("2026-11-24", "17:00") }, 0, now), null);
  assert.match(assignmentGuard({ status: "published", ends_at: iso("2026-11-24", "17:00") }, 2, now), /attendance/);
});

test("assignmentVerdict", () => {
  const w = { rule: "outside_availability", level: "warning", message: "w" };
  const b = { rule: "overlap", level: "blocker", message: "b" };
  assert.equal(assignmentVerdict({ blockers: [], warnings: [] }), "eligible");
  assert.equal(assignmentVerdict({ blockers: [], warnings: [w] }), "warning");
  assert.equal(assignmentVerdict({ blockers: [b], warnings: [] }), "blocked");
  assert.equal(assignmentVerdict({ blockers: [b], warnings: [w] }), "blocked");
  assert.equal(assignmentVerdict(run()), "eligible");
  assert.equal(assignmentVerdict(run({ employee: emp({ status: "on_leave" }) })), "blocked");
  assert.equal(assignmentVerdict(run({ availability: [] })), "warning");
});

test("assignedMinutesInWeek: Manila week, cancelled excluded", () => {
  const others = [
    other("a", "2026-11-23", "09:00", "2026-11-23", "17:00"), // 480
    other("b", "2026-11-24", "22:00", "2026-11-25", "06:00"), // 480, starts Tuesday
    other("c", "2026-11-22", "22:00", "2026-11-23", "06:00"), // starts previous Sunday: other week
    other("d", "2026-11-26", "09:00", "2026-11-26", "17:00", "cancelled"),
    other("e", "2026-11-30", "09:00", "2026-11-30", "17:00"), // next week
  ];
  assert.equal(assignedMinutesInWeek(iso("2026-11-25", "12:00"), others), 960);
  assert.equal(assignedMinutesInWeek(iso("2026-11-29", "23:30"), others), 960); // Sunday still belongs to this week
  assert.equal(assignedMinutesInWeek(iso("2026-11-30", "00:30"), others), 480); // Monday 00:30 Manila starts the next week
  assert.equal(assignedMinutesInWeek(iso("2026-12-07", "09:00"), others), 0);
});

// --- Warning overrides (Phase 3.3b) -------------------------------------------------------------
import { OVERRIDE_RULE_LABELS, matchOverrides, validateReason } from "../lib/scheduling.ts";

test("validateReason: trimmed 10 to 500 characters, not one repeated character", () => {
  assert.deepEqual(validateReason("  Covering a sick colleague  "), { ok: true, reason: "Covering a sick colleague" });
  assert.equal(validateReason("a".repeat(9) + "b").ok, true); // 10 characters, not all the same
  for (const bad of [undefined, null, 5, {}, "", "   ", "\t\t\t\t\t\t\t\t\t\t", "\n\n", "short", "123456789", "aaaaaaaaaa", "..........", "😀".repeat(10), "x".repeat(501)])
    assert.equal(validateReason(bad).ok, false, String(bad));
  assert.equal(validateReason("x".repeat(499) + "y").ok, true); // 500
  assert.equal(validateReason("x".repeat(500) + "y").ok, false); // 501
  assert.equal(validateReason("é".repeat(9) + "e").ok, true); // counts characters, not bytes
  assert.equal(validateReason("😀".repeat(9) + "😁").ok, true); // code points, matching the database's char_length
});

const w = (rule, message = rule) => ({ rule, level: "warning", message });
const bl = (rule) => ({ rule, level: "blocker", message: `blocked by ${rule}` });
const good = "Approved by the duty manager";

test("matchOverrides: exact match builds a server-generated payload", () => {
  const result = { blockers: [], warnings: [w("over_headcount", "needs 1, would be 2"), w("outside_availability", "outside availability")] };
  const out = matchOverrides(result, [
    { rule: "outside_availability", reason: `  ${good}  ` },
    { rule: "over_headcount", reason: "Extra hands for stock take" },
  ]);
  assert.equal(out.ok, true);
  // order follows the rule list; detail comes from the server's warning, the reason is trimmed
  assert.deepEqual(out.payload, [
    { rule: "outside_availability", reason: good, detail: "outside availability" },
    { rule: "over_headcount", reason: "Extra hands for stock take", detail: "needs 1, would be 2" },
  ]);
});

test("matchOverrides: hard blockers are refused first, even with valid reasons", () => {
  const result = { blockers: [bl("overlap")], warnings: [w("outside_availability")] };
  const out = matchOverrides(result, [{ rule: "outside_availability", reason: good }, { rule: "overlap", reason: good }]);
  assert.equal(out.ok, false);
  assert.match(out.error, /Hard blockers cannot be overridden/);
});

test("matchOverrides: no warnings, missing, extra, duplicate and unknown rules are refused", () => {
  const two = { blockers: [], warnings: [w("outside_availability"), w("insufficient_rest")] };
  assert.match(matchOverrides({ blockers: [], warnings: [] }, []).error, /no warnings/);
  assert.match(matchOverrides({ blockers: [], warnings: [] }, [{ rule: "over_headcount", reason: good }]).error, /no warnings/);
  assert.match(matchOverrides(two, []).error, /Missing: Outside weekly availability, Insufficient rest/);
  assert.match(matchOverrides(two, [{ rule: "outside_availability", reason: good }]).error, /Missing: Insufficient rest/);
  assert.match(matchOverrides(two, [{ rule: "outside_availability", reason: good }, { rule: "insufficient_rest", reason: good }, { rule: "over_headcount", reason: good }]).error, /not a warning for this assignment/);
  assert.match(matchOverrides(two, [{ rule: "outside_availability", reason: good }, { rule: "outside_availability", reason: good }, { rule: "insufficient_rest", reason: good }]).error, /more than once/);
  assert.match(matchOverrides(two, [{ rule: "made_up", reason: good }, { rule: "outside_availability", reason: good }]).error, /Unknown rule "made_up"/);
  assert.match(matchOverrides(two, [{ rule: "overlap", reason: good }, { rule: "outside_availability", reason: good }]).error, /not a warning|cannot be overridden/); // a blocker id is never accepted
  assert.match(matchOverrides(two, [{ rule: "<script>".repeat(20), reason: good }]).error, /Unknown rule/); // long input is truncated in the message
});

test("matchOverrides: every reason must be valid, and the message names the warning", () => {
  const two = { blockers: [], warnings: [w("outside_availability"), w("insufficient_rest")] };
  for (const bad of ["", "   ", "short", "aaaaaaaaaa", "x".repeat(501), undefined]) {
    const out = matchOverrides(two, [{ rule: "outside_availability", reason: good }, { rule: "insufficient_rest", reason: bad }]);
    assert.equal(out.ok, false, String(bad));
    assert.match(out.error, /^Insufficient rest: /);
  }
});

test("a rule never appears twice in one result, so a rule id identifies a warning", () => {
  const all = validateAssignment({
    shift: shift({ position_id: "p1", required_headcount: 1 }),
    employee: emp({ position_id: "p2", max_weekly_hours: 1 }),
    availability: [],
    otherShifts: [other("r", "2026-11-22", "15:00", "2026-11-22", "23:30")],
    assignedCount: 1,
  });
  const rules = all.warnings.map((x) => x.rule);
  assert.deepEqual([...rules].sort(), ["exceeds_weekly_hours", "insufficient_rest", "outside_availability", "over_headcount", "position_mismatch"]);
  assert.equal(new Set(rules).size, rules.length);
  assert.deepEqual(Object.keys(OVERRIDE_RULE_LABELS).sort(), [...rules].sort());
  assert.equal(matchOverrides(all, rules.map((rule) => ({ rule, reason: good }))).ok, true);
});

// --- Phase 3.4a: publish and unpublish guards ---
import { publishGuard, unpublishGuard } from "../lib/scheduling.ts";

test("publishGuard: only a draft that has not ended and has no attendance", () => {
  const now = new Date("2026-11-24T04:00:00Z");
  const future = iso("2026-11-30", "17:00");
  const past = iso("2026-11-20", "17:00");
  assert.equal(publishGuard({ status: "draft", ends_at: future }, 0, now), null);
  assert.match(publishGuard({ status: "cancelled", ends_at: future }, 0, now), /cancelled/);
  assert.match(publishGuard({ status: "published", ends_at: future }, 0, now), /already published/);
  assert.match(publishGuard({ status: "draft", ends_at: past }, 0, now), /already ended/);
  assert.match(publishGuard({ status: "draft", ends_at: future }, 2, now), /attendance/);
});

test("unpublishGuard: only a published shift with no attendance", () => {
  assert.equal(unpublishGuard({ status: "published" }, 0), null);
  assert.match(unpublishGuard({ status: "published" }, 1), /attendance/);
  assert.match(unpublishGuard({ status: "draft" }, 0), /already a draft/);
  assert.match(unpublishGuard({ status: "cancelled" }, 0), /cancelled/);
});

// --- Phase 3.4b: week publish plan ---
import { planWeekPublish } from "../lib/scheduling.ts";

test("planWeekPublish: eligible drafts, skipped reasons, understaffed and empty counts", () => {
  const now = new Date("2026-11-24T04:00:00Z");
  const future = iso("2026-11-30", "17:00");
  const past = iso("2026-11-20", "17:00");
  const s = (id, o = {}) => ({ id, status: "draft", ends_at: future, updated_at: "2026-11-24T00:00:00Z", required_headcount: 1, assigned: 1, attendanceCount: 0, employeeIds: ["e1"], ...o });
  const plan = planWeekPublish(
    [
      s("b"), // filled, eligible
      s("a", { required_headcount: 3, assigned: 2, employeeIds: ["e1", "e2"] }), // understaffed
      s("c", { assigned: 0, employeeIds: [] }), // empty
      s("d", { status: "published" }),
      s("e", { status: "cancelled" }),
      s("f", { ends_at: past }), // ended
      s("g", { attendanceCount: 2 }),
    ],
    now,
  );
  assert.deepEqual(plan.eligible.map((x) => x.id), ["a", "b", "c"]); // stable order by id
  assert.equal(plan.understaffed, 2);
  assert.equal(plan.empty, 1);
  assert.equal(plan.employees, 2); // e1 and e2, counted once
  assert.deepEqual(plan.skipped, { published: 1, cancelled: 1, ended: 1, attendance: 1 });
  assert.deepEqual(planWeekPublish([], now).eligible, []);
});
