-- New.работа, шаг 18: «Пойти с другом» — держим второе место. При записи с сайта можно отметить
-- «держать место для друга»: если свободно ≥2 мест, одно место держится за другом до 24 ч
-- (но не позже чем за 3 ч до начала). Друг записывается по ссылке с кодом (events.html?c=КОД)
-- и занимает это место, даже если остальные места уже разобрали. Не пришёл вовремя — место
-- освобождается само (по времени, без фоновых задач). Можно запускать повторно. Нужен шаг 16.
alter table public.event_signups add column if not exists friend_code text;
alter table public.event_signups add column if not exists friend_hold_until timestamptz;
create unique index if not exists event_signups_friend_code_idx on public.event_signups (friend_code) where friend_code is not null;

-- занято мест: основные + действующие брони для друзей
create or replace function public.event_taken(eid uuid) returns int
language sql stable security definer set search_path = public as $$
  select (count(*) filter (where status = 'main') + count(*) filter (where status = 'main' and friend_hold_until > now()))::int
  from public.event_signups where event_id = eid
$$;
revoke execute on function public.event_taken(uuid) from public;
grant execute on function public.event_taken(uuid) to anon, authenticated;

-- старые вызовы (4 и 5 аргументов) тоже не занимают место, которое держат для друга
create or replace function public.event_signup(eid uuid, p_name text, p_contact text, p_age int, p_with text) returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int; w text;
begin
  w := nullif(left(regexp_replace(trim(coalesce(p_with, '')), '[[:cntrl:]<>]', '', 'g'), 60), '');
  select * into e from public.events where id = eid and published and starts_at > now();
  if not found then raise exception 'closed'; end if;
  n := public.event_taken(eid);
  if exists (select 1 from public.event_signups where event_id = eid and lower(contact) = lower(trim(p_contact))) then
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

create or replace function public.event_signup(eid uuid, p_name text, p_contact text, p_age int) returns int
language sql security definer set search_path = public as $$
  select public.event_signup(eid, p_name, p_contact, p_age, null::text)
$$;
grant execute on function public.event_signup(uuid, text, text, int) to anon, authenticated;

-- новая запись: p_hold — держать место для друга, p_code — код из ссылки друга.
-- Ответ: {"n": занято, "reserve": bool, "code": код для ссылки | null, "until": до когда держим | null, "friend": имя позвавшего | null}
create or replace function public.event_signup_pair(eid uuid, p_name text, p_contact text, p_age int, p_with text, p_hold boolean, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; n int; w text; inv record; code text; till timestamptz; sid uuid;
begin
  w := nullif(left(regexp_replace(trim(coalesce(p_with, '')), '[[:cntrl:]<>]', '', 'g'), 60), '');
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(trim(coalesce(p_contact, ''))) < 3 then raise exception 'bad'; end if;
  select * into e from public.events where id = eid and published and starts_at > now() for update;
  if not found then raise exception 'closed'; end if;
  n := public.event_taken(eid);
  -- уже записан: как раньше, но код не выдаём (чтобы чужой контакт не давал брони)
  if exists (select 1 from public.event_signups where event_id = eid and lower(contact) = lower(trim(p_contact))) then
    if w is not null then
      update public.event_signups set with_name = w where event_id = eid and lower(contact) = lower(trim(p_contact)) and with_name is null;
    end if;
    return jsonb_build_object('n', n, 'reserve', false, 'code', null, 'until', null, 'friend', null, 'again', true);
  end if;
  if (select count(*) from public.event_signups where event_id = eid) > coalesce(e.capacity, 1000) + 50 then raise exception 'full'; end if;

  -- друг пришёл по ссылке с кодом: занимает удержанное место
  if nullif(trim(coalesce(p_code, '')), '') is not null then
    select * into inv from public.event_signups
    where event_id = eid and friend_code = upper(trim(p_code)) and status = 'main' and friend_hold_until > now() for update;
    if found then
      update public.event_signups set friend_hold_until = null, friend_code = null where id = inv.id;
      insert into public.event_signups (event_id, name, contact, age, with_name)
      values (eid, trim(p_name), trim(p_contact), p_age, coalesce(w, left(inv.name, 60)));
      update public.event_signups set with_name = coalesce(with_name, left(trim(p_name), 60)) where id = inv.id;
      return jsonb_build_object('n', n, 'reserve', false, 'code', null, 'until', null, 'friend', split_part(inv.name, ' ', 1));
    end if;
  end if;

  if e.capacity is not null and n >= e.capacity then
    insert into public.event_signups (event_id, name, contact, age, status, with_name) values (eid, trim(p_name), trim(p_contact), p_age, 'reserve', w);
    return jsonb_build_object('n', n, 'reserve', true, 'code', null, 'until', null, 'friend', null);
  end if;

  insert into public.event_signups (event_id, name, contact, age, with_name) values (eid, trim(p_name), trim(p_contact), p_age, w)
  returning id into sid;
  n := n + 1;
  -- держим второе место: только если оно есть и до начала больше 3,5 ч
  if coalesce(p_hold, false) and e.capacity is not null and e.capacity - n >= 1 then
    till := least(now() + interval '24 hours', e.starts_at - interval '3 hours');
    if till > now() + interval '30 minutes' then
      code := upper(substr(md5(random()::text || clock_timestamp()::text || sid::text), 1, 10));
      update public.event_signups set friend_code = code, friend_hold_until = till where id = sid;
      n := n + 1;
    else
      till := null;
    end if;
  end if;
  return jsonb_build_object('n', n, 'reserve', false, 'code', code, 'until', till, 'friend', null);
end $$;
revoke execute on function public.event_signup_pair(uuid, text, text, int, text, boolean, text) from public;
grant execute on function public.event_signup_pair(uuid, text, text, int, text, boolean, text) to anon, authenticated;

-- по коду из ссылки: кто зовёт и до когда держит место (без контактов)
create or replace function public.event_friend_hold(p_code text) returns table (event_id uuid, name text, hold_until timestamptz)
language sql stable security definer set search_path = public as $$
  select s.event_id, split_part(s.name, ' ', 1), s.friend_hold_until from public.event_signups s
  where s.friend_code = upper(trim(p_code)) and s.status = 'main' and s.friend_hold_until > now()
$$;
grant execute on function public.event_friend_hold(text) to anon, authenticated;

-- счётчики на сайте: с учётом мест, которые держат для друзей
create or replace function public.event_counts() returns table (event_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select s.event_id, (count(*) filter (where s.status = 'main') + count(*) filter (where s.status = 'main' and s.friend_hold_until > now()))::int
  from public.event_signups s join public.events e on e.id = s.event_id where e.published group by s.event_id
$$;
grant execute on function public.event_counts() to anon, authenticated;

-- кабинет: «держим место для друга до …»
drop function if exists public.emp_signups(text, uuid);
create or replace function public.emp_signups(t text, eid uuid)
returns table (id uuid, created_at timestamptz, name text, contact text, age int, status text, attended boolean, came int, missed int, reliable boolean, with_name text, friend_hold_until timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.name, s.contact, s.age, s.status, s.attended, r.came, r.missed, r.reliable, s.with_name,
    case when s.friend_hold_until > now() then s.friend_hold_until end
  from public.event_signups s join public.events e on e.id = s.event_id
  cross join lateral public.person_rel(s.chat_id, s.contact) r
  where s.event_id = eid and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null
  order by s.status, r.reliable desc, s.created_at
$$;
grant execute on function public.emp_signups(text, uuid) to anon, authenticated;

-- работодатель перевёл в резерв — бронь для друга снимается
create or replace function public.emp_signup_status(t text, sid uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('main','reserve') then raise exception 'bad status'; end if;
  update public.event_signups s set status = p_status, offered_at = null,
    friend_hold_until = case when p_status = 'reserve' then null else s.friend_hold_until end,
    friend_code = case when p_status = 'reserve' then null else s.friend_code end
  from public.events e
  where s.id = sid and e.id = s.event_id and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null;
end $$;
grant execute on function public.emp_signup_status(text, uuid, text) to anon, authenticated;

-- работодатель снимает бронь вручную
create or replace function public.emp_drop_hold(t text, sid uuid) returns void language sql security definer set search_path = public as $$
  update public.event_signups s set friend_hold_until = null, friend_code = null from public.events e
  where s.id = sid and e.id = s.event_id and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null
$$;
grant execute on function public.emp_drop_hold(text, uuid) to anon, authenticated;
