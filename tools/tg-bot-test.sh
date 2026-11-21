#!/bin/sh
# Проверка серверного бота (supabase/functions/tg-bot) без Telegram, ВК и Supabase: заглушки в tools/tg-bot.test.mjs.
# Нужны node и tsc (npm i -g typescript). Запуск из корня репозитория: sh tools/tg-bot-test.sh
set -e
D=$(mktemp -d)
cp supabase/functions/tg-bot/index.ts "$D/bot.ts"
tsc --target es2022 --module es2022 --lib es2022,dom --skipLibCheck --outDir "$D/out" tools/deno-shim.d.ts "$D/bot.ts"
mv "$D/out/bot.js" "$D/out/bot.mjs"
BOT_JS="$D/out/bot.mjs" node tools/tg-bot.test.mjs
