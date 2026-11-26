-- New.работа, шаг 26 (Никита 26.11): переписка соискателя и работодателя по анкете — в приложении/на сайте.
-- Соискатель без аккаунта: после анкеты получает секретный ключ переписки (хранится только у него в телефоне, в базе — хеш).
-- Работодатель — из кабинета (вход через бота). Модератор видит всё (жалобы, обман). Новые сообщения работодателю шлёт бот.
alter table public.applications add column if not exists chat_hash text;

create table if not exists public.app_messages (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  application_id uuid not null references public.applications(id) on delete cascade,
  from_emp boolean not null,
  body text not null check (char_length(body) between 1 and 1000),
  notified boolean not null default false,
  read_at timestamptz
);
create index if not exists app_messages_app on public.app_messages (application_id, id);
create index if not exists app_messages_new on public.app_messages (notified) where not notified;
alter table public.app_messages enable row level security;
drop policy if exists "app messages admin" on public.app_messages;
create policy "app messages admin" on public.app_messages for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.app_chat_id(tok text) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.applications where chat_hash = public.nr_hash(tok) and char_length(coalesce(tok,'')) >= 32 limit 1
$$;
revoke execute on function public.app_chat_id(text) from public, anon, authenticated;

-- 1) после анкеты (apply_v вернул код) — выдать ключ переписки, один раз и только в первые сутки
create or replace function public.app_chat_start(p_vcode text) returns text
language plpgsql security definer set search_path = public as $$
declare aid uuid; tok text;
begin
  select id into aid from public.applications
    where vcode = p_vcode and char_length(coalesce(p_vcode,'')) >= 16 and chat_hash is null and created_at > now() - interval '1 day' limit 1;
  if aid is null then return null; end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.applications set chat_hash = public.nr_hash(tok) where id = aid;
  if exists (select 1 from public.applications where id = aid and message is not null) then
    insert into public.app_messages (application_id, from_emp, body, notified)
      select id, false, message, true from public.applications where id = aid;   -- текст анкеты — первое сообщение (уже ушло работодателю с анкетой)
  end if;
  return tok;
end $$;

-- 2) соискатель: переписка целиком
create or replace function public.app_chat_get(tok text) returns json
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); r json;
begin
  if aid is null then return null; end if;
  update public.app_messages set read_at = now() where application_id = aid and from_emp and read_at is null;
  select json_build_object(
    'title', v.title, 'company', v.company, 'vacancy_id', v.id, 'status', a.status, 'name', a.name,
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'at', m.created_at, 'emp', m.from_emp, 'body', m.body, 'read', m.read_at is not null) order by m.id)
                          from public.app_messages m where m.application_id = aid), '[]'::json))
    into r from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid;
  return r;
end $$;

-- сколько непрочитанных у соискателя по нескольким ключам сразу (значок в приложении)
create or replace function public.app_chat_unread(toks text[]) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.app_messages m
  where m.from_emp and m.read_at is null and m.application_id in (select public.app_chat_id(x) from unnest(coalesce(toks, '{}')) x limit 50)
$$;

create or replace function public.app_chat_say(tok text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); b text := left(trim(coalesce(p_body,'')), 1000);
begin
  if aid is null then raise exception 'no chat'; end if;
  if b = '' then return; end if;
  if (select count(*) from public.app_messages where application_id = aid and not from_emp and created_at > now() - interval '10 minutes') >= 20 then raise exception 'too many'; end if;
  insert into public.app_messages (application_id, from_emp, body) values (aid, false, b);
end $$;

-- 3) работодатель (кабинет): переписка по своей анкете
create or replace function public.emp_chat_get(t text, aid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t);
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then return null; end if;
  update public.app_messages set read_at = now() where application_id = aid and not from_emp and read_at is null;
  return (select coalesce(json_agg(json_build_object('id', m.id, 'at', m.created_at, 'emp', m.from_emp, 'body', m.body, 'read', m.read_at is not null) order by m.id), '[]'::json)
          from public.app_messages m where m.application_id = aid);
end $$;

create or replace function public.emp_chat_say(t text, aid uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t); b text := left(trim(coalesce(p_body,'')), 1000);
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then raise exception 'not yours'; end if;
  if b = '' then return; end if;
  if (select count(*) from public.app_messages m join public.applications a on a.id = m.application_id join public.vacancies v on v.id = a.vacancy_id
      where v.employer_id = me and m.from_emp and m.created_at > now() - interval '10 minutes') >= 60 then raise exception 'too many'; end if;
  insert into public.app_messages (application_id, from_emp, body, notified) values (aid, true, b, true);
end $$;

-- непрочитанные у работодателя по анкетам (для кабинета)
create or replace function public.emp_chat_unread(t text) returns table (application_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select m.application_id, count(*)::int from public.app_messages m
    join public.applications a on a.id = m.application_id join public.vacancies v on v.id = a.vacancy_id
  where v.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null and not m.from_emp and m.read_at is null
  group by m.application_id
$$;

revoke execute on function public.app_chat_start(text), public.app_chat_get(text), public.app_chat_unread(text[]), public.app_chat_say(text, text),
  public.emp_chat_get(text, uuid), public.emp_chat_say(text, uuid, text), public.emp_chat_unread(text) from public;
grant execute on function public.app_chat_start(text), public.app_chat_get(text), public.app_chat_unread(text[]), public.app_chat_say(text, text),
  public.emp_chat_get(text, uuid), public.emp_chat_say(text, uuid, text), public.emp_chat_unread(text) to anon, authenticated;
