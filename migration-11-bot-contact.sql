-- New.работа, шаг 11: контакт человека в базе бота (только если он сам оставил командой /contact).
alter table public.bot_users add column if not exists contact text;
alter table public.bot_users add column if not exists contact_at timestamptz;
