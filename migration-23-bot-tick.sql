-- New.работа, шаг 23: обход серверного бота раз в 10 минут прямо из базы (pg_cron + pg_net), без GitHub-секретов и без телефона.
-- Бот (supabase/functions/tg-bot) принимает обход по заголовку x-tick-key = bot_config.tick_key (случайный, генерируется здесь один раз).
-- Можно запускать повторно.
create extension if not exists pg_net;
create extension if not exists pg_cron;

insert into public.bot_config (key, value)
values ('tick_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

select cron.unschedule(jobid) from cron.job where jobname = 'nr-bot-tick';
select cron.schedule('nr-bot-tick', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://htachxunemajeawnbccy.supabase.co/functions/v1/tg-bot',
    body := '{"tick": true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tick-key', (select value from public.bot_config where key = 'tick_key')),
    timeout_milliseconds := 60000)
$job$);
