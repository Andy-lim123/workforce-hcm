-- Link an auth user to their employee record only once the email address is verified.
-- Previously the link happened at sign-up, so an unverified sign-up using an employee's
-- email address could claim that employee record.

create function private.link_employee(p_user_id uuid, p_email text) returns void
language sql security definer set search_path = '' as $$
  update public.employees set profile_id = p_user_id
  where profile_id is null and lower(email) = lower(p_email);
$$;
revoke all on function private.link_employee(uuid, text) from public;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  -- Users created already confirmed (e.g. by an admin in the dashboard) link immediately.
  if new.email_confirmed_at is not null then
    perform private.link_employee(new.id, new.email);
  end if;

  return new;
end $$;

create function private.handle_user_email_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.link_employee(new.id, new.email);
  return new;
end $$;
revoke all on function private.handle_user_email_confirmed() from public;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_user_email_confirmed();
