-- Шаг 33 (Никита 27.11): «по СБП по номеру — пусть видит только тот, кто заказал и хочет заплатить».
-- Реквизиты больше не лежат в открытых настройках сайта (settings читает кто угодно): отдельная таблица только для админа,
-- а работодатель получает их по личной ссылке вакансии и только при неоплаченном заказе.
create table if not exists public.pay_secret (
  id int primary key default 1 check (id = 1),
  info text check (char_length(info) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.pay_secret enable row level security;
drop policy if exists "pay_secret admin" on public.pay_secret;
create policy "pay_secret admin" on public.pay_secret for all using (public.is_admin()) with check (public.is_admin());

-- переношу, если реквизиты уже были вписаны в открытые настройки, и убираю их оттуда
insert into public.pay_secret (id, info)
  select 1, data->>'pay_info' from public.settings where id = 1 and coalesce(data->>'pay_info', '') <> ''
  on conflict (id) do update set info = excluded.info, updated_at = now();
update public.settings set data = data - 'pay_info' where id = 1 and data ? 'pay_info';

-- работодатель (личная ссылка вакансии): реквизиты — только если у этой вакансии есть заказ, ждущий оплаты
create or replace function public.my_pay_info(vid uuid, k text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.nr_key_ok(vid, k) then return null; end if;
  if not exists (select 1 from public.orders o where o.vacancy_id = vid and o.status in ('new', 'invoiced')) then return null; end if;
  return (select info from public.pay_secret where id = 1);
end $$;
grant execute on function public.my_pay_info(uuid, text) to anon, authenticated;
