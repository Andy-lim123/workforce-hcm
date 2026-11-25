-- Telegram chat links (applied 2026-11-25 as migration "employee_telegram").
-- Rollback (links are lost; employees link again): drop table public.employee_telegram;

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
