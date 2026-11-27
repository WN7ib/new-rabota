-- Шаг 37 (Никита 27.11 «план Б»): что серверная Неви ответила, пока телефон был выключен, — телефону в учёбу.
-- Лежит здесь только до следующей связи с телефоном (функция newi-bot стирает после передачи). Только для сервера (RLS без политик).
create table if not exists public.newi_log (id bigserial primary key, q text not null, a text not null, at timestamptz not null default now());
alter table public.newi_log enable row level security;
revoke all on public.newi_log from anon, authenticated;
