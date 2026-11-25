# Telegram integration plan — T1–T5 and M1 approved; SQL passed a rolled-back test; migration APPLIED 2026-11-25; application work not approved

Date: 2026-11-25. Brief: "Automatic shift notifications and reminders on schedule changes"; demo step "Employee receives the
shift alert on Telegram".

## 1. Approved decisions and conditions (user, 2026-11-25)
- T1 new table for chat ids, with row-level security; T2 manual reminders (timed reminders deferred); T3 notification calls
  in the finished publish, assign, edit and cancel actions; T4 no message history; T5 real test messages only to the user's
  own Telegram account.
- Employees register and unlink only their own Telegram account; one chat id cannot belong to two employees; chat ids are not
  exposed unnecessarily; `TELEGRAM_BOT_TOKEN` lives only in server environment variables, never in the frontend or database.
- A Telegram failure never fails or rolls back a scheduling action; results are reported; no automatic retry.
- Approval of this plan does **not** authorise running the SQL. It needs its own approval.

## 2. Migration for review (NOT applied; no file in `supabase/migrations/` yet)

Proposed name `20261125012350_employee_telegram.sql`:

```sql
create table public.employee_telegram (
  employee_id uuid        primary key references public.employees (id) on delete cascade,
  chat_id     bigint      not null,
  linked_at   timestamptz not null default now(),
  constraint employee_telegram_chat_id_key  unique (chat_id),
  constraint employee_telegram_private_chat check (chat_id > 0)   -- private chats only; group ids are negative
);

alter table public.employee_telegram enable row level security;

revoke all on public.employee_telegram from public, anon, authenticated, service_role;

-- Signed-in users can see WHETHER a link exists, never the chat id, and can remove it. They cannot create or change one.
grant select (employee_id, linked_at) on public.employee_telegram to authenticated;
grant delete on public.employee_telegram to authenticated;

-- Only server code with the secret key creates links (after verifying the person controls the chat) and reads chat ids.
grant select, insert, delete on public.employee_telegram to service_role;

create policy employee_telegram_select on public.employee_telegram for select to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()));

create policy employee_telegram_delete on public.employee_telegram for delete to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()));
```

Rollback (links are lost; employees link again): `drop table public.employee_telegram;`

No existing table, policy, function or row is touched.

### Who can do what

| Role | See link status | See chat id | Create | Change | Remove |
|---|---|---|---|---|---|
| anonymous | no | no | no | no | no |
| employee | own only | no | no direct write | no | own only |
| admin (signed in) | all | no | no | no | any (decision M1) |
| server with secret key | yes | yes | yes, after verification | no | yes |

### Rolled-back test result (2026-11-25, run by Claude; M1 approved: admins may remove links, never read chat ids)

The SQL above ran inside one transaction that was aborted by a final `raise`; no migration file was created and nothing was
applied. Access was simulated with `set local role` and request claims (not through the API with real keys).

- Grants after the `revoke`: anon none; authenticated table DELETE plus column SELECT on `employee_id`, `linked_at` only;
  service_role SELECT, INSERT, DELETE. RLS enabled (not forced; the table owner bypasses it). service_role has BYPASSRLS, so
  its limits are its grants and the secrecy of the key.
- service_role: created and read links; duplicate chat id and second link for one employee 23505; negative and zero chat id
  23514; null 23502; unknown employee 23503; UPDATE 42501.
- anon: select, insert, update, delete all 42501.
- Employee: saw only the own row (3 existed), 0 rows for another employee; reading, filtering on or returning `chat_id`,
  `select *`, insert, upsert, update and truncate 42501; deleting others removed 0 rows; an unfiltered delete would remove
  only the own row; deleted the own link; the other links remained.
- Signed-in user without an employee record: 0 rows seen, 0 deleted.
- Admin: saw all 3 link statuses; every attempt to read or filter on `chat_id`, insert, update or truncate 42501; removed
  another employee's link.
- Cascade: deleting a temporary employee removed its link.
- Afterwards, checked separately: no table, type, policy, constraint or grant with the name; public catalog counts identical
  to before (48 relations, 34 types, 44 policies, 49 constraints, 210 table grants, 1027 column grants); migrations still 3;
  temporary employee absent; data counts unchanged.

Implementation notes: signed-in queries must name columns (`select *` is refused); relinking is delete then insert.

### Permanent apply (2026-11-25, approved by the user, run by Claude)

Applied as migration `20261125012350 employee_telegram` with the SQL above; repo copy
`supabase/migrations/20261125012350_employee_telegram.sql`. Verified: columns, 4 constraints, 2 policies, RLS and grants
as reviewed (relations 48→51, policies 44→46, constraints 49→53); rolled-back tests on the real table (30 must-fail
statements all refused; ownership, admin removal and cascade as expected); through the Data API with real keys, anonymous
was refused (401, 42501) for both selects and the secret key could read both (0 rows); security advisor shows no finding for
the table (only the earlier leaked-password-protection warning). Table is empty; data counts unchanged. Not verified through
the API: signed-in employee and admin sessions. `database.types.ts` is NOT yet updated.

**Not approved:** linking page, notification calls, message tests.

## 3. Linking and unlinking (ownership proof)

An employee must not be able to type a chat id: they could enter someone else's, receive nothing themselves, send that person
their shifts and block that person from linking. So the app proves control of the chat:

1. The employee opens a new page, `/me/telegram`, and presses **Connect Telegram**.
2. The server builds a code for **that signed-in employee**: employee id and a 10-minute expiry, signed with HMAC-SHA-256
   using a key derived from the bot token, at most 64 characters. No code table is needed.
3. The employee opens the shown link `t.me/<bot>?start=<code>` and presses **Start**.
4. The employee presses **Check connection**. The server calls Telegram `getUpdates`, looks for `/start <code>` from a
   private chat whose sender is the chat, checks the signature, the expiry and that the code is for the signed-in employee,
   then inserts the row with the secret-key client.
5. Refused: expired or altered code; a code of another employee; the same code arriving from two different chats; a chat id
   already linked to someone else; an employee who is already linked (unlink first).

**Unlink:** a button on the same page deletes the employee's own row through their own session (RLS applies).

Limits: anyone who obtains a code within its 10 minutes and presses Start first, alone, would be linked, so the code is shown
only to its owner. The code can be reused until it expires, but only while no link exists. `getUpdates` reads the latest 100
updates and does not work if a webhook is set on the bot. **Only employees with a login can link** (today only EMP-0042);
others need an account through the existing invite flow.

## 4. When a message is sent
Only after the database change has succeeded, and only about **published** shifts.

| Event (existing action) | Message to |
|---|---|
| `publishShift` | each assigned employee |
| `publishWeek` | each affected employee, one message listing their shifts |
| `assignEmployee`, `assignEmployeeWithOverrides` on a published shift | that employee |
| `updateShift` changing time, department or position of a published shift | each assigned employee |
| `cancelShift` of a published shift | each assigned employee |
| `unpublishShift` | each assigned employee ("withdrawn") |
| Admin button "Send tomorrow's reminders" (with confirmation; pressing twice sends twice) | employees with a published shift tomorrow |

Text: first name, shift title, Manila date and time, department, what changed. No override reasons, no other employees.
Each action gains one notify call after its successful write; its rules and checks do not change. Chat ids are read on the
server for exactly the affected employee ids, after the admin role check.

## 5. Failures and token handling
- Plain `fetch`, 5-second timeout, no new package, no retry, no stored messages.
- Result text, for example "Telegram: 2 sent, 1 not linked, 0 failed"; a timeout is "delivery unknown". The scheduling
  change always stays.
- No token configured: scheduling works and the result says so.
- You create the bot with @BotFather and put `TELEGRAM_BOT_TOKEN` into `.env.local` yourself (never in this chat). `.env*` is
  ignored by `.gitignore`. Request addresses contain the token, so addresses and raw fetch errors are never logged or shown.

## 6. Steps, each reported before the next
1. You review the SQL (this document).
2. After SQL approval: run it inside a transaction that is rolled back, with the access tests below; report.
3. After your go-ahead: apply the migration, update `database.types.ts`, rerun the access tests and the security advisor.
4. Linking page and code verification. 5. Notification calls and reminder button. 6. Real tests and report.

## 7. Testing
- Access tests (rolled back): employee sees only own status; selecting `chat_id` is refused; employee insert and update are
  refused; employee cannot delete another's row; anonymous refused; admin sees status but not `chat_id`; duplicate chat id and
  negative chat id refused; deleting an employee removes the link.
- Unit tests: code sign and verify (valid, expired, altered, wrong employee, length); update matching (group chat, two chats,
  no match); message text; grouped week message; sender with a stubbed `fetch` (success, API error, timeout, not configured);
  the token never appears in an error or result.
- Browser with temporary shifts, deleted afterwards: link, publish one, publish a week, assign, change time, cancel,
  unpublish, reminder, draft sends nothing, unlinked employee, send failure leaves the change in place, unlink. You confirm
  arrival on your phone; Claude cannot see it. Only your own chat is ever linked.
- Regression: unit tests, `tsc`, lint, build, seed check; the 30 November week and existing assignments unchanged; counts.

## 8. Needed from you
Bot and token; restart of the server; pressing Start; internet on the demo computer; SQL approval; decision M1.

Rough estimate 4–6 hours after approval and token (more than the earlier 3–5, because of verified self-linking).

## 9. Open decision
**M1 (APPROVED 2026-11-25: yes, removal only).** May an administrator remove an employee's link (for example when someone leaves)? Recommended: yes, remove only. To
forbid it, drop `or (select private.is_admin())` from the delete policy.
