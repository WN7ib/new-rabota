-- New.работа, шаг 16: «Пойти с другом» с сайта. При записи на смену можно указать, с кем идёшь
-- (имя друга, необязательно) — работодатель видит в кабинете «👫 вместе с Аней» и ставит пару в одну смену.
-- Можно запускать повторно.
alter table public.event_signups add column if not exists with_name text;
alter table public.event_signups drop constraint if exists event_signups_with_name_chk;
alter table public.event_signups add constraint event_signups_with_name_chk check (with_name is null or char_length(with_name) <= 60);

-- запись с другом (новая перегрузка; старая на 4 аргумента остаётся для старых страниц и мини-приложения)
create or replace function public.event_signup(eid uuid, p_name text, p_contact text, p_age int, p_with text) returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int; w text;
begin
  w := nullif(left(regexp_replace(trim(coalesce(p_with, '')), '[[:cntrl:]<>]', '', 'g'), 60), '');
  select * into e from public.events where id = eid and published and starts_at > now();
  if not found then raise exception 'closed'; end if;
  select count(*) into n from public.event_signups where event_id = eid and status = 'main';
  if exists (select 1 from public.event_signups where event_id = eid and lower(contact) = lower(trim(p_contact))) then
    -- уже записан: только дописать, с кем идёт (если раньше не указал)
    if w is not null then
      update public.event_signups set with_name = w where event_id = eid and lower(contact) = lower(trim(p_contact)) and with_name is null;
    end if;
    return n;
  end if;
  if (select count(*) from public.event_signups where event_id = eid) > coalesce(e.capacity, 1000) + 50 then raise exception 'full'; end if;
  if e.capacity is not null and n >= e.capacity then
    insert into public.event_signups (event_id, name, contact, age, status, with_name) values (eid, trim(p_name), trim(p_contact), p_age, 'reserve', w);
    return -1;
  end if;
  insert into public.event_signups (event_id, name, contact, age, with_name) values (eid, trim(p_name), trim(p_contact), p_age, w);
  return n + 1;
end $$;
grant execute on function public.event_signup(uuid, text, text, int, text) to anon, authenticated;

-- кабинет: список записавшихся + «с кем идёт»
drop function if exists public.emp_signups(text, uuid);
create or replace function public.emp_signups(t text, eid uuid)
returns table (id uuid, created_at timestamptz, name text, contact text, age int, status text, attended boolean, came int, missed int, reliable boolean, with_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.name, s.contact, s.age, s.status, s.attended, r.came, r.missed, r.reliable, s.with_name
  from public.event_signups s join public.events e on e.id = s.event_id
  cross join lateral public.person_rel(s.chat_id, s.contact) r
  where s.event_id = eid and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null
  order by s.status, r.reliable desc, s.created_at
$$;
grant execute on function public.emp_signups(text, uuid) to anon, authenticated;
