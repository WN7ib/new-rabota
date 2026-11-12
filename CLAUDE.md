# New.работа — памятка для Claude

Владелец — Никита (пишет по-русски, коротко; ждёт, что всё доводится до конца и проверяется).
Сайт вакансий и смен для молодёжи (14+, по всей России, есть удалёнка). Статика на GitHub Pages + Supabase.

## Устройство
- HTML/JS без сборщиков: `index.html`, `vacancy.html`, `events.html` (смены), `cabinet.html` (кабинет работодателя),
  `consent.html` (согласие родителей для 14–17), `common.js`, `app.js`, `config.js` (URL Supabase и публичный ключ — это нормально).
- База: Supabase. Схема — `schema.sql`, изменения — `migration-N.sql` по порядку. Доступ — через RLS и RPC `SECURITY DEFINER`
  с токеном (`nr_emp(t)` и т.п.). Серверные функции — `supabase/functions/` (бот `tg-bot`, оплата `pay`).
- Боты: рабочий бот New.работа сейчас крутится на телефоне Никиты (мессенджер `WN7ib/navi-assistant`, `TgBot.kt`);
  серверная версия — `supabase/functions/tg-bot` (деплой `deploy-bot.yml`).
- Группа в Telegram: @Newrabotaa.

## Применить миграции
- GitHub Actions `db.yml` (запуск вручную) применяет `migration-*.sql` через Supabase Management API.
  Нужен секрет репозитория **SUPABASE_ACCESS_TOKEN** (ключ `sbp_…`). Без него миграции 7–9 так и не применены.
- Запасной путь: поручение телефону в `newi-tasks.json` (тип `sql`) — мессенджер выполнит своим ключом.
- Проверять SQL локально можно на Postgres 16 со «заглушками» ролей `anon/authenticated/service_role` и `auth.uid()`.

## Правила
- Ключи и токены не коммитить никогда. Platega (оплата) — MerchantId/Secret только в секреты Supabase.
- Для 14–17 лет — подсказки по ТК РФ (ст. 63, 92, 94, 96, 265, 268) и согласие родителей.
- Не парсить Авито и чужие паблики (правила площадок).
- Перед push: `git pull --rebase origin main` — работают несколько сессий Claude.
- Очередь общих задач — `CLAUDE_QUEUE.md` в репозитории `WN7ib/navi-assistant`.
