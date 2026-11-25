// Seed conformance check: runs the scheduling validator (lib/scheduling.ts) over every assignment
// in the live database. READ-ONLY: it only selects rows.
//
//   npm run seed:check
//
// Reads .env.local: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server-side key, never printed).
// Part 1: every existing assignment must have 0 blockers and 0 warnings.
// Part 2: forces one violation per rule on a copy of a real assignment and checks exactly that rule fires.
import { createClient } from "@supabase/supabase-js";
import { BLOCKER_RULES, RULE_IDS, WARNING_RULES, toManilaParts, validateAssignment } from "../lib/scheduling.ts";

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PAGE_LIMIT = 1000; // PostgREST's default row cap: a result this long may be truncated
async function load(table, columns) {
  const { data, error } = await db.from(table).select(columns);
  if (error) throw new Error(`${table}: ${error.message}`);
  if (data.length >= PAGE_LIMIT) throw new Error(`${table} returned ${data.length} rows; paginate before trusting this check`);
  return data;
}

const [shifts, assignments, employees, availability] = await Promise.all([
  load("shifts", "id, department_id, position_id, starts_at, ends_at, required_headcount, status"),
  load("shift_assignments", "id, shift_id, employee_id"),
  load("employees", "id, employee_code, status, department_id, position_id, max_weekly_hours"),
  load("employee_availability", "employee_id, day_of_week, start_time, end_time"),
]);

const shiftById = new Map(shifts.map((s) => [s.id, s]));
const employeeById = new Map(employees.map((e) => [e.id, e]));
const availabilityByEmployee = Map.groupBy(availability, (a) => a.employee_id);
const assignmentsByEmployee = Map.groupBy(assignments, (a) => a.employee_id);
const countByShift = Map.groupBy(assignments, (a) => a.shift_id);

const contexts = [];
for (const a of assignments) {
  const shift = shiftById.get(a.shift_id);
  const employee = employeeById.get(a.employee_id);
  if (!shift || !employee || shift.status === "cancelled") continue;
  contexts.push({
    code: employee.employee_code,
    overnight: toManilaParts(shift.starts_at).date !== toManilaParts(shift.ends_at).date,
    ctx: {
      shift,
      employee,
      availability: availabilityByEmployee.get(employee.id) ?? [],
      otherShifts: (assignmentsByEmployee.get(employee.id) ?? [])
        .filter((o) => o.shift_id !== shift.id)
        .map((o) => shiftById.get(o.shift_id))
        .filter(Boolean),
      assignedCount: (countByShift.get(shift.id) ?? []).length - 1,
    },
  });
}

// --- Part 1: the seed must be clean -------------------------------------------------------------
const fired = new Map(RULE_IDS.map((r) => [r, 0]));
const offenders = [];
for (const c of contexts) {
  const { blockers, warnings } = validateAssignment(c.ctx);
  for (const v of [...blockers, ...warnings]) fired.set(v.rule, fired.get(v.rule) + 1);
  if (blockers.length + warnings.length) offenders.push(`${c.code} ${c.ctx.shift.starts_at}: ${[...blockers, ...warnings].map((v) => v.rule).join(", ")}`);
}
const overnight = contexts.filter((c) => c.overnight);

console.log(`Assignments checked: ${contexts.length} (of ${assignments.length}; cancelled shifts skipped)`);
console.log(`  overnight (cross Manila midnight): ${overnight.length}`);
for (const r of RULE_IDS) console.log(`  ${BLOCKER_RULES.includes(r) ? "blocker" : "warning"} ${r}: ${fired.get(r)}`);
let failed = offenders.length > 0 || contexts.length === 0;
if (offenders.length) {
  console.log(`FAIL part 1: ${offenders.length} assignment(s) break a rule`);
  offenders.slice(0, 10).forEach((o) => console.log("   ", o));
} else if (contexts.length === 0) {
  console.log("FAIL part 1: nothing to check");
} else {
  console.log("PASS part 1: 0 blockers and 0 warnings on every assignment");
}

// --- Part 2: force each rule on a copy of a real assignment -------------------------------------
const base = contexts[0]?.ctx;
if (base) {
  const t = (iso, hours) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
  const loose = (c) => ({ ...c, employee: { ...c.employee, max_weekly_hours: 1000 } }); // isolate the rule under test
  const otherShift = (start, end) => ({ id: "forced", starts_at: start, ends_at: end, status: "published" });
  const mutations = {
    already_assigned: (c) => ({ ...c, otherShifts: [...c.otherShifts, { ...c.shift }] }),
    employee_inactive: (c) => ({ ...c, employee: { ...c.employee, status: "inactive" } }),
    employee_on_leave: (c) => ({ ...c, employee: { ...c.employee, status: "on_leave" } }),
    department_mismatch: (c) => ({ ...c, employee: { ...c.employee, department_id: "other-department" } }),
    overlap: (c) => ({ ...c, otherShifts: [...c.otherShifts, otherShift(t(c.shift.starts_at, 1), t(c.shift.ends_at, 1))] }),
    outside_availability: (c) => ({ ...c, availability: [] }),
    insufficient_rest: (c) => ({ ...c, otherShifts: [...c.otherShifts, otherShift(t(c.shift.starts_at, -13), t(c.shift.starts_at, -5))] }),
    exceeds_weekly_hours: (c) => ({ ...c, employee: { ...c.employee, max_weekly_hours: 1 } }),
    position_mismatch: (c) => ({ ...c, shift: { ...c.shift, position_id: "other-position" } }),
    over_headcount: (c) => ({ ...c, assignedCount: c.shift.required_headcount }),
  };
  const untested = RULE_IDS.filter((r) => !(r in mutations));
  if (untested.length) {
    failed = true;
    console.log(`FAIL part 2: no forced case for ${untested.join(", ")}`);
  }
  for (const [rule, mutate] of Object.entries(mutations)) {
    const prepared = rule === "exceeds_weekly_hours" ? base : loose(base);
    const result = validateAssignment(mutate(prepared));
    const got = [...result.blockers, ...result.warnings].map((v) => v.rule);
    const level = BLOCKER_RULES.includes(rule) ? result.blockers : WARNING_RULES.includes(rule) ? result.warnings : [];
    const ok = got.length === 1 && got[0] === rule && level.length === 1;
    if (!ok) failed = true;
    console.log(`  ${ok ? "ok  " : "FAIL"} forced ${rule}: fired [${got.join(", ")}]`);
  }
  console.log(failed ? "Part 2 finished with failures" : "PASS part 2: each rule fires alone when forced");
}

console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
