// Self-check for lib/validation.ts. Run with: npm test (Node 22.18+ strips TypeScript types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findOverlap, parseEmployee, parseWindow, searchTerms } from "../lib/validation.ts";

const DEPT = "11111111-1111-4111-8111-111111111111";
const POS = "22222222-2222-4222-8222-222222222222";

function form(overrides = {}) {
  const fd = new FormData();
  const values = {
    employee_code: " emp-0042 ",
    first_name: "Ana",
    last_name: "Reyes",
    email: "Ana.Reyes@Example.com",
    phone: "+63 917 555 0142",
    department_id: DEPT,
    position_id: POS,
    employment_type: "full_time",
    status: "active",
    hire_date: "2026-11-24",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

test("valid employee is normalised", () => {
  const { data, errors } = parseEmployee(form());
  assert.deepEqual(errors, {});
  assert.equal(data.employee_code, "EMP-0042");
  assert.equal(data.email, "ana.reyes@example.com");
});

test("empty phone becomes null", () => {
  assert.equal(parseEmployee(form({ phone: "" })).data.phone, null);
});

test("invalid fields are reported", () => {
  const { data, errors } = parseEmployee(
    form({ employee_code: "x", email: "nope", department_id: "abc", status: "fired", hire_date: "2026-02-30", first_name: "" }),
  );
  assert.equal(data, undefined);
  assert.deepEqual(Object.keys(errors).sort(), ["department_id", "email", "employee_code", "first_name", "hire_date", "status"]);
});

test("search terms drop PostgREST filter syntax", () => {
  assert.deepEqual(searchTerms("maria,id.eq.1) or(%"), ["maria", "id", "eq", "1", "or"]);
  assert.deepEqual(searchTerms("  Maria   Santos "), ["Maria", "Santos"]);
});

function windowForm(day, start, end) {
  const fd = new FormData();
  fd.set("day_of_week", String(day));
  fd.set("start_time", start);
  fd.set("end_time", end);
  return fd;
}

test("availability window: valid, reversed, overnight and bad input", () => {
  assert.deepEqual(parseWindow(windowForm(1, "09:00", "17:00")).data, { day_of_week: 1, start_time: "09:00", end_time: "17:00" });
  assert.deepEqual(parseWindow(windowForm(1, "09:00:00", "17:30:00")).data.end_time, "17:30");
  assert.match(parseWindow(windowForm(1, "22:00", "06:00")).error, /overnight/);
  assert.match(parseWindow(windowForm(1, "09:00", "09:00")).error, /after the start/);
  assert.ok(parseWindow(windowForm(7, "09:00", "17:00")).error);
  assert.ok(parseWindow(windowForm(1, "9am", "17:00")).error);
});

test("availability overlap: same day only, touching allowed, edited window ignored", () => {
  const existing = [{ id: "a", day_of_week: 1, start_time: "09:00:00", end_time: "12:00:00" }];
  assert.equal(findOverlap(existing, { day_of_week: 1, start_time: "11:00", end_time: "13:00" })?.id, "a");
  assert.equal(findOverlap(existing, { day_of_week: 1, start_time: "08:00", end_time: "18:00" })?.id, "a");
  assert.equal(findOverlap(existing, { day_of_week: 1, start_time: "12:00", end_time: "17:00" }), undefined);
  assert.equal(findOverlap(existing, { day_of_week: 2, start_time: "10:00", end_time: "11:00" }), undefined);
  assert.equal(findOverlap(existing, { day_of_week: 1, start_time: "10:00", end_time: "11:00" }, "a"), undefined);
});
