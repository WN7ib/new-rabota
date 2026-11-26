// New.работа как приложение: всегда свежее из сети; без сети — последняя сохранённая копия страницы (данные из базы не кешируются).
const C = "nr-shell-1";
const SHELL = ["karta.html", "style.css?v=13", "mascot.js", "common.js?v=3", "geo.js", "config.js?v=2", "vendor/supabase.js?v=1", "logo.png?v=2", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // база, карты, Telegram — мимо
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: u.pathname.endsWith(".html") })));
});
