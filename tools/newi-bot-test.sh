#!/bin/sh
# Проверка серверной Неви (supabase/functions/newi-bot) без Telegram и Supabase. Запуск из корня репозитория: sh tools/newi-bot-test.sh
set -e
D=$(mktemp -d)
cp supabase/functions/newi-bot/index.ts "$D/bot.ts"
tsc --target es2022 --module es2022 --lib es2022,dom --skipLibCheck --outDir "$D/out" tools/deno-shim.d.ts "$D/bot.ts"
mv "$D/out/bot.js" "$D/out/bot.mjs"
BOT_JS="$D/out/bot.mjs" node tools/newi-bot.test.mjs
