// Собирает sitemap.xml: страницы сайта + все одобренные вакансии и мероприятия из базы (публичный ключ).
import { readFileSync, writeFileSync } from "node:fs";
const cfg = readFileSync("config.js", "utf8");
const url = cfg.match(/supabaseUrl\s*:\s*"([^"]+)"/)[1], key = cfg.match(/supabaseKey\s*:\s*"([^"]+)"/)[1];
const SITE = "https://wn7ib.github.io/new-rabota/";
async function q(path) {
  try { const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); return r.ok ? await r.json() : []; }
  catch { return []; }
}
const today = new Date().toISOString().slice(0, 10);
const pages = [["", "hourly", "1.0"], ["events.html", "daily", "0.8"], ["map.html", "daily", "0.6"], ["resume.html", "monthly", "0.7"],
  ["guide.html", "monthly", "0.7"], ["about.html", "monthly", "0.3"]];
const vac = await q("vacancies?select=id,created_at,expires_at&status=eq.approved&order=created_at.desc&limit=5000");
const live = vac.filter((v) => !v.expires_at || v.expires_at >= today);
const x = (s) => s.replace(/&/g, "&amp;");
const rows = pages.map(([p, f, pr]) => `<url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
  .concat(live.map((v) => `<url><loc>${x(SITE + "vacancy.html?id=" + v.id)}</loc><lastmod>${v.created_at.slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`));
writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`);
console.log("sitemap:", rows.length, "адресов");
