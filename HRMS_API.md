# HRMS API (version 1, read-only)

An HR management system can **read** employees, the organisation, published shifts and attendance from this application. It
cannot change anything. The application currently runs on a local computer, so only programs on that computer (or one that
can reach it) can call it. It is not published on the internet.

## Switching it on (owner)

1. Generate a key of at least 32 characters:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. Add `HRMS_API_KEY=<the key>` to `.env.local`. Never commit it, share it in chat or give it a `NEXT_PUBLIC_` name.
3. Restart the server.

Without a key of at least 32 characters every request answers `503`. To rotate the key, change it and restart.

## Calling it

Send the key in the `Authorization` header only. It is refused in the address.

```powershell
$key = Read-Host "HRMS API key"
```

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/hrms/v1/employees?limit=2" -Headers @{ Authorization = "Bearer $key" }
```

Sample consumer (a simulated HRMS):

```powershell
node scripts/hrms-sync-demo.mjs
```

## Responses

```json
{ "data": [], "page": { "limit": 100, "offset": 0, "total": 34 }, "generated_at": "2026-11-25T03:00:00.000Z" }
```

```json
{ "error": { "code": "unauthorized", "message": "A valid API key is required in the Authorization header." } }
```

| Status | Meaning |
|---|---|
| 200 | success (an empty `data` array is a valid result) |
| 400 | `invalid_request`: unknown, repeated or invalid parameter |
| 401 | `unauthorized`: missing or wrong key. A browser sign-in is not accepted |
| 405 | method other than GET |
| 500 | `server_error`: the data could not be read |
| 503 | `unavailable`: the API is not switched on |

Responses are sent with `Cache-Control: no-store` and no cross-origin headers.

Paging: `limit` 1–500 (default 100), `offset` 0 or more. Read pages until `offset` reaches `page.total`. Pages are separate
reads: upsert by key, because a record changed during a sync can repeat or be missed.

## GET /api/hrms/v1/employees

Parameters: `status` (`active`, `on_leave`, `inactive`), `updated_since` (timestamp with a zone, such as
`2026-11-25T00:00:00Z`; write `+` as `%2B`), `limit`, `offset`. Ordered by `employee_code`, the key to match records on.

```json
{
  "employee_code": "EMP-0001",
  "external_ref": null,
  "first_name": "Sam",
  "last_name": "Example",
  "work_email": "sam@example.com",
  "department": "Customer Support",
  "position": "Support Team Lead",
  "employment_type": "full_time",
  "status": "active",
  "hire_date": "2024-03-01",
  "max_weekly_hours": 40,
  "updated_at": "2026-11-24T02:23:18.403262+00:00"
}
```

## GET /api/hrms/v1/departments

No parameters.

```json
{ "name": "Customer Support", "positions": ["Support Agent", "Support Team Lead"] }
```

## GET /api/hrms/v1/shifts

**Published shifts only.** Parameters: `from` and `to` (required, Manila dates, at most 31 days; by shift start), `limit`,
`offset`. Times are UTC. Ordered by start.

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "title": "Evening Support",
  "starts_at": "2026-11-26T06:00:00+00:00",
  "ends_at": "2026-11-26T14:00:00+00:00",
  "department": "Customer Support",
  "position": null,
  "required_headcount": 3,
  "assigned_employee_codes": ["EMP-0001", "EMP-0002"]
}
```

## GET /api/hrms/v1/attendance

Parameters: `from` and `to` (required, Manila work dates, at most 31 days), `limit`, `offset`. Ordered by work date.

```json
{
  "employee_code": "EMP-0001",
  "work_date": "2026-11-16",
  "status": "present",
  "clock_in": "2026-11-15T21:55:00+00:00",
  "clock_out": "2026-11-16T06:10:00+00:00",
  "worked_minutes": 495,
  "scheduled_minutes": 480,
  "overtime_minutes": 15
}
```

`worked_minutes` is clock-out minus clock-in (null without both). `overtime_minutes` is worked time beyond the scheduled
shift length, never below zero. There are no break records, so breaks are not deducted. If a record is no longer linked to a
shift, `scheduled_minutes` and `overtime_minutes` are null.

## Never returned

Phone numbers, login or profile ids, roles, availability, notes, schedule override records, draft or cancelled shifts, and
anything about Telegram links.

## Limitations

- One key with full read access to the fields above; no per-client permissions, request log or rate limit.
- Use HTTPS for anything beyond this computer; plain `http://localhost` does not encrypt the key.
- `updated_since` exists only for employees. Deleted records leave no trace: re-read date ranges for shifts and attendance.
- Attendance records carry no id of their own; match on employee, work date and clock-in.
- No writing, webhooks, scheduled sync or vendor-specific connector.

Example values above are invented.
