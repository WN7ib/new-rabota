#!/usr/bin/env bash
# New.работа: обслуживание своей базы. Ставится как /usr/local/bin/nr (install.sh).
#   nr status         — что запущено
#   nr update         — подтянуть репозиторий сайта; новые migration-*.sql → в базу; новые функции → перезапуск functions
#   nr backup         — копия базы в /opt/newrabota/backup (хранится 14 последних)
#   nr restart        — перезапуск (после правки functions.env)
#   nr logs [сервис]  — журнал (functions, db, auth, rest, caddy)
#   nr sql 'select …' — выполнить SQL
set -euo pipefail
ROOT=/opt/newrabota; DIR=${NR_DIR:-$ROOT/supabase}; SRC=${NR_SRC:-$ROOT/site}
cd "$DIR"
psql_admin() { docker compose exec -T -e PGOPTIONS=-cclient_min_messages=warning db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

cmd="${1:-status}"; shift || true
case "$cmd" in
  status) docker compose ps --format 'table {{.Service}}\t{{.Status}}' ;;
  restart) docker compose up -d --force-recreate functions; docker compose restart functions ;;
  logs) docker compose logs --tail 100 -f "${1:-functions}" ;;
  sql) psql_admin -c "$1" ;;
  backup)
    B=${NR_BACKUP:-$ROOT/backup}; mkdir -p "$B"; f="$B/db-$(date +%F-%H%M).sql.gz"
    docker compose exec -T db pg_dump -U supabase_admin -d postgres -n public -n auth --no-comments | gzip > "$f"
    ls -1t "$B"/db-*.sql.gz | tail -n +15 | xargs -r rm -f
    echo "копия: $f ($(du -h "$f" | cut -f1))" ;;
  update)
    git -C "$SRC" pull -q --ff-only || { echo "git pull не удался"; exit 1; }
    psql_admin -qc "create table if not exists public.nr_migrations (name text primary key, applied_at timestamptz default now()); revoke all on public.nr_migrations from anon, authenticated;" >/dev/null
    applied=$(psql_admin -tAc "select name from public.nr_migrations")
    # по номеру: migration-2…, migration-3…, …, migration-24…
    for f in $(ls "$SRC"/migration-*.sql 2>/dev/null | sort -t- -k2 -n); do
      n=$(basename "$f")
      grep -qx "$n" <<<"$applied" && continue
      echo "миграция $n"
      sed "s|https://htachxunemajeawnbccy.supabase.co/functions/v1/|http://kong:8000/functions/v1/|g" "$f" \
        | psql_admin -q -1 -f - && psql_admin -qc "insert into public.nr_migrations(name) values ('$n') on conflict do nothing" \
        || { echo "ОШИБКА в $n — остальные не трогаю"; exit 1; }
    done
    changed=0
    for d in "$SRC"/supabase/functions/*/; do
      n=$(basename "$d"); mkdir -p "volumes/functions/$n"
      if ! diff -rq "$d" "volumes/functions/$n" >/dev/null 2>&1; then cp -r "$d". "volumes/functions/$n/"; changed=1; echo "функция $n обновлена"; fi
    done
    [ $changed = 1 ] && docker compose restart functions >/dev/null
    true ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
