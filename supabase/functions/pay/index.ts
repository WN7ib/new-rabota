// Оплата продвижения вакансий через Platega (СБП и карта). Работает на сервере Supabase (Edge Function `pay`).
// Ключи Platega только в секретах Supabase: PLATEGA_MERCHANT_ID, PLATEGA_SECRET (кладёт мессенджер Newi по команде
// «/platega ID СЕКРЕТ» в личном боте). В коде и на сайте ключей нет.
//
// Запросы:
//  • с сайта (кабинет): POST {action:"create", order, vid, k, method:"sbp"|"card"} → {url} — ссылка на страницу оплаты Platega;
//  • с сайта: POST {action:"check", order, vid, k} → {status} — сверить заказ с Platega (если уведомление не дошло);
//  • от Platega (callback, заголовки X-MerchantId / X-Secret): {id, status, amount, ...} → 200 "ok".
// Оплату НЕ подтверждаю по телу уведомления: статус всегда перепроверяю запросом GET /transaction/{id} к Platega.

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MID = Deno.env.get("PLATEGA_MERCHANT_ID") ?? "";
const SECRET = Deno.env.get("PLATEGA_SECRET") ?? "";
const API = (Deno.env.get("PLATEGA_URL") ?? "https://app.platega.io").replace(/\/$/, "");
const SITE = Deno.env.get("SITE_URL") ?? "https://wn7ib.github.io/new-rabota/";
const TG = Deno.env.get("TG_TOKEN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROD: Record<string, string> = { top7: "В топ на 7 дней", urgent: "Срочно + пост в канале", verify: "Значок «✓ проверен»", business: "Бизнес на месяц" };

async function db(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) { console.error("db", method, path, r.status, t.slice(0, 300)); return null; }
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}
const enc = encodeURIComponent;

function platega(method: string, path: string, body?: unknown) {
  return fetch(API + path, {
    method,
    headers: { "X-MerchantId": MID, "X-Secret": SECRET, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Сравнение строк без утечки по времени. */
function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** Заказ, если ключ вакансии верный. */
async function myOrder(order: string, vid: string, k: string): Promise<any | null> {
  if (!UUID.test(order) || !UUID.test(vid) || typeof k !== "string" || k.length < 32 || k.length > 200) return null;
  const ok = await db("POST", "rpc/nr_key_ok", { vid, k });
  if (ok !== true) return null;
  const r = await db("GET", `orders?select=id,vacancy_id,product,price,status,pay_tx&id=eq.${order}&vacancy_id=eq.${vid}`);
  return r?.[0] ?? null;
}

async function notifyOwner(text: string) {
  if (!TG) return;
  const cfg = await db("GET", "bot_config?select=value&key=eq.owner_id");
  const owner = Deno.env.get("OWNER_ID") || cfg?.[0]?.value;
  if (!owner) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: owner, text }) }).catch(() => {});
}

/** Сверяю транзакцию с Platega и обновляю заказ. Возвращает итоговый статус заказа. */
async function sync(o: any): Promise<string> {
  if (!o.pay_tx) return o.status;
  const r = await platega("GET", `/transaction/${enc(o.pay_tx)}`);
  if (!r.ok) { console.error("platega status", r.status, (await r.text()).slice(0, 200)); return o.status; }
  const t = await r.json().catch(() => ({}));
  const st = String(t.status ?? "").toUpperCase();
  const amount = Number(t.paymentDetails?.amount ?? t.amount ?? 0);
  if (st === "CONFIRMED" && o.status !== "paid") {
    if (amount + 0.001 < o.price) {
      await db("PATCH", `orders?id=eq.${o.id}`, { pay_note: `CONFIRMED, но сумма ${amount} < ${o.price}` });
      await notifyOwner(`⚠️ Platega: заказ ${o.id.slice(0, 8)} оплачен не полностью (${amount} из ${o.price} ₽). Проверь вручную.`);
      return o.status;
    }
    // статус paid → триггер nr_order_paid сам включает услугу (топ, срочно, значок)
    await db("PATCH", `orders?id=eq.${o.id}&status=neq.paid`, { status: "paid", pay_note: "CONFIRMED" });
    await notifyOwner(`💰 Оплата ${o.price} ₽: ${PROD[o.product] ?? o.product}, заказ ${o.id.slice(0, 8)}. Услуга включилась сама.`);
    return "paid";
  }
  if (st === "CHARGEBACKED" && o.status === "paid") {
    await db("PATCH", `orders?id=eq.${o.id}`, { status: "cancelled", pay_note: "CHARGEBACKED" });
    await notifyOwner(`↩️ Platega: возврат по заказу ${o.id.slice(0, 8)} (${o.price} ₽). Услуга снята.`);
    return "cancelled";
  }
  if (st && st !== "CONFIRMED") await db("PATCH", `orders?id=eq.${o.id}`, { pay_note: st });
  return o.status;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!MID || !SECRET) return json({ error: "not_configured" }, 503);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  // ───── уведомление от Platega
  const hm = req.headers.get("x-merchantid"), hs = req.headers.get("x-secret");
  if (hm !== null || hs !== null || (b.id && b.status && !b.action)) {
    // заголовки есть, но чужие — отказ; без заголовков тоже не страшно: статус всё равно перепроверяю у Platega
    if ((hm !== null || hs !== null) && (!same(hm ?? "", MID) || !same(hs ?? "", SECRET))) return json({ error: "auth" }, 401);
    const tx = String(b.id ?? b.transactionId ?? "");
    if (!tx) return new Response("ok", { headers: CORS });
    const o = (await db("GET", `orders?select=id,vacancy_id,product,price,status,pay_tx&pay_tx=eq.${enc(tx)}`))?.[0];
    if (o) await sync(o);
    return new Response("ok", { headers: CORS });   // 200 — иначе Platega повторит
  }

  // ───── запросы с сайта
  const o = await myOrder(String(b.order ?? ""), String(b.vid ?? ""), String(b.k ?? ""));
  if (!o) return json({ error: "not_found" }, 404);

  if (b.action === "check") return json({ status: await sync(o) });

  if (b.action === "create") {
    if (o.status === "paid") return json({ error: "already_paid" }, 409);
    if (o.status === "cancelled") return json({ error: "cancelled" }, 409);
    if (!(o.price > 0)) return json({ error: "bad_price" }, 400);
    const method = b.method === "card" ? 11 : 2;   // 2 — СБП (QR), 11 — банковская карта
    const back = new URL("cabinet.html", SITE).href;
    const r = await platega("POST", "/transaction/process", {
      paymentMethod: method,
      id: crypto.randomUUID(),
      paymentDetails: { amount: o.price, currency: "RUB" },
      description: `New.работа: ${PROD[o.product] ?? o.product}, заказ ${o.id.slice(0, 8)}`,
      return: `${back}#paid=${o.id}`,
      failedUrl: `${back}#payfail=${o.id}`,
      payload: o.id,
    });
    const t = await r.text();
    if (!r.ok) { console.error("platega create", r.status, t.slice(0, 300)); return json({ error: "platega", code: r.status }, 502); }
    let p: any = {}; try { p = JSON.parse(t); } catch { /* */ }
    const url = p.redirect ?? p.url;
    const tx = p.transactionId ?? p.id;
    if (!url || !tx) { console.error("platega create: нет ссылки", t.slice(0, 300)); return json({ error: "platega" }, 502); }
    await db("PATCH", `orders?id=eq.${o.id}`, { status: "invoiced", pay_tx: String(tx), pay_method: method, pay_note: String(p.status ?? "PENDING") });
    return json({ url });
  }
  return json({ error: "action" }, 400);
});
