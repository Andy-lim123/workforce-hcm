# Phase 3 — SQL: Part A APPLIED (S1), Part B NOT APPLIED (S2)

**Part A was applied on 2026-11-24** as migration `20261124101712 schedule_overrides_audit` after rolled-back verification
(repo copy: `supabase/migrations/20261124101712_schedule_overrides_audit.sql`; the SQL below is the approved text). **Part B has not been
run against any database**; its syntax and behaviour are unverified until it is tested in a rolled-back transaction at its milestone.
Part B was revised after review (shift row locked before the employee row; function revokes include `anon` and `authenticated`).

---

## Part A — Override audit trail (APPLIED 2026-11-24, Gate S1)

### A1. Table

```sql
create table public.schedule_overrides (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  overridden_by       uuid references public.profiles (id) on delete set null,
  overridden_by_email text not null,                       -- snapshot: survives profile deletion
  shift_id            uuid references public.shifts (id) on delete set null,
  employee_id         uuid references public.employees (id) on delete set null,
  shift_title         text not null,                       -- snapshots: audit rows stay readable
  shift_starts_at     timestamptz not null,                -- after the shift or employee is deleted
  shift_ends_at       timestamptz not null,
  employee_code       text not null,
  rule                text not null check (rule in (
                        'outside_availability', 'insufficient_rest', 'exceeds_weekly_hours',
                        'position_mismatch', 'over_headcount')),
  reason              text not null check (char_length(btrim(reason)) between 10 and 500),
  detail              text check (detail is null or char_length(detail) <= 500)
);
create index schedule_overrides_shift_idx    on public.schedule_overrides (shift_id);
create index schedule_overrides_employee_idx on public.schedule_overrides (employee_id, created_at desc);
create index schedule_overrides_by_idx       on public.schedule_overrides (overridden_by);

alter table public.schedule_overrides enable row level security;
revoke all on public.schedule_overrides from anon, authenticated;
grant select, insert on public.schedule_overrides to authenticated;   -- no update, no delete: append-only

create policy schedule_overrides_select on public.schedule_overrides for select to authenticated
  using ((select private.is_admin()));
create policy schedule_overrides_insert on public.schedule_overrides for insert to authenticated
  with check ((select private.is_admin()) and overridden_by = (select auth.uid()));
```

Notes: employees cannot read or write it. The `rule` list must equal `RULE_IDS` in `lib/scheduling.ts` (a unit test will check
the migration file once it exists). `service_role` can still alter rows; that is the project owner, not the app.
The reason minimum (10 characters) is mirrored in the server action.

### A2. Atomic assign-with-overrides function (proposed by Claude; needs approval)

The Data API cannot run two statements in one transaction. Without this function the assignment and its audit rows are
separate calls and could diverge. As an RPC both succeed or both roll back.

```sql
create function public.assign_employee(
  p_shift_id    uuid,
  p_employee_id uuid,
  p_overrides   jsonb default '[]'::jsonb   -- [{"rule": "...", "reason": "...", "detail": "..."}]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor      uuid := auth.uid();
  v_email      text;
  v_shift      public.shifts%rowtype;
  v_emp        public.employees%rowtype;
  v_assignment uuid;
  o            jsonb;
begin
  if not private.is_admin() then
    raise exception 'only admins can assign shifts' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts    where id = p_shift_id;
  if not found then raise exception 'shift not found'    using errcode = 'P0002'; end if;
  select * into v_emp   from public.employees where id = p_employee_id;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  select email into v_email from public.profiles where id = v_actor;

  insert into public.shift_assignments (shift_id, employee_id, assigned_by)
  values (p_shift_id, p_employee_id, v_actor)
  returning id into v_assignment;

  for o in select value from jsonb_array_elements(p_overrides) loop
    insert into public.schedule_overrides (
      overridden_by, overridden_by_email, shift_id, employee_id, shift_title,
      shift_starts_at, shift_ends_at, employee_code, rule, reason, detail)
    values (
      v_actor, v_email, v_shift.id, v_emp.id, v_shift.title,
      v_shift.starts_at, v_shift.ends_at, v_emp.employee_code,
      o ->> 'rule', o ->> 'reason', o ->> 'detail');
  end loop;

  return v_assignment;
end $$;

revoke all on function public.assign_employee(uuid, uuid, jsonb) from public, anon;
grant execute on function public.assign_employee(uuid, uuid, jsonb) to authenticated;
```

Behaviour: `security invoker`, so RLS still applies as the calling admin. A bad `rule`, a short or missing `reason`, or a
non-array `p_overrides` raises an error and the whole call, including the assignment, rolls back. If part B is applied the
overlap trigger runs on the `insert` and also rolls everything back. The database stores what the admin **declared**; the
application (`lib/scheduling.ts`) remains the source of truth for whether a violation really exists.

### A3. Rollback (loses audit data; export first)

```sql
drop function public.assign_employee(uuid, uuid, jsonb);
drop table public.schedule_overrides;
```

---

## Part B — Double-booking protection (ON HOLD; no approval; SQL for review → Gate S2)

### B1. Functions and triggers

```sql
-- Fires when an assignment is created or moved to another shift or employee.
create function private.check_assignment_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_start  timestamptz;
  v_end    timestamptz;
  v_status public.shift_status;
begin
  -- Lock order is always shift first, then employee (the shifts trigger below gets the shift row lock
  -- from its own UPDATE), so the two triggers cannot deadlock. FOR SHARE on the shift blocks while another
  -- transaction is changing that shift's times, so the overlap check below never reads stale times.
  select starts_at, ends_at, status into v_start, v_end, v_status
  from public.shifts where id = new.shift_id for share;

  -- Serialise all assignment changes for this employee. A second transaction waits on this lock
  -- until the first commits or rolls back, and its next statement then sees the first one's rows.
  perform 1 from public.employees where id = new.employee_id for update;
  if v_status is null or v_status = 'cancelled' then
    return new;                       -- cancelled shifts never conflict
  end if;

  if exists (
    select 1
    from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    where sa.employee_id = new.employee_id
      and sa.id <> new.id
      and s.status <> 'cancelled'
      and s.starts_at < v_end
      and s.ends_at   > v_start      -- touching shifts (end = start) are allowed
  ) then
    raise exception 'employee already has an overlapping shift'
      using errcode = '23P01', hint = 'overlapping_assignment';   -- exclusion_violation
  end if;

  return new;
end $$;

-- Fires when an already-assigned shift changes time or is un-cancelled.
create function private.check_shift_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Lock every assigned employee in a fixed order (by id) so concurrent changes cannot deadlock.
  perform 1
  from public.employees e
  where e.id in (select employee_id from public.shift_assignments where shift_id = new.id)
  order by e.id
  for update;

  if exists (
    select 1
    from public.shift_assignments a1
    join public.shift_assignments a2 on a2.employee_id = a1.employee_id and a2.shift_id <> a1.shift_id
    join public.shifts s2 on s2.id = a2.shift_id
    where a1.shift_id = new.id
      and s2.status <> 'cancelled'
      and s2.starts_at < new.ends_at
      and s2.ends_at   > new.starts_at
  ) then
    raise exception 'change would give an assigned employee an overlapping shift'
      using errcode = '23P01', hint = 'overlapping_assignment';
  end if;

  return new;
end $$;

revoke all on function private.check_assignment_overlap(), private.check_shift_overlap() from public, anon, authenticated;

create trigger check_assignment_overlap
  before insert or update of shift_id, employee_id on public.shift_assignments
  for each row execute function private.check_assignment_overlap();

create trigger check_shift_overlap
  before update of starts_at, ends_at, status on public.shifts
  for each row when (new.status <> 'cancelled')
  execute function private.check_shift_overlap();
```

### B2. Locking strategy

- **What is locked:** one row, the employee's row in `public.employees`, with `FOR UPDATE`, only inside the trigger and
  only until the surrounding transaction ends (commit or rollback). No table lock, no advisory lock.
- **Why it prevents the race:** two admins assigning the same employee at the same moment both reach the `FOR UPDATE`;
  the second waits. When the first commits, the second continues and its overlap query (a new statement under
  `READ COMMITTED`, the Postgres and PostgREST default) sees the first assignment and raises `23P01`. Without the lock both
  overlap queries would run against snapshots that lack each other's row and both would insert.
- **Different employees never block each other.** Shifts are ordinary rows and are not locked by the assignment trigger.
- **Cost:** while a transaction holds the lock, other writes to that same employee row (profile edits, login linking)
  wait for it. Transactions are one request long, so the wait is milliseconds.
- **Deadlocks:** an assignment locks one employee, so it cannot form a cycle with itself. A shift time change locks several
  employees in ascending id order. Any code that locks several employees in one transaction (the Phase 4 batch) must also
  sort by id. (`ORDER BY … FOR UPDATE` follows output order in the normal case; Postgres documents rare exceptions.)
- **`SECURITY DEFINER`:** lets the trigger lock and read regardless of the caller's RLS, so the check is identical for every
  caller. It only reads and raises an error; it returns nothing to the caller beyond the message. `search_path` is empty and
  every object is schema-qualified. Triggers also fire for `service_role` (not when `session_replication_role = replica`).

### B3. Transaction behaviour and rollback implications

- Raising an exception aborts the statement and, in a Data API request or RPC call, the whole request transaction:
  nothing it did stays. Locks are released at once. With `public.assign_employee` (part A) the assignment and its audit rows
  roll back together.
- Rule scope: **only overlap is enforced in the database.** Rest hours, weekly hours, availability, position and headcount
  stay application warnings (overridable and audited), by design.
- The trigger does not inspect existing rows. The seed was checked read-only: 0 overlapping pairs among 330 assignments, so
  enabling it creates no instant conflicts, and unrelated updates (`update of` columns) do not fire it.
- Error handling: the app maps `23P01` with hint `overlapping_assignment` to "This employee already has an overlapping shift."
- Existing writers are unaffected unless they overlap: the seed script (it avoids overlaps by construction) and the
  Phase 3 actions.
- **Removal:** `drop trigger check_assignment_overlap on public.shift_assignments; drop trigger check_shift_overlap on
  public.shifts; drop function private.check_assignment_overlap(); drop function private.check_shift_overlap();` Data is
  untouched and overlaps become possible again.

### B4. How it would be tested (after approval)

1. Rolled-back SQL: insert an overlapping assignment, expect `23P01`; touching shifts accepted; cancelled shift ignored;
   moving a shift's time into a conflict rejected; moving it to a free time accepted; un-cancelling into a conflict rejected.
2. Manual concurrency test (cannot be automated with one-statement tool calls): two SQL Editor tabs, each `begin;` then
   insert an overlapping assignment for the same employee; the second must block, then fail after the first `commit;`.
3. Seed script re-run on an empty copy loads without errors.
