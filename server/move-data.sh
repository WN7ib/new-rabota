#!/usr/bin/env bash
# New.работа: перенос базы со старого Supabase (supabase.co, за границей) на свой сервер. Запускать на сервере после install.sh:
#   bash /opt/newrabota/site/server/move-data.sh
# Спросит строку подключения к старой базе — Supabase → проект → кнопка «Connect» → «Session pooler» → URI
# (вид: postgresql://postgres.htachxunemajeawnbccy:ПАРОЛЬ@aws-0-….pooler.supabase.com:5432/postgres; ПАРОЛЬ — пароль базы).
# Переносит: все таблицы, функции и правила (public), учётку владельца для админки (auth.users — пароль тот же; вход
# модератора в Мессенджере тоже остаётся — переезжают сессии),
# обход бота раз в 10 минут (pg_cron) — уже на новый адрес. Старую базу НЕ меняет и не удаляет.
# Повторный запуск — только с --again (новая база очищается и заливается заново).
set -euo pipefail
ROOT=/opt/newrabota; DIR=${NR_DIR:-$ROOT/supabase}; SRC=${NR_SRC:-$ROOT/site}
cd "$DIR"
say() { printf '\n=== %s\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }
dc() { docker compose "$@"; }
new() { dc exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

OLD="${NR_OLD_DB:-}"
if [ -z "$OLD" ]; then
  printf 'Строка подключения к старой базе (Session pooler URI; ввод скрыт): ' >/dev/tty
  IFS= read -rs OLD </dev/tty; echo >/dev/tty
fi
case "$OLD" in postgres://*|postgresql://*) ;; *) die "строка должна начинаться с postgresql://";; esac
case "$OLD" in *"[YOUR-PASSWORD]"*) die "в строке вместо [YOUR-PASSWORD] нужно вписать пароль базы";; esac
old() { dc exec -T -e PGCONNECT_TIMEOUT=20 db "$@"; }

say "Проверяю старую базу"
old psql "$OLD" -tAc "select 'ok: ' || count(*) || ' таблиц' from pg_tables where schemaname='public'" || die "не подключилась к старой базе (пароль? Session pooler?)"

have=$(new -tAc "select count(*) from pg_tables where schemaname='public' and tablename <> 'nr_migrations'")
if [ "$have" != 0 ]; then
  [ "${1:-}" = "--again" ] || die "в новой базе уже есть таблицы ($have). Перенести заново: bash $0 --again"
  say "Очищаю новую базу (--again)"
  new -qc "drop schema public cascade; create schema public; alter schema public owner to pg_database_owner;
           grant usage on schema public to anon, authenticated, service_role;
           grant all on schema public to postgres, anon, authenticated, service_role;
           delete from auth.refresh_tokens; delete from auth.sessions; delete from auth.identities; delete from auth.users;"
  new -qc "select cron.unschedule(jobid) from cron.job where jobname='nr-bot-tick'" >/dev/null 2>&1 || true
fi

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT; chmod 700 "$W"
say "Снимаю копию: схема, данные, учётки"
old pg_dump "$OLD" -n public --schema-only --no-comments > "$W/schema.sql"
old pg_dump "$OLD" -n public --data-only --no-comments > "$W/data.sql"
old pg_dump "$OLD" -t auth.users -t auth.identities -t auth.sessions -t auth.refresh_tokens -t auth.mfa_factors -t auth.mfa_amr_claims --data-only --column-inserts --on-conflict-do-nothing > "$W/auth.sql"
echo "схема $(wc -l <"$W/schema.sql") строк, данные $(du -h "$W/data.sql" | cut -f1)"

# схема public уже есть в новой базе
sed -i -e '/^CREATE SCHEMA public;/d' -e '/^ALTER SCHEMA public OWNER/d' -e '/^COMMENT ON SCHEMA public/d' "$W/schema.sql"

say "Заливаю в новую базу"
new -q -1 -f - < "$W/schema.sql" >/dev/null
{ echo "set session_replication_role = replica;"; cat "$W/data.sql"; } | new -q -1 -f - >/dev/null
{ echo "set session_replication_role = replica;"; cat "$W/auth.sql"; } | new -q -1 -f - >/dev/null
# GoTrue не входит, если в строковых полях NULL (бывает у учёток, созданных вручную/старыми версиями)
new -qc "update auth.users set confirmation_token=coalesce(confirmation_token,''), recovery_token=coalesce(recovery_token,''),
  email_change_token_new=coalesce(email_change_token_new,''), email_change=coalesce(email_change,''),
  email_change_token_current=coalesce(email_change_token_current,''), phone_change=coalesce(phone_change,''),
  phone_change_token=coalesce(phone_change_token,''), reauthentication_token=coalesce(reauthentication_token,'')"

say "Обход бота раз в 10 минут — на новый адрес"
new -qc "create table if not exists public.nr_migrations (name text primary key, applied_at timestamptz default now()); revoke all on public.nr_migrations from anon, authenticated;"
for f in "$SRC"/migration-*.sql; do new -qc "insert into public.nr_migrations(name) values ('$(basename "$f")') on conflict do nothing"; done
if [ -f "$SRC/migration-23-bot-tick.sql" ]; then
  sed "s|https://htachxunemajeawnbccy.supabase.co/functions/v1/|http://kong:8000/functions/v1/|g" "$SRC/migration-23-bot-tick.sql" | new -q -f - >/dev/null
fi
new -qc "notify pgrst, 'reload schema'"

say "Сверяю: строк в старой → в новой"
bad=0
for t in $(new -tAc "select tablename from pg_tables where schemaname='public' and tablename <> 'nr_migrations' order by 1"); do
  a=$(old psql "$OLD" -tAc "select count(*) from public.\"$t\"")
  b=$(new -tAc "select count(*) from public.\"$t\"")
  [ "$a" = "$b" ] && m="✓" || { m="✗"; bad=1; }
  printf '  %s %-28s %8s → %s\n' "$m" "$t" "$a" "$b"
done
u=$(new -tAc "select count(*) from auth.users"); echo "  учёток для входа: $u"
[ $bad = 0 ] || die "есть расхождения (✗) — пришли Клоду этот вывод"
say "Готово: данные на своём сервере. Старую базу не трогала — она работает, пока сайт не переключён."
