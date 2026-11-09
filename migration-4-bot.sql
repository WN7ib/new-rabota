-- New.работа, шаг 4: бот в Telegram работает круглосуточно на сервере Supabase.
-- Эти таблицы видит только сервер бота (ключ service_role) и модератор. Применяется автоматически из GitHub Actions.

create table if not exists public.bot_users (
  chat_id bigint primary key,
  name text, username text,
  city text,                         -- подписка на новые вакансии по городу («удалённо» тоже город)
  step text, draft jsonb,            -- где человек в диалоге и черновик вакансии
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);

create table if not exists public.bot_questions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  chat_id bigint not null, name text, username text,
  q text not null,
  a text, answered_at timestamptz,
  answered_by text,                  -- newi | owner | faq
  escalated boolean not null default false
);
create index if not exists bot_questions_open on public.bot_questions (answered_at, created_at);

create table if not exists public.bot_vacancy_from (
  vacancy_id uuid primary key references public.vacancies(id) on delete cascade,
  chat_id bigint not null
);

create table if not exists public.bot_config (
  key text primary key,
  value text not null
);

alter table public.bot_users enable row level security;
alter table public.bot_questions enable row level security;
alter table public.bot_vacancy_from enable row level security;
alter table public.bot_config enable row level security;

drop policy if exists "bot users admin" on public.bot_users;
create policy "bot users admin" on public.bot_users for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "bot questions admin" on public.bot_questions;
create policy "bot questions admin" on public.bot_questions for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "bot from admin" on public.bot_vacancy_from;
create policy "bot from admin" on public.bot_vacancy_from for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "bot config admin" on public.bot_config;
create policy "bot config admin" on public.bot_config for all using (public.is_admin()) with check (public.is_admin());
