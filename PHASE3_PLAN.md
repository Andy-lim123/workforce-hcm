# Phase 3 — Manual Workforce Scheduling: final implementation plan (v2)

Status (2026-11-24): **Gate 0, S1 and S2 approved by the user. 3.0 implemented and checked by Claude; **Gate 1 passed 2026-11-24** (unit tests, seed check, build, and browser regression run by Claude); **3.1 (admin week view, read-only) implemented and verified 2026-11-24**; 3.2 (shift create, edit, cancel; NO delete) implemented and verified 2026-11-24; 3.3a (assign employees, no overrides, no unassign) implemented and verified 2026-11-24; 3.3b (warning overrides with required reasons and audit trail, via the S1 function; S2 NOT applied) implemented and verified 2026-11-24; S2 audited (`PHASE3_S2_AUDIT.md`) and DEFERRED, not applied; 3.4a (publish / unpublish one shift) implemented and verified 2026-11-24; 3.4b (publish a week, no week unpublish) implemented and verified 2026-11-24; 3.5 (employee `/me/schedule`) implemented and verified 2026-11-24; 3.6 not started.
**S1 applied 2026-11-24 (migration `20261124101712 schedule_overrides_audit`); S2 not applied.** (3.0 changed only application files; see `PROJECT_CONTEXT.md` section 9.)
Originally written as plan-only; the sections below are unchanged except this status.
Companion file: `PHASE3_PROPOSED_SQL.md` (proposed SQL, **not applied**; deliberately not in `supabase/migrations/`).
Based on read-only inspection of the live database (project HCM), 2026-11-24.

## 1. Decisions (user-approved)

| # | Decision |
|---|---|
| 1 | Manual scheduling only. Auto-assignment is Phase 4. |
| 2 | **Hard blockers:** overlapping assignment, inactive or on-leave employee, department mismatch, already assigned. |
| 3 | **Warnings with admin override:** outside availability, under 10 h rest, over weekly hours, **position mismatch, over required headcount**. |
| 4 | Editing a published shift is allowed, with a confirmation showing affected employees. |
| 5 | Notifications deferred to Phase 5. |
| 6 | Keep `EMP-0042` during development; sanitize or remove before any public demo. |
| 7 | All rules centralised in `lib/scheduling.ts`, reusable by Phase 4. |
| A | Overnight availability follows the seed's interpretation (section 3), documented exactly and identical in validator, editor and tests. |
| C | Double-booking trigger **on hold**; SQL proposed for review only. |
| D | **Override audit trail required before overrides are enabled.** Schema proposed for review only. |

## 2. Inspection findings (read-only)

- `shift_assignments` has only `UNIQUE (shift_id, employee_id)`: **no overlap protection**; no time columns, so a
  time-range exclusion constraint is impossible without a trigger.
- Deleting a shift cascades to its assignments and nulls `attendance_records.shift_assignment_id`.
  So only a **draft with no assignments** may be deleted; everything else is cancelled.
- RLS: admin full access; employees see only **published** shifts they are assigned to and only their own
  assignments (never co-workers' names). `notifications` and `employee_availability` policies unchanged.
- Seed: 186 shifts in 3 Monday-start Manila weeks (16 Nov and 23 Nov published, 30 Nov draft); 330 assignments,
  102 on draft shifts; 40 deliberately understaffed shifts; 117 shifts with no position. Shifts are 8 h (Delivery Route 9 h).
- **Overnight data, corrected figures:** 21 shifts run 22:00–06:00 across midnight in Manila, but only
  **19 overnight assignments** exist (2 draft shifts were left unassigned by design). All 19 belong to 2 Security
  Officers. Counting days in UTC would label 54 shifts as overnight, so UTC day logic is wrong for 33 of them.
- **Seed conformance, verified:** every one of the 330 assignments passes the overlap, 10 h rest, weekly-hours,
  department, position, active-status and availability rules, **under semantics A below**. (An earlier check of
  mine excluded overnight shifts from the availability test; they were checked separately: 19 of 19 pass A,
  0 of 19 pass a strict two-window reading.)
- The seed's literal SQL for overnight shifts also accepts any window ending at or after the shift's end
  time-of-day (e.g. 06:00), which is accidental. The validator implements the precise rule in section 3 instead.
  Result on the seed is identical (19 of 19).

## 3. Availability semantics (exact definition, shared by validator, editor and tests)

All times are `Asia/Manila`. Constant `END_OF_DAY_WINDOW = "23:59"` is defined once in `lib/scheduling.ts` and imported
by the validator, the availability editor's help text and the tests.

1. **Same-day shift** (starts and ends on the same Manila date): covered when one window on that weekday has
   `window.start <= shift.start` and `window.end >= shift.end`.
2. **Overnight shift** (ends on a later Manila date): covered when one window on the **start day's** weekday has
   `window.start <= shift.start` and `window.end >= 23:59`. The next day's windows are **not** consulted.
   A window ending at 23:59 therefore means: *available from its start time through the end of the day and overnight
   until the following morning.*
3. A window ending **before** 23:59 never covers an overnight shift.
4. A shift spanning more than one midnight (over 24 h) is never covered.
5. No window on the shift's start weekday means not available.

Consequences that must be implemented, not hidden:
- `app/admin/employees/[id]/availability-editor.tsx` help text and the error text in `lib/validation.ts`
  `parseWindow` currently say "for overnight availability add two windows". Both change to the rule above.
  Existing `parseWindow` behaviour (end must be after start on the same day) does not change.
- `PROJECT_CONTEXT.md` decision "overnight = two windows" is marked superseded, not deleted.
- Unit tests pin all five rules, plus the difference from the strict two-window reading.

## 4. Validator rules (`lib/scheduling.ts`, pure, no I/O)

Input: shift, employee, employee availability, employee's other assignments (±1 week), assigned count.
Output: `{ blockers: Violation[], warnings: Violation[] }`. Rule ids are a single exported list `RULE_IDS`.

| Rule id | Level | Condition |
|---|---|---|
| `already_assigned` | blocker | employee already on this shift |
| `employee_inactive`, `employee_on_leave` | blocker | status is not `active` |
| `department_mismatch` | blocker | employee department differs from shift department |
| `overlap` | blocker | overlaps another non-cancelled shift of the employee |
| `outside_availability` | warning | not covered per section 3 |
| `insufficient_rest` | warning | under 10 h to the previous or next shift |
| `exceeds_weekly_hours` | warning | hours in the Manila Monday–Sunday week above `max_weekly_hours` |
| `position_mismatch` | warning | shift has a position and the employee holds a different one |
| `over_headcount` | warning | assignment would exceed `required_headcount` |

Time rules: week = Monday 00:00 to Sunday 24:00 Manila; a shift counts toward the week it **starts** in (as the seed does);
timestamps stay UTC in the database; Manila has no daylight saving so local time uses a fixed +08:00 offset in one
constant, with a comment on when to replace it.

## 5. Database changes

**APPLIED 2026-11-24 as migration `schedule_overrides_audit` (verified in rolled-back tests first):**
1. Table `public.schedule_overrides`: append-only audit rows (admin, employee, shift, rule, reason, timestamp), admin-only
   read, admin-only insert as themselves, no update or delete. Snapshots (admin email, employee code, shift title and
   times) keep rows meaningful if the shift or employee is later deleted.

**Also APPLIED in the same migration (proposed by Claude, approved by the user):**
2. Function `public.assign_employee(shift, employee, overrides jsonb)`, security invoker, admin-only: inserts the
   assignment and its audit rows **in one transaction**, so an override can never exist without its audit record, and
   an audit record never exists for a failed assignment. Without it the two writes are separate API calls and can diverge.

**Still on hold, no approval yet (NOT applied):**
3. Double-booking protection: two `BEFORE` row triggers, `private.check_assignment_overlap()` on `shift_assignments`
   and `private.check_shift_overlap()` on `shifts` (time or status changes), locking the employee row `FOR UPDATE`.
   Full SQL, locking strategy, transaction behaviour and rollback are in `PHASE3_PROPOSED_SQL.md`.

**No other schema change.** After any approved migration, `lib/supabase/database.types.ts` is regenerated (a file change
listed under the milestone).

## 6. Milestones, files, gates

| Step | Delivers | New / changed files | Needs |
|---|---|---|---|
| **3.0** Foundation (no DB change) | `lib/scheduling.ts`, Manila helpers, all rules, `RULE_IDS`, `END_OF_DAY_WINDOW`; availability help text and `parseWindow` message updated to section 3; seed conformance script | new `lib/scheduling.ts`, `scripts/scheduling.test.mjs`, `scripts/check-seed-schedule.mjs`; edit `app/admin/employees/[id]/availability-editor.tsx` (text), `lib/validation.ts` (message), `scripts/validation.test.mjs` (assertion), `package.json` (test script), `PROJECT_CONTEXT.md` | **Gate 0** |
| **3.1** Admin week view, read-only | `?week=&department=`, 7-day grid, filled/required, understaffed and draft markers, prev/next/this week, loading/empty/error | `app/admin/schedules/page.tsx` (replaces placeholder), new `week-grid.tsx`; small helpers in `lib/labels.ts` | 3.0 |
| **3.2** Shift create / edit / cancel | create, edit, cancel; delete only an unassigned draft; editing a published shift needs a confirmation listing affected employees and re-validates their assignments (never silently removes them) | new `app/admin/schedules/actions.ts`, `new/page.tsx`, `[id]/page.tsx`, `shift-form.tsx` | 3.1 |
| **3.3a** Assign / unassign, no overrides | picker shows blockers and warnings per employee; server re-reads and re-validates; **blockers always refuse; any warning also refuses while overrides are disabled**; sets `assigned_by`; unassign with confirmation | `[id]/page.tsx`, `actions.ts` (`assignEmployee`, `unassignEmployee`), new `assign-panel.tsx` | 3.2 |
| **3.3b** Overrides | override checkbox per warning with a required reason (10–500 chars); assignment goes through `assign_employee` | `actions.ts`, `assign-panel.tsx`; regenerated `lib/supabase/database.types.ts` | 3.3a and **Gate S1** |
| **3.4** Publish / unpublish | per shift or whole week; confirmation shows draft count and understaffed shifts; unpublish hides from employees | `actions.ts`, week view controls | 3.2 |
| **3.5** Employee `/me/schedule` | own published shifts by week; empty state; session client only, so RLS decides visibility | `app/me/schedule/page.tsx` | 3.4 (parallel with 3.3) |
| **3.6** Verification | all checks in section 7; `PROJECT_CONTEXT.md` updated | `PROJECT_CONTEXT.md`, `PHASE3_PLAN.md` | all |

Untouched throughout: Phase 2 employee, department and position pages and actions, `proxy.ts`, auth, all existing migrations.

**Gates**
- **Gate 0** (now): you approve this plan. Nothing starts before it.
- **Gate 1** (end of 3.0): unit tests pass; seed conformance reports 0 problems on all 330 assignments including the 19 overnight; editor text, `parseWindow` message and validator agree; you review.
- **Per milestone:** `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass before it is called done; Phase 2 browser regression spot-check after any milestone touching shared files.
- **Gate S1** (before 3.3b): you approve the audit SQL; I apply it as a migration, regenerate types, rerun RLS checks. Until then overrides stay disabled.
- **Gate S2** (trigger): you approve the trigger SQL separately; independent of 3.x, recommended before Phase 4.
- **Gate 3.6:** browser tests recorded with exact provenance (section 7).

## 7. Test coverage

**Unit (`node:test`, no database):**
- Manila week boundaries: Sunday 23:30 and Monday 00:30 Manila around the UTC date change; week start for any weekday.
- Overnight: a 22:00–06:00 shift crossing midnight for overlap, rest, weekly bucketing, and availability rules 1–5 of section 3;
  the case that distinguishes semantics A from a strict two-window reading.
- Every rule id: positive, negative and boundary (touching shifts do not overlap; exactly 10 h rest passes; exactly `max_weekly_hours` passes).
- Blockers versus warnings classification; `RULE_IDS` equals the rule list in the audit migration (once it exists).
- `END_OF_DAY_WINDOW` is the single source used by editor text and validator.

**Integration (`scripts/check-seed-schedule.mjs`, live database, secret key, read-only):**
- Runs the validator over all 330 seeded assignments: expect 0 blockers and 0 warnings, including 19 overnight.
- Negative runs on in-memory copies: force one violation per rule and confirm exactly that rule fires.

**RLS / database (SQL in rolled-back transactions, literal ids):**
- Employee: reads only own published shifts and own assignments; cannot see draft or cancelled; cannot insert, update or delete
  shifts or assignments; cannot read `schedule_overrides`.
- Admin: full shift and assignment access.
- After Gate S1: admin inserts an override only as themselves; update and delete are denied; reason shorter than 10 chars and an
  unknown rule are rejected; `assign_employee` rolls back the assignment when an audit row is invalid; non-admin gets 42501.
- After Gate S2: overlapping assignment rejected (23P01); touching shifts allowed; cancelled shifts ignored; changing a shift's
  time into a conflict is rejected; the seed still loads. **True concurrency cannot be tested from the available tools**
  (one statement per call): verify by review and a documented manual two-tab SQL Editor test.

**Browser (signed-in admin and employee; each recorded as "run by Claude" or "user-confirmed", never blurred):**
1. Week view shows the seeded weeks, understaffed and draft markers. 2. Week and department navigation. 3. Create a shift.
4. Edit a draft shift. 5. Edit a published shift: confirmation lists affected employees. 6. Cancel a shift.
7. Delete blocked for assigned or published shifts. 8. Assign an eligible employee. 9. Each blocker refuses (overlap,
on-leave, wrong department). 10. A warning refuses without override (3.3a). 11. Override with reason, audit row exists (3.3b).
12. Overnight shift to a Security Officer accepted per section 3. 13. Unassign with confirmation. 14. Publish one shift and a
week. 15. Unpublish. 16. Employee sees only own published shifts. 17. Employee cannot open `/admin/schedules`.
18. Phase 2 regression: directory, availability editor text, invite flow page loads. 19. Data persists after refresh.

## 8. Dependencies and regression risks

- 3.0 edits two Phase 2 files (editor text, `parseWindow` message): re-run the existing 6 unit tests and re-test the availability editor.
- Availability decision change is visible to admins: the old "add two windows" advice disappears; documented in `PROJECT_CONTEXT.md`.
- Next 16 rules apply: `searchParams`/`params` read inside `<Suspense>` via `<RequireRole>`, `refresh()` after mutations.
- If the trigger is applied later: any insert that overlaps now fails with 23P01, mapped to a clear message; a seed re-run still works
  (it avoids overlaps); Phase 4 batch inserts must lock employees in id order.
- If the audit migration is applied: types regenerated; `assign_employee` becomes the only path that records overrides.
- Time helpers use a fixed +08:00 offset: correct for Manila, wrong if the organisation timezone ever observes daylight saving.
- Concurrency gap remains until Gate S2 is approved and applied; documented in `PROJECT_CONTEXT.md`.
- Overrides are admin-claimed: the database stores what the admin declared and cannot re-verify the violation.
- `EMP-0042` has a real email and a linked login: sanitize or remove before any public demo.
- Weekly hours count a shift in the week it starts (matches the seed).
