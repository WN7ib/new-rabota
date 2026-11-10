-- New.работа, шаг 6: синхронизация профиля по секретной ссылке и заказы платного продвижения.
-- Можно запускать повторно. Применяет Newi («выполни поручения Клода») или вручную в SQL Editor.

-- ───── профиль соискателя в облаке: только по секретному ключу (хранится хэш), без регистрации
create table if not exists public.profiles_sync (
  key_hash text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.profiles_sync enable row level security;   -- политик нет: доступ только через функции ниже

create or replace function public.profile_save(k text, p jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if char_length(coalesce(k,'')) < 32 then raise exception 'bad key'; end if;
  if octet_length(p::text) > 60000 then raise exception 'too big'; end if;
  insert into public.profiles_sync (key_hash, data, updated_at) values (public.nr_hash(k), p, t)
  on conflict (key_hash) do update set data = excluded.data, updated_at = t;
  return t;
end $$;

create or replace function public.profile_load(k text) returns table (data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.data, s.updated_at from public.profiles_sync s where s.key_hash = public.nr_hash(k) and char_length(coalesce(k,'')) >= 32
$$;

create or replace function public.profile_delete(k text) returns void
language sql security definer set search_path = public as $$
  delete from public.profiles_sync where key_hash = public.nr_hash(k)
$$;

grant execute on function public.profile_save(text, jsonb) to anon, authenticated;
grant execute on function public.profile_load(text) to anon, authenticated;
grant execute on function public.profile_delete(text) to anon, authenticated;

-- ───── продвижение вакансий
alter table public.vacancies add column if not exists pinned_until timestamptz;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  vacancy_id uuid not null references public.vacancies(id) on delete cascade,
  product text not null check (product in ('top7','urgent','verify','business')),
  price int not null check (price >= 0),
  contact text check (char_length(contact) <= 120),
  status text not null default 'new' check (status in ('new','invoiced','paid','cancelled')),
  paid_at timestamptz
);
alter table public.orders enable row level security;
drop policy if exists "orders admin" on public.orders;
create policy "orders admin" on public.orders for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.nr_price(p_product text) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (data->'prices'->>p_product)::int from public.settings where id = 1),
    case p_product when 'top7' then 199 when 'urgent' then 299 when 'verify' then 490 when 'business' then 990 end)
$$;

-- заказ из кабинета работодателя (по личной ссылке вакансии)
create or replace function public.order_create(vid uuid, k text, p_product text, p_contact text) returns table (id uuid, price int)
language plpgsql security definer set search_path = public as $$
declare oid uuid; pr int;
begin
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  if p_product not in ('top7','urgent','verify','business') then raise exception 'bad product'; end if;
  if (select count(*) from public.orders o where o.vacancy_id = vid and o.status = 'new') >= 3 then raise exception 'too many'; end if;
  pr := public.nr_price(p_product);
  insert into public.orders (vacancy_id, product, price, contact) values (vid, p_product, pr, left(trim(coalesce(p_contact,'')), 120))
  returning orders.id into oid;
  return query select oid, pr;
end $$;

create or replace function public.my_orders(vid uuid, k text) returns table (id uuid, created_at timestamptz, product text, price int, status text)
language sql stable security definer set search_path = public as $$
  select o.id, o.created_at, o.product, o.price, o.status from public.orders o
  where o.vacancy_id = vid and public.nr_key_ok(vid, k) order by o.created_at desc limit 20
$$;

grant execute on function public.order_create(uuid, text, text, text) to anon, authenticated;
grant execute on function public.my_orders(uuid, text) to anon, authenticated;

-- оплачено → услуга включается сама
create or replace function public.nr_order_paid() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and coalesce(old.status, '') <> 'paid' then
    new.paid_at := now();
    if new.product = 'top7' then
      update public.vacancies set pinned = true, pinned_until = greatest(now(), coalesce(pinned_until, now())) + interval '7 days' where id = new.vacancy_id;
    elsif new.product = 'urgent' then
      update public.vacancies set pinned = true, pinned_until = greatest(now(), coalesce(pinned_until, now())) + interval '3 days' where id = new.vacancy_id;
      delete from public.bot_seen where key = 'post:' || new.vacancy_id;   -- бот опубликует вакансию в канале ещё раз
    elsif new.product = 'verify' then
      update public.vacancies set verified = true where id = new.vacancy_id;
    elsif new.product = 'business' then
      update public.vacancies set verified = true, pinned = true, pinned_until = greatest(now(), coalesce(pinned_until, now())) + interval '14 days' where id = new.vacancy_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_paid on public.orders;
create trigger orders_paid before update on public.orders for each row execute function public.nr_order_paid();
