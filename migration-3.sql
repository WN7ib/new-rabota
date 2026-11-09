-- New.работа, шаг 3: проверенные работодатели, срок вакансии, отклики, жалобы, чат с Newi, проекты.
alter table public.vacancies add column if not exists verified boolean not null default false;
alter table public.vacancies add column if not exists expires_at date;
alter table public.vacancies add column if not exists clicks int not null default 0;
alter table public.vacancies drop constraint if exists vacancies_type_check;
alter table public.vacancies add constraint vacancies_type_check check (type in ('Подработка','Стажировка','Частичная','Полная','Разовая','Проект','Волонтёрство'));

drop policy if exists "submit pending" on public.vacancies;
create policy "submit pending" on public.vacancies for insert to anon, authenticated
  with check (status = 'pending' and pinned = false and verified = false and clicks = 0
    and coalesce((select (data->>'submissions_open')::boolean from public.settings where id = 1), true));

create or replace function public.vacancy_click(vid uuid) returns void
language sql security definer set search_path = public as $$
  update public.vacancies set clicks = clicks + 1 where id = vid and status = 'approved';
$$;
grant execute on function public.vacancy_click(uuid) to anon, authenticated;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  vacancy_id uuid not null references public.vacancies(id) on delete cascade,
  reason text not null check (char_length(reason) between 2 and 500),
  status text not null default 'new' check (status in ('new','done'))
);
alter table public.reports enable row level security;
drop policy if exists "report submit" on public.reports;
create policy "report submit" on public.reports for insert to anon, authenticated with check (status = 'new');
drop policy if exists "report admin" on public.reports;
create policy "report admin" on public.reports for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.site_chat (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session text not null check (char_length(session) between 16 and 64),
  q text not null check (char_length(q) between 1 and 1000),
  a text,
  answered_at timestamptz
);
create index if not exists site_chat_open on public.site_chat (answered_at, created_at);
alter table public.site_chat enable row level security;
drop policy if exists "chat admin" on public.site_chat;
create policy "chat admin" on public.site_chat for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.chat_ask(p_session text, p_q text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if (select count(*) from public.site_chat where session = p_session and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'too many';
  end if;
  insert into public.site_chat (session, q) values (p_session, left(p_q, 1000)) returning id into new_id;
  return new_id;
end $$;
create or replace function public.chat_get(p_session text)
returns table (id uuid, created_at timestamptz, q text, a text)
language sql stable security definer set search_path = public as $$
  select id, created_at, q, a from public.site_chat where session = p_session order by created_at desc limit 40;
$$;
grant execute on function public.chat_ask(text, text) to anon, authenticated;
grant execute on function public.chat_get(text) to anon, authenticated;
