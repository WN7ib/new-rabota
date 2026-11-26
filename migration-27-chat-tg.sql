-- New.работа, шаг 27 (Никита 26.11): ответы работодателя — соискателю в Telegram, если он сам нажал «Получать ответы в боте».
-- Сайт просит короткий код привязки (по ключу переписки), бот по t.me/бот?start=ch_КОД запоминает chat_id. Отвязать — /chatoff в боте.
alter table public.applications add column if not exists chat_tg bigint;
alter table public.applications add column if not exists chat_bind text;

create or replace function public.app_chat_bind(tok text) returns text
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); c text;
begin
  if aid is null then return null; end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  update public.applications set chat_bind = c where id = aid;
  return c;
end $$;
revoke execute on function public.app_chat_bind(text) from public;
grant execute on function public.app_chat_bind(text) to anon, authenticated;

-- подключён ли Telegram к этой переписке (для кнопки на сайте)
create or replace function public.app_chat_tg(tok text) returns boolean
language sql stable security definer set search_path = public as $$
  select chat_tg is not null from public.applications where id = public.app_chat_id(tok)
$$;
revoke execute on function public.app_chat_tg(text) from public;
grant execute on function public.app_chat_tg(text) to anon, authenticated;

-- ответы работодателя теперь тоже уходят ботом (соискателю, если подключил Telegram)
create or replace function public.emp_chat_say(t text, aid uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t); b text := left(trim(coalesce(p_body,'')), 1000);
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then raise exception 'not yours'; end if;
  if b = '' then return; end if;
  if (select count(*) from public.app_messages m join public.applications a on a.id = m.application_id join public.vacancies v on v.id = a.vacancy_id
      where v.employer_id = me and m.from_emp and m.created_at > now() - interval '10 minutes') >= 60 then raise exception 'too many'; end if;
  insert into public.app_messages (application_id, from_emp, body, notified)
    values (aid, true, b, not exists (select 1 from public.applications where id = aid and chat_tg is not null));
end $$;
