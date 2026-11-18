-- New.работа, шаг 13: «Смена под ключ» по графику — контракт на неделю, месяц или свой срок,
-- выбранные дни недели и время. Можно запускать повторно. Нужна migration-12-shift.sql.
-- Сайт сам раскладывает график на конкретные даты и присылает их списком (starts) — так часовой пояс
-- работодателя учитывается правильно. На каждую дату создаётся отдельный заказ (1 000 ₽ × человек).

alter table public.orders add column if not exists schedule  text check (char_length(schedule) <= 200);  -- «Месяц · Пн Ср Пт · 10:00–14:00»
alter table public.orders add column if not exists time_from text check (time_from ~ '^\d{2}:\d{2}$');
alter table public.orders add column if not exists time_to   text check (time_to ~ '^\d{2}:\d{2}$');
alter table public.orders add column if not exists age_min   int  check (age_min is null or age_min in (14, 16, 18));
alter table public.orders drop constraint if exists orders_day_no_check;
alter table public.orders drop constraint if exists orders_days_total_check;
alter table public.orders add constraint orders_day_no_check check (day_no is null or day_no between 1 and 62);
alter table public.orders add constraint orders_days_total_check check (days_total is null or days_total between 1 and 62);

-- p.starts — массив начал смен (ISO-время с часовым поясом), 1–62 штуки, в пределах 100 дней.
-- Если starts нет — работает старый вариант: shift_at + days подряд.
-- Время: только с 06:00 до 22:00 (ночью подросткам нельзя), длительность по возрасту:
-- с 14 лет — до 4 ч, с 16 — до 7 ч, с 18 — до 12 ч (ТК РФ, ст. 92, 94, 96).
drop function if exists public.shift_order_create(text, jsonb);
create or replace function public.shift_order_create(t text, p jsonb) returns table (id uuid, price int, shift_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  oid uuid; pr int; emp uuid;
  v_contact text := left(trim(coalesce(p->>'contact','')), 120);
  v_company text := left(trim(coalesce(p->>'company','')), 80);
  v_address text := left(trim(coalesce(p->>'address','')), 200);
  v_task    text := left(trim(coalesce(p->>'task','')), 600);
  v_city    text := left(trim(coalesce(p->>'city','')), 60);
  v_sched   text := left(trim(coalesce(p->>'schedule','')), 200);
  v_from    text := nullif(p->>'time_from','');
  v_to      text := nullif(p->>'time_to','');
  v_age     int;
  v_at      timestamptz;
  v_pay     int;
  v_hours   numeric;
  v_people  int := least(greatest(coalesce(nullif(p->>'people','')::int, 1), 1), 10);
  v_days    int;
  v_starts  timestamptz[];
  v_series  uuid := gen_random_uuid();
  v_max     numeric;
  d int;
begin
  begin
    v_pay   := nullif(p->>'worker_pay','')::int;
    v_hours := nullif(p->>'shift_hours','')::numeric;
    v_age   := coalesce(nullif(p->>'age_min','')::int, 16);
    if jsonb_typeof(p->'starts') = 'array' then
      select array_agg(distinct x::timestamptz order by x::timestamptz) into v_starts from jsonb_array_elements_text(p->'starts') x;
    else
      v_at   := (p->>'shift_at')::timestamptz;
      v_days := coalesce(nullif(p->>'days','')::int, 1);
      if v_at is null or v_days < 1 or v_days > 31 then raise exception 'bad days'; end if;
      select array_agg(v_at + (i - 1) * interval '1 day' order by i) into v_starts from generate_series(1, v_days) i;
    end if;
  exception when others then raise exception 'bad data'; end;

  if coalesce((p->>'safe_ack')::boolean, false) is not true then raise exception 'need safe_ack'; end if;
  if char_length(v_contact) < 3 then raise exception 'need contact'; end if;
  if char_length(v_company) < 2 then raise exception 'need company'; end if;
  if char_length(v_address) < 5 then raise exception 'need address'; end if;
  if v_age not in (14, 16, 18) then raise exception 'bad age'; end if;
  if v_starts is null or cardinality(v_starts) < 1 or cardinality(v_starts) > 62 then raise exception 'bad days'; end if;
  if v_starts[1] < now() - interval '1 hour' or v_starts[cardinality(v_starts)] > now() + interval '100 days' then raise exception 'bad date'; end if;
  if v_pay is null or v_pay < 100 or v_pay > 100000 then raise exception 'bad pay'; end if;
  if (v_from is null) <> (v_to is null) then raise exception 'bad time'; end if;
  if v_from is not null then
    if v_from !~ '^([01]\d|2[0-3]):[0-5]\d$' or v_to !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'bad time'; end if;
    if v_from < '06:00' or v_to > '22:00' or v_to <= v_from then raise exception 'night'; end if;
    v_hours := round(extract(epoch from (v_to::time - v_from::time)) / 3600.0, 1);
  end if;
  v_max := case v_age when 14 then 4 when 16 then 7 else 12 end;
  if v_hours is not null and (v_hours < 1 or v_hours > v_max) then raise exception 'too long'; end if;
  -- защита от спама: не больше 5 новых заявок с одного контакта за сутки
  if (select count(distinct coalesce(o.series_id, o.id)) from public.orders o where o.product = 'shift' and lower(o.contact) = lower(v_contact)
        and o.created_at > now() - interval '1 day') >= 5 then raise exception 'too many'; end if;

  if coalesce(t, '') <> '' and to_regprocedure('public.nr_emp(text)') is not null then
    execute 'select public.nr_emp($1)' into emp using t;
  end if;

  pr := public.nr_price('shift') * v_people;   -- 1 000 ₽ за каждого человека за каждый выход
  for d in 1..cardinality(v_starts) loop
    insert into public.orders (product, price, contact, employer_id, company, task, city, address, shift_at, shift_hours,
                               worker_pay, people, with_friend, is_urgent, safe_ack, series_id, day_no, days_total,
                               schedule, time_from, time_to, age_min)
    values ('shift', pr, v_contact, emp, v_company, nullif(v_task,''), nullif(v_city,''), v_address, v_starts[d], v_hours,
            v_pay, v_people, coalesce((p->>'with_friend')::boolean, false), coalesce((p->>'is_urgent')::boolean, false) and d = 1, true,
            v_series, d, cardinality(v_starts), nullif(v_sched,''), v_from, v_to, v_age)
    returning orders.id into oid;
    id := oid; price := pr; shift_at := v_starts[d];
    return next;
  end loop;
end $$;
revoke execute on function public.shift_order_create(text, jsonb) from public;
grant execute on function public.shift_order_create(text, jsonb) to anon, authenticated;

-- продление на день: переносим и график/время/возраст
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
                             worker_pay, people, with_friend, is_urgent, safe_ack, series_id, day_no, days_total, candidate,
                             schedule, time_from, time_to, age_min)
  values ('shift', public.nr_price('shift') * src.people, src.contact, src.employer_id, src.company, src.task, src.city, src.address,
          coalesce(nxt, src.shift_at + interval '1 day'), src.shift_hours, src.worker_pay, src.people, src.with_friend, false, true,
          src.series_id, (select count(*) + 1 from public.orders o where o.series_id = src.series_id), null, src.candidate,
          src.schedule, src.time_from, src.time_to, src.age_min)
  returning orders.id into nid;
  return nid;
end $$;
revoke execute on function public.shift_order_repeat(uuid) from public, anon;
grant execute on function public.shift_order_repeat(uuid) to authenticated;
