# Своя база в России (переезд с supabase.co, 152-ФЗ ч. 5 ст. 18)

Решение Никиты 25.11.2026: вариант «Б», перенос базы в российское облако. Выбран путь «своя копия Supabase на VPS»,
потому что сайт, бот и мессенджер меняют только адрес и ключ (`config.js`, `Sb.kt`), код запросов остаётся прежним.

## Файлы
- `install.sh` ставит на чистую Ubuntu: Docker (из репозитория Ubuntu), зеркала Docker Hub, официальный self-hosted Supabase
  (`self-hosted/v0.8.5`, Envoy + Caddy с HTTPS), наши функции `tg-bot` и `pay`, таймеры `nr-update` (раз в 10 мин)
  и `nr-backup` (ночью), ufw (22/80/443). Не запускаются storage, imgproxy, realtime и supavisor: сайт их не использует.
  Регистрация закрыта (`DISABLE_SIGNUP`). Домен по умолчанию — `<IP>.sslip.io`.
- `docker-compose.newi.yml` подключается через `COMPOSE_FILE`. Здесь `functions.env` (секреты функций, chmod 600)
  и выключенные сервисы.
- `move-data.sh` переносит со старой базы public (схему, данные, права, RLS), а из auth — users, identities, sessions и refresh_tokens.
  Пароль админки и вход модератора в Мессенджере сохраняются. Ещё он отмечает все `migration-*.sql` как применённые, ставит pg_cron-обход
  бота на `http://kong:8000/functions/v1/tg-bot` и сверяет число строк в каждой таблице. Старую базу не меняет.
  Повторный запуск — `--again`.
- `nr.sh` (на сервере это `/usr/local/bin/nr`): `status | update | backup | restart | logs | sql`. `nr update` делает `git pull`,
  применяет новые migration-*.sql (учёт в `public.nr_migrations`, URL supabase.co заменяет на внутренний) и обновляет функции.
  **Новые миграции и функции теперь достаточно запушить в main: сервер подхватит их сам за 10 минут.** `db.yml`, `deploy-bot.yml` и ключ `sbp_` после переезда не нужны.

## Проверено Клодом 25.11 (Docker в облачной среде)
- Официальная установка, наш compose и функции: стек поднимается (db, auth, rest, meta, functions, api-gw, studio).
- Перенос с «старой» базы: schema.sql и все миграции 2–24, 120 вакансий, учётка админа и сессия. Сверка ✓ по 21 таблице,
  refresh-токен после переноса работает.
- RLS: аноним видит 80 одобренных и 0 на проверке, вставка approved → 401, чужая регистрация → 422.
- Настоящий сайт в Chromium (config.js → новая база): главная показывает 80 вакансий, вход в админку работает (40 ждут проверки), ошибок в консоли нет.
- Не проверено здесь (в песочнице нет выхода на jsr.io и ghcr через прокси): запуск edge-runtime (нужен jsr.io) и HTTPS Caddy.
  Проверить на сервере: `nr status`, `curl https://<домен>/functions/v1/tg-bot` должен вернуть 403 forbidden.

## Переключение (после install.sh и move-data.sh)
1. `config.js` сайта: `supabaseUrl` и `supabaseKey` из `/opt/newrabota/ИТОГ.txt` (оба публичные).
2. Мессенджер: в `new-rabota/newi-tasks.json` добавить поручение `{"do":"sb_url","args":{"url":"https://…","key":"sb_publishable_…"}}`
   (нужен Мессенджер с `sb_url`, ветка claude/newi-helper). Потом `bot_server`: телефон переставит webhook Telegram на новый адрес.
3. Platega: в кабинете сменить Callback URL на `https://<домен>/functions/v1/pay`.
4. ВК: `/vk` владельцем ещё раз (vkSetup запишет новый адрес Callback).
5. `privacy.html`, раздел 5: «на сервере в России (провайдер, город)».
6. Неделю держать старую базу как запасную, потом поставить проект на паузу в Supabase. **Не удалять без слова Никиты.**
7. Подать уведомление в РКН об обработке ПД (pd.rkn.gov.ru), указав место хранения — Россия.
