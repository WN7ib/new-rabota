-- New.работа — база вакансий.
-- Вставь целиком в Supabase → SQL Editor → New query → Run.

create table if not exists public.vacancies (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null check (char_length(title) between 2 and 80),
  company     text check (char_length(company) <= 60),
  city        text check (char_length(city) <= 40),
  type        text not null default 'Подработка'
              check (type in ('Подработка','Стажировка','Частичная','Полная','Разовая')),
  age_min     int  not null default 16 check (age_min in (14,16,18)),
  pay         text check (char_length(pay) <= 40),
  remote      boolean not null default false,
  description text check (char_length(description) <= 1200),
  contact     text not null check (char_length(contact) between 3 and 120),
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected'))
);

create index if not exists vacancies_status_created on public.vacancies (status, created_at desc);

-- Кто модератор: сюда попадают id аккаунтов из Authentication → Users.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.vacancies enable row level security;
alter table public.admins    enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Все видят только одобренные вакансии; модератор видит все.
drop policy if exists "read approved" on public.vacancies;
create policy "read approved" on public.vacancies
  for select using (status = 'approved' or public.is_admin());

-- Любой может прислать вакансию, но только на проверку.
drop policy if exists "submit pending" on public.vacancies;
create policy "submit pending" on public.vacancies
  for insert to anon, authenticated
  with check (status = 'pending');

-- Одобрять, править и удалять может только модератор.
drop policy if exists "admin update" on public.vacancies;
create policy "admin update" on public.vacancies
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete" on public.vacancies;
create policy "admin delete" on public.vacancies
  for delete using (public.is_admin());

drop policy if exists "admin sees self" on public.admins;
create policy "admin sees self" on public.admins
  for select using (user_id = auth.uid());

-- ШАГ ПОСЛЕ РЕГИСТРАЦИИ МОДЕРАТОРА (запусти отдельно, подставив свою почту):
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'ТВОЯ_ПОЧТА@gmail.com';
