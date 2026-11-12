// Код подтверждения Яндекс.Вебмастера / Google из настроек сайта (их кладёт телефон Никиты) → meta в index.html.
// Запускается workflow «verify» раз в час. Ничего не меняет, если код уже на месте.
import fs from "node:fs";
const cfg = fs.readFileSync("config.js", "utf8");
const url = cfg.match(/supabaseUrl:\s*"([^"]+)"/)[1], key = cfg.match(/supabaseKey:\s*"([^"]+)"/)[1];
const r = await fetch(`${url}/rest/v1/settings?select=data&id=eq.1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
if (!r.ok) { console.log("настройки не прочитались", r.status); process.exit(0); }
const data = (await r.json())[0]?.data || {};
let html = fs.readFileSync("index.html", "utf8"), changed = false;
for (const [k, name] of [["yandex_verification", "yandex-verification"], ["google_verification", "google-site-verification"]]) {
  const v = String(data[k] || "").trim();
  if (!/^[A-Za-z0-9_\-]{6,80}$/.test(v)) continue;
  const tag = `<meta name="${name}" content="${v}">`;
  if (html.includes(tag)) continue;
  const re = new RegExp(`<meta name="${name}" content="[^"]*">\\n?`);
  html = re.test(html) ? html.replace(re, tag + "\n") : html.replace(/(<meta name="viewport"[^>]*>\n)/, `$1${tag}\n`);
  changed = true; console.log("вписала", name);
}
if (changed) fs.writeFileSync("index.html", html); else console.log("без изменений");
