# PROJECT CONTEXT — Workforce Management System (WMS)

> **AI assistant: read this whole file before doing anything.** It is the single source of truth
> for this project. Follow the rules in section 1. At the end of every session, update the
> sections marked 🔄 (see section 11). Last updated: **2026-11-24**.

---

## 0. How to use this file (for the human)

1. Start every new chat by pasting the **Session start prompt** below, then this whole file
   (or attach it).
2. At the end of the chat, ask: **"Update PROJECT_CONTEXT.md per section 11."** Save the new
   version over this file.
3. Keep this file in the repo root (`0-3_hcm/PROJECT_CONTEXT.md`). Never put secrets in it.

**Session start prompt (copy and paste):**

```
You are continuing my Workforce Management System project. The attached PROJECT_CONTEXT.md is the
source of truth. Read it fully. Follow section 1 (rules) and run the section 2 checklist before
writing code. If anything I ask conflicts with this file, say so and ask before acting.
Today's task: <describe the task>
```

---

## 1. Rules for the AI (anti-hallucination)

1. **Do not guess.** If you have not seen a file, function, table or column in this chat, say
   "I need to see X" and ask for it. Never invent file contents, APIs, column names or versions.
2. **This is Next.js 16.4.6, not the Next.js you know.** APIs differ from older versions.
   Before using a Next.js API, check `node_modules/next/dist/docs/` or ask me to paste the
   relevant doc. See section 5 for confirmed rules.
3. **Use what exists.** Check section 7 (file map) for an existing helper or component before
   writing a new one. Do not add npm packages without asking.
4. **Database:** do not change the schema, RLS policies or triggers without explicit approval.
   Propose the SQL first and explain why.
5. **Security is never optional:** every Server Action calls `requireRole("admin")` (or checks
   the user) first; validate all input on the server; the secret key is server-only.
6. **Never claim something works unless it was run.** Say "not tested" when you have not run it.
   Tests I run and paste back count; your assumptions do not.
7. **Small steps.** One feature per step. After each step list: files changed, what to test,
   and the exact commands to run.
8. **Give whole files or exact edits.** When editing, show the exact existing lines being
   replaced, so I can find them. Say the file path every time.
9. **Fictional data only.** All people and companies are fictional; emails use `example.com`.
10. **If unsure, ask one clear question** instead of picking silently.
11. **Record test provenance accurately.** Write "run by Claude" only for tests Claude actually executed; write
    "user-confirmed" for results the user reported. Never present a user report as independent verification.

---

## 2. Checklist before writing code (run every time)

- [ ] I read this whole file in this chat.
- [ ] I know which phase/step the task belongs to (section 9).
- [ ] I have seen the current contents of every file I will change (asked the user to paste it if not).
- [ ] I checked section 7 for existing helpers/components to reuse.
- [ ] I checked section 5 for the Next.js 16 rules that apply.
- [ ] The change needs no schema/RLS change, or I asked for approval first.
- [ ] Every new Server Action checks the role and validates input on the server.
- [ ] No secret key or service-role client is imported into a `"use client"` file.

## 3. Checklist after writing code (run every time)

- [ ] Listed every file changed or created, with full paths.
- [ ] Told the user to run: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- [ ] Gave manual browser test steps for the feature.
- [ ] Marked anything not tested as **not tested**.
- [ ] Listed remaining risks or follow-ups.
- [ ] Updated this file per section 11.

---

## 3a. Commands

```
npm install                 # install dependencies
npm run dev                 # dev server at http://localhost:3000
npm run lint                # ESLint
npx tsc --noEmit            # typecheck
npm test                    # unit tests: node --test "scripts/*.test.mjs" (validation + scheduling)
npm run seed:check          # READ-ONLY: validates every seeded assignment with lib/scheduling.ts (needs secret key)
npm run build               # production build (must pass before a step is "done")
npm run demo:accounts       # create demo logins (needs secret key + DEMO_* vars)
```

---

## 4. Project summary

- **What:** portfolio/demo workforce management app: employees, departments, positions, skills,
  availability, shift scheduling, attendance, reports. Not tied to any real organisation.
- **Roles:** `admin` (manages everything, `/admin/*`) and `employee` (own data, `/me/*`).
- **Timezone:** `Asia/Manila` for all demo dates and times.
- **Stack (exact):** Next.js 16.4.6 (App Router, Cache Components, Turbopack), React 19.3.0,
  TypeScript 5, Tailwind CSS 4.3.3, `@supabase/supabase-js` ^2.119, `@supabase/ssr` ^0.12.
  Node 24. No other UI libraries.
- **Supabase project:** `HCM`, ref `yzjrtnqmnjvuwyyrnnfc`, region `ap-northeast-1`, free plan.

### Environment variables (`.env.local`, gitignored — never commit, never paste in chat)

| Name | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | server only | `sb_secret_...`, 41 chars; never `NEXT_PUBLIC_` |
| `TELEGRAM_BOT_TOKEN` | server only | Telegram bot; set by the owner |
| `HRMS_API_KEY` | server only | read-only HRMS API, at least 32 characters; unset = API off (`HRMS_API.md`) |
| `DEMO_ADMIN_EMAIL`, `DEMO_PASSWORD` | `scripts/create-demo-accounts.mjs` only | optional |

After editing `.env.local`, **restart** `npm run dev`; Next only reads it at startup.

---

## 5. Next.js 16 rules confirmed in this project (do not "fix" these)

- `next.config.ts` has `cacheComponents: true` and `partialPrefetching: true`.
- **Middleware is `proxy.ts`** (exports `proxy`), not `middleware.ts`. It calls
  `lib/supabase/proxy.ts` `updateSession()` to refresh the session and redirect signed-out users.
- Anything reading cookies, `params`, `searchParams` or `usePathname()` must be inside
  `<Suspense>`, or the build fails ("blocking prerender"). Pattern used everywhere:
  page renders `<RequireRole role="admin">` (which has Suspense) and an inner `async` component
  awaits `params`/`searchParams`.
- `lib/supabase/server.ts` calls `await connection()` before creating the client (required).
- Page props: use the global `PageProps<"/route/[id]">` type; `params` and `searchParams` are Promises.
- After a mutation in a Server Action, call `refresh()` from `next/cache` to update the current
  page, or `redirect()` to go elsewhere.
- `proxy.ts` must **not redirect Server Action POSTs** (requests with a `next-action` header):
  the client throws "An unexpected response was received from the server". Actions check auth
  themselves with `requireRole()`.
- Role check must be in the **page** (via `<RequireRole>`), not only the layout.
- Forms: Server Actions + `useActionState`. `components/action-form.tsx` `ActionForm` submits via
  `onSubmit` + `startTransition` so fields are not cleared on validation errors.

---

## 6. Database (Supabase Postgres) — do not change without approval

Source: `supabase/migrations/20261124015908_core_schema.sql`,
`supabase/migrations/20261124020354_link_employee_on_verified_email.sql`, seed `supabase/seed.sql`.
TypeScript types: `lib/supabase/database.types.ts`.

**Enums:** `app_role` (admin, employee) · `employment_type` (full_time, part_time, contract) ·
`employee_status` (active, on_leave, inactive) · `shift_status` (draft, published, cancelled) ·
`attendance_status` (present, late, absent, excused).

**Tables (12; `schedule_overrides` added by S1):**

| Table | Key columns / rules |
|---|---|
| `profiles` | `id` = auth user id, `email`, `full_name`, `role` (default employee) |
| `departments` | `name` unique |
| `positions` | `department_id` NOT NULL (cascade), `title`; unique (department_id, title) |
| `skills` | `name` unique |
| `employees` | `employee_code` unique, `email` unique (lower), `profile_id` unique nullable (login link), `department_id`, `position_id` (set null), `employment_type`, `status`, `hire_date`, `max_weekly_hours` |
| `employee_skills` | PK (employee_id, skill_id), `proficiency` 1–5 |
| `employee_availability` | `day_of_week` 0=Sun..6=Sat, `start_time` < `end_time` (CHECK) |
| `shifts` | `department_id` (cascade), `position_id`, `starts_at`, `ends_at`, `required_headcount`, `status` |
| `shift_assignments` | unique (shift_id, employee_id) |
| `attendance_records` | `employee_id`, `work_date`, `clock_in`, `clock_out`, `status` |
| `notifications` | `recipient_id`, `read_at` |
| `schedule_overrides` | append-only audit of overridden scheduling warnings: `overridden_by`, snapshots (`overridden_by_email`, `shift_title`, `shift_starts_at/ends_at`, `employee_code`), `rule` (5 overridable ids), `reason` (10–500 chars), `detail`; admin-only select and insert-as-self, no update/delete. RPC `public.assign_employee(shift, employee, overrides jsonb)` (security invoker, admin-only) writes the assignment and its audit rows in one transaction. |

**RLS:** enabled on all tables. Helpers in schema `private`: `is_admin()`, `current_employee_id()`,
`is_assigned_to_shift()`. Admins write everything; employees read their own employee row,
skills, attendance and published assigned shifts; employees manage their own availability.
Reference tables (departments, positions, skills) readable by any signed-in user.

**Triggers:**
- New auth user → profile row with role `employee` (never from metadata).
- Login is linked to the employee with the same email **only after the email is verified**
  (`private.link_employee`).
- Only admins can change `profiles.role` through the API.

**Seed counts (live DB, 2026-11-24):** 5 departments, 14 positions, 16 skills, 33 employees,
71 employee skills, 153 availability windows, 186 shifts, 330 assignments, 132 attendance records.

**Deleting a department cascades** to positions and shifts → the app blocks deletion while any
employees, positions or shifts reference it.

---

## 7. File map (reuse these) 🔄

| Path | What it is |
|---|---|
| `proxy.ts`, `lib/supabase/proxy.ts` | session refresh + signed-out redirect |
| `lib/supabase/server.ts` | `createClient()` for Server Components/Actions (user session, RLS applies) |
| `lib/supabase/client.ts` | browser client |
| `lib/supabase/admin.ts` | `createAdminClient()` secret-key client, **server only**, returns null if key missing |
| `lib/auth.ts` | `getCurrentUser()`, `requireRole(role)`, `homeFor(role)` |
| `lib/labels.ts` | enum labels, `DAY_LABELS`, `ORG_TIMEZONE`, `todayInOrg()`, `formatDate()` |
| `lib/validation.ts` | `parseEmployee`, `parseWindow`, `findOverlap`, `searchTerms`, `isUuid` (pure, unit-tested) |
| `app/admin/schedules/assignment-data.ts` | shared server loader and fingerprint for assignment (3.3a): `loadShiftState`, `loadEmployeeData`, `assignmentContext`, `fingerprintAssignment` |
| `app/admin/schedules/actions.ts`, `shift-form.tsx`, `new/page.tsx`, `[id]/page.tsx` | shift lifecycle (3.2): `createShift`, `updateShift` (draft direct, published preview + confirm), `cancelShift`; no delete |
| `app/admin/schedules/page.tsx`, `week-grid.tsx`, `loading.tsx` | read-only week view (3.1): page reads `?week=` / `?department=`, queries shifts whose start falls in the Manila week with `shift_assignments(count)`; `WeekGrid` renders the 7 days |
| `lib/scheduling.ts` | Phase 3 rules engine, pure (also week-view helpers `resolveWeek`, `formatDayHeading`, `weekRangeLabel`, `formatTimeRange`, `headcountState`, `shiftsByDay`): `validateAssignment`, `validateShiftEdit`, `checkOverrides`, `coveredByAvailability`, Manila helpers (`toManilaParts`, `fromManila`, `weekStartManila`, `weekBoundsUtc`, `weekDays`, `addDays`), `RULE_IDS`, `OVERRIDABLE_RULES`, `END_OF_DAY_WINDOW`, `OVERNIGHT_HELP`. No imports; Node runs it directly. |
| `components/app-shell.tsx` | `AppShell`, `RequireRole` (Suspense + role gate) |
| `components/ui.tsx` | `inputClass`, `buttonClass`, `Field`, `Badge`, `Card`, `EmptyState`, `Alert`, `BackLink`, `DescriptionList` |
| `components/action-form.tsx` | `ActionForm`, `ActionState`, `SubmitButton`, `ConfirmSubmit` (modal), copyable one-time link |
| `components/placeholder.tsx` | `PageHeader`, `Placeholder` (unbuilt pages) |
| `app/login/*` | sign-in / sign-out |
| `app/auth/accept/*` | accepts one-time invite token (token in URL `#fragment`) |
| `app/auth/set-password/*` | user sets own password after invite |
| `app/admin/employees/*` | directory, `new`, `[id]` profile, `[id]/edit`, `actions.ts` |
| `app/admin/departments/*`, `app/admin/positions/*` | CRUD pages + `actions.ts` |
| `app/admin/schedules/override-form.tsx` | client `OverrideFields` for 3.3b: one reason box per warning, client-side hints only (the server re-validates everything) |
| `scripts/validation.test.mjs`, `scripts/scheduling.test.mjs` | unit tests (57 total) |
| `scripts/check-seed-schedule.mjs` | read-only seed conformance check + forced-violation checks (`npm run seed:check`) |
| `scripts/create-demo-accounts.mjs` | demo login creation |
| `PHASE3_PLAN.md` | Phase 3 plan v2: decisions, rules, milestones, gates, tests (plan only) |
| `supabase/migrations/20261124101712_schedule_overrides_audit.sql` | S1 audit migration (applied as `schedule_overrides_audit`) |
| `PHASE3_PROPOSED_SQL.md` | proposed audit-trail and double-booking SQL, **not applied**, not in `supabase/migrations/` |

**Conventions:** Server Action returns `ActionState` `{ error?, success?, fieldErrors?, link?, done? }`.
Every action: `await requireRole("admin")` → validate → write with user client (RLS) → `refresh()`.
Map Postgres errors: `23505` unique, `23503` FK, `23514` check.

---

## 8. Decisions log (why things are the way they are) 🔄

| Date | Decision |
|---|---|
| 2026-11-24 | Employee records are separate from logins; creating an employee never creates a login. |
| 2026-11-24 | Positions are referenced by `position_id`, never free text; server checks position belongs to department. |
| 2026-11-24 | Logins are created by **one-time invite links** (Supabase `generateLink`), shown once with a copy button, never stored. No temporary passwords. |
| 2026-11-24 | Invite token travels in the URL fragment (`/auth/accept#token_hash=...`) so it never hits server logs; user clicks Continue to verify. |
| 2026-11-24 | Account states shown: No login · Invited · Registered not linked · Linked (password not set) · Linked active · Disabled. Invited ≠ activated. |
| 2026-11-24 | Disable access = Supabase ban (`ban_duration`), employees only, never admins. |
| 2026-11-24 | Availability windows: same-day only, no overlaps (touching OK), validated on server. The Phase 2 advice "overnight = two windows" is **superseded** by the 23:59 rule in the next rows. |
| 2026-11-24 | **Overnight availability (Phase 3, approved):** all times Asia/Manila. A same-day shift is covered by one window on that weekday with `start <= shift start` and `end >= shift end`. An overnight shift (ends on a later Manila date) is covered by one window on the **start day** with `start <= shift start` and `end >= 23:59`; the next day's windows are not consulted. So a window ending 23:59 means "available from its start through the end of the day and overnight until the next morning". A window ending earlier never covers an overnight shift; shifts over 24 h are never covered. Matches the seed (19 of 19 overnight assignments valid; a strict two-window reading would fail all 19). Editor text, `parseWindow` message, validator and tests must all use the single constant `END_OF_DAY_WINDOW`. |
| 2026-11-24 | Department/position deletion blocked while referenced; never cascade silently. |
| 2026-11-24 | Phase 3 direction approved (plan v2 in `PHASE3_PLAN.md`): manual scheduling only; **blockers** = overlap, inactive/on-leave, department mismatch, already assigned; **warnings with admin override** = outside availability, under 10 h rest, over weekly hours, position mismatch, over required headcount; editing published shifts needs confirmation naming affected employees; notifications deferred to Phase 5; all rules centralised in `lib/scheduling.ts`; Manila week = Monday–Sunday. |
| 2026-11-24 | **Overrides require an audit trail first.** Audit record = admin, employee, shift, rule, reason, timestamp. Schema proposed in `PHASE3_PROPOSED_SQL.md` part A, **not applied**. Until it is approved and applied, overrides stay disabled (warnings refuse assignment). |
| 2026-11-24 | **No double-booking trigger or any schema change until the user explicitly approves it.** |
| 2026-11-24 | **S1 applied.** Audit trail table and atomic `assign_employee` RPC are live. Null or empty `p_overrides` means no overrides (assignment still made); a non-array value, an unknown rule or a bad reason rolls back the whole call. Overrides stay disabled in the app until 3.3b. |
| 2026-11-24 | **Week view (3.1):** a shift belongs to the Manila day (and week) it STARTS in; an overnight shift shows "(+1)". Understaffed = not cancelled and fewer people assigned than required (unfilled = 0 assigned). "Positions filled" sums min(assigned, required). Cancelled shifts are shown but excluded from the summary counts. |
| 2026-11-24 | **Shift lifecycle (3.2):** no shift deletion for now. Edits that introduce a new or worse problem for an assigned employee are refused (overrides only via `assign_employee` in 3.3b); shifts with attendance are locked (time, department, position, cancel). Cancelled is terminal (no reopen). Published-shift edits require confirming the exact previewed state. Warning severity is compared with `Violation.measure` (bigger is worse). |
| 2026-11-24 | **Assignment (3.3a):** candidates are the shift's department only (presentation; the server still judges department itself); no unassign, replacement or direct assignment delete (deferred with shift deletion: destructive, race with attendance links); assignments are refused on cancelled shifts, shifts with attendance and shifts that already ended; published-shift assignments require a confirmation; assignment goes only through `assign_employee` with an empty override list. |
| 2026-11-24 | No public sign-up page. Admin created manually; role set via SQL by project owner. |

---

## 9. Progress checklist 🔄

### Phase 1 — Foundation ✅
- [x] Next.js app, Tailwind, Supabase SSR auth, admin/employee route groups
- [x] 11 tables, RLS, triggers, seed data
- [x] Demo account script

### Phase 2 — Employee Management ✅ COMPLETE (2026-11-24)
- [x] 2.1 Directory: search, filters (dept/position/status/login), sort, pagination, count, row actions
- [x] 2.2 Add / edit employee with server validation, duplicate ID/email checks
- [x] 2.3 Profile: personal, employment, skills, availability, account status
- [x] 2.4 Departments: list, add, edit, counts, safe delete
- [x] 2.5 Positions: list, add, edit, safe delete, department lock while staffed
- [x] 2.6 Skills assign/remove/proficiency; availability add/edit/remove
- [x] 2.7 Invite link + accept + set password; link existing login; disable/restore
- [x] Build, lint, typecheck, unit tests (6/6), RLS SQL checks pass
- [x] 2.8 Browser tests — **user-confirmed working** (2026-11-24): the user reported all 13 behaviours work. Claude did **not**
      run these browser tests and has not independently verified them. Claude's own checks were build, lint, typecheck,
      unit tests, a secret-scan of the client bundle and rolled-back RLS SQL tests.

**2.8 browser test cases** (all 13 are **user-confirmed**, not run by Claude; future entries must say "run by Claude" or "user-confirmed"):
- [x] 1. Directory loads all 33 seeded employees
- [x] 2. Search works (name, ID, email)
- [x] 3. Department and position filters work
- [x] 4. Create employee works (and duplicate ID is rejected)
- [x] 5. Edit employee works
- [x] 6. Profile shows correct information
- [x] 7. Skill assign / remove works
- [x] 8. Availability add / edit / remove works (overlap and overnight rejected)
- [x] 9. Department create / edit works (delete blocked while in use)
- [x] 10. Position create / edit works (delete blocked while in use)
- [x] 11. Invite link → accept → set password → employee lands on `/me` and is linked
- [x] 12. Employee login cannot open `/admin/*`
- [x] 13. Changes persist after refresh

### Phase 3 — Workforce Scheduling ⏳ (final plan v2 in `PHASE3_PLAN.md`; **awaiting explicit approval to start 3.0 — Gate 0**)
- [x] 3.0 `lib/scheduling.ts` + unit tests + seed conformance check + availability text aligned to the 23:59 rule — **run by Claude, 2026-11-24:** 28/28 unit tests, `npm run seed:check` PASS (330 assignments incl. 19 overnight: 0 blockers, 0 warnings; each of the 10 rules fires alone when forced), lint 0 problems, `tsc` clean, production build passes. **Gate 1 browser regression, run by Claude in the signed-in Browser pane as admin (2026-11-24):** directory loads (34 employees, filters, View/Edit/Manage actions); departments page and positions page load with correct counts; employee profile loads; availability editor shows the new 23:59 help text; **edit and save** a window ("Availability updated."); **overlap** rejected with "This overlaps the existing Wednesday window 06:00–22:00…" and no row written; **reversed 22:00–06:00** rejected with the new "end the window at 23:59" message and no row written; **add** a window (row created); **remove** a window via the confirmation dialog (row deleted). Earlier user-confirmed screenshots agree. Browser console showed only dev-server HMR WebSocket errors (pane tooling, not the app); dev server log had 0 errors. Test data: EMP-0001 had lost its seeded Saturday 06:00–22:00 window and had a test Saturday 09:00–17:00 instead; Claude restored it by editing to 06:00–22:00 (part of the edit test), added and removed a Monday test window, so EMP-0001 again has exactly its 5 seeded windows (Sun, Wed, Thu, Fri, Sat 06:00–22:00). Database otherwise unchanged: 2 migrations, 11 tables, no `schedule_overrides`, no `assign_employee`, no triggers. **Gate 1: PASSED.** Awaiting user instruction; S1, S2 and 3.1 not started.
- [x] S1 audit migration — **run by Claude, 2026-11-24:** SQL verified against the live schema; 2 rolled-back test transactions (constraints, RLS, grants, RPC, atomic rollback, non-admin and anon access, real employee account); applied as `schedule_overrides_audit`; types updated; post-apply rolled-back re-check passed; security advisor shows no new findings; 29/29 unit tests, `tsc`, lint, build and seed check pass. **Application-level overrides are still disabled (3.3b not built).**
- [x] 3.1 Admin week view (read-only) — **run by Claude, 2026-11-24:** `/admin/schedules` replaces the placeholder: Manila Monday–Sunday grid, `?week=` (any valid date selects its week; invalid falls back to this week with a notice) and `?department=` (non-UUID ignored), Previous / This week / Next links that keep the department, a date-jump + department form (GET), week summary (shifts, published/draft, positions filled, understaffed, fully staffed), per-shift time (with +1 for overnight), title, department · position, Draft/Published/Cancelled badge, headcount badge (filled / short N / unfilled / +N over), Today marker, empty / error / loading (`loading.tsx` plus the existing `Loading…` fallback) states. **Read-only:** the only form is a GET filter; shift cards have no links or buttons. Verified in the signed-in Browser pane against numbers computed directly from the database: week 16 Nov 62 shifts (62 published), 114/127 filled, 9 understaffed, 2 unfilled; week 23 Nov identical; week 30 Nov 62 draft, 102/127, 22 understaffed, 6 unfilled; Customer Support 23 Nov 14 shifts 35/42 5 understaffed; Retail 23 Nov 24/28 2 understaffed 2 unfilled; Customer Support 30 Nov 34/42 6 understaffed; empty week 7 Dec and empty department state; invalid week 2026-02-30 and non-UUID department handled; Previous/Next clicks and the date-jump form (26 Nov selects the 23 Nov week); Monday-morning Manila shifts that start on UTC Sunday (Morning Support, Warehouse Day, Maintenance) sit on Monday, Sunday 22:00 Night Security stays on Sunday as 22:00–06:00 (+1). 36/36 unit tests, `tsc`, lint and production build pass. DB unchanged (3 migrations, 0 audit rows, 330 assignments, no shift updated). Not verified: the `loading.tsx` skeleton itself was not seen on screen; the 4-column layout (only 2-column and 7-column were seen).
- [x] 3.2 Shift create / edit / cancel — **run by Claude, 2026-11-24.** `/admin/schedules/new` (always creates a draft; separate Manila start and end dates so overnight is explicit; end after start, max 24 h, headcount 1–50, title 2–80, notes ≤ 500; position must belong to the department), `/admin/schedules/[id]` (details, assigned employees read-only, edit form, cancel), "New shift" button and shift-card links on the week view. **No delete** (user decision: a check-then-delete would race with a concurrent assignment and the cascade would remove it; deletion stays out of the UI and actions until a safe atomic mechanism is separately approved). Edit rules: cancelled shifts cannot be edited; the form carries `expected_updated_at` and a changed shift is refused; shifts with attendance records cannot change department, position or times (title, notes, headcount still can) and cannot be cancelled; every assignee is re-judged with `assessShiftEdit`: a new or WORSE problem (blocker or warning) refuses the save, unchanged existing problems are tolerated and shown, nothing is removed. Draft edits save directly; published edits first return a preview (before/after values, every affected employee by name and code, unchanged existing issues) and save only when that exact state is confirmed: the server recomputes a SHA-256 fingerprint over the shift version, new values and every assignee's rule inputs, so a changed form, shift or assignee data is rejected as stale. Cancel keeps all assignments and attendance and hides the shift from employees (existing RLS). No overrides in 3.2 (deferred to 3.3b). Verified: 44/44 unit tests (15 new), `tsc`, lint, production build, seed check PASS; rolled-back SQL checks (admin create/edit/cancel, employee cannot insert/update/delete shifts, cancel keeps assignments, cancelled shift hidden from the employee); browser checks in the signed-in pane with throw-away test shifts: validation errors and kept input, create (UTC stored correctly, created_by = admin), overnight with position (22:00–06:00 (+1)), draft edit, published preview with affected employees, stale preview rejected (assignee data changed) and a fresh one accepted, new overlap refused, worse rest refused, better rest allowed, headcount below assigned refused, new availability problem refused, stale page refused, cancel draft and cancel published (2 assignments kept, week view shows Cancelled, summary excludes cancelled), attendance lock in the UI and a tampered start time refused by the server (seeded shift unchanged), 3 seeded weeks and Facilities filter still match, employee profile and availability text unchanged. Test shifts removed afterwards; counts returned exactly to the baseline. **Not verified:** server refusal of cancelling a shift with attendance (the UI hides the button, code reviewed only); the headcount message wording fix was verified by unit tests, not re-seen in the browser; 4-column layout and the loading skeleton were not seen.
- [x] 3.3a Assign employees (NO unassign; blockers and any warning refuse; overrides disabled) — **run by Claude, 2026-11-24.** The shift page `/admin/schedules/[id]` has an "Assign an employee" card for draft and published shifts: candidates are the shift's DEPARTMENT only (with a count of the excluded other-department employees), sorted eligible, then warning, then blocked, then fewest hours that week; each row shows name, code, position, status, hours already assigned that Manila week against the maximum, a verdict in words and every blocker/warning message; only fully eligible rows get an Assign button (a confirmation dialog for published shifts, because the employee sees the shift immediately). Assigned employees show their current rule issues. `assignEmployee` re-reads everything on the server and refuses, in order: bad ids, shift missing, shift guards (cancelled, attendance records exist, already ended), the employee (loaded on its own, so a department mismatch is judged server-side too), any blocker or any warning (explained), a missing published confirmation field, a stale fingerprint; it then calls ONLY the S1 function with `p_overrides: []` (no audit rows are written for ordinary assignments). No direct insert or delete on `shift_assignments` exists in app code (grepped). The fingerprint (shift version/status, assigned ids, attendance, the employee row, availability, other shifts) is a stale-state safeguard, not a concurrency guarantee. Verified: 48/48 unit tests (4 new), `tsc`, lint, production build, seed check PASS; rolled-back SQL (RPC with `[]` creates the assignment with `assigned_by` and 0 audit rows, duplicate 23505, employee and anon 42501 on the RPC and on direct insert, assignment visible to the employee only on a published shift); browser checks on throw-away December shifts: panel contents and ordering with the right messages (on leave, overlap, availability), assign on a draft, headcount warning after a 1-person shift was filled (no button for anyone else), published dialog and assignment, published confirmation field removed by tampering (refused), stale page refused after an assignee's availability changed, server guards refused after the shift was cancelled, moved into the past, and given attendance (the UI had been loaded before each change), panel replaced by the reason on a seeded attendance shift, panel absent on a cancelled shift, week view counts correct. Test data removed and counts returned exactly to the baseline. **Not verified:** server-side department-mismatch refusal in the browser (the bound employee id cannot be tampered with from the page; covered by the shared rule tests and by the action loading the employee on its own); the 23P01 message path (needs S2); concurrent requests.
- [x] 3.3b Warning overrides with required reasons and audit trail — **run by Claude, 2026-11-24.** New separate Server Action `assignEmployeeWithOverrides`; the clean `assignEmployee` path is unchanged (empty override list, no audit rows). Order on the server: role and ids, shift guards, employee loaded alone, fresh validation, HARD BLOCKERS refused before any override data is read (never overridable), no-warnings refused, published confirmation field, stale fingerprint, `shown_rules` must equal the fresh warning set, then `matchOverrides` (no missing, duplicate, extra or unknown rule; every reason valid), then ONLY the S1 function `assign_employee` with the server-built payload. The browser supplies reasons only; rule ids and the audit `detail` (the warning text, max 500) are generated by the server. UI: warning-only rows get an "Override the warnings and assign…" panel with one reason box per warning and a confirmation dialog listing every warning and reason; blocked rows have no form; the shift page has a read-only "Override history" card (rule, employee, time, reason, warning text, recorded by; no controls). **Reason rules, exactly what enforces what:** DATABASE-enforced (verified against the applied SQL): rule is one of the five warning ids, reason 10 to 500 characters after trimming spaces, detail at most 500, not-null columns, atomic with the assignment, no update or delete of audit rows by app roles. APPLICATION-enforced only (the database does NOT check them): override set equals the fresh warning set, no duplicates, blockers refuse everything, whitespace-only reasons incl. tabs, a reason that is one repeated character. Shift-edit overrides stay out of scope. **Concurrency limit unchanged until S2:** an override is recorded against warnings computed at read time; two simultaneous requests can still overlap shifts or exceed headcount; the database guarantees only unique (shift, employee) and the atomic RPC. S2 is NOT applied. Verified (run by me): 54/54 unit tests (6 new, including a parity test against the migration's rule list), `tsc`, lint, production build, seed check (330 assignments, 19 overnight) PASS; rolled-back SQL (exact 5-rule payload creates the assignment and 5 audit rows with correct snapshots and actor; database accepts repeated-character, tab-only, duplicate-rule and non-real-warning payloads, which is why the app enforces them; database rejects space-only, 9-char, 501-char, blocker and unknown rule ids, missing reason, 501-char detail; a bad item after a good one rolls everything back; duplicate assignment 23505 with no audit rows; employee and anon 42501; admin cannot update or delete audit rows); browser checks on throw-away December shifts: blocked rows have no form; button disabled until reasons are valid and a dialog confirms; server refused empty, spaces, tabs, repeated-character, short and oversize reasons, an extra, unknown, duplicate or missing reason field, a wrong rule key, tampered `shown_rules`, a blocker (on leave set after page load) and a department change after load, even with valid reasons, a stale fingerprint, and a removed `published_ack` on a published shift; no rows were written by any refusal. Real UI overrides each created the assignment and exactly the expected audit row(s): outside_availability, insufficient_rest, exceeds_weekly_hours, position_mismatch, over_headcount, and two warnings at once on a published shift (2 rows); a clean eligible assignment still wrote no audit row; history card showed the entries read-only. All test shifts, assignments and the test audit rows were removed afterwards (the audit rows by the database owner via SQL, since app roles cannot delete them) and EMP-0002's `max_weekly_hours` was restored to 40. Counts returned exactly to baseline: 186 shifts (62 draft, 124 published, 0 cancelled), 330 assignments, 0 audit rows, 132 attendance, 34 employees, 158 availability windows. **Not verified:** the 23P01 overlap error message path (needs S2); concurrent requests; the history card's rendering with many entries or very long reasons; the two-warning dialog was exercised by script-driven clicks on the real buttons, not by hand.
- [x] 3.4a Publish / unpublish one shift — **run by Claude, 2026-11-24.** Actions `publishShift` and `unpublishShift` (admin-only, one shared `changeShiftStatus`, no SQL or schema change) with a Publish / Unpublish card and confirmation dialog on `/admin/schedules/[id]`. Rules (`publishGuard`, `unpublishGuard` in `lib/scheduling.ts`): only a draft that has not ended and has no attendance can be published (cancelled and already-published refused); only a published shift with no attendance can be unpublished (attendance would be hidden from the employee). Stale checks: the page sends the shift's `updated_at` and the assigned count it showed; the server refuses if either differs, and the single UPDATE is also guarded by the status and `updated_at` it judged. Understaffed shifts are a warning, not a blocker: amber notice plus the dialog, and the server requires `understaffed_ack=yes` when assigned < headcount. Assignments are never changed. Verified (run by me): 56/56 unit tests (2 new), `tsc`, lint, production build, seed check PASS; browser (throw-away shifts TEST P1/P2, 4–5 Jan 2027): removed understaffed confirmation, wrong assigned count and stale `updated_at` each refused with nothing written; real publish through the dialog (status became published in the database); stale unpublish refused; real unpublish through the dialog (back to draft); the seeded shift "Dispatch Desk" (has attendance) shows no unpublish button, only the reason. Test shifts removed; counts returned exactly to baseline (186 shifts: 62 draft, 124 published; 330 assignments; 0 audit rows; 132 attendance; 34 employees; 158 availability windows). **Not verified:** server-side refusal of unpublishing a shift with attendance by tampering (the UI renders no form, covered by unit tests only); publishing an already-ended draft in the browser (unit-tested only); an employee actually seeing or losing the shift (3.5); concurrent requests (S2 deferred).
- [x] 3.5 Employee schedule `/me/schedule` — **run by Claude, 2026-11-24 (the user signed in as the real EMP-0042 account in the Browser pane; I never entered a password).** Employee-only page (`requireRole("employee")`): a Monday–Sunday week in Asia/Manila with previous / this week / next links (`?week=`, an invalid date falls back to the current week with a notice), a shifts and hours summary, and per day the shifts with time range, name, department, position, hours and badges (Published, and Upcoming / In progress / Completed; Today on the day heading). The query asks only for the signed-in employee's own assignments on `published` shifts (explicit `employee_id` and `status` filters on top of the existing RLS), so a draft or cancelled shift can never be listed. States: empty week, "account not linked to an employee record", load error, loading skeleton (`loading.tsx`). No admin controls. No SQL or schema change; nothing published. Verified (run by me): 57/57 unit tests, `tsc`, lint, production build (`/me/schedule` prerendered shell), seed check PASS; rolled-back SQL as EMP-0042's profile: the account sees exactly 2 shifts (26 and 27 Nov, published), 2 assignments, 1 employee row, 0 drafts, 0 overrides, is not admin; a signed-in user with no employee record sees 0 of everything. Browser as the real EMP-0042: the week of 23 Nov shows Thu 26 and Fri 27 Nov Evening Support, 14:00–22:00, Customer Support, 8.0 h each, 2 shifts and 16.0 h; the week of 30 Nov shows "No shifts this week" even though EMP-0042 has two DRAFT assignments there (3 and 4 Dec), so drafts stay hidden; a direct URL to `/admin/schedules` and to an admin draft-shift page redirected to `/me` with no admin content; signed-out requests (curl) to `/me/schedule` and both admin URLs redirect (307) to `/login`; an admin opening `/me/schedule` is redirected to `/admin`; an invalid `?week=` shows the notice; the mobile layout (375 px wide) was checked by screenshot. Database counts unchanged (nothing written). **Not verified:** a SECOND real employee login (no other employee has an account, so "another employee cannot see EMP-0042's schedule" is proven at the database level and by the page having no employee id in its URL, not in the browser); the "In progress" and "Completed" badges and a past week with shifts (no such data for this account); the employee dashboard `/me` is still a placeholder.
- [x] 3.4b Publish a week — **run by Claude, 2026-11-24 (user-approved: honor the department filter, no week unpublish, understaffed and empty shifts allowed with confirmation).** `planWeekPublish` (pure, `lib/scheduling.ts`), `week-publish.ts` (scope parsing, fresh loader, SHA-256 fingerprint) and the admin-only `publishWeek` action. A "Publish this week" card on `/admin/schedules` for the displayed week and department filter. The server recomputes the eligible set from fresh data (drafts that have not ended, with no attendance), checks the scope (real Monday date, empty or valid department id), the fingerprint (ids, `updated_at`, assigned counts) and the understaffed acknowledgement, caps at 200 shifts, and publishes the confirmed ids with ONE update restricted to drafts (all or none; repeating publishes nothing). The browser never sends shift ids. No SQL, schema or S1 change. No week unpublish (single-shift unpublish remains). Verified (run by me): 57/57 unit tests (1 new), `tsc`, lint, production build, seed check PASS; browser on throw-away shifts (TEST WK1–7, Jan 2027 and one ended Nov 2026 draft): the card counts matched (department filter: 3 eligible, 2 understaffed, 1 empty, 2 employees, 1 cancelled and 1 already published skipped); a non-Monday date, garbage date, impossible date and garbage department were refused; another week gave "nothing to publish"; a changed scope or bad fingerprint was refused; a removed understaffed acknowledgement was refused; a shift edited after the page loaded made the real submit refuse as stale; the real publish with the Customer Support filter published exactly the 3 Customer Support drafts and left the Warehouse draft, the cancelled and the already-published shifts alone; an all-departments publish then published the Warehouse draft; the card then showed "No draft shifts to publish" with the success message kept; a past week showed 1 skipped as ended; single-shift unpublish and publish still worked. All fixtures removed; counts returned exactly to baseline (186 shifts: 62 draft, 124 published; 332 assignments; 0 audit rows; 132 attendance; 34 employees; 158 windows); the 30 Nov week is still 62 drafts; EMP-0042's 2 assignments and availability untouched. **Not verified:** two simultaneous submissions (bulk update cannot check each row's `updated_at`: a shift edited between the server's read and the write could be published with that edit; S2 is deferred); a repeated submit from a stale second tab (covered by the fingerprint and the "nothing to publish" path, not tried from two tabs); the real employee seeing week-published shifts (3.5).
- [x] Demo data for the employee view (approved by the user 2026-11-24) — **run by Claude through the admin UI.** Employee EMP-0042 (the only employee with a login; its employee id is `f07991d7-becb-4e04-8688-8b7ca577f65f`, its profile id `322cff9b-8deb-47f3-be48-31091c1fa976`) had availability Monday–Friday 09:00–17:00 and no shifts. Availability changed ONLY on Thursday and Friday to 09:00–22:00 (5 windows still; Monday to Wednesday unchanged). Assigned with the normal Assign button, both rows showing "Eligible", no overrides: Evening Support Thu 26 Nov 14:00–22:00 (now 3/3) and Evening Support Fri 27 Nov 14:00–22:00 (now 2/3), both already published. Verified in the database: both assignments exist once, `assigned_by` set, both shifts still published, 0 audit rows, EMP-0042 has 16.0 h assigned (maximum 40). **The baseline is now 332 assignments** (was 330); every other count is unchanged: 186 shifts (62 draft, 124 published, 0 cancelled), 0 audit rows, 132 attendance, 34 employees, 158 availability windows. Seed check still PASS. These assignments cannot be removed in this version (no unassign). The employee view of them is not verified until 3.5.
- [x] Demo data, second step (approved by the user 2026-11-24, after a read-only eligibility check) — **run by Claude through the normal Assign button, no overrides.** EMP-0042 was assigned to Evening Support Thu 3 Dec 14:00–22:00 (now 3/3) and Fri 4 Dec 14:00–22:00 (now 2/3). Both shifts are in the 30 Nov week, which stays ALL DRAFT (62 drafts, 0 other statuses) until the demo rehearsal: nothing was published. Verified in the database: each assignment exists once with `assigned_by` set, 0 audit rows, EMP-0042 has 16.0 h in the week of 30 Nov (maximum 40), 16 h of rest between Thursday 22:00 and Friday 14:00 (minimum 10), availability unchanged. **The baseline is now 334 assignments**; other counts unchanged: 186 shifts (62 draft, 124 published, 0 cancelled), 0 audit rows, 132 attendance, 34 employees, 158 availability windows. EMP-0042 has 4 assignments in total. Cannot be removed in this version.
- [ ] S2 concurrency protection — **DEFERRED (user decision 2026-11-24, Thursday 2026-11-26 deadline); NOT applied, NOT complete.** Read-only audit and proposed design are in `PHASE3_S2_AUDIT.md`. Known limitation until then: simultaneous requests can still double-book an employee, exceed headcount, assign to a just-cancelled shift, or together exceed rest/weekly-hours limits. Do not mark complete without a separate approval, migration and verification.
- [ ] 3.4 Publish / unpublish
- [ ] 3.5 Employee `/me/schedule`
- [ ] 3.6 Verification (lint, tsc, tests, build, RLS checks, browser tests)
- **Approvals (user, 2026-11-24):** Gate 0 (implement 3.0–3.6), Gate S1 (`schedule_overrides` + `assign_employee`) and
  Gate S2 (both overlap triggers). **Database changes applied so far: S1 only, migration `20261124101712 schedule_overrides_audit` (applied 2026-11-24, repo copy `supabase/migrations/20261124101712_schedule_overrides_audit.sql`). S2 not applied.** Order: 3.0 → Gate 1 review → apply S1 →
  3.1–3.3 → apply S2 → 3.4–3.6. Each migration is verified in a rolled-back test first and applied separately.
- **SQL amendments to apply when S1/S2 are applied (found in review, differ from the file the user first read):**
  (1) `check_assignment_overlap` locks the shift row `FOR SHARE` before the employee row `FOR UPDATE`, closing a race between
  editing a shift's times and assigning a new employee, and giving one lock order (shift, then employee);
  (2) revoke the trigger functions from `anon` and `authenticated` as well as `public`.
  Known limit: the audit trail only covers assignments made through `assign_employee`.
- Gates: 0 ✅ · 1 ✅ passed 2026-11-24 (awaiting user instruction) · S1 ✅ applied 2026-11-24 · S2 (approved, not applied) · 3.6 browser tests with provenance.
### Phase 4 — Automated scheduling (uses skills + availability) ⏳
### Phase 5 — Attendance and reports ⏳

---

## 10. Open issues / known risks 🔄

- Department delete and position delete are check-then-delete; a row added in between could
  still cascade. Fix would be `ON DELETE RESTRICT` FKs (**schema change, needs approval**).
- Availability overlap check is check-then-write; simultaneous saves could overlap. Fix would be
  a Postgres exclusion constraint (**schema change, needs approval**).
- Directory "Login" column shows only Linked / No login; invite states are on the profile page.
- `password_set` user metadata is display-only (user-editable); it grants nothing.
- A disabled user's current session may last until its access token expires (≈1 hour).
- Supabase advisor: **leaked password protection is off** → Authentication → Attack Protection.
- Old test users `admin.test@example.com` / `employee.test@example.com` were to be deleted manually.
- Live DB has 34 employees: the 33 seeded plus test employee `EMP-0042`, created in browser tests
  with a real email and a linked login. Keep during development; **sanitize or remove it before any public demo.**
- Seed shifts: 186 (62 draft, 124 published), 2026-11-16 to 2026-12-07 Manila time. 40 are
  deliberately understaffed and 117 have no position, so Phase 3 treats `position_id` as optional.
- `shift_assignments` has no database guard against assigning one employee to overlapping shifts;
  Phase 3 must check this in the app. Two admins acting at the same moment could still double-book until the
  trigger in `PHASE3_PROPOSED_SQL.md` part B is approved and applied (currently on hold).
- **Concurrency limits (3.3a), stated exactly:** the database guarantees only that one employee cannot be on the same shift twice (unique constraint) and that `assign_employee` writes atomically. It does NOT prevent two simultaneous requests from giving one employee overlapping shifts, or from pushing a shift past its headcount; the fingerprint and fresh re-read narrow that window but do not close it. S2 closes it by locking the shift row and then the employee row inside the same transaction as `assign_employee` and re-checking overlap (the action already maps its 23P01 error). Not applied.
- **Concurrency limits (3.2), stated exactly:** a shift row edit is guarded by `updated_at` (form version plus a conditional UPDATE), and a published edit must match the previewed state. Nothing stops ANOTHER shift or assignment from changing between the server's check and its write: the database has no overlap guard until the S2 triggers are applied, so two admins acting at the same instant can still produce an overlap. Cancel checks the shift row version but not assignment changes made at the same instant.
- Shift deletion is intentionally not implemented (race with the assignment cascade); needs a separately approved atomic mechanism.
- Audit limits: the audit trail covers assignments made through `assign_employee`; an admin calling the Data API directly can still insert a `shift_assignments` row without an audit record. Overrides are admin-declared and not re-verified by the database.
- Testing pitfall: an RLS test needs a real identity: if the test user does not exist, `auth.uid()` is null and the "employee" session proves little. (S1 tests were re-run with the real employee profile for this reason.)
- Testing pitfall: in SQL RLS tests, a non-admin `INSERT ... SELECT FROM employees` inserts 0 rows
  (RLS hides the rows) and looks "allowed". Use a literal id captured as the DB owner first.

---

## 11. How to update this file (end of every session)

The AI must output the full updated file with:
1. "Last updated" date at the top.
2. Section 7: new or renamed files.
3. Section 8: any new decision, with date and one-line reason.
4. Section 9: tick only items that were **actually completed and verified**; add new steps.
5. Section 10: add new risks, remove fixed ones.
6. Never delete rules in sections 1–3 unless the user asks.
7. Never add secrets, keys, passwords or real personal data.

## GECO brief: primary acceptance criteria (recorded 2026-11-24 from the user's screenshot)

Solution 03 of 25, Human Capital Management, difficulty Moderate. Title: "Build a mobile-friendly roster tool that schedules shifts and pushes each employee their own timetable".

What GECO requires:
1. Admin and user accounts; business units by geography, division or tenure.
2. Customisable scheduling screen controlled by the administrator.
3. Web and mobile access for every employee.
4. Automatic shift notifications and reminders on schedule changes.
5. Attendance and overtime reports and a status dashboard.
6. API link to an HRMS.

Friday demo: (1) the admin builds next week's roster in the calendar view; (2) the employee receives the shift alert on Telegram; (3) a dashboard shows attendance and overtime by unit. Stretch: a skills record to fill peak-period gaps with the right staff. The brief's suggested build path (not a requirement) names Next.js on Supabase, an LLM or OR-Tools solver that proposes a roster from availability, FullCalendar or react-big-calendar, a Telegram bot, and Plotly or Metabase on Vercel.

Status against these criteria (2026-11-24): 1 accounts done, business units = departments only (geography and tenure grouping not built); 2 mostly done (week view, create, edit, cancel, assign, overrides, publish one shift; week publish not built); 3 NOT done (`/me/schedule` is a placeholder; the layout is responsive but unverified on a phone); 4 NOT built (no Telegram code); 5 NOT built (attendance data is seeded; the dashboard is not built); 6 NOT built; stretch: skills exist on employees, no gap-filling logic. Do not treat finishing a Phase 3 milestone as finishing a requirement.

## Phase 3.6 demo-readiness review (2026-11-24, run by Claude; nothing built, no code changed)

Verified in the browser with real sessions (the user signed in each time; no password was entered by Claude): admin dashboard and scheduling pages; create a shift through the real form (draft, Customer Support, Tue 19 Jan 2027 06:00–14:00, headcount 2); assignment panel with 3 eligible, 6 warning and 1 blocked candidate; a clean assignment (Aiko Tanaka); warning detection and the override flow (Daniel Reyes, outside availability: reason box, confirmation dialog, history row); single-shift publish with its dialog; publish of a week with the understaffed confirmation (2 drafts, both understaffed, 0 assigned); the real EMP-0042 account sees its 26 and 27 Nov shifts and not the 3 and 4 Dec drafts; the employee is redirected away from admin URLs. No horizontal scroll at 375 px on the admin week view, the admin shift page or the employee schedule. All throw-away shifts, their assignments and the one test audit row were removed afterwards; counts returned exactly to the baseline (186 shifts: 62 draft, 124 published; 334 assignments; 0 audit rows; 132 attendance; 34 employees; 158 windows); EMP-0042 still has 4 assignments and unchanged availability; the 30 Nov week is still all draft.

Known demo issues (not fixed): the employee Availability, Attendance and Profile pages and the admin Reports page are placeholders ("Not built yet / Planned for Phase 2 or 6"); both dashboards show dashes, and the admin one says "Live figures arrive in Phase 2"; the "Draft shift created" banner stays after assigning (the `?created=1` parameter persists); the "Publish this week" card shows "No draft shifts to publish" on weeks that have none; in `next dev` the first visit to each page can take 10 to 40 seconds to compile (use `npm run build` then `npm start` for the demo).

## Dashboard and placeholder cleanup (2026-11-25, run by Claude; approved by the user as milestone 1 of 4: dashboard, automatic scheduling, Telegram, HRMS)

Built, read-only, no SQL or schema change: `lib/attendance-report.ts` (pure calculation, 4 unit tests), `app/admin/reports/attendance-data.ts` (loader, 1000-row limit with a notice) and `app/admin/reports/page.tsx` (period buttons 7 days / 30 days / all time, summary cards, by-department table with totals, top overtime list, a "how calculated" card); live figures on `app/admin/page.tsx` (active employees, shifts this week, unfilled shifts, overtime over 30 days with late arrivals); a new employee dashboard `app/me/page.tsx` (next shift, hours this week, shifts this week, own published shifts only); the employee menu now links only Dashboard and My schedule (Availability, Attendance and Profile routes still exist as placeholders, unlinked).

Calculation (documented on the Reports page): worked time = clock_out minus clock_in; overtime = worked time beyond the scheduled shift length, never below zero (a duration comparison, so arriving early counts); the attendance data has NO break fields, so breaks cannot be deducted (worked and scheduled time are both gross); late, absent and excused come from the record status; attendance rate = (present + late) / (present + late + absent), excused left out; departments come from the shift of each record; periods use the Asia/Manila work date. Open decision: because early arrivals count, 110 of 132 records show some overtime (56.0 h total); a grace threshold (for example 15 minutes) would be more realistic and has NOT been applied.

Verified (run by me): 61/61 unit tests, `tsc`, lint, production build, seed check PASS. The Reports page matched an independent SQL calculation exactly: 132 records (109 present, 12 late, 7 absent, 4 excused), attendance 95%, 1032.4 h worked, 56.0 h overtime over 110 shifts, and every department row (for example Customer Support 40 records, 334.6 h, 22.9 h overtime; Logistics 79% attendance); the 7-day period gave 114 records and 8 late, also matching SQL; the admin dashboard showed 33 active employees, 62 shifts this week, 8 unfilled and 56.0 h overtime, matching SQL. As the real EMP-0042 (the user signed in): the dashboard shows the next shift Thu 26 Nov 14:00–22:00 Evening Support, 16.0 h this week and 2 shifts (the draft 3 and 4 Dec shifts are not counted); the menu shows only Dashboard and My schedule; the mobile layout at 375 px was checked by screenshot; opening `/admin/reports` as the employee redirected to `/me`. Counts after the milestone (nothing written): 186 shifts (62 draft, 124 published, 0 cancelled), 334 assignments, 0 audit rows, 132 attendance, 34 employees, 158 availability windows; EMP-0042 has 4 assignments; the 30 Nov week is still all draft. Not verified: the Reports page at phone width; a period with no records (the empty state).

## Roadmap and decisions (approved by the user, 2026-11-25)

Order (revised later on 2026-11-25): (1) Telegram integration, (2) HRMS integration, (3) automatic scheduling engine, (4) scheduling preview, (5) apply, only if time permits and partial-write risks are handled, (6) final demonstration and regression testing. This replaces the earlier order (dashboard, scheduling, Telegram, HRMS); the dashboard milestone is done. Each phase stops for review.

Automatic scheduling decisions D1–D9 are approved (details in `AUTOMATIC_SCHEDULING_PLAN.md`): never assign anyone with a blocker or warning; fairness by share of weekly maximum, then shift count, then flexibility; qualifications = department and position, no skill system; apply through `assign_employee` one at a time with every success and failure reported and no silent retry; repair step only after engine and preview work; cap 150 assignments; undo only by owner SQL; the real 30 Nov week is preview-only and apply runs on test shifts only; existing rules, database structure, assignments and the overtime definition unchanged. Not started.

Telegram: decisions T1–T5 approved (new chat id table with RLS, manual reminders, notify calls in the scheduling actions, no message history, test messages only to the user's own account). Employees link and unlink only their own account, one chat id per employee, token only in server environment variables, delivery failures never fail a scheduling action, no retry. The migration and RLS SQL are in `TELEGRAM_PLAN.md`, AWAITING SEPARATE APPROVAL; nothing applied or implemented.

Telegram update (2026-11-25): M1 approved (admins may remove links, never read chat ids). The `employee_telegram` SQL passed a rolled-back access test and left nothing behind (details in `TELEGRAM_PLAN.md`). Permanent migration and application work NOT approved.

Telegram update (2026-11-25, later): the `employee_telegram` migration is APPLIED and verified (4 migrations now; table empty; details in `TELEGRAM_PLAN.md`). `database.types.ts` not yet updated. Linking page, notification calls and message tests NOT approved. This supersedes the earlier 'NOT approved and NOT applied' note about the migration.

## Telegram linking milestone (2026-11-25, in progress)

Migration history cleanup done: the four local files were renamed to the ledger versions and names (`20261124015908_core_schema`, `20261124020354_link_employee_on_verified_email`, `20261124101712_schedule_overrides_audit`, `20261125012350_employee_telegram`); normalised SQL identical to the ledger; no SQL executed for the rename and the ledger untouched.

Built (no schema change, no messages): `lib/telegram.ts` (signed 48-character link code with 10-minute expiry, `/start` matching for private chats only, Bot API client without retry that never returns the token), `app/me/telegram/` (page, actions, panel: connect, check, status, disconnect), `employee_telegram` in `database.types.ts`, a Telegram menu item. Verified: 66/66 unit tests (5 new), `tsc`, lint, build, seed check; no token, secret key or chat id reference in the client bundle; through the Data API with real keys, anonymous select, insert, update and delete refused, secret key insert works, duplicate chat id 409/23505, negative 400/23514, update refused; test rows removed. NOT yet verified: the page with a real employee session; real linking (no bot token yet); admin session through the API.

Telegram linking, app test (2026-11-25, real EMP-0042 session signed in by the user): `/me/telegram` showed "Not connected" and "not set up" (no bot token); with temporary links added through the API with made-up chat ids (EMP-0042 and EMP-0002), the page showed "Connected" with the date and no chat id in the page or server response; Disconnect through the confirmation dialog removed only EMP-0042's row (EMP-0002's remained). Test rows removed; table empty; counts: 34 employees, 186 shifts (62 draft, 124 published), 334 assignments, 0 audit rows, 132 attendance, 158 windows, 4 migrations. Still NOT verified: Connect and Check connection against real Telegram (needs the bot token, a server restart and the user pressing Start); an admin session through the API (admin permissions verified in the database only; there is no admin unlink screen). The milestone stays open on real linking. Shift notifications and reminders are not built or approved.

## Telegram linking milestone complete (2026-11-25)

Real linking test: the user, signed in as EMP-0042, got a link on `/me/telegram`, sent `/start <code>` to the bot `@UncleBadangBot` from their own phone (the web "Start Bot" button did nothing on this computer, so the code was sent by hand), pressed Check connection, and reported that Telegram is connected. A read-only diagnosis just before the check saw one waiting private-chat message with a valid code for EMP-0042. Read-only database verification afterwards (chat id never selected for output): exactly 1 row in `employee_telegram`, for EMP-0042 (active, has a login), 0 rows for other employees, linked 2026-11-25 09:52 Asia/Manila, chat id present as a private-chat value and not one of the test values. Counts: 34 employees, 186 shifts (62 draft, 124 published), 334 assignments, 0 audit rows, 132 attendance, 158 windows, 4 migrations.

The link must be KEPT (the notification milestone will use it): do not disconnect or replace it, and do not run test-row cleanup that could match it. Not verified: that the bot can deliver a message (none was sent); linking by a second employee; an admin session through the API. This supersedes the earlier "NOT yet verified: real linking" notes. Next milestone, not yet approved: Telegram shift notifications and manual reminders.

## Telegram notifications milestone (2026-11-25, approved N1–N6; code written, real delivery NOT yet tested)

Built (no schema change): `lib/telegram-messages.ts` (one message per employee, only the required saved status, never ended shifts, sent / not linked / failed / delivery unknown with no retry, server-signed 5-minute result notice), `app/admin/schedules/notify.ts` (re-reads saved shifts after the write, never throws, chat ids only server-side), hooks in publish, unpublish, publish week, both assignment actions, edit (start, end, department, position of published shifts) and cancel (was published), `sendTomorrowReminders` with a card on `/admin/schedules`, updated wording on `/me/telegram`. Verified so far: 73/73 unit tests (7 new), `tsc`, lint, build, seed check; no token, secret key or chat id reference in the client bundle; only linked account is EMP-0042 (read-only query). NOT yet verified: everything in the running app and any real Telegram delivery (needs an admin session).

Telegram notifications, running-app test (2026-11-25, admin session signed in by the user; messages only to the user's linked account, the only real link, checked before sending): draft assignment and draft edit sent nothing; week publish of 2 temporary shifts gave 1 sent (one combined message) and 1 not linked; time edit of a published shift 1 sent, 1 not linked; notes-only edit sent nothing; assignment to a published shift showed the signed notice "1 sent" (a forged, typed or reused-on-another-shift notice showed nothing); unpublish, republish and cancel each 1 sent; cancelling an ended shift "nobody needed a message"; real reminder for 26 Nov: 1 sent, 19 not linked. Forced failure: first run (unpublish) returned "2 delivery unknown (not retried)" for both recipients while api.telegram.org was intermittently unreachable from this computer (one of three plain requests took 12 s and failed); the schedule change was saved. Second run (a new publish) gave 1 sent, 1 failed for the made-up link. The made-up link and all temporary shifts were removed; the real link is intact; counts back to baseline (186 shifts, 334 assignments, 0 audit rows, 132 attendance, 34 employees, 158 windows, 0 notifications, 4 migrations, 1 Telegram link). Not verified: arrival on the phone (only the user can confirm; Telegram's API accepted the sends reported as sent); the override-assignment path with a real send (same hook as the clean path); an edit of position or department; timed reminders (not built). Known limit: the 5-second timeout can report "delivery unknown" on a slow connection.

**Telegram notifications milestone CLOSED (2026-11-25).** The user confirmed on their phone that the Evening Support reminder and the test messages arrived (this supersedes "arrival not verified" above; whether the single "delivery unknown" test message arrived was not asked separately). Timeout stays at 5 seconds (user-supported). Still not built or tested: timed reminders, override-assignment and position/department-edit sends, linking by a second employee. Next in the approved order: HRMS integration (not started, needs a plan and approval).

## HRMS integration (2026-11-25, approved H1–H6 and H8; H7 admin page deferred) — implemented

Read-only API `GET /api/hrms/v1/{employees,departments,shifts,attendance}`: `lib/hrms.ts` (key check, parameters), `app/api/hrms/v1/` (handler, data loaders with explicit columns, four routes), `scripts/hrms-sync-demo.mjs` (simulated HRMS), documentation `HRMS_API.md`. Bearer key only, checked before parameters and before any database client; secret key used server-side only; published shifts only; no phone, ids of logins, notes, overrides or Telegram data. No schema change, no package, overtime calculation unchanged.

Verified (run by Claude): 76/76 unit tests (3 new), `tsc`, lint, build (routes are dynamic), seed check; live against the BUILT app on temporary local ports with a throw-away key: 401 for missing, wrong, Basic, cookie-only and in-address keys; 503 for a short key; 405 for POST, PUT, PATCH, DELETE; 34 employees, 5 departments and 14 positions, 124 published shifts with 230 assignments, 132 attendance records with 1032.4 h worked and 56.0 h overtime (as the Reports page), each paged exactly once; exact field lists; draft week empty; empty periods and filters; 400 for bad parameters; generic 500 with a wrong secret key; no key in server logs or output; no secret names in the client bundle; sample script succeeded. Dev server on port 3000 answers 503 (no key configured). Database counts, last-updated times and the Telegram link row unchanged.

Not done or not verified: a call against the DEVELOPMENT server with the owner's own key (the owner must add `HRMS_API_KEY` to `.env.local` and restart); any real HRMS; internet access (local only); rate limiting, request log, per-client permissions; attendance records have no id of their own in the API.

HRMS live demo on the development server (2026-11-25): the owner added `HRMS_API_KEY` to `.env.local`; after a restart, a request without a key got 401 and `node scripts/hrms-sync-demo.mjs` (reading the key from `.env.local`, never printing it) succeeded against `http://localhost:3000`, period 10 Nov to 10 Dec 2026: 34 employees (33 active), 5 departments with 14 positions, 124 published shifts with 230 assignments, 132 attendance records, 1032.4 h worked, 56.0 h overtime; nothing written. This supersedes "not verified: a call against the development server". HRMS milestone complete (local, simulated HRMS only).

## Automatic scheduling, Phase 4.1: proposal engine (2026-11-25, approved) — done, awaiting review

`lib/auto-schedule.ts` (`proposeSchedule`, pure; rules from `lib/scheduling.ts` are passed in, none duplicated or changed) and `scripts/auto-schedule.test.mjs` (18 tests). No database access in the engine, no UI, no apply, no schema change. Repair step OMITTED (decision D6: only after the engine and preview work). Verified: 94/94 unit tests, `tsc`, lint, build, seed check; a read-only in-memory dry run on the live 30 Nov week (all departments): 21 draft shifts with open places, 23 open places, 10 proposed, 13 left open on 11 shifts, replay through the real rules 0 violations, about 0.4 s; Customer Support 0 of 6 filled (availability, weekly hours, rest). Nothing written: assignment hash, counts, last-updated times and the Telegram link unchanged. Not verified: whether more places could be filled (greedy is not optimal); app-side data loading (Phase 4.2). Next, not approved: Phase 4.2 preview.

## Automatic scheduling, Phase 4.2: preview screen (2026-11-25, approved) — built, one access test pending

`/admin/schedules/auto` (admin only, linked from the week view): week and department selector, previous and next, Recalculate; summary of open, proposed and uncovered positions; per department each draft shift with open places, current assignees, proposed employees marked "Proposed", uncovered count with the engine's reasons, link to the shift; workload table; empty, loading, invalid-week and load-error states; a "proposal only" notice. Files: `app/admin/schedules/auto/{page,loading,recalculate-button}.tsx`, `auto-data.ts`, `lib/auto-preview.ts`, `scripts/auto-preview.test.mjs`, one link in `app/admin/schedules/page.tsx`. Read only: no Server Action and no write call; the engine and rules are unchanged; no Apply.

Verified: 95/95 unit tests, `tsc`, lint, build, seed check; browser as admin: week of 30 Nov showed 23 open, 10 proposed, 13 uncovered (computed live), departments and reasons, 8 employees in the workload table, no apply/assign/publish control; Recalculate changed the calculation time; weeks of 23 and 16 Nov (all published) and 2 Nov and 1 Mar 2027 (empty) showed the empty state; Customer Support filter 6 open, 0 proposed; invalid week and department fell back with a notice; 375 px width without horizontal page scroll; signed-out request redirects to sign-in. Database counts, assignment fingerprint, last-updated times and Telegram link unchanged. Not verified: employee account refused (needs an employee sign-in); the load-error and loading states were not triggered in the browser; Recalculate picking up changed data (no data was changed); `no department employees` case only in a unit test. Next, not approved: Phase 4.3 apply.

Phase 4.2 access test (2026-11-25, real EMP-0042 session signed in by the user): opening `/admin/schedules/auto` redirected to `/me`; the raw page and the React data response for that URL carried the redirect and none of the checked proposal figures, employee names or shift titles. Counts, assignment fingerprint and the Telegram link unchanged. This closes the pending access test; Phase 4.2 is complete. The loading and load-error states remain unexercised.

## Final testing and rehearsal preparation (2026-11-25, run by Claude; Phase 4.3 explicitly DEFERRED)

Passed on the production build: 95/95 unit tests, `tsc`, lint, build, seed check; no secret names in the client bundle; signed-out pages redirect; HRMS: 46 live API checks and the sample script; Telegram bot reachable (read only), link unchanged, no message sent; as EMP-0042: dashboard, schedule (30 Nov week empty), Telegram "Connected", admin pages redirect to `/me`, no sideways scroll at 1100 and 375 px on the three employee pages checked; as admin: dashboard, reports (30 days 132 records; 7 days 95), week views, preview 30 Nov 23 open / 10 proposed / 13 uncovered identical over three recalculations; checked admin pages have no sideways scroll at 375 and 1280 px EXCEPT the Employees list. Preview loading and load-error states shown by temporarily adding a delay and a forced failure to `auto-data.ts` on a dev server; the file was restored byte for byte (SHA-256 match) and rebuilt. Database fingerprint (shifts, assignments, employees, availability, attendance, Telegram) identical before and after: 34 employees, 186 shifts (62 draft, 124 published, 0 cancelled), 334 assignments, 132 attendance, 158 windows, 0 audit rows, 0 notifications, 1 Telegram link, 4 migrations.

Found, not fixed: `/admin/employees` makes the whole page scroll sideways below about 1290 px (main area lacks `min-w-0`, `components/app-shell.tsx`). Friday note: the 27 Nov "tomorrow" reminder will not reach EMP-0042 (no shift on 28 Nov); options in `DEMO_CHECKLIST.md`, the live one changes a shift and needs the user's decision. Not re-run today: write workflows (create, assign, override, publish, Telegram sends), last verified earlier on 24–25 Nov.

Employees list layout fix (2026-11-25, approved; `app/admin/employees/page.tsx` only): the table box gained `relative w-0 min-w-full`. Cause: the table's width widened the page, and the screen-reader-only labels in its cells (absolutely positioned) escaped the scroll box. Verified in the browser at 1920, 1440, 1280, 1100, 768 and 375 px: no page-level sideways scroll; the table scrolls inside its box below about 1290 px and fills it above; page 2, search, empty search and sort variants also without page overflow. `tsc`, lint, build, 95 tests pass. This closes the layout item found in final testing. Implementation is frozen for the demo.

## Phone layout pass (2026-11-25, requested by the user; this reopened the code freeze)

UI only, no logic, database, permission or API change: bottom navigation on phones from one shared list (`components/nav-links.tsx`; admin Home, Employees, Schedules, Reports, More with Departments and Positions; employee Home, Schedule, Telegram; sidebar unchanged from the md breakpoint); `components/app-shell.tsx` spacing for the bar; redesigned employee dashboard (`app/me/page.tsx`: greeting, next-shift card, week summary, upcoming shifts); two-per-row admin dashboard cards; Employees list shows name, ID, department, position and status on phones with two filters per row; Reports and preview workload tables fold secondary columns under the name; preview summary in three compact cards; shift page shows status and assigned people first on phones and folds the long explanation into "How assigning works" (wording "(S2)" replaced by "stronger database protection").

Verified in the browser with real admin and EMP-0042 sessions: no page-level sideways scroll at 360, 375, 390 and 414 px on the admin pages checked (dashboard, employees at all four; departments, positions, week view, a shift, reports, preview, new shift, new/edit/detail employee at 360) and the three employee pages (360, 390, 414 and 375); bottom bar 48 px targets, More menu opens and closes; sidebar at 1280 px. 95 tests, `tsc`, lint, build and seed check pass. Not built (no such features): clock in/out, approvals, location, employee attendance and profile screens. Not verified: a physical phone; landscape; the preview and week publish forms' dialogs at phone width.
