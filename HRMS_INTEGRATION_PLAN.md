# HRMS integration implementation plan — IMPLEMENTED 2026-11-25

**Status:** H1–H6 and H8 approved and implemented; H7 (admin page) deferred. Test results are in `PROJECT_CONTEXT.md`; usage is in
`HRMS_API.md`. Differences from the text below: the e-mail field is called `work_email`; attendance records carry no id; the
live tests ran against the built app on temporary local ports, because no `HRMS_API_KEY` is configured in `.env.local` yet. The
sections below are the proposal as written before approval.

Date: 2026-11-25. Prepared from read-only inspection: project files and one `select` of row counts. No code, configuration,
schema, migration or data was changed. This file is the only thing written.

## 1. Requirements

### 1.1 What the brief says
The whole requirement, as recorded in `PROJECT_CONTEXT.md` from the user's screenshot of the GECO brief (Solution 03):
**"API link to an HRMS."** (requirement 6 of 6).

The brief does **not** name: an HRMS product, a direction (send, receive or both), the data, a format, a frequency, an
authentication method or a demo step. The Friday demo lists roster, Telegram alert and dashboard; no HRMS step.

Everything below is therefore a proposal. The earlier approved roadmap described it as a "read-only API endpoint and
documentation".

### 1.2 Proposed interpretation
This system offers a documented, authenticated, **read-only REST API** from which any HRMS can pull workforce data. The
roster tool stays the source of truth for schedules and attendance. No HRMS vendor is assumed.

| In scope (proposed) | Out of scope (proposed) |
|---|---|
| Read employees, organisation, published shifts, attendance with worked and overtime minutes | Writing into this system from an HRMS |
| API key authentication, field allowlist, documentation, a sample consumer script | Webhooks or push, scheduled sync, vendor-specific connectors, payroll calculation |

## 2. Current state

### 2.1 Exists
- `employees.external_ref` (text, unique), commented in the schema as the id in an external HRMS. **0 of 34 filled**; no
  screen reads or edits it (it appears only in the generated types).
- Employees (`employee_code` unique, email unique ignoring case, status, employment type, hire date, weekly maximum,
  department, position), 5 departments, 14 positions, skills.
- Shifts and assignments (186 and 334), attendance records (132), with `updated_at` triggers on employees, shifts and attendance.
- `lib/attendance-report.ts`: the approved worked-time and overtime calculation, pure and tested.
- `lib/supabase/admin.ts`: server-only secret-key client. `.env*` is git-ignored.
- Admin-only validation and write paths for employees (`app/admin/employees/actions.ts`, `lib/validation.ts`).

### 2.2 Does not exist
- Any API route (`app/` has no route handlers), API key, integration page, API documentation or consumer.
- A public address: the app runs locally.

## 3. Integration design

```
HRMS or sample script  --HTTPS GET, Authorization: Bearer <key>-->  app/api/hrms/v1/<resource>/route.ts
                                                                      1. key check  2. parameter check
                                                                      3. secret-key client, explicit columns
                                                                      4. pure mapping to the public shape  --> JSON
```

| Endpoint (GET only) | Returns | Parameters |
|---|---|---|
| `/api/hrms/v1/employees` | employee records | `status`, `updated_since`, `limit`, `offset` |
| `/api/hrms/v1/departments` | departments with their positions | none |
| `/api/hrms/v1/shifts` | **published** shifts with assigned employee codes | `from`, `to` (required, at most 31 days), `limit`, `offset` |
| `/api/hrms/v1/attendance` | records with worked, scheduled and overtime minutes | `from`, `to` (required, at most 31 days), `limit`, `offset` |

Response shape: `{ "data": [...], "page": { "limit": 100, "offset": 0, "total": 34 }, "generated_at": "..." }`.
Errors: `{ "error": { "code": "unauthorized", "message": "..." } }` with 400, 401, 405, 500 or 503, never raw database text.

New files: `lib/hrms.ts` (pure: key comparison, parameters, mapping), one loader, four `route.ts` files,
`scripts/hrms-sync-demo.mjs`, `HRMS_API.md`, optionally `app/admin/integrations/page.tsx`. Changed: admin menu (if the page
is approved). No package, no schema change.

Framework notes to confirm while building: `cacheComponents` is on, so each handler must read the request headers first and
run at request time, with `Cache-Control: no-store`. `proxy.ts` also runs on `/api`; it redirects only `/admin` and `/me`, so
API calls are not redirected.

## 4. User workflows
- **Administrator:** (optional page) sees whether the API is switched on, the endpoint list and field definitions, and how to
  call it. The key is never displayed or generated in the browser; the owner puts it in `.env.local` and restarts.
- **Employee:** no change and no new screen.
- **HRMS operator (demo):** runs the sample script, which pulls all four resources and prints record counts.

## 5. Data mapping

| API field | Source | Note |
|---|---|---|
| `employee_code` | `employees.employee_code` | proposed matching key |
| `external_ref` | `employees.external_ref` | null for all today |
| `first_name`, `last_name`, `email` | same columns | personal data, decision H3 |
| `department`, `position` | joined names | |
| `employment_type`, `status`, `hire_date`, `max_weekly_hours` | same columns | `hire_date` supports tenure |
| `updated_at` | `employees.updated_at` | |
| shift `id`, `title`, `starts_at`, `ends_at`, `department`, `position`, `required_headcount` | `shifts` | published only; UTC ISO 8601 |
| shift `assigned_employee_codes` | `shift_assignments` → `employees` | |
| attendance `employee_code`, `work_date`, `status`, `clock_in`, `clock_out` | `attendance_records` | `work_date` is the Manila date |
| `worked_minutes`, `scheduled_minutes`, `overtime_minutes` | existing calculation | gross, no breaks; unchanged definition |

**Never returned:** Telegram links or chat ids, login or profile ids, roles, phone (unless H3 says otherwise), availability,
shift notes, attendance notes, override reasons and audit rows, draft or cancelled shifts.

## 6. Security
- The API has no user session, so it must read with the **secret key, which bypasses row-level security**. The protections are
  then: the key check, GET only, a fixed column list per endpoint, and the published-only filter. A narrower database role
  would be safer and needs a schema change (decision H5).
- `HRMS_API_KEY`: server only, no `NEXT_PUBLIC_` name, at least 32 random characters, accepted only in the `Authorization`
  header (never in the address). Compared in constant time on hashes. Unset or too short: every request gets 503.
- A signed-in browser session alone gets 401. No CORS headers, so web pages on other origins cannot read responses.
- No request body is read; keys, headers and personal data are never logged.
- Rotation: change the value and restart. One key, no per-client permissions, no request log, **no rate limit**.
- Over plain `http://localhost` the key is unencrypted; any hosted use requires HTTPS.
- Telegram code, table and the EMP-0042 link are not touched or queried.

## 7. Data consistency
- Read only: no duplicates or conflicts are created here. Matching, de-duplication and writes are the HRMS's job, keyed on
  `employee_code`.
- Stable ordering by a unique column for paging. A record changed between pages can be seen twice or missed; consumers should
  upsert by key. Each endpoint is a separate read, not one snapshot.
- `updated_since` is offered only for employees. Assignment changes do not update `shifts.updated_at`, and hard deletions leave
  no trace, so shifts and attendance are synchronised by re-reading a date range.
- Invalid parameters are rejected with 400, never silently adjusted. Results are never truncated without saying so
  (`page.total`).
- Failure: the consumer retries safely, since requests change nothing.

## 8. Implementation sequence (each step testable; estimates are rough)

| Step | Work | Estimate |
|---|---|---|
| 1 | `lib/hrms.ts`: key check, parameters, mapping, unit tests | 1 h |
| 2 | employees and departments endpoints | 45 min |
| 3 | shifts and attendance endpoints | 1 h |
| 4 | sample consumer script and `HRMS_API.md` | 45 min |
| 5 | live security and regression tests, documentation | 1 h |
| 6 | optional admin Integrations page | 45 min |

Total: about **4.5 hours**, about 5.25 hours with the page. Needed from the user: approval, and putting `HRMS_API_KEY` in
`.env.local` (a command to generate one will be given; the value is not to be pasted into chat).

## 9. Testing
- **Unit:** missing, short, wrong and correct key; header formats; every parameter limit and bad value; date range over 31
  days; mapping returns exactly the allowed fields; overtime figures equal the existing calculation.
- **Live, against the running server:** no key, wrong key, key in the address → 401; unset key → 503; admin session without
  key → 401; POST, PUT, DELETE → 405; counts match the database (34 employees; 132 attendance over the seeded range); only
  published shifts; paging covers every record once; response scan for forbidden fields and chat ids; no cache headers; no
  redirect.
- **Regression:** all unit tests, `tsc`, lint, build, seed check, client bundle scan for the key, admin and employee pages;
  database counts unchanged and the one Telegram link intact. No temporary data is needed because everything is read only.

## 10. Risks, assumptions, blockers
- **Interpretation risk:** an evaluator may expect two-way sync or a named HRMS. The sample script makes the link visible but
  is not a real HRMS.
- **No hosting:** an external system cannot reach a local app. Not a blocker for a local demo.
- Time: the brief's demo is Friday 27 November; automatic scheduling and final rehearsal also remain.
- Assumption: `employee_code` is an acceptable shared identifier.
- Related gap, outside this plan: the brief's "business units by geography, division or tenure" is only met by departments.

## 11. Decisions needing approval

| # | Decision | Recommendation |
|---|---|---|
| H1 | Direction | read-only pull API; no import |
| H2 | Resources | all four endpoints |
| H3 | Personal data | include name and work email; exclude phone |
| H4 | Authentication | one API key from `.env.local` |
| H5 | Database access | secret-key client with fixed columns; no schema change |
| H6 | `external_ref` | return it; no editing screen now |
| H7 | Admin Integrations page | build only if time permits; the document and script come first |
| H8 | Demo proof | sample consumer script plus one request shown live |
