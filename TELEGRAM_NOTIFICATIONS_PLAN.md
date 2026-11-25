# Telegram shift notifications: read-only audit and plan — N1–N6 APPROVED, implemented and tested 2026-11-25 (results in PROJECT_CONTEXT.md)

Date: 2026-11-25. Method: reading code only. No SQL, code or data change; no message sent. The existing EMP-0042 link must be
preserved. No schema change, no message history, no retry, no change to scheduling rules, no automatic scheduling.

## 1. Audit

### 1.1 Where schedules change (`app/admin/schedules/actions.ts`)

All six actions call `requireRole("admin")` first, re-read fresh data and write through the admin's own session.

| Action | Successful write | Can touch a published shift | Result message survives the page refresh |
|---|---|---|---|
| `createShift` | insert, always draft | no | not relevant |
| `updateShift` | `apply()`, guarded by `updated_at` and status | yes, after preview and confirmation | yes (edit form stays) |
| `cancelShift` | status → cancelled | yes (draft or published) | **no**: the card disappears |
| `publishShift` / `unpublishShift` | shared `changeShiftStatus` | yes | yes |
| `publishWeek` | one update of confirmed drafts, returns changed ids | yes | yes |
| `assignEmployee` / `assignEmployeeWithOverrides` | `assign_employee` RPC | yes, with `published_ack` | **no**: the employee's row disappears from the list |

No other code writes shifts or assignments. There is no unassign and no delete, so neither needs a message. Employee,
availability and department edits do not change a shift and send nothing.

### 1.2 Telegram side
- `lib/telegram.ts`: Bot API client with a 5-second timeout and no retry; allows only `getMe` and `getUpdates` today.
- Link status is readable by an admin session; chat ids only with the secret key (`createAdminClient`).
- Verified: exactly one real link, EMP-0042.

### 1.3 Findings that shape the design
1. For assignment and cancellation, a delivery report returned by the action would **never be seen** (row or card unmounts).
2. The status read before a write can be stale by the time a message is built, so the sender must re-read after the write.
3. Cancelling or editing an already-ended published shift without attendance is possible; messaging then is noise.
4. `/me/telegram` says "Shift messages are not being sent yet"; that text must change.

## 2. Design

### 2.1 Pieces
- `lib/telegram.ts`: add `sendMessage` (plain text, no formatting mode, so shift titles cannot inject markup).
- `lib/telegram-messages.ts` (pure, unit tested): message text per event; grouping shifts per employee; length cap under 4,096.
- `app/admin/schedules/notify.ts` (server only): `notifyShiftChange(event, shiftIds, employeeIds?)`:
  1. re-reads the shifts and assignments **after** the write and keeps only those in the status the event requires and not ended;
  2. reads chat ids with the secret key for exactly those employees;
  3. sends one message per employee, in parallel with a small concurrency limit;
  4. returns counts only: sent, not linked, failed, delivery unknown (timeout). It **never throws**.

### 2.2 Integration points
Each call goes after the "was a row actually changed" check and never before a write or on any refusal path.

| Event | Hook | Sends when | Recipients |
|---|---|---|---|
| Published | `changeShiftStatus`, to = published | row updated | assignees |
| Withdrawn | `changeShiftStatus`, to = draft | row updated (was published) | assignees |
| Week published | `publishWeek` | for the ids the update returned | one combined message per employee |
| Assigned | both assignment actions | RPC succeeded and the shift is published | that employee |
| Changed | `updateShift` `apply()` | shift published and start, end, department or position changed | assignees, with old and new values |
| Cancelled | `cancelShift` | previous status was published | assignees |
| Reminder | new action `sendTomorrowReminders` | admin confirms | assignees of published shifts starting tomorrow (Manila), one combined message each |

Draft work sends nothing: creating, editing or assigning on a draft, cancelling a draft, and any refused action.

### 2.3 Never interrupting scheduling
The write is already committed when sending starts. The notifier catches everything; a missing token or secret key, an API
rejection (for example a blocked bot or rate limit) or a timeout only changes the counts. Sending is awaited so the result can
be shown, so an unreachable Telegram can delay the confirmation by a few seconds. No retry. Nothing is stored.

### 2.4 Showing the result
Appended to the success message, for example "Telegram: 1 sent, 2 not linked, 0 failed." For assignment and cancellation the
action redirects back to the shift page with four numbers in the address (`?tg=1.2.0.0`), and the page shows them in a notice
after checking the format. No names or ids go in the address. This replaces the in-place refresh for those actions only.

### 2.5 Reminders
A card on `/admin/schedules`: "Send tomorrow's reminders", with a confirmation showing the date, number of employees and how
many are linked. All departments. Pressing it again sends again (no history); the button is disabled while sending.

### 2.6 Message content
First name, shift title, Manila date and time, department, and what happened. No override reasons, no other employees, no
links. The text leaves the system to Telegram's servers.

## 3. Testing
- Unit: every message type; grouping and ordering; length cap; counts for sent, not linked, rejected, timeout and thrown
  errors; the token and chat ids never appear in a result.
- Before any real send: confirm by query that the only non-test link is EMP-0042's. Real messages can then reach only your
  own phone.
- Browser, admin session, **temporary shifts** in a future week, with EMP-0042 temporarily assigned (removed with the shifts;
  your 4 real assignments stay): publish; week publish (one combined message); assign to published; change time; cancel;
  unpublish; draft actions send nothing; unlinked employee counted; a temporary made-up link for one other employee to
  force a "failed" result (removed afterwards by that exact made-up id). You confirm arrival on your phone.
- Reminder: tomorrow relative to 25 Nov is 26 Nov, where EMP-0042 has a real published shift, so one real reminder to your
  phone can be tested without changing data. Only with your go-ahead.
- Regression: unit tests, `tsc`, lint, build, seed check, client bundle scan, employee pages; exact counts; the link intact;
  the 30 November week still draft. Test audit rows are removed by owner SQL as before.

## 4. Effort and limits
Rough estimate 3–4 hours. Limits: manual reminders only; no history, so no proof of delivery later and duplicates are possible
by pressing twice; a message can be outdated if the shift changes again a moment later; only linked employees receive
anything (one today).

## 5. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| N1 | Send "withdrawn" when a published shift is unpublished (it is a draft afterwards) | yes, otherwise employees keep believing they work it |
| N2 | Which edits notify | start, end, department, position; not title, notes or headcount |
| N3 | Shifts that already ended | send nothing |
| N4 | Report for assign and cancel through the address (`?tg=`) | yes |
| N5 | Reminders: all departments, tomorrow, one message per employee | yes |
| N6 | Show timeouts as "delivery unknown", separate from failed | yes |
