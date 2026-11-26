-- Шаг 32 (Никита 26.11): в «🔥 Срочно» работодатель пишет ИТОГОВУЮ сумму за смену («заплачу 2000 ₽»), а не надбавку сверху.
-- Колонка bonus из шага 31 больше не используется (остаётся пустой).
alter table public.vacancies add column if not exists urgent_pay int check (urgent_pay is null or urgent_pay between 0 and 1000000);

create or replace function public.nr_vacancy_urgent(vid uuid, p_bonus int, p_hours int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v public.vacancies; till timestamptz;
begin
  select * into v from public.vacancies where id = vid;
  if v.id is null then raise exception 'not found'; end if;
  if v.status <> 'approved' then raise exception 'not approved'; end if;
  if v.urgent_last is not null and v.urgent_last > now() - interval '24 hours' then raise exception 'once a day'; end if;
  if coalesce((select data->>'urgent_free' from public.settings where id = 1), 'true') = 'false' then raise exception 'need pay'; end if;
  till := now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 2), 48));
  -- p_bonus теперь — итоговая оплата за смену, ₽ (имя параметра оставлено, чтобы не ломать вызовы)
  update public.vacancies set urgent_pay = nullif(least(greatest(coalesce(p_bonus, 0), 0), 1000000), 0), bonus = null,
         urgent_until = till, urgent_sent_at = null, urgent_last = now()
   where id = vid;
  return till;
end $$;
revoke execute on function public.nr_vacancy_urgent(uuid, int, int) from public, anon, authenticated;
