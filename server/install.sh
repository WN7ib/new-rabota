#!/usr/bin/env bash
# New.работа: своя база (Supabase) на сервере в России — 152-ФЗ, ч. 5 ст. 18 (данные граждан РФ хранятся в РФ).
#
# Запуск на чистом сервере Ubuntu 22.04/24.04 (2 ядра, 4 ГБ, 40 ГБ), от root, в консоли сервера:
#   curl -fsSL https://raw.githubusercontent.com/WN7ib/new-rabota/main/server/install.sh | bash
#   (или: bash install.sh [домен] — по умолчанию <IP>.sslip.io, HTTPS-сертификат Caddy получит сам)
# Можно запускать повторно: что уже сделано — пропускает.
#
# Что ставит: официальный self-hosted Supabase (тег ниже) + наши функции tg-bot и pay + автообновление
# из репозитория (миграции migration-*.sql и функции) раз в 10 минут — ключ Supabase (sbp_) и GitHub-секреты больше не нужны.
# Наружу открыты только 22, 80, 443. Postgres наружу не смотрит.
set -euo pipefail

SB_REF="self-hosted/v0.8.5"                       # версия Supabase (проверена Клодом 25.11.2026)
SITE_REPO="https://github.com/WN7ib/new-rabota.git"
ROOT=/opt/newrabota
DIR=$ROOT/supabase
SRC=$ROOT/site                                    # копия репозитория сайта (миграции + функции)
TEST="${NR_TEST:-0}"                              # 1 — проверка без HTTPS (http://localhost:8000), для Клода

say() { printf '\n=== %s\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "запусти от root (sudo -i)"

setenv() { # setenv KEY VALUE — меняет или дописывает строку в .env
  local k="$1" v="$2"
  if grep -q "^$k=" "$DIR/.env"; then
    local esc; esc=$(printf '%s' "$v" | sed -e 's/[\/&|]/\\&/g')
    sed -i "s|^$k=.*$|$k=$esc|" "$DIR/.env"
  else printf '%s=%s\n' "$k" "$v" >> "$DIR/.env"; fi
}
getenv() { grep "^$1=" "$DIR/.env" | head -n1 | cut -d= -f2-; }

# ---------- 1. Docker ----------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Ставлю Docker (из репозитория Ubuntu — download.docker.com из России открывается не всегда)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq docker.io git openssl jq curl ca-certificates >/dev/null
  apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null
fi
command -v git >/dev/null || { apt-get update -qq; apt-get install -y -qq git openssl jq curl >/dev/null; }
command -v jq >/dev/null || apt-get install -y -qq jq >/dev/null

# Docker Hub ограничивает скачивание из России — зеркала (если зеркало недоступно, Docker идёт в Hub сам)
if [ ! -f /etc/docker/daemon.json ] && [ "$TEST" != 1 ]; then
  say "Зеркала Docker Hub"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://mirror.gcr.io", "https://dockerhub.timeweb.cloud"],
  "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------- 2. Домен ----------
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f "$DIR/.env" ]; then DOMAIN=$(getenv PROXY_DOMAIN); fi
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "your-domain.example.com" ]; then
  IP=$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  DOMAIN="$(printf '%s' "$IP" | tr . -).sslip.io"
fi
[ "$TEST" = 1 ] && PUBLIC="http://localhost:8000" || PUBLIC="https://$DOMAIN"
say "Адрес базы: $PUBLIC"

# ---------- 3. Копия репозитория сайта ----------
if [ -d "$SRC/.git" ]; then git -C "$SRC" pull -q --ff-only || true
elif [ -n "${NR_SRC:-}" ]; then mkdir -p "$ROOT"; cp -r "$NR_SRC" "$SRC"           # для проверки — локальная копия
else mkdir -p "$ROOT"; git clone -q --depth 20 "$SITE_REPO" "$SRC"; fi

# ---------- 4. Supabase ----------
if [ ! -f "$DIR/.env" ]; then
  say "Скачиваю Supabase ($SB_REF) и создаю ключи"
  mkdir -p "$ROOT"; cd "$ROOT"
  curl -fsSL "https://raw.githubusercontent.com/supabase/supabase/$SB_REF/docker/setup.sh" -o /tmp/sb-setup.sh
  sh /tmp/sb-setup.sh -y --skip-deps --ref "$SB_REF" --project-dir supabase </dev/null
fi
cd "$DIR"
setenv SUPABASE_PUBLIC_URL "$PUBLIC"
setenv API_EXTERNAL_URL "$PUBLIC/auth/v1"
setenv PROXY_DOMAIN "$DOMAIN"
setenv SITE_URL "https://new-rabota.ru"
setenv ADDITIONAL_REDIRECT_URLS "https://new-rabota.ru/**,https://www.new-rabota.ru/**,https://nw7ib.github.io/**,https://wn7ib.github.io/**"
setenv DISABLE_SIGNUP true            # вход только у владельца (его учётка переедет с данными), чужие регистрации закрыты
setenv ENABLE_PHONE_SIGNUP false
setenv ENABLE_ANONYMOUS_USERS false
setenv FUNCTIONS_VERIFY_JWT false     # Telegram и Platega шлют без JWT; функции проверяют сами (tick-key, X-Secret)
setenv STUDIO_DEFAULT_PROJECT "New.работа"
if [ "$TEST" = 1 ]; then setenv COMPOSE_FILE "docker-compose.yml:docker-compose.newi.yml"
else setenv COMPOSE_FILE "docker-compose.yml:docker-compose.caddy.yml:docker-compose.newi.yml"; fi
cp "$SRC/server/docker-compose.newi.yml" "$DIR/docker-compose.newi.yml"

# секреты функций — отдельно, только root может читать
FENV="$DIR/functions.env"
if [ ! -f "$FENV" ]; then
  umask 077
  printf '%s\n' "# Секреты функций tg-bot и pay. Меняешь — потом: bash $ROOT/site/server/nr.sh restart" \
    "TG_TOKEN=" "OWNER_ID=" "PLATEGA_MERCHANT_ID=" "PLATEGA_SECRET=" "PLATEGA_URL=" "GEMINI_API_KEY=" "VK_TOKEN=" \
    "SITE_URL=https://new-rabota.ru" > "$FENV"
  umask 022
fi
chmod 600 "$FENV"
ask_secret() { # ask_secret KEY "вопрос" — спрашивает, если пусто и есть экран
  local cur; cur=$(grep "^$1=" "$FENV" | cut -d= -f2-)
  [ -n "$cur" ] && return 0
  ( : </dev/tty ) 2>/dev/null || return 0
  printf '%s (Enter — пропустить): ' "$2" >/dev/tty; local v; IFS= read -rs v </dev/tty; echo >/dev/tty
  [ -n "$v" ] && sed -i "s|^$1=.*$|$1=$(printf '%s' "$v" | sed -e 's/[\/&|]/\\&/g')|" "$FENV"
  return 0
}
if [ "$TEST" != 1 ]; then
  say "Ключи (вводятся скрыто, на экране не видны; в чат их не присылай)"
  ask_secret TG_TOKEN "Токен рабочего бота New.работа из @BotFather"
  ask_secret OWNER_ID "Твой Telegram id (цифры)"
  ask_secret PLATEGA_MERCHANT_ID "Platega MerchantId"
  ask_secret PLATEGA_SECRET "Platega Secret"
fi

# наши функции
sync_functions() {
  for f in "$SRC"/supabase/functions/*/; do
    n=$(basename "$f"); mkdir -p "volumes/functions/$n"; cp -r "$f". "volumes/functions/$n/"
  done
}
sync_functions

# ---------- 5. Запуск ----------
say "Запускаю (первый раз — несколько минут, скачивается ~3 ГБ)"
docker compose pull -q 2>/dev/null || docker compose pull
docker compose up -d --remove-orphans
say "Жду, пока всё поднимется"
KEY=$(getenv SUPABASE_PUBLISHABLE_KEY)
ok=0
if [ "$TEST" = 1 ]; then CHK=(curl -fsS --max-time 5 "$PUBLIC/auth/v1/health" -H "apikey: $KEY")
else CHK=(curl -fsS --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "$PUBLIC/auth/v1/health" -H "apikey: $KEY"); fi
for i in $(seq 1 90); do "${CHK[@]}" >/dev/null 2>&1 && { ok=1; break; }; sleep 5; done
[ $ok = 1 ] || { docker compose ps; die "база не ответила за 7 минут — пришли Клоду вывод: docker compose -f $DIR/docker-compose.yml ps"; }

# ---------- 6. Расширения, автообновление, защита ----------
docker compose exec -T db psql -U supabase_admin -d postgres -qc "create extension if not exists pg_net; create extension if not exists pg_cron;" >/dev/null
if [ "$TEST" != 1 ]; then
  install -m 755 "$SRC/server/nr.sh" /usr/local/bin/nr
  cat > /etc/systemd/system/nr-update.service <<EOF
[Unit]
Description=New.работа: миграции и функции из репозитория
[Service]
Type=oneshot
ExecStart=/usr/local/bin/nr update
EOF
  cat > /etc/systemd/system/nr-update.timer <<'EOF'
[Unit]
Description=New.работа: обновление раз в 10 минут
[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/nr-backup.timer <<'EOF'
[Unit]
Description=New.работа: копия базы каждую ночь
[Timer]
OnCalendar=*-*-* 03:17
Persistent=true
[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/nr-backup.service <<'EOF'
[Unit]
Description=New.работа: копия базы
[Service]
Type=oneshot
ExecStart=/usr/local/bin/nr backup
EOF
  systemctl daemon-reload
  systemctl enable --now nr-update.timer nr-backup.timer >/dev/null
  if command -v ufw >/dev/null; then
    ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null
  fi
fi

# ---------- 7. Итог ----------
cat > "$ROOT/ИТОГ.txt" <<EOF
New.работа — база на своём сервере
Адрес (supabaseUrl):          $PUBLIC
Публичный ключ (supabaseKey): $KEY
Панель Supabase Studio:       $PUBLIC  (логин и пароль: grep DASHBOARD_ $DIR/.env)
Секреты функций:              $FENV
Команды: nr status | nr update | nr backup | nr restart | nr logs tg-bot
EOF
say "Готово"
cat "$ROOT/ИТОГ.txt"
echo
echo "Дальше — перенос данных:  bash $SRC/server/move-data.sh"
echo "Клоду пришли только две строки «Адрес» и «Публичный ключ» (они не секретные). Пароли и ключи — НЕ присылай."
