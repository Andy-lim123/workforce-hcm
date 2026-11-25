# S2 concurrency protection: read-only audit (2026-11-24) — STATUS: DEFERRED, NOT APPLIED

Decision (user, 2026-11-24): full S2 is deferred because of the Thursday 2026-11-26 delivery. No S2 migration was created or
applied, no database function or trigger was changed, and S1 and Phase 3.3b are exactly as completed. S2 is a separate future
milestone and must NOT be marked complete until it is separately approved, applied and verified.

Decisions on the audit's open points:
- D1 database headcount enforcement: DEFERRED. It would need a change to the S1 function `assign_employee`. The proposed
  transaction-local `set_config` flag is NOT a security boundary (a caller able to run SQL could set a custom setting
  itself), so any future design needs a safer way to carry override authorisation, for example checking inside
  `assign_employee` only, or passing the authorisation as a function argument to a checked routine.
- D2 reject assigning to a cancelled shift in the database: kept as a proposed future protection, not implemented.
- D3 employee status and department checks: stay application-side.
- Lock refinement (`FOR NO KEY UPDATE` instead of `FOR SHARE` / `FOR UPDATE`): deferred with S2.

## What the database enforces today
- One row per (shift, employee) (unique key).
- `ends_at > starts_at`, `required_headcount > 0`.
- `assign_employee` writes the assignment and its audit rows in one transaction; audit rows cannot be updated or deleted by app roles.
- Rule and reason-length checks on audit rows. Admin-only writes by RLS.

## What only the application enforces (and is racy under simultaneous requests)
- Employee overlap, headcount, rest hours, weekly hours, availability, position, department, on leave, inactive.
- Cancelled shifts, attendance locks, past shifts.
- Override set equals the fresh warnings; repeated-character and tab-only reasons; stale-page fingerprint.

## Races that remain possible until S2
1. Two admins assign the same employee to overlapping shifts at the same moment: both can commit (double-booking).
2. Two simultaneous requests fill the last headcount slot: both succeed, no override recorded.
3. Assign versus cancel: an assignment can land on a shift cancelled a moment earlier.
4. Assign versus a shift time edit: each passes its check against the other's old state.
5. Rest, weekly-hours and availability warnings are computed per request; two simultaneous requests can together exceed a limit with no override recorded.
These need two requests within milliseconds of each other. The app does not prevent them; the fingerprint only catches a page that went stale.

## Current objects (read from the live database)
- `shifts`, `shift_assignments`, `schedule_overrides`: no triggers except `set_updated_at` on `shifts`; no `btree_gist` extension; no exclusion constraint.
- `public.assign_employee(uuid, uuid, jsonb)`: security invoker, `search_path = ''`, admin check, unlocked reads, one insert for the assignment, one per audit row. Default isolation `read committed`.
- Baseline data: 0 overlapping pairs, 0 shifts over headcount, 0 assignments on cancelled shifts, 0 department mismatches.

## Proposed S2 design (for the future; SQL draft is Part B of `PHASE3_PROPOSED_SQL.md`, which still needs revising)
- Trigger on `shift_assignments` (before insert, or update of `shift_id, employee_id`): lock the shift row, then the employee row; reject a cancelled shift (D2); reject overlap with errcode `23P01` (touching allowed, same rule as `overlaps()` in `lib/scheduling.ts`); headcount only with a safe override design (D1).
- Trigger on `shifts` (before update of `starts_at, ends_at, status`, not cancelled): lock assigned employees in id order; reject a change that would overlap.
- Lock order is always shift, then employee, then employees by id: no cycle found between any pair of paths. Waits last milliseconds; different employees never block each other. Under `read committed` the second transaction waits and then re-reads; under `repeatable read` or `serializable` it would fail with `40001`.
- Revoke execute on the trigger functions from `public`, `anon`, `authenticated`. Triggers fire for every caller, including the service role.
- Existing rows are not re-checked (the baseline has no violations).

## Regression plan for when S2 is approved
Rolled-back SQL tests (overlap rejected, touching accepted, cancelled rejected, shift time edit into a conflict rejected, edit to a free slot accepted, S1 tests unchanged, audit rows still roll back with a failed assignment, employee and anon refusals unchanged); parallel direct inserts through the service role (`Promise.all`) where exactly one of two overlapping inserts must win; a manual two-tab SQL editor test for the function path; then the 54 unit tests, `tsc`, lint, build, seed check and a browser run.

## Rollback
New migration that drops both triggers and both functions and restores `assign_employee` to the text captured before S2. Data is untouched; overlaps become possible again.
