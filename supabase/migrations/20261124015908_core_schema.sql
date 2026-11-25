-- Workforce Management System: core schema, helpers and Row Level Security.
-- Helper functions live in the `private` schema so they are not exposed through the Data API.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role          as enum ('admin', 'employee');
create type public.employment_type   as enum ('full_time', 'part_time', 'contract');
create type public.employee_status   as enum ('active', 'on_leave', 'inactive');
create type public.shift_status      as enum ('draft', 'published', 'cancelled');
create type public.attendance_status as enum ('present', 'late', 'absent', 'excused');

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       public.app_role not null default 'employee',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.positions (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  title         text not null,
  description   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (department_id, title)
);

create table public.skills (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- An employee may exist without a login; profile_id links them once they sign up.
create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid unique references public.profiles (id) on delete set null,
  employee_code    text not null unique,
  first_name       text not null,
  last_name        text not null,
  email            text not null,
  phone            text,
  department_id    uuid references public.departments (id) on delete set null,
  position_id      uuid references public.positions (id) on delete set null,
  employment_type  public.employment_type not null default 'full_time',
  status           public.employee_status not null default 'active',
  hire_date        date not null default current_date,
  max_weekly_hours numeric(5,2) not null default 40 check (max_weekly_hours between 0 and 168),
  external_ref     text unique, -- id in an external HRMS, for future integrations
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index employees_email_key on public.employees (lower(email));
create index employees_department_id_idx on public.employees (department_id);
create index employees_position_id_idx on public.employees (position_id);

create table public.employee_skills (
  employee_id uuid not null references public.employees (id) on delete cascade,
  skill_id    uuid not null references public.skills (id) on delete cascade,
  proficiency smallint not null default 3 check (proficiency between 1 and 5),
  created_at  timestamptz not null default now(),
  primary key (employee_id, skill_id)
);
create index employee_skills_skill_id_idx on public.employee_skills (skill_id);

-- Recurring weekly availability windows. day_of_week: 0 = Sunday ... 6 = Saturday.
create table public.employee_availability (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_time > start_time)
);
create index employee_availability_employee_day_idx on public.employee_availability (employee_id, day_of_week);

create table public.shifts (
  id                 uuid primary key default gen_random_uuid(),
  department_id      uuid not null references public.departments (id) on delete cascade,
  position_id        uuid references public.positions (id) on delete set null,
  title              text not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  required_headcount smallint not null default 1 check (required_headcount > 0),
  status             public.shift_status not null default 'draft',
  notes              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index shifts_department_starts_idx on public.shifts (department_id, starts_at);
create index shifts_starts_at_idx on public.shifts (starts_at);
create index shifts_position_id_idx on public.shifts (position_id);
create index shifts_created_by_idx on public.shifts (created_by);

create table public.shift_assignments (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.shifts (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (shift_id, employee_id)
);
create index shift_assignments_employee_id_idx on public.shift_assignments (employee_id);
create index shift_assignments_assigned_by_idx on public.shift_assignments (assigned_by);

create table public.attendance_records (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  shift_assignment_id uuid references public.shift_assignments (id) on delete set null,
  work_date           date not null,
  clock_in            timestamptz,
  clock_out           timestamptz,
  status              public.attendance_status not null default 'present',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (clock_out is null or (clock_in is not null and clock_out > clock_in))
);
create index attendance_records_employee_date_idx on public.attendance_records (employee_id, work_date);
create index attendance_records_assignment_idx on public.attendance_records (shift_assignment_id);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','departments','positions','skills','employees',
                           'employee_availability','shifts','attendance_records']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helper functions (security definer: read without RLS to avoid policy recursion)
-- ---------------------------------------------------------------------------
create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create function private.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where profile_id = (select auth.uid());
$$;

create function private.is_assigned_to_shift(p_shift_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shift_assignments sa
    join public.employees e on e.id = sa.employee_id
    where sa.shift_id = p_shift_id and e.profile_id = (select auth.uid())
  );
$$;

revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin(), private.current_employee_id(),
  private.is_assigned_to_shift(uuid) to authenticated;

-- New auth user -> profile (always role 'employee'; never trust client metadata for role),
-- then link a pre-existing employee record with the same email.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  update public.employees set profile_id = new.id
  where profile_id is null and lower(email) = lower(new.email);

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Only admins may change a role through the API (service role / SQL editor are unaffected).
create function private.guard_profile_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role
     and current_user = 'authenticated'
     and not private.is_admin() then
    raise exception 'only admins can change roles' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_profile_role
  before update on public.profiles
  for each row execute function private.guard_profile_role();

-- ---------------------------------------------------------------------------
-- Grants: anon gets nothing; authenticated gets table access gated by RLS.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.departments, public.positions, public.skills,
  public.employees, public.employee_skills, public.employee_availability, public.shifts,
  public.shift_assignments, public.attendance_records, public.notifications from anon, authenticated;

grant select, insert, update, delete on public.departments, public.positions, public.skills,
  public.employees, public.employee_skills, public.employee_availability, public.shifts,
  public.shift_assignments, public.attendance_records to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, role) on public.profiles to authenticated;

grant select, insert, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (one policy per action to avoid overlapping permissive policies)
-- ---------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.departments           enable row level security;
alter table public.positions             enable row level security;
alter table public.skills                enable row level security;
alter table public.employees             enable row level security;
alter table public.employee_skills       enable row level security;
alter table public.employee_availability enable row level security;
alter table public.shifts                enable row level security;
alter table public.shift_assignments     enable row level security;
alter table public.attendance_records    enable row level security;
alter table public.notifications         enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

-- reference data: readable by any signed-in user, writable by admins
do $$
declare t text;
begin
  foreach t in array array['departments','positions','skills'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (true)', t);
  end loop;
end $$;

-- admin-only writes
do $$
declare t text;
begin
  foreach t in array array['departments','positions','skills','employees','employee_skills',
                           'shifts','shift_assignments','attendance_records'] loop
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check ((select private.is_admin()))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using ((select private.is_admin()))', t);
  end loop;
end $$;

-- own-or-admin reads
create policy employees_select on public.employees for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.is_admin()));
create policy employee_skills_select on public.employee_skills for select to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()));
create policy attendance_records_select on public.attendance_records for select to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()));

-- availability: employees manage their own, admins manage all
create policy employee_availability_select on public.employee_availability for select to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()));
create policy employee_availability_insert on public.employee_availability for insert to authenticated
  with check (employee_id = (select private.current_employee_id()) or (select private.is_admin()));
create policy employee_availability_update on public.employee_availability for update to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()))
  with check (employee_id = (select private.current_employee_id()) or (select private.is_admin()));
create policy employee_availability_delete on public.employee_availability for delete to authenticated
  using (employee_id = (select private.current_employee_id()) or (select private.is_admin()));

-- shifts: employees see only published shifts they are assigned to
create policy shifts_select on public.shifts for select to authenticated
  using ((select private.is_admin())
         or (status = 'published' and private.is_assigned_to_shift(id)));
create policy shift_assignments_select on public.shift_assignments for select to authenticated
  using ((select private.is_admin())
         or (employee_id = (select private.current_employee_id())
             and exists (select 1 from public.shifts s where s.id = shift_id and s.status = 'published')));

-- notifications: recipients read and mark their own; admins create and delete
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy notifications_insert on public.notifications for insert to authenticated
  with check ((select private.is_admin()));
create policy notifications_delete on public.notifications for delete to authenticated
  using ((select private.is_admin()));
