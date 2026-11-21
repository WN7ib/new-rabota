-- New.работа, шаг 22: «🎯 Подбор под меня» в серверном боте (как в боте на телефоне).
-- Человек сам указывает возраст и интересы — бот показывает только подходящие вакансии
-- и раз в неделю (воскресенье) присылает подборку. Выключить — /weekly, удалить всё — /forget.
-- Можно запускать повторно. Нужен шаг 4.
alter table public.bot_users add column if not exists age smallint;          -- 14…30, 99 — «не скажу» (возраст не фильтрую)
alter table public.bot_users add column if not exists ints text[];           -- интересы: food, promo, courier, retail, online, kids, outdoor
alter table public.bot_users add column if not exists weekly boolean not null default true;   -- подборка раз в неделю
alter table public.bot_users add column if not exists wk_at timestamptz;     -- когда ушла последняя подборка
alter table public.bot_users add column if not exists wk_ids text[];         -- что уже присылала в подборках (не повторять)
