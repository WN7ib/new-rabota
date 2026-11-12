-- migration-10: рейтинг надёжности соискателей (Никита 12.11).
-- Работодатель после смены отмечает «пришёл / не пришёл». Значок «✓ Надёжный» — 3 последние отмеченные смены подряд пришёл.
-- Подростков не баним: неявка только мягко опускает в резерве, бот пишет доброе напоминание.

alter table public.event_signups add column if not exists attended boolean;          -- null = ещё не отмечено
alter table public.event_signups add column if not exists att_notified boolean;      -- бот уже написал человеку про отметку

-- надёжность человека: по chat_id (бот) или по контакту (сайт)
create or replace function public.person_rel(p_chat bigint, p_contact text)
returns table (came int, missed int, reliable boolean)
language sql stable security definer set search_path = public as $$
  with h as (
    select s.attended, e.starts_at
    from public.event_signups s join public.events e on e.id = s.event_id
    where s.attended is not null
      and ((p_chat is not null and s.chat_id = p_chat) or lower(trim(s.contact)) = lower(trim(coalesce(p_contact, ''))))
  ), last3 as (select attended from h order by starts_at desc limit 3)
  select (select count(*) from h where attended)::int,
         (select count(*) from h where not attended)::int,
         coalesce((select count(*) = 3 and bool_and(attended) from last3), false)
$$;
grant execute on function public.person_rel(bigint, text) to authenticated;

-- кабинет: список записавшихся + отметка и надёжность каждого
drop function if exists public.emp_signups(text, uuid);
create or replace function public.emp_signups(t text, eid uuid)
returns table (id uuid, created_at timestamptz, name text, contact text, age int, status text, attended boolean, came int, missed int, reliable boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.name, s.contact, s.age, s.status, s.attended, r.came, r.missed, r.reliable
  from public.event_signups s join public.events e on e.id = s.event_id
  cross join lateral public.person_rel(s.chat_id, s.contact) r
  where s.event_id = eid and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null
  order by s.status, r.reliable desc, s.created_at
$$;
grant execute on function public.emp_signups(text, uuid) to anon, authenticated;

-- отметить явку (только после начала смены и только свою смену)
create or replace function public.emp_mark(t text, sid uuid, came boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.event_signups s set attended = came, att_notified = null
  from public.events e
  where s.id = sid and e.id = s.event_id and e.starts_at <= now()
    and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null;
end $$;
grant execute on function public.emp_mark(text, uuid, boolean) to anon, authenticated;

-- резерв: первым место предлагается надёжным и тем, у кого меньше неявок
create or replace function public.event_reserve_order(eid uuid)
returns table (id uuid, reliable boolean, missed int)
language sql stable security definer set search_path = public as $$
  select s.id, r.reliable, r.missed
  from public.event_signups s cross join lateral public.person_rel(s.chat_id, s.contact) r
  where s.event_id = eid and s.status = 'reserve' and s.offered_at is null
  order by r.reliable desc, r.missed asc, s.created_at
$$;
grant execute on function public.event_reserve_order(uuid) to authenticated;
