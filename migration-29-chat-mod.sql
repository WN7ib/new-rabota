-- New.работа, шаг 29 (Никита 26.11: «чтобы я мог вмешаться»): модератор пишет в переписку от своего имени (видят обе стороны)
-- и может остановить переписку (больше никто не пишет, пока не откроет).
alter table public.app_messages add column if not exists from_mod boolean not null default false;
alter table public.applications add column if not exists chat_locked boolean not null default false;

create or replace function public.app_chat_get(tok text) returns json
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); r json;
begin
  if aid is null then return null; end if;
  update public.app_messages set read_at = now() where application_id = aid and from_emp and read_at is null;
  select json_build_object(
    'title', v.title, 'company', v.company, 'vacancy_id', v.id, 'status', a.status, 'name', a.name, 'locked', a.chat_locked,
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'at', m.created_at, 'emp', m.from_emp, 'mod', m.from_mod, 'body', m.body, 'read', m.read_at is not null) order by m.id)
                          from public.app_messages m where m.application_id = aid), '[]'::json))
    into r from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid;
  return r;
end $$;

create or replace function public.app_chat_say(tok text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); b text := left(trim(coalesce(p_body,'')), 1000);
begin
  if aid is null then raise exception 'no chat'; end if;
  if (select chat_locked from public.applications where id = aid) then raise exception 'locked'; end if;
  if b = '' then return; end if;
  if (select count(*) from public.app_messages where application_id = aid and not from_emp and created_at > now() - interval '10 minutes') >= 20 then raise exception 'too many'; end if;
  insert into public.app_messages (application_id, from_emp, body) values (aid, false, b);
end $$;

create or replace function public.emp_chat_get(t text, aid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t);
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then return null; end if;
  update public.app_messages set read_at = now() where application_id = aid and not from_emp and read_at is null;
  return (select coalesce(json_agg(json_build_object('id', m.id, 'at', m.created_at, 'emp', m.from_emp, 'mod', m.from_mod, 'body', m.body, 'read', m.read_at is not null) order by m.id), '[]'::json)
          from public.app_messages m where m.application_id = aid);
end $$;

create or replace function public.emp_chat_say(t text, aid uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t); b text := left(trim(coalesce(p_body,'')), 1000);
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then raise exception 'not yours'; end if;
  if (select chat_locked from public.applications where id = aid) then raise exception 'locked'; end if;
  if b = '' then return; end if;
  if (select count(*) from public.app_messages m join public.applications a on a.id = m.application_id join public.vacancies v on v.id = a.vacancy_id
      where v.employer_id = me and m.from_emp and m.created_at > now() - interval '10 minutes') >= 60 then raise exception 'too many'; end if;
  insert into public.app_messages (application_id, from_emp, body, notified)
    values (aid, true, b, not exists (select 1 from public.applications where id = aid and chat_tg is not null));
end $$;
