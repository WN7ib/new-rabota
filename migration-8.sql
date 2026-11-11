-- New.работа, шаг 8: резерв на сменах. Мест нет → человек в резерве; работодатель сам выбирает основных;
-- основной отменил → бот предлагает место первому из резерва. Можно запускать повторно.
alter table public.event_signups add column if not exists status text not null default 'main';
alter table public.event_signups drop constraint if exists event_signups_status_chk;
alter table public.event_signups add constraint event_signups_status_chk check (status in ('main','reserve'));
alter table public.event_signups add column if not exists offered_at timestamptz;   -- когда боту предложили место из резерва

-- запись: при заполненных местах — в резерв (функция возвращает число основных; -1 = записан в резерв)
create or replace function public.event_signup(eid uuid, p_name text, p_contact text, p_age int) returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int;
begin
  select * into e from public.events where id = eid and published and starts_at > now();
  if not found then raise exception 'closed'; end if;
  select count(*) into n from public.event_signups where event_id = eid and status = 'main';
  if exists (select 1 from public.event_signups where event_id = eid and lower(contact) = lower(trim(p_contact))) then return n; end if;
  if (select count(*) from public.event_signups where event_id = eid) > coalesce(e.capacity, 1000) + 50 then raise exception 'full'; end if;
  if e.capacity is not null and n >= e.capacity then
    insert into public.event_signups (event_id, name, contact, age, status) values (eid, trim(p_name), trim(p_contact), p_age, 'reserve');
    return -1;
  end if;
  insert into public.event_signups (event_id, name, contact, age) values (eid, trim(p_name), trim(p_contact), p_age);
  return n + 1;
end $$;
grant execute on function public.event_signup(uuid, text, text, int) to anon, authenticated;

create or replace function public.event_counts() returns table (event_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select s.event_id, count(*)::int from public.event_signups s join public.events e on e.id = s.event_id where e.published and s.status = 'main' group by s.event_id
$$;
grant execute on function public.event_counts() to anon, authenticated;

-- кабинет: список с резервом и смена статуса
drop function if exists public.emp_signups(text, uuid);
create or replace function public.emp_signups(t text, eid uuid) returns table (id uuid, created_at timestamptz, name text, contact text, age int, status text)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.name, s.contact, s.age, s.status from public.event_signups s join public.events e on e.id = s.event_id
  where s.event_id = eid and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by s.status, s.created_at
$$;
grant execute on function public.emp_signups(text, uuid) to anon, authenticated;
create or replace function public.emp_signup_status(t text, sid uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('main','reserve') then raise exception 'bad status'; end if;
  update public.event_signups s set status = p_status, offered_at = null from public.events e
  where s.id = sid and e.id = s.event_id and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null;
end $$;
grant execute on function public.emp_signup_status(text, uuid, text) to anon, authenticated;

-- emp_events: n — только основные, r — резерв
drop function if exists public.emp_events(text);
create or replace function public.emp_events(t text) returns table (id uuid, title text, starts_at timestamptz, place text, city text, kind text, description text, capacity int, published boolean, n int, r int)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.starts_at, e.place, e.city, e.kind, e.description, e.capacity, e.published,
    (select count(*)::int from public.event_signups s where s.event_id = e.id and s.status = 'main'),
    (select count(*)::int from public.event_signups s where s.event_id = e.id and s.status = 'reserve')
  from public.events e where e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by e.starts_at desc limit 200
$$;
grant execute on function public.emp_events(text) to anon, authenticated;
