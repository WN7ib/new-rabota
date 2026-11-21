-- New.работа, шаг 24: «⏰ Мои смены» в серверном боте (как в боте на телефоне).
-- Человек сам пишет свою смену словами («завтра 10:00 кафе», «15 ноября в 9 промо») — бот напоминает
-- накануне вечером (19–22 по Саратову) и за 2 часа, кнопки «Буду / Не смогу». Удалить всё — /forget (каскадом).
-- Видит только сервер бота (service_role) и модератор. Можно запускать повторно. Нужен шаг 4.
create table if not exists public.bot_shifts (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.bot_users(chat_id) on delete cascade,
  at timestamptz not null,           -- начало смены
  text text not null,                -- где/что, как написал человек (без даты и времени)
  r1 boolean not null default false, -- напомнила накануне
  r2 boolean not null default false, -- напомнила за 2 часа
  answer text,                       -- ok | no — ответ на кнопки напоминания
  created_at timestamptz not null default now()
);
create index if not exists bot_shifts_at on public.bot_shifts (at);
create index if not exists bot_shifts_chat on public.bot_shifts (chat_id, at);

alter table public.bot_shifts enable row level security;
drop policy if exists "bot shifts admin" on public.bot_shifts;
create policy "bot shifts admin" on public.bot_shifts for all using (public.is_admin()) with check (public.is_admin());
