-- New.работа, шаг 15: кто спрашивает Newi на сайте — имя и Telegram, только если человек сам указал их в профиле.
-- Можно запускать повторно. Видит только модератор (RLS «chat admin» из migration-3).

alter table public.site_chat add column if not exists who_name text check (char_length(who_name) <= 30);
alter table public.site_chat add column if not exists who_tg   text check (who_tg ~ '^[A-Za-z0-9_]{4,32}$');

-- старая версия (2 аргумента) заменяется версией с необязательными именем и ником — старые страницы продолжают работать
drop function if exists public.chat_ask(text, text);
drop function if exists public.chat_ask(text, text, text, text);
create or replace function public.chat_ask(p_session text, p_q text, p_name text default null, p_tg text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid; v_tg text := nullif(regexp_replace(coalesce(p_tg, ''), '^@|^https?://t\.me/', ''), '');
begin
  if (select count(*) from public.site_chat where session = p_session and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'too many';
  end if;
  if v_tg is not null and v_tg !~ '^[A-Za-z0-9_]{4,32}$' then v_tg := null; end if;
  insert into public.site_chat (session, q, who_name, who_tg)
  values (p_session, left(p_q, 1000), nullif(left(trim(coalesce(p_name, '')), 30), ''), v_tg)
  returning id into new_id;
  return new_id;
end $$;
grant execute on function public.chat_ask(text, text, text, text) to anon, authenticated;
