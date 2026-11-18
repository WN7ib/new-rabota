-- New.работа, шаг 14: форматы «Смены под ключ» (обычная / сплит 4+4 / разовая задача / полная 18+),
-- вакансии «в выходные» и «сплит по 4 ч», новые цены 500/750/1000/1500/2000. Можно запускать повторно.
-- Нужны migration-12 и migration-13.
--
-- Что говорит закон (ТК РФ) и как это заложено:
--  • ст. 268 — до 18 лет нельзя в ночь (22–6), сверхурочно, в СВОИ выходные дни и в нерабочие праздники.
--    Суббота и воскресенье могут быть рабочими днями по графику (выходные тогда — другие дни), поэтому Сб/Вс разрешены,
--    а государственные праздники (ст. 112) для младше 18 — нет.
--  • ст. 94 — в день: с 14 до 15 лет — 4 ч, с 15 до 16 — 5 ч, с 16 до 18 — 7 ч; в учебный год у школьников — 2,5 и 4 ч.
--  • ст. 92 — в неделю: до 16 лет — 24 ч, с 16 до 18 — 35 ч.
--  • Сплит 4+4: два разных человека по 4 ч — это две законные короткие смены, а не одна длинная.
--  • Разовая задача (ГПХ / самозанятость с 14 лет с согласия родителей): платят за результат, без графика и подчинения.
--    Если человек работает по графику на точке под контролем — это трудовые отношения, и нормы часов действуют.

-- ───── заказы: формат смены
alter table public.orders add column if not exists shift_type text not null default 'hourly';
alter table public.orders drop constraint if exists orders_shift_type_check;
alter table public.orders add constraint orders_shift_type_check check (shift_type in ('hourly','split','task','adult'));
alter table public.orders add column if not exists result text check (char_length(result) <= 300);   -- для разовой задачи: что сдать (объём/результат)

-- ───── вакансии: работа в выходные и сплит-смены по 4 ч (для фильтров на главной)
alter table public.vacancies add column if not exists weekend boolean not null default false;
alter table public.vacancies add column if not exists split boolean not null default false;

create or replace function public.submit_vacancy(p jsonb) returns table (id uuid, manage_key text)
language plpgsql security definer set search_path = public as $$
declare vid uuid; k text; exp date;
begin
  if not coalesce((select (data->>'submissions_open')::boolean from public.settings where settings.id = 1), true) then
    raise exception 'submissions closed';
  end if;
  if (select count(*) from public.vacancies v where v.status = 'pending' and v.created_at > now() - interval '10 minutes') > 30 then
    raise exception 'too many';
  end if;
  exp := nullif(p->>'expires_at','')::date;
  if exp is not null and (exp < current_date or exp > current_date + 90) then exp := current_date + 30; end if;
  insert into public.vacancies (title, company, city, type, age_min, pay, remote, description, contact, expires_at, status, weekend, split)
  values (trim(p->>'title'), nullif(trim(p->>'company'),''), nullif(trim(p->>'city'),''), coalesce(nullif(p->>'type',''),'Подработка'),
          coalesce((p->>'age_min')::int, 16), nullif(trim(p->>'pay'),''), coalesce((p->>'remote')::boolean, false),
          nullif(trim(p->>'description'),''), trim(p->>'contact'), exp, 'pending',
          coalesce((p->>'weekend')::boolean, false), coalesce((p->>'split')::boolean, false))
  returning vacancies.id into vid;
  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.vacancy_keys (vacancy_id, key_hash) values (vid, public.nr_hash(k));
  return query select vid, k;
end $$;
grant execute on function public.submit_vacancy(jsonb) to anon, authenticated;

-- ───── цены
create or replace function public.nr_price(p_product text) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (data->'prices'->>p_product)::int from public.settings where id = 1),
    case p_product when 'top7' then 500 when 'urgent' then 750 when 'verify' then 1500 when 'business' then 2000 when 'shift' then 1000 end)
$$;
update public.settings
   set data = jsonb_set(data, '{prices}',
         coalesce(data->'prices', '{}'::jsonb) || '{"top7":500,"urgent":750,"verify":1500,"business":2000,"shift":1000}'::jsonb),
       updated_at = now()
 where id = 1;

-- ───── нерабочие праздники РФ (ст. 112 ТК): 1–8 янв, 23 фев, 8 мар, 1 и 9 мая, 12 июн, 4 ноя
create or replace function public.nr_holiday(d date) returns boolean language sql immutable as $$
  select to_char(d, 'MM-DD') in ('01-01','01-02','01-03','01-04','01-05','01-06','01-07','01-08','02-23','03-08','05-01','05-09','06-12','11-04')
$$;

-- ───── заявка на смену: формат, сплит, разовая задача, 18+
drop function if exists public.shift_order_create(text, jsonb);
create or replace function public.shift_order_create(t text, p jsonb) returns table (id uuid, price int, shift_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  oid uuid; pr int; emp uuid;
  v_type    text := coalesce(nullif(p->>'shift_type',''), 'hourly');
  v_contact text := left(trim(coalesce(p->>'contact','')), 120);
  v_company text := left(trim(coalesce(p->>'company','')), 80);
  v_address text := left(trim(coalesce(p->>'address','')), 200);
  v_task    text := left(trim(coalesce(p->>'task','')), 600);
  v_result  text := left(trim(coalesce(p->>'result','')), 300);
  v_city    text := left(trim(coalesce(p->>'city','')), 60);
  v_sched   text := left(trim(coalesce(p->>'schedule','')), 200);
  v_from    text := nullif(p->>'time_from','');
  v_to      text := nullif(p->>'time_to','');
  v_age     int;
  v_at      timestamptz;
  v_pay     int;
  v_hours   numeric;
  v_slot    numeric;
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

  if v_type not in ('hourly','split','task','adult') then raise exception 'bad type'; end if;
  if v_type = 'adult' then v_age := 18; end if;
  if coalesce((p->>'safe_ack')::boolean, false) is not true then raise exception 'need safe_ack'; end if;
  if char_length(v_contact) < 3 then raise exception 'need contact'; end if;
  if char_length(v_company) < 2 then raise exception 'need company'; end if;
  if char_length(v_address) < 5 then raise exception 'need address'; end if;
  if v_type = 'task' and char_length(v_result) < 3 then raise exception 'need result'; end if;
  if v_age not in (14, 16, 18) then raise exception 'bad age'; end if;
  if v_starts is null or cardinality(v_starts) < 1 or cardinality(v_starts) > 62 then raise exception 'bad days'; end if;
  if v_starts[1] < now() - interval '1 hour' or v_starts[cardinality(v_starts)] > now() + interval '100 days' then raise exception 'bad date'; end if;
  if v_pay is null or v_pay < 100 or v_pay > 100000 then raise exception 'bad pay'; end if;
  -- до 18 лет — не в нерабочие праздники (по московской дате)
  if v_age < 18 and exists (select 1 from unnest(v_starts) s where public.nr_holiday((s at time zone 'Europe/Moscow')::date)) then raise exception 'holiday'; end if;

  if (v_from is null) <> (v_to is null) then raise exception 'bad time'; end if;
  if v_from is not null then
    if v_from !~ '^([01]\d|2[0-3]):[0-5]\d$' or v_to !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'bad time'; end if;
    if v_from < '06:00' or v_to > '22:00' or v_to <= v_from then raise exception 'night'; end if;
    v_hours := round(extract(epoch from (v_to::time - v_from::time)) / 3600.0, 1);
  end if;
  v_max := case v_age when 14 then 4 when 16 then 7 else 12 end;
  if v_type = 'split' then
    -- общее окно делится на две половины — два разных человека, у каждого своя короткая смена
    if v_hours is null or v_hours < 2 then raise exception 'bad time'; end if;
    v_slot := v_hours / 2;
    if v_slot > v_max then raise exception 'too long'; end if;
    v_people := 2;
  elsif v_type = 'task' then
    null;   -- оплата за результат: время — только окно, когда можно выполнять (не ночью)
  elsif v_hours is not null and (v_hours < 1 or v_hours > v_max) then
    raise exception 'too long';
  end if;

  if (select count(distinct coalesce(o.series_id, o.id)) from public.orders o where o.product = 'shift' and lower(o.contact) = lower(v_contact)
        and o.created_at > now() - interval '1 day') >= 5 then raise exception 'too many'; end if;

  if coalesce(t, '') <> '' and to_regprocedure('public.nr_emp(text)') is not null then
    execute 'select public.nr_emp($1)' into emp using t;
  end if;

  -- комиссия: 1 000 ₽ за выход каждого человека; сплит 4+4 — одна комиссия на пару (закрывает одну смену 8 ч)
  pr := public.nr_price('shift') * (case when v_type = 'split' then 1 else v_people end);
  for d in 1..cardinality(v_starts) loop
    insert into public.orders (product, price, contact, employer_id, company, task, city, address, shift_at, shift_hours,
                               worker_pay, people, with_friend, is_urgent, safe_ack, series_id, day_no, days_total,
                               schedule, time_from, time_to, age_min, shift_type, result)
    values ('shift', pr, v_contact, emp, v_company, nullif(v_task,''), nullif(v_city,''), v_address, v_starts[d],
            case when v_type = 'split' then v_slot else v_hours end,
            v_pay, v_people, coalesce((p->>'with_friend')::boolean, false), coalesce((p->>'is_urgent')::boolean, false) and d = 1, true,
            v_series, d, cardinality(v_starts), nullif(v_sched,''), v_from, v_to, v_age, v_type, nullif(v_result,''))
    returning orders.id into oid;
    id := oid; price := pr; shift_at := v_starts[d];
    return next;
  end loop;
end $$;
revoke execute on function public.shift_order_create(text, jsonb) from public;
grant execute on function public.shift_order_create(text, jsonb) to anon, authenticated;

-- продление на день: сохраняем формат и цену как у исходного заказа
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
                             schedule, time_from, time_to, age_min, shift_type, result)
  values ('shift', public.nr_price('shift') * (case when src.shift_type = 'split' then 1 else src.people end), src.contact, src.employer_id,
          src.company, src.task, src.city, src.address,
          coalesce(nxt, src.shift_at + interval '1 day'), src.shift_hours, src.worker_pay, src.people, src.with_friend, false, true,
          src.series_id, (select count(*) + 1 from public.orders o where o.series_id = src.series_id), null, src.candidate,
          src.schedule, src.time_from, src.time_to, src.age_min, src.shift_type, src.result)
  returning orders.id into nid;
  return nid;
end $$;
revoke execute on function public.shift_order_repeat(uuid) from public, anon;
grant execute on function public.shift_order_repeat(uuid) to authenticated;
