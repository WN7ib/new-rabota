-- Шаг 34 (Никита 27.11): восстановление входа в админку кодом в Telegram / ВК / SMS (функция admin-recover).
-- Проверка «это почта админа?» — только для service_role (функция), снаружи недоступна.
create or replace function public.admin_email_ok(em text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users u join public.admins a on a.user_id = u.id where lower(u.email) = lower(em));
$$;
revoke all on function public.admin_email_ok(text) from public, anon, authenticated;
grant execute on function public.admin_email_ok(text) to service_role;
