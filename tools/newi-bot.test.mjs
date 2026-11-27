// Проверка серверной Неви (supabase/functions/newi-bot) без Telegram и Supabase. Запуск: sh tools/newi-bot-test.sh
import assert from "node:assert";
const T = { newi_cfg: [], newi_rem: [], newi_log: [], bot_config: [{ key: "tick_key", value: "t".repeat(40) }, { key: "gemini_key", value: "g" }], admins: [{ user_id: "u1" }] };
const sent = [], gem = [];
function match(row, k, v) {
  if (v === "is.null") return row[k] == null;
  if (v === "not.is.null") return row[k] != null;
  if (v.startsWith("eq.")) return String(row[k]) === decodeURIComponent(v.slice(3));
  if (v.startsWith("lte.")) return row[k] <= decodeURIComponent(v.slice(4));
  if (v.startsWith("gte.")) return row[k] >= decodeURIComponent(v.slice(4));
  if (v.startsWith("lt.")) return row[k] < decodeURIComponent(v.slice(3));
  return true;
}
function filt(tbl, u) { let r = T[tbl]; for (const [k, v] of u.searchParams) if (!["select", "order", "limit"].includes(k)) r = r.filter((x) => match(x, k, v)); return r; }
// повторяющиеся ключи (at=lte & at=gte) URLSearchParams отдаёт оба
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url); const body = o.body ? JSON.parse(o.body) : undefined;
  const ok = (j, s = 200) => ({ ok: s < 300, status: s, text: async () => j === undefined ? "" : JSON.stringify(j), json: async () => j });
  if (u.host === "generativelanguage.googleapis.com") { gem.push(body); return ok({ candidates: [{ content: { parts: [{ text: "Ответ **сервера**" }] } }] }); }
  if (u.host === "api.telegram.org") {
    const m = u.pathname.split("/").pop(); sent.push({ m, ...body });
    if (m === "answerGuestQuery") return ok({ ok: true, result: { inline_message_id: "IM1" } });
    if (m === "getMe") return ok({ ok: true, result: { username: "Newibot" } });
    return ok({ ok: true, result: true });
  }
  if (u.pathname === "/auth/v1/user") return o.headers.Authorization === "Bearer good" ? ok({ id: "u1" }) : ok({}, 401);
  const tbl = u.pathname.replace("/rest/v1/", "");
  if (o.method === "GET") return ok(filt(tbl, u));
  if (o.method === "POST") { for (const r0 of [].concat(body)) { const r = tbl === "newi_log" ? { id: T.newi_log.length + 1, ...r0 } : r0; const i = T[tbl].findIndex((x) => (x.key ?? x.id) === (r.key ?? r.id)); if (i >= 0) T[tbl][i] = { ...T[tbl][i], ...r }; else T[tbl].push({ ...r }); } return ok(undefined, 201); }
  if (o.method === "PATCH") { filt(tbl, u).forEach((x) => Object.assign(x, body)); return ok(undefined, 204); }
  if (o.method === "DELETE") { const del = new Set(filt(tbl, u)); T[tbl] = T[tbl].filter((x) => !del.has(x)); return ok(undefined, 204); }
  return ok({}, 404);
};
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_ANON_KEY: "a" })[k] }, serve: (h) => { handler = h; } };
await import(process.env.BOT_JS);
const cfg = (k) => T.newi_cfg.find((x) => x.key === k)?.value;
const req = (h, b) => handler(new Request("https://x/", { method: "POST", headers: h, body: JSON.stringify(b) }));
const tick = () => req({ "x-tick-key": "t".repeat(40) }, { tick: true });

// чужой без входа админа — нельзя
assert.equal((await req({ authorization: "Bearer bad" }, { op: "sync", token: "X" })).status, 403);
assert.equal(cfg("token"), undefined);
assert.equal((await req({ "x-tick-key": "nope" }, { tick: true })).status, 403);

// телефон отмечается: токен, владелец, напоминания
const soon = Date.now() + 3600e3, past = Date.now() - 60e3;
let r = await (await req({ authorization: "Bearer good" }, { op: "sync", token: "TOK", owner_chat: 900, owner_id: 900, rems: [{ id: "a", at: soon, t: "встреча" }, { id: "b", at: past, t: "позвонить маме" }] })).json();
assert.equal(r.ok, true); assert.equal(cfg("token"), "TOK"); assert.equal(T.newi_rem.length, 2);

// телефон на связи — сервер ничего не делает
assert.match(await (await tick()).text(), /stale=false sent=0/);
assert.equal(sent.filter((s) => s.m === "setWebhook").length, 0);

// телефон молчит 40 минут — сервер забирает бота и напоминает просроченное
T.newi_cfg.find((x) => x.key === "phone_seen").value = String(Date.now() - 40 * 60e3);
assert.match(await (await tick()).text(), /stale=true sent=1/);
assert.equal(cfg("mode"), "server");
const hook = sent.find((s) => s.m === "setWebhook"); assert.ok(hook.secret_token && hook.allowed_updates.includes("guest_message"));
assert.ok(sent.some((s) => s.m === "sendMessage" && /позвонить маме/.test(s.text)));
await tick(); assert.equal(sent.filter((s) => /позвонить маме/.test(s.text ?? "")).length, 1, "напоминание — один раз");

// вебхук без секрета — нельзя; с секретом — отвечаю владельцу, чужому — отказ
const H = { "x-telegram-bot-api-secret-token": hook.secret_token };
assert.equal((await req({ "x-telegram-bot-api-secret-token": "x" }, {})).status, 403);
sent.length = 0;
await req(H, { message: { chat: { id: 900, type: "private" }, from: { id: 900 }, text: "какая погода? мой номер +7 967 000 00 00" } });
const a = sent.find((s) => s.m === "sendMessage"); assert.match(a.text, /Ответ сервера/); assert.doesNotMatch(a.text, /\*\*/);
assert.doesNotMatch(JSON.stringify(gem.at(-1)), /967/, "телефон в облако не уходит");
await req(H, { message: { chat: { id: 5, type: "private" }, from: { id: 5 }, text: "привет" } });
assert.match(sent.at(-1).text, /личный помощник Никиты/);
// гостевой режим: «@Newibot вопрос» в чужом чате
sent.length = 0;
await req(H, { guest_message: { guest_query_id: "Q1", from: { id: 900 }, text: "@Newibot что такое ВВП?" } });
assert.ok(sent.some((s) => s.m === "editMessageText" && s.inline_message_id === "IM1"));
assert.match(JSON.stringify(gem.at(-1)), /что такое ВВП/); assert.doesNotMatch(JSON.stringify(gem.at(-1)), /Newibot/);
await req(H, { guest_message: { guest_query_id: "Q2", from: { id: 7 }, text: "@Newibot привет" } });
assert.match(sent.at(-1).result.input_message_content.message_text, /только ему/);

// телефон вернулся — webhook снимается, сервер говорит, что уже напомнил
sent.length = 0;
r = await (await req({ authorization: "Bearer good" }, { op: "sync", rems: [{ id: "b", at: past, t: "позвонить маме" }, { id: "c", at: soon, t: "новое" }] })).json();
assert.equal(r.back, true); assert.deepEqual(r.sent, ["b"]); assert.equal(cfg("mode"), "phone");
assert.ok(sent.some((s) => s.m === "deleteWebhook"));
assert.ok(!T.newi_rem.some((x) => x.id === "b" && x.sent_at == null), "уже напомненное не дублируется");
assert.ok(r.learned.length >= 2 && r.learned.some((x) => /погода/.test(x.q)), "ответы без телефона — телефону в учёбу");
assert.equal(T.newi_log.length, 0, "после передачи на сервере стёрто");
console.log("newi-bot: все проверки прошли");
