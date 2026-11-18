-- New.работа, шаг 12: «Смена под ключ» (1 000 ₽ за выход) и новые цены тарифов.
-- Можно запускать повторно. Самодостаточна: если migration-6.sql не был применён, таблица заказов создаётся здесь.
-- Нужны только schema.sql и migration-5.sql (is_admin, nr_hash, nr_key_ok, bot_seen).
-- Деньги работников через нас не идут: в заказе хранится только ставка «на руки» для справки,
-- работодатель платит её работнику сам. Нам — только комиссия (price) после подтверждения кандидата.
-- Комиссия — за каждый выход: 1 000 ₽ × человек × день. Смена на несколько дней = отдельный заказ на каждый день
-- (общий series_id), каждый день подтверждается и оплачивается отдельно.

-- ───── заказы (то же, что в migration-6, на случай если она не применена)
alter table public.vacancies add column if not exists pinned_until timestamptz;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  vacancy_id uuid references public.vacancies(id) on delete cascade,
  product text not null,
  price int not null check (price >= 0),
  contact text check (char_length(contact) <= 120),
  status text not null default 'new' check (status in ('new','invoiced','paid','cancelled')),
  paid_at timestamptz
);
alter table public.orders add column if not exists pay_tx text;
alter table public.orders add column if not exists pay_method int;
alter table public.orders add column if not exists pay_note text;
create unique index if not exists orders_pay_tx on public.orders (pay_tx) where pay_tx is not null;

-- смена под ключ не привязана к вакансии
alter table public.orders alter column vacancy_id drop not null;
alter table public.orders drop constraint if exists orders_product_check;
alter table public.orders add constraint orders_product_check check (product in ('top7','urgent','verify','business','shift'));
alter table public.orders drop constraint if exists orders_vacancy_needed;
alter table public.orders add constraint orders_vacancy_needed check (product = 'shift' or vacancy_id is not null);

-- ───── поля «Смены под ключ»
alter table public.orders add column if not exists employer_id uuid;
do $$ begin
  if to_regclass('public.employers') is not null and not exists (
    select 1 from pg_constraint where conname = 'orders_employer_fk') then
    alter table public.orders add constraint orders_employer_fk foreign key (employer_id) references public.employers(id) on delete set null;
  end if;
end $$;
alter table public.orders add column if not exists company      text check (char_length(company) <= 80);
alter table public.orders add column if not exists task         text check (char_length(task) <= 600);      -- что делать
alter table public.orders add column if not exists city         text check (char_length(city) <= 60);
alter table public.orders add column if not exists address      text check (char_length(address) <= 200);
alter table public.orders add column if not exists shift_at     timestamptz;                                  -- начало смены
alter table public.orders add column if not exists shift_hours  numeric(4,1) check (shift_hours is null or shift_hours between 1 and 12);
alter table public.orders add column if not exists worker_pay   int check (worker_pay is null or worker_pay between 100 and 100000); -- на руки работнику, платит бизнес
alter table public.orders add column if not exists people       int not null default 1 check (people between 1 and 10);
alter table public.orders add column if not exists with_friend  boolean not null default false;              -- можно вдвоём с другом
alter table public.orders add column if not exists is_urgent    boolean not null default false;              -- человек нужен через 2 часа
alter table public.orders add column if not exists safe_ack     boolean not null default false;              -- работа лёгкая, без алкоголя/табака/ночи, по ТК РФ
alter table public.orders add column if not exists shift_status text not null default 'search';
alter table public.orders drop constraint if exists orders_shift_status_check;
alter table public.orders add constraint orders_shift_status_check
  check (shift_status in ('search','confirmed','done','no_show','replaced','cancelled'));
-- search — ищем; confirmed — кандидат подтвердил выход (выставляем счёт 1 000 ₽); done — отработал;
-- no_show — не вышел (делаем бесплатную замену); replaced — замена вышла; cancelled — отменено
alter table public.orders add column if not exists candidate    text check (char_length(candidate) <= 200);  -- кто выходит (для модератора)
alter table public.orders add column if not exists admin_note   text check (char_length(admin_note) <= 600);
alter table public.orders add column if not exists notified     boolean not null default false;              -- бот уже сообщил Никите
alter table public.orders add column if not exists series_id    uuid;                                        -- одна заявка на несколько дней
alter table public.orders add column if not exists day_no       int check (day_no is null or day_no between 1 and 31);
alter table public.orders add column if not exists days_total   int check (days_total is null or days_total between 1 and 31);
create index if not exists orders_series on public.orders (series_id) where series_id is not null;
create index if not exists orders_status_created on public.orders (status, created_at desc);
create index if not exists orders_shift_at on public.orders (shift_at) where product = 'shift';

-- ───── права: таблицу видит и правит только модератор; сайт создаёт заказ только через функцию
alter table public.orders enable row level security;
drop policy if exists "orders admin" on public.orders;
create policy "orders admin" on public.orders for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.orders from anon;
grant select, insert, update, delete on public.orders to authenticated;   -- дальше решает RLS (только is_admin)
grant all on public.orders to service_role;                               -- бот

-- ───── цены: новые значения по умолчанию + запись в настройки
create or replace function public.nr_price(p_product text) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (data->'prices'->>p_product)::int from public.settings where id = 1),
    case p_product when 'top7' then 390 when 'urgent' then 490 when 'verify' then 690 when 'business' then 1990 when 'shift' then 1000 end)
$$;
update public.settings
   set data = jsonb_set(data, '{prices}',
         coalesce(data->'prices', '{}'::jsonb) || '{"top7":390,"urgent":490,"verify":690,"business":1990,"shift":1000}'::jsonb),
       updated_at = now()
 where id = 1;

-- ───── заявка на «Смену под ключ» с сайта (вход в кабинет не обязателен: t может быть пустым)
drop function if exists public.shift_order_create(text, jsonb);
-- p.days — сколько дней подряд нужен человек (1–31, по умолчанию 1). Создаётся по заказу на каждый день.
-- Возвращает строки (id, price, shift_at) — по одной на день.
create or replace function public.shift_order_create(t text, p jsonb) returns table (id uuid, price int, shift_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  oid uuid; pr int; emp uuid;
  v_contact text := left(trim(coalesce(p->>'contact','')), 120);
  v_company text := left(trim(coalesce(p->>'company','')), 80);
  v_address text := left(trim(coalesce(p->>'address','')), 200);
  v_task    text := left(trim(coalesce(p->>'task','')), 600);
  v_city    text := left(trim(coalesce(p->>'city','')), 60);
  v_at      timestamptz;
  v_pay     int;
  v_hours   numeric;
  v_people  int := least(greatest(coalesce(nullif(p->>'people','')::int, 1), 1), 10);
  v_days    int;
  v_series  uuid := gen_random_uuid();
  d int;
begin
  begin
    v_at    := (p->>'shift_at')::timestamptz;
    v_pay   := nullif(p->>'worker_pay','')::int;
    v_hours := nullif(p->>'shift_hours','')::numeric;
    v_days  := coalesce(nullif(p->>'days','')::int, 1);
  exception when others then raise exception 'bad data'; end;

  if coalesce((p->>'safe_ack')::boolean, false) is not true then raise exception 'need safe_ack'; end if;
  if char_length(v_contact) < 3 then raise exception 'need contact'; end if;
  if char_length(v_company) < 2 then raise exception 'need company'; end if;
  if char_length(v_address) < 5 then raise exception 'need address'; end if;
  if v_at is null or v_at < now() - interval '1 hour' or v_at > now() + interval '90 days' then raise exception 'bad date'; end if;
  if v_pay is null or v_pay < 100 or v_pay > 100000 then raise exception 'bad pay'; end if;
  if v_days < 1 or v_days > 31 then raise exception 'bad days'; end if;
  if v_hours is not null and (v_hours < 1 or v_hours > 12) then raise exception 'bad hours'; end if;
  -- защита от спама: не больше 5 новых заявок с одного контакта за сутки
  if (select count(distinct coalesce(o.series_id, o.id)) from public.orders o where o.product = 'shift' and lower(o.contact) = lower(v_contact)
        and o.created_at > now() - interval '1 day') >= 5 then raise exception 'too many'; end if;

  if coalesce(t, '') <> '' and to_regprocedure('public.nr_emp(text)') is not null then
    execute 'select public.nr_emp($1)' into emp using t;
  end if;

  pr := public.nr_price('shift') * v_people;   -- 1 000 ₽ за каждого человека в день
  for d in 1..v_days loop
    insert into public.orders (product, price, contact, employer_id, company, task, city, address, shift_at, shift_hours,
                               worker_pay, people, with_friend, is_urgent, safe_ack, series_id, day_no, days_total)
    values ('shift', pr, v_contact, emp, v_company, nullif(v_task,''), nullif(v_city,''), v_address, v_at + (d - 1) * interval '1 day', v_hours,
            v_pay, v_people, coalesce((p->>'with_friend')::boolean, false), coalesce((p->>'is_urgent')::boolean, false) and d = 1, true,
            v_series, d, v_days)
    returning orders.id into oid;
    id := oid; price := pr; shift_at := v_at + (d - 1) * interval '1 day';
    return next;
  end loop;
end $$;

-- модератор: продлить смену ещё на один день (работник вышел и завтра снова нужен) — новый заказ на 1 000 ₽ × человек
create or replace function public.shift_order_repeat(oid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare src public.orders; nid uuid; nxt timestamptz;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select * into src from public.orders where orders.id = oid and product = 'shift';
  if not found then raise exception 'not found'; end if;
  src.series_id := coalesce(src.series_id, src.id);
  select max(o.shift_at) + interval '1 day' into nxt from public.orders o where o.series_id = src.series_id or o.id = src.series_id;
  update public.orders set series_id = src.series_id, day_no = coalesce(day_no, 1) where orders.id = src.id and series_id is null;
  insert into public.orders (product, price, contact, employer_id, company, task, city, address, shift_at, shift_hours,
                             worker_pay, people, with_friend, is_urgent, safe_ack, series_id, day_no, days_total, candidate)
  values ('shift', public.nr_price('shift') * src.people, src.contact, src.employer_id, src.company, src.task, src.city, src.address,
          coalesce(nxt, src.shift_at + interval '1 day'), src.shift_hours, src.worker_pay, src.people, src.with_friend, false, true,
          src.series_id, (select count(*) + 1 from public.orders o where o.series_id = src.series_id), null, src.candidate)
  returning orders.id into nid;
  return nid;
end $$;
revoke execute on function public.shift_order_repeat(uuid) from public, anon;
grant execute on function public.shift_order_repeat(uuid) to authenticated;
revoke execute on function public.shift_order_create(text, jsonb) from public;
grant execute on function public.shift_order_create(text, jsonb) to anon, authenticated;

-- ───── заказы продвижения: обновить проверку продукта в старых функциях не нужно — 'shift' через них не создаётся.

-- ───── оплачено → услуга включается сама (как в migration-6; для 'shift' просто фиксируем время оплаты)
create or replace function public.nr_order_paid() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and coalesce(old.status, '') <> 'paid' then
    new.paid_at := now();
    if new.product = 'top7' then
      update public.vacancies set pinned = true, pinned_until = greatest(now(), coalesce(pinned_until, now())) + interval '7 days' where id = new.vacancy_id;
    elsif new.product = 'urgent' then
      update public.vacancies set pinned = true, pinned_until = greatest(now(), coalesce(pinned_until, now())) + interval '3 days' where id = new.vacancy_id;
      delete from public.bot_seen where key = 'post:' || new.vacancy_id;
    elsif new.product = 'verify' then
      update public.vacancies set verified = true where id = new.vacancy_id;
    elsif new.product = 'business' then
      update public.vacancies set verified = true, pinned = true, pinned_until = greatest(now(), coalesce(pinned_until, now())) + interval '30 days' where id = new.vacancy_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_paid on public.orders;
create trigger orders_paid before update on public.orders for each row execute function public.nr_order_paid();
