# Automatic scheduling plan (Phase 4) — PROPOSAL ONLY, nothing implemented

Date: 2026-11-25. Method: reading project files only. No SQL was run, no code, schema or data was changed. Data figures
quoted below come from earlier verified reports in `PROJECT_CONTEXT.md`, not from a new query.

## 1. Requirements

### 1.1 What the GECO brief says (as recorded in `PROJECT_CONTEXT.md` from the user's screenshot)

| Brief text | Where it appears | Weight |
|---|---|---|
| "Customisable scheduling screen controlled by the administrator" | What GECO requires | Requirement (manual scheduling already covers it) |
| "LLM or OR-Tools solver proposes a roster from availability" | Free build path | **Suggestion, not a requirement** |
| "Skills record to fill peak-period gaps with the right staff" | Stretch | Optional |
| Friday demo: admin builds next week's roster; Telegram alert; attendance and overtime dashboard | Friday demo | Automatic scheduling is **not** a demo step |

The user has asked for automatic scheduling to be on the roadmap, so it is planned here. It should be understood as an
addition beyond the brief's stated requirements.

### 1.2 Functional requirements (derived)
- F1. For one Manila week (Monday to Sunday), optionally one department, **propose** employees for open slots on draft shifts.
- F2. Show the proposal before anything is written. The administrator confirms or discards it.
- F3. Show every slot that could not be filled, with the reasons.
- F4. Show the resulting workload per employee so fairness can be judged.
- F5. Write only confirmed proposals. Never publish.

### 1.3 Constraints
- C1. Never create an assignment that has any blocker **or any warning** under `validateAssignment`. The scheduler never overrides.
- C2. Never change or remove an existing assignment.
- C3. Only draft shifts that have not ended and have no attendance records.
- C4. Never fill a shift beyond `required_headcount`.
- C5. Deterministic: the same data gives the same proposal.
- C6. No schema change and no new package without separate approval.

## 2. Audit of what exists

### 2.1 Rules (`lib/scheduling.ts`, pure and already written to be reused by Phase 4)

| Rule | Level today | In automatic scheduling |
|---|---|---|
| already assigned | blocker | excluded |
| employee inactive / on leave | blocker | excluded |
| department mismatch | blocker | excluded |
| overlap with a non-cancelled shift | blocker | excluded |
| outside weekly availability | warning | excluded |
| less than 10 h rest | warning | excluded |
| over `max_weekly_hours` (week the shift starts in) | warning | excluded |
| position mismatch (only when the shift names a position) | warning | excluded |
| over headcount | warning | excluded |

Related helpers: `coveredByAvailability`, `weekBoundsUtc`, `weekStartManila`, `headcountState`, `publishGuard`,
`planWeekPublish`.

### 2.2 Data and code
- Tables used: `shifts` (department, optional position, times, `required_headcount`, status), `employees` (status,
  department, position, `max_weekly_hours`, `employment_type`), `employee_availability` (recurring weekly windows),
  `shift_assignments` (unique per shift and employee).
- Loader: `loadEmployeeData` in `assignment-data.ts` returns employees with availability and **all** their assignments. It
  refuses results of 1,000 rows or more.
- Writes: assignments are created only through `public.assign_employee` (one assignment per call, atomic with its audit
  rows). There is no batch function and **no unassign** in the application.
- `scripts/check-seed-schedule.mjs` already runs `validateAssignment` over a whole schedule, which is a model for tests.

### 2.3 Gaps (do not exist today)
- No proposal engine, preview screen or apply action.
- **Shifts have no required-skill field.** `skills` and `employee_skills` (with proficiency 1–5) describe employees only.
  "Qualifications" can today mean only department and position.
- No date-specific leave or time off: only the employee status `on_leave` and weekly availability.
- No employee preferences, minimum hours or maximum consecutive days.
- No database protection against simultaneous writes (S2 deferred).

## 3. Proposed algorithm

A deterministic greedy scheduler with one limited repair pass, as a pure function in `lib/auto-schedule.ts` that calls
`validateAssignment`. No LLM and no OR-Tools: no new dependency, every choice can be explained, and the problem is small
(about 62 shifts and 33 employees per week). Greedy search is **not guaranteed to find the maximum possible coverage**.

Input: the week's shifts, existing assignments, the candidate employees with availability and all their assignments
(including neighbouring weeks, needed for rest and overlap), and the current time.

1. **Select target shifts:** draft, not ended, no attendance (`publishGuard` conditions), inside the week and department scope.
2. **Open slots:** `required_headcount − assigned`, if above zero.
3. **Working state:** existing assignments plus proposed ones. Every check below sees both, so two proposals cannot
   conflict with each other.
4. **Candidates for a shift:** employees for whom `validateAssignment` returns no blocker and no warning in the working state.
5. **Pick the hardest shift first:** the smallest "candidates minus open slots". Ties: earlier start, then shift id.
6. **Pick the employee for that slot**, in this order of priority:
   1. lowest share of weekly maximum **after** this shift (hours ÷ `max_weekly_hours`), so a 24 h part-timer and a 40 h
      full-timer are loaded proportionally;
   2. fewest shifts already in the week;
   3. least flexible employee first (can fill the fewest other open slots), which keeps versatile people free;
   4. employee code (final tie-break, so results are repeatable).
7. Add it to the working state and return to step 4 until no open slot has a candidate.
8. **Repair pass:** for each still-open slot, look for a single move: employee E could take it if one **proposed**
   assignment of E moved to another eligible employee F. Apply only if coverage rises by one. Existing assignments are
   never moved. Each open slot is tried once.
9. **Report:** proposed assignments, unfilled slots with reasons, and workload per employee.

### 3.1 Fairness
- Measured over the week and including existing assignments: hours, shifts and share of weekly maximum per employee.
- The preview shows each employee's before and after, plus the highest and lowest share in each department.
- Fairness never outranks a constraint, and filling slots comes before balancing: nobody is left off a shift to even out hours.
- Not balanced in this version: weekend or evening shifts, history from earlier weeks, employee preferences.

### 3.2 Understaffing
- An unfilled slot is left empty. No rule is relaxed and no override is created.
- For each unfilled shift the preview lists how many department employees were excluded by each reason (for example
  "5 outside availability, 2 over weekly hours, 1 on leave"). One employee may count under several reasons.
- The administrator can then use the existing manual assignment, including overrides, for those slots.
- A week can still be published while understaffed, with the existing confirmation.

## 4. Safety and data integrity

- **Preview first.** Generating a proposal writes nothing.
- **Apply:** the browser sends only the week, department and a fingerprint. The server re-reads the data, recomputes the
  proposal, compares the SHA-256 fingerprint and refuses if anything differs. Employee and shift pairs are never accepted
  from the browser.
- **Write path (recommended):** one `assign_employee` call per assignment with an empty override list. No schema change and
  the existing single creation path is kept. Consequence: the run is **not atomic**. On the first error it stops and
  reports exactly what was created. Every created assignment was valid, and running again fills the remainder.
- **Duplicates:** prevented by the engine and by the database unique key.
- **Existing schedules:** published, cancelled, ended and attendance-bearing shifts are never targets. Their assignments
  still count toward overlap, rest and hours. Existing manual assignments, including overridden ones, are untouched.
- **Manual workflow:** unchanged.
- **No undo in the application.** Created assignments are permanent for the administrator. Rollback means an owner running
  SQL that deletes exactly the assignment ids returned by the run, so the apply step must show and record those ids.
- **Concurrency (S2 deferred):** a manual change made while the run is writing can produce an overlap, over-headcount or
  rest or hours breach. Only the duplicate assignment is blocked by the database. Mitigation: apply when no one else is
  editing.
- **Limits:** cap one run (proposed: 150 assignments). The loader's 1,000-row guard must be replaced by date-bounded or
  paged queries if data grows.

## 5. Testing strategy

Unit tests on the pure engine (no database):

| # | Case | Expected |
|---|---|---|
| T1 | Enough staff | all slots filled; every result passes `validateAssignment` with no violations |
| T2 | Too few staff | maximum the greedy finds; rest unfilled with correct reasons; no override |
| T3 | Nobody available | nothing proposed; all reasons "outside availability" |
| T4 | Overnight shift and 23:59 window | follows the existing availability semantics |
| T5 | Two overlapping open shifts, one eligible person | only one proposed |
| T6 | Rest under 10 h, including across a week boundary | excluded; exactly 10 h allowed |
| T7 | Weekly maximum, existing hours counted | never exceeded; exactly at maximum allowed |
| T8 | Position required / not required | mismatch excluded only when required |
| T9 | Other department, inactive, on leave | excluded |
| T10 | Already assigned | never proposed twice; filled and over-filled shifts skipped |
| T11 | Published, cancelled, ended, attendance shifts | never targets, still count as conflicts |
| T12 | Fairness: equal candidates, several shifts | hours spread proportionally; part-timer weighted by maximum |
| T13 | Scarce skill of position: one flexible, one restricted employee | both slots filled |
| T14 | Repair pass | a case greedy misses is filled by one move; existing assignments unmoved |
| T15 | Determinism: shuffled input order | identical output |
| T16 | Empty week | empty proposal, no error |

Invariant test: for many generated weeks, replaying the proposal through `validateAssignment` gives zero violations.

Integration and browser tests on **temporary fixture weeks only**: preview writes nothing; stale fingerprint refused;
tampered week or department refused; apply creates exactly the previewed assignments with no audit rows; repeat run
creates nothing new; a forced failure mid-run reports correctly; employee cannot open or invoke it; counts return to
baseline after cleanup. Regression: all existing unit tests, `tsc`, lint, build, seed check, manual assign, override,
publish and employee schedule.

## 6. Implementation roadmap (each phase needs its own approval and ends with a report)

| Phase | Purpose | Outcome | Writes data | Rough effort |
|---|---|---|---|---|
| 4.1 Engine | pure proposal function and tests T1–T16 | proven algorithm, no UI | no | 3–4 h |
| 4.2 Preview | admin "Auto-schedule" view for a week and department: proposal, unfilled reasons, fairness table | demonstrable without risk | no | 2–3 h |
| 4.3 Apply | confirmation, fingerprint, `assign_employee` loop, result and id report | proposals become draft assignments | yes (drafts) | 2–3 h |
| 4.4 Verification | fixture browser tests, regression, docs, counts | signed-off feature | fixtures only | 1–2 h |
| 4.5 Optional | skill requirements on shifts and skill-aware selection (brief stretch) | peak-gap filling | needs schema approval | not estimated |

## 7. Assumptions
- A1. One week at a time; existing weekly maximum and 10 h minimum rest apply unchanged.
- A2. A shift without a position can be filled by any position in the department.
- A3. Draft assignments stay invisible to employees until publishing (existing behaviour).
- A4. The attendance overtime definition is unrelated and unchanged.

## 8. Risks
- Time: the demo is days away; Telegram (a demo step) and the HRMS link (a requirement) are still unbuilt.
- Permanent assignments with no unassign: one bad apply is costly.
- Non-atomic apply and no S2 protection.
- Greedy results may leave a fillable slot empty.
- Real availability is narrow for some employees, so many slots may stay unfilled; the 30 Nov week had 22 understaffed
  draft shifts at the 2026-11-24 check, and how many can be filled without warnings is unknown until the engine runs.

## 9. Decisions — D1 to D9 APPROVED by the user (2026-11-25)

All nine recommendations above were approved:

| # | Decision | Approved |
|---|---|---|
| D1 | Order of work given the deadline | Telegram first, then 4.1 and 4.2; 4.3 only if time remains |
| D2 | Never create assignments with warnings | Yes |
| D3 | Fairness priority in step 6 | As listed |
| D4 | Qualifications = department and position; skills deferred | Yes (skills need a schema change) |
| D5 | Write path: `assign_employee` loop (non-atomic) vs a new batch database function (atomic, schema change) | Loop |
| D6 | Include the repair pass | Yes, but it is the first thing to cut |
| D7 | Run cap of 150 assignments | Yes |
| D8 | Rollback by owner SQL only (no unassign in the app) | Accept for now |
| D9 | Real 30 Nov week: preview only during testing and demo | Yes; apply only on fixtures |

## 10. Approved order and conditions (replaces the order in section 6 where they differ)

Revised 2026-11-25: HRMS moved ahead of automatic scheduling.

1. Telegram integration (plan in `TELEGRAM_PLAN.md`).
2. HRMS integration.
3. Automatic scheduling engine (4.1), **without** the repair step.
4. Preview (4.2): proposed assignments, uncovered slots, exclusion reasons. It must be useful on its own even if apply is never built.
5. Apply (4.3) only if time permits and partial-write handling is in place.
6. Final demonstration and regression testing.

Conditions: existing scheduling rules and database structure preserved; no skill-based qualification system; the repair step is
built only after the basic engine and preview work; the 150-assignment cap is enforced; the real 30 November week is strictly
preview-only and apply runs on test shifts only; a partial apply reports every successful and failed assignment and never
silently retries one that may have succeeded; existing assignments are preserved; the overtime definition is unchanged; each
phase stops for review. Automatic scheduling has NOT been started.

## 11. Phase 4.1 status (2026-11-25)

Implemented as designed in section 3 except step 8 (repair), which is omitted under D6. Differences: "hardest first" and fairness are as written; the rule functions are passed into the engine as an argument. Results and limitations are in `PROJECT_CONTEXT.md`.

## 12. Phase 4.2 status (2026-11-25)

Preview screen built at `/admin/schedules/auto`, read only, no apply. Employee access refused (browser test passed). Details in `PROJECT_CONTEXT.md`. Phase 4.3 is not approved.
