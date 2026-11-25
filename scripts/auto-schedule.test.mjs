import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PROPOSALS, proposeSchedule } from "../lib/auto-schedule.ts";
import * as rules from "../lib/scheduling.ts";

// Week under test: Monday 2026-11-30 to Sunday 2026-12-06, Asia/Manila.
const WEEK = "2026-11-30";
const now = new Date("2026-11-25T04:00:00Z");
const iso = (date, time) => rules.fromManila(date, time).toISOString();
const day = (n) => rules.addDays(WEEK, n);

const shift = (id, o = {}) => {
  const date = o.date ?? day(0);
  const start = o.start ?? "09:00";
  const end = o.end ?? "17:00";
  const endDate = end <= start ? rules.addDays(date, 1) : date;
  return {
    id, department_id: "d1", position_id: null, status: "draft", required_headcount: 1, assignedIds: [], attendanceCount: 0,
    starts_at: iso(date, start), ends_at: iso(endDate, end), ...o,
  };
};
const allWeek = (start = "00:00", end = "23:59") => Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, start_time: start, end_time: end }));
const person = (code, o = {}) => ({
  code,
  availability: o.availability ?? allWeek(),
  assignments: o.assignments ?? [],
  employee: { id: code, status: "active", department_id: "d1", position_id: null, max_weekly_hours: 40, ...o.employee },
});
const existing = (s) => ({ id: s.id, starts_at: s.starts_at, ends_at: s.ends_at, status: s.status });
const run = (shifts, employees, o = {}) => proposeSchedule({ weekStart: WEEK, shifts, employees, now, ...o }, rules);
const who = (p, shiftId) => p.assignments.filter((a) => a.shiftId === shiftId).map((a) => a.employeeCode);

/** Replays a proposal through the real rules: every proposed assignment must be free of blockers and warnings. */
function assertValid(shifts, employees, proposal) {
  const state = new Map(employees.map((e) => [e.employee.id, [...e.assignments]]));
  const count = new Map(shifts.map((s) => [s.id, s.assignedIds.length]));
  for (const s of shifts) for (const id of s.assignedIds) if (state.has(id) && !state.get(id).some((a) => a.id === s.id)) state.get(id).push(existing(s));
  for (const a of proposal.assignments) {
    const s = shifts.find((x) => x.id === a.shiftId);
    const e = employees.find((x) => x.employee.id === a.employeeId);
    const result = rules.validateAssignment({ shift: s, employee: e.employee, availability: e.availability, otherShifts: state.get(a.employeeId), assignedCount: count.get(s.id) });
    assert.deepEqual([...result.blockers, ...result.warnings], [], `${a.shiftId} ${a.employeeCode}`);
    assert.equal(s.status, "draft");
    state.get(a.employeeId).push(existing(s));
    count.set(s.id, count.get(s.id) + 1);
  }
}

test("enough staff: every open place filled, nothing over headcount, existing assignments counted", () => {
  const shifts = [shift("s1", { required_headcount: 3, assignedIds: ["E1"] }), shift("s2", { date: day(1), required_headcount: 2 })];
  const people = [person("E1"), person("E2"), person("E3"), person("E4")];
  const p = run(shifts, people);
  assert.equal(p.summary.openPlaces, 4);
  assert.equal(p.summary.filledPlaces, 4);
  assert.equal(who(p, "s1").length, 2);
  assert.ok(!who(p, "s1").includes("E1")); // already on it
  assert.equal(new Set(who(p, "s2")).size, 2);
  assert.deepEqual(p.uncovered, []);
  assertValid(shifts, people, p);
});

test("blockers exclude: inactive, on leave, other department, overlap", () => {
  const clash = shift("other", { date: day(0), start: "12:00", end: "20:00", status: "published", required_headcount: 1, assignedIds: ["E4"] });
  const shifts = [shift("s1"), clash];
  const people = [
    person("E1", { employee: { status: "inactive" } }),
    person("E2", { employee: { status: "on_leave" } }),
    person("E3", { employee: { department_id: "d2" } }),
    person("E4"),
  ];
  const p = run(shifts, people);
  assert.deepEqual(p.assignments, []);
  const [u] = p.uncovered;
  assert.equal(u.cause, "no_eligible_employee");
  assert.equal(u.departmentEmployees, 3); // the other department is not counted
  assert.deepEqual(Object.fromEntries(u.excluded.map((x) => [x.rule, x.count])), { employee_inactive: 1, employee_on_leave: 1, overlap: 1 });
  assert.match(u.explanation, /None of the 3 department employee\(s\)/);
});

test("warnings exclude too: availability, rest, weekly hours, position", () => {
  const late = shift("late", { date: day(0), start: "14:00", end: "22:00" });
  const target = shift("s1", { date: day(1), start: "06:00", end: "14:00", position_id: "lead" });
  const long = Array.from({ length: 5 }, (_, i) => shift(`w${i}`, { date: day(i + 2), start: "08:00", end: "16:00", status: "published" }));
  const people = [
    person("E1", { availability: allWeek("09:00", "17:00"), employee: { position_id: "lead" } }),
    person("E2", { assignments: [existing({ ...late, status: "published" })], employee: { position_id: "lead" } }),
    person("E3", { assignments: long.map(existing), employee: { position_id: "lead" } }),
    person("E4", { employee: { position_id: "agent" } }),
  ];
  const p = run([target], people);
  assert.deepEqual(p.assignments, []);
  assert.deepEqual(Object.fromEntries(p.uncovered[0].excluded.map((x) => [x.rule, x.count])), {
    outside_availability: 1, insufficient_rest: 1, exceeds_weekly_hours: 1, position_mismatch: 1,
  });
});

test("boundaries: exactly 10 h rest and exactly the weekly maximum are allowed", () => {
  const evening = shift("prev", { date: day(0), start: "12:00", end: "20:00", status: "published" });
  const morning = shift("s1", { date: day(1), start: "06:00", end: "14:00" });
  const p = run([morning], [person("E1", { assignments: [existing(evening)], employee: { max_weekly_hours: 16 } })]);
  assert.deepEqual(who(p, "s1"), ["E1"]);
});

test("rest across the week boundary counts; an overnight shift needs an overnight window", () => {
  const sunday = shift("prev", { date: rules.addDays(WEEK, -1), start: "15:00", end: "23:00", status: "published" });
  const monday = shift("s1", { date: day(0), start: "06:00", end: "14:00" });
  assert.deepEqual(run([monday], [person("E1", { assignments: [existing(sunday)] })]).assignments, []);
  const night = shift("n", { date: day(2), start: "22:00", end: "06:00" });
  assert.deepEqual(run([night], [person("E1", { availability: allWeek("20:00", "23:00") })]).assignments, []);
  assert.equal(run([night], [person("E1", { availability: allWeek("20:00", "23:59") })]).assignments.length, 1);
});

test("only draft shifts of the week that have not ended and have no attendance are targets", () => {
  const shifts = [
    shift("pub", { status: "published" }),
    shift("can", { status: "cancelled" }),
    shift("att", { attendanceCount: 1 }),
    shift("full", { assignedIds: ["E9"] }),
    shift("next", { date: rules.addDays(WEEK, 7) }),
    shift("other-dept", { department_id: "d2" }),
    shift("yes", { date: day(3) }),
  ];
  const p = run(shifts, [person("E1")], { departmentId: "d1" });
  assert.deepEqual(p.assignments.map((a) => a.shiftId), ["yes"]);
  assert.deepEqual(p.summary.skipped, { filled: 1, published: 1, cancelled: 1, ended: 0, attendance: 1 });
  const late = run([shift("old")], [person("E1")], { now: new Date(iso(day(0), "18:00")) });
  assert.equal(late.summary.skipped.ended, 1);
  assert.deepEqual(late.assignments, []);
});

test("an existing assignment known only from the shift is still respected", () => {
  const busy = shift("busy", { date: day(0), status: "published", assignedIds: ["E1"] });
  const p = run([busy, shift("s1", { date: day(0), start: "10:00", end: "18:00" })], [person("E1")]);
  assert.deepEqual(p.assignments, []);
});

test("one person, two overlapping open shifts: only one is proposed", () => {
  const p = run([shift("a"), shift("b", { start: "10:00", end: "18:00" })], [person("E1")]);
  assert.equal(p.assignments.length, 1);
  assert.equal(p.uncovered.length, 1);
});

test("hardest shift first: the shift only one person can take gets that person", () => {
  const shifts = [shift("easy", { date: day(0), start: "09:00" }), shift("hard", { date: day(0), start: "10:00", end: "18:00", position_id: "lead" })];
  const people = [person("E1", { employee: { position_id: "lead" } }), person("E2")];
  const p = run(shifts, people);
  assert.deepEqual(who(p, "hard"), ["E1"]);
  assert.deepEqual(who(p, "easy"), ["E2"]);
});

test("fairness 1: lowest share of weekly maximum after the shift (part-timers weighted)", () => {
  const prior = (id) => existing(shift(id, { date: day(0), status: "published" }));
  // E1: 8 of 40 h used -> 16/40 = 40 %. E2: 0 of 16 h -> 8/16 = 50 %. E3: 8 of 24 h -> 16/24 = 67 %.
  const people = [
    person("E1", { assignments: [prior("p1")] }),
    person("E2", { employee: { max_weekly_hours: 16 } }),
    person("E3", { assignments: [prior("p3")], employee: { max_weekly_hours: 24 } }),
  ];
  assert.deepEqual(who(run([shift("s1", { date: day(3) })], people), "s1"), ["E1"]);
});

test("fairness 2: equal share, fewer shifts wins", () => {
  const short = (id, d) => existing(shift(id, { date: day(d), start: "09:00", end: "13:00", status: "published" }));
  const long = existing(shift("long", { date: day(0), status: "published" }));
  const people = [person("E1", { assignments: [short("a", 0), short("b", 1)] }), person("E2", { assignments: [long] })];
  assert.deepEqual(who(run([shift("s1", { date: day(4) })], people), "s1"), ["E2"]);
});

test("fairness 3: equal share and shifts, the less flexible person is used first; then employee code", () => {
  const shifts = [shift("s1", { date: day(1) }), shift("s2", { date: day(3), required_headcount: 1 })];
  const flexible = person("E1");
  const onlyTuesday = person("E2", { availability: [{ day_of_week: 2, start_time: "00:00", end_time: "23:59" }] });
  const third = person("E3");
  const p = run(shifts, [flexible, onlyTuesday, third]);
  assert.deepEqual(who(p, "s1"), ["E2"]); // keeps the flexible people for other shifts
  assert.deepEqual(who(run([shift("x")], [person("E2"), person("E1")]), "x"), ["E1"]); // full tie: code
});

test("work is spread: five shifts over five equal people give one each", () => {
  const shifts = Array.from({ length: 5 }, (_, i) => shift(`s${i}`, { date: day(i) }));
  const p = run(shifts, ["E1", "E2", "E3", "E4", "E5"].map((c) => person(c)));
  assert.deepEqual(p.workload.map((w) => w.after.shifts), [1, 1, 1, 1, 1]);
  assert.deepEqual(p.workload.map((w) => w.before.minutes), [0, 0, 0, 0, 0]);
});

test("limit: never more than 150, a lower limit is honoured, a higher one ignored, and the cause is stated", () => {
  const shifts = [shift("big", { required_headcount: 200 })];
  const people = Array.from({ length: 180 }, (_, i) => person(`E${String(i).padStart(3, "0")}`));
  const p = run(shifts, people, { limit: 999 });
  assert.equal(MAX_PROPOSALS, 150);
  assert.equal(p.assignments.length, 150);
  assert.equal(p.summary.limitReached, true);
  assert.equal(p.uncovered[0].cause, "limit");
  assert.equal(p.uncovered[0].open, 50);
  assert.equal(run(shifts, people, { limit: 3 }).assignments.length, 3);
  assert.equal(run(shifts, people, { limit: -1 }).assignments.length, 0);
  assert.equal(run([shift("s")], [person("E1")], { limit: 1 }).summary.limitReached, false);
});

test("edge cases: empty week, no employees, zero weekly maximum", () => {
  assert.deepEqual(run([], [person("E1")]).assignments, []);
  const none = run([shift("s1")], []);
  assert.equal(none.uncovered[0].explanation, "This department has no employees.");
  assert.deepEqual(run([shift("s1")], [person("E1", { employee: { max_weekly_hours: 0 } })]).assignments, []);
});

// No repair step is built, so nothing is ever moved; an existing assignment stays and only the open place is proposed.
test("existing assignments are never moved or repeated, and the shifts given are not changed", () => {
  const shifts = [shift("s1", { date: day(0), required_headcount: 2, assignedIds: ["E9"] })];
  const before = JSON.stringify(shifts);
  const p = run(shifts, [person("E9"), person("E1")]);
  assert.deepEqual(who(p, "s1"), ["E1"]);
  assert.equal(JSON.stringify(shifts), before);
});

test("deterministic and pure: shuffled input gives identical output and the input is unchanged", () => {
  const shifts = Array.from({ length: 12 }, (_, i) => shift(`s${String(i).padStart(2, "0")}`, { date: day(i % 6), start: i % 2 ? "14:00" : "06:00", end: i % 2 ? "22:00" : "14:00", required_headcount: 2 }));
  const people = Array.from({ length: 7 }, (_, i) => person(`E${i}`, { employee: { max_weekly_hours: i % 2 ? 24 : 40 } }));
  const snapshot = JSON.stringify([shifts, people]);
  const first = run(shifts, people);
  assert.deepEqual(run([...shifts].reverse(), [...people].reverse()), first);
  assert.deepEqual(run(shifts, people), first);
  assert.equal(JSON.stringify([shifts, people]), snapshot);
});

test("invariant: 200 random weeks never produce a blocker, a warning, a duplicate or more than the limit", () => {
  let seed = 7;
  const random = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
  const times = [["06:00", "14:00"], ["09:00", "17:00"], ["14:00", "22:00"], ["22:00", "06:00"]];
  let proposed = 0;
  for (let round = 0; round < 200; round++) {
    const shifts = Array.from({ length: 2 + random(14) }, (_, i) => {
      const [start, end] = times[random(4)];
      return shift(`s${i}`, { date: day(random(7)), start, end, required_headcount: 1 + random(3), department_id: random(4) ? "d1" : "d2", position_id: random(3) ? null : "p1", status: ["draft", "draft", "draft", "published", "cancelled"][random(5)] });
    });
    const people = Array.from({ length: 1 + random(9) }, (_, i) =>
      person(`E${i}`, {
        availability: random(3) ? allWeek() : allWeek("06:00", "18:00"),
        employee: { max_weekly_hours: [8, 16, 24, 40][random(4)], department_id: random(5) ? "d1" : "d2", position_id: random(2) ? "p1" : null, status: random(10) ? "active" : "on_leave" },
      }),
    );
    const p = run(shifts, people);
    proposed += p.assignments.length;
    assertValid(shifts, people, p);
    assert.equal(new Set(p.assignments.map((a) => `${a.shiftId} ${a.employeeId}`)).size, p.assignments.length);
    assert.ok(p.assignments.length <= MAX_PROPOSALS);
    assert.equal(p.summary.filledPlaces + p.uncovered.reduce((n, u) => n + u.open, 0), p.summary.openPlaces);
  }
  assert.ok(proposed > 500, `the random weeks should exercise the engine (${proposed})`);
});
