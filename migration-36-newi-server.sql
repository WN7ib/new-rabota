-- Шаг 36 (Никита 27.11): «серверная Неви» — когда телефон выключен, личный бот отвечает с сервера и напоминает (функция newi-bot).
-- Обе таблицы — только для сервера (RLS без политик: anon/authenticated не видят ничего). Токен бота и напоминания сюда кладёт сам телефон.
create table if not exists public.newi_cfg (key text primary key, value text not null default '');
alter table public.newi_cfg enable row level security;
create table if not exists public.newi_rem (id text primary key, at timestamptz not null, text text not null, sent_at timestamptz);
alter table public.newi_rem enable row level security;
revoke all on public.newi_cfg, public.newi_rem from anon, authenticated;

-- проверка «телефон на связи?» раз в 5 минут — тем же ключом обхода, что и у рабочего бота (bot_config.tick_key, шаг 23)
create extension if not exists pg_net;
create extension if not exists pg_cron;
insert into public.bot_config (key, value)
values ('tick_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
select cron.unschedule(jobid) from cron.job where jobname = 'newi-tick';
select cron.schedule('newi-tick', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://htachxunemajeawnbccy.supabase.co/functions/v1/newi-bot',
    body := '{"tick": true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tick-key', (select value from public.bot_config where key = 'tick_key')),
    timeout_milliseconds := 60000)
$job$);
