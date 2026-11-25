-- Phase 3 / S1: override audit trail.
-- Append-only record of every scheduling warning an administrator overrides, plus an RPC that writes
-- an assignment and its audit rows in one transaction.

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
