-- Synthetic demo data for the Workforce Management System.
-- Every person and organisation in this file is fictional. Emails use the reserved example.com domain.
--
-- Safe to re-run: it does nothing when departments already exist.
-- Dates are relative to "now", so a fresh seed always has last week (published, with attendance),
-- this week (published) and next week (draft, partly unfilled) in the demo organisation's timezone.

do $seed$
declare
  tz    constant text := 'Asia/Manila';  -- demo organisation timezone
  week0 constant date := date_trunc('week', now() at time zone tz)::date;  -- Monday of this week
  s record;
begin
  if exists (select 1 from public.departments) then
    raise notice 'Seed skipped: data already present.';
    return;
  end if;

  -- Departments and positions -------------------------------------------------
  insert into public.departments (name, description) values
    ('Customer Support', 'Phone, chat and email support, seven days a week.'),
    ('Warehouse',        'Receiving, picking, packing and inventory control.'),
    ('Retail',           'Flagship store sales floor and checkout.'),
    ('Logistics',        'Last-mile delivery and dispatch.'),
    ('Facilities',       'Building maintenance and security.');

  insert into public.positions (department_id, title)
  select d.id, p.title
  from (values
    ('Customer Support', 'Support Agent'), ('Customer Support', 'Senior Support Agent'), ('Customer Support', 'Support Team Lead'),
    ('Warehouse', 'Picker Packer'), ('Warehouse', 'Forklift Operator'), ('Warehouse', 'Inventory Clerk'), ('Warehouse', 'Warehouse Supervisor'),
    ('Retail', 'Sales Associate'), ('Retail', 'Cashier'), ('Retail', 'Store Supervisor'),
    ('Logistics', 'Delivery Driver'), ('Logistics', 'Dispatcher'),
    ('Facilities', 'Maintenance Technician'), ('Facilities', 'Security Officer')
  ) p(dept, title)
  join public.departments d on d.name = p.dept;

  -- Skills --------------------------------------------------------------------
  insert into public.skills (name, description) values
    ('Customer Service',          'Resolving customer questions and complaints.'),
    ('Technical Troubleshooting', 'Diagnosing product and account issues.'),
    ('Live Chat',                 'Handling several chat conversations at once.'),
    ('Bilingual Support',         'Supporting customers in a second language.'),
    ('Team Leadership',           'Leading a shift and coaching team members.'),
    ('Forklift Operation',        'Certified to operate counterbalance and reach trucks.'),
    ('Inventory Management',      'Cycle counts, stock reconciliation and receiving.'),
    ('Order Picking',             'Accurate picking and packing against orders.'),
    ('Cash Handling',             'Till operation, refunds and end-of-day balancing.'),
    ('Visual Merchandising',      'Product displays and store presentation.'),
    ('Route Planning',            'Planning efficient multi-stop delivery routes.'),
    ('Commercial Driving',        'Licensed to drive light commercial vehicles.'),
    ('Electrical Maintenance',    'Low-voltage electrical repairs and inspections.'),
    ('HVAC Maintenance',          'Heating, ventilation and air-conditioning upkeep.'),
    ('Security Monitoring',       'CCTV monitoring, patrols and incident reports.'),
    ('First Aid',                 'Current first-aid certification.');

  -- Employees -----------------------------------------------------------------
  insert into public.employees (employee_code, first_name, last_name, email, phone,
                                department_id, position_id, employment_type, hire_date, max_weekly_hours)
  select format('EMP-%s', lpad(e.n::text, 4, '0')),
         e.first_name, e.last_name,
         lower(replace(e.first_name || '.' || e.last_name, '''', '')) || '@example.com',
         format('+1 555 01%s', lpad(e.n::text, 2, '0')),
         d.id, p.id, e.etype::public.employment_type,
         current_date - (e.n * 53 % 1900 + 30),
         case e.etype when 'part_time' then 24 when 'contract' then 32 else 40 end
  from (values
    ( 1, 'Maria',    'Santos',    'Customer Support', 'Support Team Lead',      'full_time'),
    ( 2, 'James',    'Carter',    'Customer Support', 'Senior Support Agent',   'full_time'),
    ( 3, 'Aiko',     'Tanaka',    'Customer Support', 'Senior Support Agent',   'full_time'),
    ( 4, 'Daniel',   'Reyes',     'Customer Support', 'Support Agent',          'full_time'),
    ( 5, 'Priya',    'Nair',      'Customer Support', 'Support Agent',          'full_time'),
    ( 6, 'Lucas',    'Silva',     'Customer Support', 'Support Agent',          'full_time'),
    ( 7, 'Emma',     'Novak',     'Customer Support', 'Support Agent',          'part_time'),
    ( 8, 'Kwame',    'Mensah',    'Customer Support', 'Support Agent',          'full_time'),
    ( 9, 'Sofia',    'Rossi',     'Customer Support', 'Support Agent',          'part_time'),
    (10, 'Marcus',   'Johnson',   'Warehouse',        'Warehouse Supervisor',   'full_time'),
    (11, 'Elena',    'Petrova',   'Warehouse',        'Inventory Clerk',        'full_time'),
    (12, 'Diego',    'Fernandez', 'Warehouse',        'Forklift Operator',      'full_time'),
    (13, 'Tomasz',   'Kowalski',  'Warehouse',        'Forklift Operator',      'full_time'),
    (14, 'Grace',    'Kim',       'Warehouse',        'Picker Packer',          'full_time'),
    (15, 'Omar',     'Haddad',    'Warehouse',        'Picker Packer',          'full_time'),
    (16, 'Liam',     'O''Brien',  'Warehouse',        'Picker Packer',          'contract'),
    (17, 'Nina',     'Andersen',  'Warehouse',        'Picker Packer',          'part_time'),
    (18, 'Isabella', 'Garcia',    'Retail',           'Store Supervisor',       'full_time'),
    (19, 'Noah',     'Williams',  'Retail',           'Sales Associate',        'full_time'),
    (20, 'Chloe',    'Martin',    'Retail',           'Sales Associate',        'full_time'),
    (21, 'Ravi',     'Patel',     'Retail',           'Cashier',                'full_time'),
    (22, 'Hannah',   'Schmidt',   'Retail',           'Cashier',                'part_time'),
    (23, 'Mateo',    'Lopez',     'Retail',           'Sales Associate',        'part_time'),
    (24, 'Zara',     'Ahmed',     'Retail',           'Sales Associate',        'full_time'),
    (25, 'Samuel',   'Okafor',    'Logistics',        'Dispatcher',             'full_time'),
    (26, 'Victor',   'Dubois',    'Logistics',        'Delivery Driver',        'full_time'),
    (27, 'Ana',      'Costa',     'Logistics',        'Delivery Driver',        'full_time'),
    (28, 'Kenji',    'Watanabe',  'Logistics',        'Delivery Driver',        'full_time'),
    (29, 'Fatima',   'Zahra',     'Logistics',        'Delivery Driver',        'contract'),
    (30, 'Robert',   'Miller',    'Facilities',       'Maintenance Technician', 'full_time'),
    (31, 'Lina',     'Hoang',     'Facilities',       'Maintenance Technician', 'full_time'),
    (32, 'Ethan',    'Brooks',    'Facilities',       'Security Officer',       'full_time'),
    (33, 'Mei',      'Chen',      'Facilities',       'Security Officer',       'full_time')
  ) e(n, first_name, last_name, dept, title, etype)
  join public.departments d on d.name = e.dept
  join public.positions p on p.department_id = d.id and p.title = e.title;

  update public.employees set status = 'on_leave' where employee_code = 'EMP-0008';

  -- Employee skills: core skills from the position, plus a few extras ------------
  insert into public.employee_skills (employee_id, skill_id, proficiency)
  select e.id, sk.id, 2 + abs(hashtext(e.employee_code || sk.name)) % 4  -- proficiency 2..5
  from public.employees e
  join public.positions p on p.id = e.position_id
  join (values
    ('Support Agent', 'Customer Service'), ('Support Agent', 'Live Chat'),
    ('Senior Support Agent', 'Customer Service'), ('Senior Support Agent', 'Technical Troubleshooting'), ('Senior Support Agent', 'Live Chat'),
    ('Support Team Lead', 'Customer Service'), ('Support Team Lead', 'Technical Troubleshooting'), ('Support Team Lead', 'Team Leadership'),
    ('Picker Packer', 'Order Picking'),
    ('Forklift Operator', 'Forklift Operation'), ('Forklift Operator', 'Order Picking'),
    ('Inventory Clerk', 'Inventory Management'),
    ('Warehouse Supervisor', 'Inventory Management'), ('Warehouse Supervisor', 'Team Leadership'), ('Warehouse Supervisor', 'Forklift Operation'),
    ('Sales Associate', 'Customer Service'), ('Sales Associate', 'Visual Merchandising'),
    ('Cashier', 'Cash Handling'), ('Cashier', 'Customer Service'),
    ('Store Supervisor', 'Team Leadership'), ('Store Supervisor', 'Cash Handling'), ('Store Supervisor', 'Visual Merchandising'),
    ('Delivery Driver', 'Commercial Driving'), ('Delivery Driver', 'Route Planning'),
    ('Dispatcher', 'Route Planning'), ('Dispatcher', 'Customer Service'),
    ('Maintenance Technician', 'Electrical Maintenance'), ('Maintenance Technician', 'HVAC Maintenance'),
    ('Security Officer', 'Security Monitoring'), ('Security Officer', 'First Aid')
  ) m(title, skill) on m.title = p.title
  join public.skills sk on sk.name = m.skill;

  insert into public.employee_skills (employee_id, skill_id, proficiency)
  select e.id, sk.id, 3 + abs(hashtext(e.employee_code)) % 3
  from public.employees e
  join public.departments d on d.id = e.department_id
  join public.positions p on p.id = e.position_id
  join public.skills sk on
       (sk.name = 'Bilingual Support' and d.name = 'Customer Support' and abs(hashtext(e.employee_code)) % 3 = 0)
    or (sk.name = 'First Aid' and p.title in ('Support Team Lead', 'Warehouse Supervisor', 'Store Supervisor'))
  on conflict do nothing;

  -- Weekly availability --------------------------------------------------------
  -- Full-time: 5 consecutive days, contract: 4, part-time: 3. The time window depends on the role.
  insert into public.employee_availability (employee_id, day_of_week, start_time, end_time)
  select e.id,
         (start_dow + k) % 7,
         w.start_t, w.end_t
  from (
    select e.*, p.title, row_number() over (order by e.employee_code) as rn
    from public.employees e join public.positions p on p.id = e.position_id
  ) e
  cross join lateral (select
      case when e.title in ('Maintenance Technician', 'Dispatcher') then 1           -- Mon-Fri
           when e.employment_type = 'part_time' then (e.rn % 7)::int
           else (array[1, 3, 6])[1 + e.rn % 3]                                        -- Mon, Wed or Sat start
      end as start_dow,
      case e.employment_type when 'full_time' then 5 when 'contract' then 4 else 3 end as ndays) o
  cross join lateral generate_series(0, o.ndays - 1) k
  cross join lateral (select
      case
        when e.title in ('Support Team Lead', 'Senior Support Agent') then time '06:00'
        when e.title = 'Support Agent' and e.rn % 2 = 0 then time '06:00'
        when e.title = 'Support Agent' then time '13:00'
        when e.title = 'Security Officer' then time '21:00'
        when e.title in ('Sales Associate', 'Cashier', 'Store Supervisor') then time '09:00'
        else time '07:00'
      end as start_t,
      case
        when e.title in ('Support Team Lead', 'Senior Support Agent') then time '22:00'
        when e.title = 'Support Agent' and e.rn % 2 = 0 then time '15:00'
        when e.title = 'Support Agent' then time '22:00'
        when e.title = 'Security Officer' then time '23:59'   -- overnight shifts start inside this window
        when e.title in ('Sales Associate', 'Cashier', 'Store Supervisor') then time '21:00'
        when e.employment_type = 'part_time' then time '16:00'
        when e.title in ('Delivery Driver', 'Dispatcher') then time '18:00'
        when e.title = 'Maintenance Technician' then time '17:00'
        else time '23:00'
      end as end_t) w;

  -- Shifts: last week, this week (published) and next week (draft) --------------
  insert into public.shifts (department_id, position_id, title, starts_at, ends_at, required_headcount, status)
  select d.id, p.id, t.title,
         (g.day::date + t.start_t) at time zone tz,
         (g.day::date + t.start_t + t.dur) at time zone tz,
         t.headcount,
         (case when g.day::date < week0 + 7 then 'published' else 'draft' end)::public.shift_status
  from generate_series((week0 - 7)::timestamp, (week0 + 13)::timestamp, interval '1 day') g(day)
  join (values
    ('Customer Support', null,                     'Morning Support',  time '06:00', interval '8 hours',   3, '{1,2,3,4,5,6,7}'::int[]),
    ('Customer Support', null,                     'Evening Support',  time '14:00', interval '8 hours',   3, '{1,2,3,4,5,6,7}'),
    ('Warehouse',        null,                     'Warehouse Day',    time '07:00', interval '8 hours',   3, '{1,2,3,4,5,6}'),
    ('Warehouse',        null,                     'Warehouse Swing',  time '15:00', interval '8 hours',   2, '{1,2,3,4,5}'),
    ('Retail',           null,                     'Store Opening',    time '09:00', interval '8 hours',   2, '{1,2,3,4,5,6,7}'),
    ('Retail',           null,                     'Store Closing',    time '13:00', interval '8 hours',   2, '{1,2,3,4,5,6,7}'),
    ('Logistics',        'Delivery Driver',        'Delivery Route',   time '08:00', interval '9 hours',   2, '{1,2,3,4,5,6}'),
    ('Logistics',        'Dispatcher',             'Dispatch Desk',    time '08:00', interval '8 hours',   1, '{1,2,3,4,5}'),
    ('Facilities',       'Maintenance Technician', 'Maintenance',      time '07:00', interval '8 hours',   1, '{1,2,3,4,5}'),
    ('Facilities',       'Security Officer',       'Night Security',   time '22:00', interval '8 hours',   1, '{1,2,3,4,5,6,7}')
  ) t(dept, position_title, title, start_t, dur, headcount, isodows)
    on extract(isodow from g.day)::int = any (t.isodows)
  join public.departments d on d.name = t.dept
  left join public.positions p on p.department_id = d.id and p.title = t.position_title;

  -- Assignments: same department and position, available that day, no overlap,
  -- at least 10 hours' rest between shifts, within weekly hours. Fairest-loaded first.
  -- About a quarter of next week's draft shifts are left one person short on purpose.
  for s in
    select sh.id, sh.department_id, sh.position_id, sh.starts_at, sh.ends_at, sh.required_headcount, sh.status,
           extract(dow from sh.starts_at at time zone tz)::int as dow,
           (sh.starts_at at time zone tz)::time as st,
           (sh.ends_at at time zone tz)::time as et,
           date_trunc('week', sh.starts_at at time zone tz) at time zone tz as week_start
    from public.shifts sh
    order by sh.starts_at, sh.id
  loop
    insert into public.shift_assignments (shift_id, employee_id)
    select s.id, e.id
    from public.employees e
    where e.department_id = s.department_id
      and e.status = 'active'
      and (s.position_id is null or e.position_id = s.position_id)
      and exists (
        select 1 from public.employee_availability a
        where a.employee_id = e.id and a.day_of_week = s.dow and a.start_time <= s.st
          and (a.end_time >= s.et or (s.et < s.st and a.end_time >= time '23:59')))
      and not exists (
        select 1 from public.shift_assignments sa join public.shifts o on o.id = sa.shift_id
        where sa.employee_id = e.id
          and o.starts_at < s.ends_at + interval '10 hours'
          and o.ends_at > s.starts_at - interval '10 hours')
      and (
        select coalesce(sum(extract(epoch from o.ends_at - o.starts_at)) / 3600, 0)
        from public.shift_assignments sa join public.shifts o on o.id = sa.shift_id
        where sa.employee_id = e.id and o.starts_at >= s.week_start and o.starts_at < s.week_start + interval '7 days'
      ) + extract(epoch from s.ends_at - s.starts_at) / 3600 <= e.max_weekly_hours
    order by (select count(*) from public.shift_assignments sa where sa.employee_id = e.id),
             hashtext(e.id::text || s.id::text)
    limit case when s.status = 'draft' and abs(hashtext(s.id::text)) % 4 = 0
               then s.required_headcount - 1 else s.required_headcount end;
  end loop;

  -- Attendance for published shifts that have already ended ----------------------
  -- Roughly: 3% absent, 2% excused, 10% late, 20% stay 30+ minutes over, the rest on time.
  insert into public.attendance_records (employee_id, shift_assignment_id, work_date, clock_in, clock_out, status, notes)
  select sa.employee_id, sa.id,
         (sh.starts_at at time zone tz)::date,
         case when x.r < 5 then null
              when x.r < 15 then sh.starts_at + make_interval(mins => 5 + x.r)
              else sh.starts_at - make_interval(mins => x.r % 12) end,
         case when x.r < 5 then null
              else sh.ends_at + make_interval(mins => case when x.r % 5 = 0 then 30 + x.r else x.r % 8 end) end,
         (case when x.r < 3 then 'absent' when x.r < 5 then 'excused' when x.r < 15 then 'late' else 'present' end)::public.attendance_status,
         case when x.r < 3 then 'No show' when x.r < 5 then 'Sick leave' end
  from public.shift_assignments sa
  join public.shifts sh on sh.id = sa.shift_id
  cross join lateral (select abs(hashtext(sa.id::text)) % 100 as r) x
  where sh.status = 'published' and sh.ends_at < now();
end
$seed$;
