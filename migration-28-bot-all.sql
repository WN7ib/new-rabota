-- New.работа, шаг 28 (Никита 26.11: «бот рассылку делает — пускай всем о новых вакансиях»):
-- новые вакансии получают ВСЕ, кто писал боту, кроме нажавших /stop (раньше — только выбравшие город).
alter table public.bot_users add column if not exists stopped boolean not null default false;
