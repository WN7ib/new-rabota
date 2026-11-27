-- Шаг 35 (Никита 27.11): «в приложении админки — афиша, куда можно сходить, с картинкой».
-- Мероприятия Саратова находит телефон (мессенджер, Афиша) и кладёт сюда; видит только админ (вкладка «🗓 Афиша»).
create table if not exists public.afisha (
  key        text primary key,            -- нормализованное название, без повторов
  title      text not null,
  date_text  text,
  starts_at  timestamptz,
  place      text,
  link       text,
  topic      text,
  image      text,                         -- картинка со страницы мероприятия (og:image)
  created_at timestamptz not null default now()
);
create index if not exists afisha_starts on public.afisha (starts_at);
alter table public.afisha enable row level security;
drop policy if exists "afisha admin all" on public.afisha;
create policy "afisha admin all" on public.afisha for all using (public.is_admin()) with check (public.is_admin());
