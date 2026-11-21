import assert from "node:assert";
const T = { bot_config: [], bot_users: [], events: [], event_signups: [], employers: [{ id: "emp1", tg_chat: 500 }], bot_questions: [], bot_seen: [] };
const sent = [], vkc = []; let seq = 0;
const EID = "11111111-2222-3333-4444-555555555555";
T.events.push({ id: EID, title: "Раздача листовок", starts_at: new Date(Date.now() + 3 * 86400e3).toISOString(), place: "Саратов", capacity: 2, published: true, employer_id: "emp1" });
T.bot_config.push({ key: "owner_id", value: "900" });
function match(row, k, v) {
  if (k === "or") return v.slice(1, -1).split(",").some((c) => { const [kk, ...rest] = c.split("."); return match(row, kk, rest.join(".")); });
  if (v.startsWith("ilike.")) { const re = new RegExp("^" + decodeURIComponent(v.slice(6)).split("*").map((x) => x.replace(/[.?+^$()[\]{}|\\]/g, "\\$&")).join(".*") + "$", "i"); return row[k] != null && re.test(String(row[k])); }
  if (v === "is.null") return row[k] == null;
  if (v === "not.is.null") return row[k] != null;
  if (v.startsWith("eq.")) return String(row[k]) === decodeURIComponent(v.slice(3));
  if (v.startsWith("lt.")) return row[k] != null && row[k] < decodeURIComponent(v.slice(3));
  if (v.startsWith("gt.")) return row[k] != null && row[k] > decodeURIComponent(v.slice(3));
  if (v.startsWith("gte.")) return row[k] != null && row[k] >= decodeURIComponent(v.slice(4));
  return true;
}
function rows(tbl, qs) { let r = T[tbl] ?? []; for (const [k, v] of qs) if (!["select", "order", "limit"].includes(k)) r = r.filter((x) => match(x, k, v)); if (qs.get("order")?.startsWith("created_at")) r = [...r].sort((a, b) => a.created_at - b.created_at); if (qs.get("limit")) r = r.slice(0, +qs.get("limit")); return r; }
const taken = (eid) => T.event_signups.filter((s) => s.event_id === eid && s.status === "main").length;
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url); let body; try { body = o.body ? JSON.parse(o.body) : undefined; } catch { body = undefined; }
  const ok = (j, s = 200) => ({ ok: s < 300, status: s, text: async () => j === undefined ? "" : JSON.stringify(j), json: async () => j });
  if (u.host === "api.vk.com") {
    const m = u.pathname.split("/").pop(); const b = Object.fromEntries(new URLSearchParams(o.body)); vkc.push({ m, ...b });
    const R = {
      "groups.getById": { groups: [{ id: 42, name: "New.работа" }] },
      "groups.getCallbackConfirmationCode": { code: "abc123" },
      "groups.getCallbackServers": { items: [] }, "groups.addCallbackServer": { server_id: 7 }, "groups.setCallbackSettings": 1, "groups.setSettings": 1,
      "messages.send": [{ peer_id: +b.peer_ids, conversation_message_id: ++seq }], "users.get": [{ first_name: "Петя" }],
      "messages.getByConversationMessageId": { items: [{ text: "✅ Записала тебя: «Раздача листовок»\nЗа день напомню." }] }, "messages.edit": 1, "messages.sendMessageEventAnswer": 1,
    };
    return ok({ response: R[m] });
  }
  if (u.host === "api.telegram.org") {
    const m = u.pathname.split("/").pop(); sent.push({ m, ...body });
    if (m === "getMe") return ok({ ok: true, result: { username: "newrabota_bot" } });
    return ok({ ok: true, result: { message_id: ++seq } });
  }
  const p = u.pathname.replace("/rest/v1/", "");
  if (p === "rpc/event_taken") return ok(taken(body.eid));
  if (p === "rpc/event_signup") {
    const e = T.events.find((x) => x.id === body.eid);
    if (T.event_signups.some((s) => s.event_id === e.id && s.contact.toLowerCase() === body.p_contact.toLowerCase())) return ok(taken(e.id));
    const st = taken(e.id) >= e.capacity ? "reserve" : "main";
    T.event_signups.push({ id: "s" + (++seq), event_id: e.id, name: body.p_name, contact: body.p_contact, status: st, with_name: body.p_with ?? null, created_at: seq, chat_id: null, offered_at: null });
    return ok(st === "reserve" ? -1 : taken(e.id));
  }
  if (p.startsWith("rpc/")) return ok({ message: "function not found" }, 404);
  const qs = new URLSearchParams(u.search);
  if (o.method === "GET") return ok(rows(p, qs));
  if (o.method === "POST") { if (o.headers?.Prefer?.includes("ignore-duplicates") && T[p].some((x) => x.key === body.key)) return ok(undefined); if (p === "bot_config") { T.bot_config = T.bot_config.filter((x) => x.key !== body.key); } const row = { id: ++seq, ...body, created_at: seq }; T[p].push(row); return ok([row]); }
  if (o.method === "PATCH") { for (const r of rows(p, qs)) Object.assign(r, body); return ok(undefined); }
  if (o.method === "DELETE") { const del = new Set(rows(p, qs)); T[p] = T[p].filter((x) => !del.has(x)); return ok(undefined); }
};
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", TG_TOKEN: "tok", OWNER_ID: "900" })[k] }, serve: (h) => { handler = h; } };
await import(process.env.BOT_JS);
const crypto = await import("node:crypto");
const secret = crypto.createHash("sha256").update("tok").digest("hex").slice(0, 32);
const post = (u) => handler(new Request("https://x/", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(u) }));
const msg = (id, uname, text) => post({ message: { chat: { id, type: "private" }, from: { id, first_name: uname, username: uname.toLowerCase() }, text } });
const cb = (id, data, text = "x") => post({ callback_query: { id: "q", from: { id, first_name: "U" }, data, message: { message_id: 1, chat: { id, type: "private" }, text } } });
const to = (c) => sent.filter((s) => s.chat_id === c && s.m === "sendMessage").map((s) => s.text);
const last = (c) => sent.filter((s) => s.chat_id === c && s.m === "sendMessage").at(-1);

await msg(101, "Аня", "/start ev_" + EID);
let a = last(101); assert.match(a.text, /Записала тебя/); const kb = a.reply_markup.inline_keyboard;
assert.equal(kb[0][0].callback_data, "evx:" + EID); assert.match(kb[1][0].url, /t\.me%2Fnewrabota_bot%3Fstart%3Dev_11111111-2222-3333-4444-555555555555_f101/);
assert.equal(T.event_signups[0].chat_id, 101); assert.ok(to(500).some((t) => /Запись на «Раздача листовок».*Аня/.test(t)), "организатору");
await msg(102, "Боря", `/start ev_${EID}_f101`);
assert.match(last(102).text, /вместе с Аня/); assert.match(last(101).text, /Боря записался/); assert.equal(T.event_signups[1].with_name, "Аня");
assert.ok(to(500).some((t) => /вместе с другом \(Аня\)/.test(t)));
await msg(103, "Вика", `/start ev_${EID}_f999`);   // чужой пригласивший — ссылка без «с другом», мест нет → резерв
assert.match(last(103).text, /в резерве \(№1\)/); assert.equal(T.event_signups[2].with_name, null);
await msg(103, "Вика", `/start ev_${EID}`); assert.match(last(103).text, /уже в резерве/);
await cb(101, "evx:" + EID); assert.equal(sent.at(-1).m, "editMessageReplyMarkup");
await cb(101, "evy:" + EID, "✅ Записала тебя: «Раздача листовок»\n🗓 x\nЗа день напомню. ...");
assert.equal(T.event_signups.filter((s) => s.chat_id === 101).length, 0); assert.match(to(101).at(-1), /отменена/);
assert.match(last(103).text, /Освободилось место/); assert.equal(last(103).reply_markup.inline_keyboard[0][0].callback_data, "evt:" + EID);
await cb(102, "evt:" + EID); assert.equal(T.event_signups.find((s) => s.chat_id === 102).status, "main");   // не из резерва — ничего не меняется
await cb(103, "evt:" + EID); assert.equal(T.event_signups.find((s) => s.chat_id === 103).status, "main");
assert.ok(to(500).some((t) => /Замена на .* Вика|Замена на .*U/.test(t)));
await msg(104, "Гоша", "/start ev_" + EID); assert.match(last(104).text, /резерве/);
await cb(104, "evt:" + EID); assert.equal(T.event_signups.find((s) => s.chat_id === 104).status, "reserve");   // мест нет — не пролезть кнопкой
await cb(102, "evy:" + EID); assert.match(last(104).text, /Освободилось место/);
await cb(104, "evz:" + EID); assert.equal(T.event_signups.find((s) => s.chat_id === 104).status, "reserve");
await msg(105, "Даша", "/start ev_not-a-uuid"); assert.match(last(105).text, /закрыта/);
await cb(105, "evy:" + EID); // нет записи
await msg(106, "Егор", "/app"); assert.match(last(106).reply_markup.inline_keyboard[0][0].web_app.url, /tg\.html$/);
T.bot_config.push({ key: "tick_init", value: "1" }); T.vacancies = []; T.reports = []; T.orders = [];
await post({ tick: 1 }); await post({ tick: 1 });
assert.equal(sent.filter((s) => s.m === "setChatMenuButton").length, 1); assert.equal(sent.find((s) => s.m === "setChatMenuButton").menu_button.web_app.url, "https://new-rabota.ru/tg.html");
// чужое нажатие кнопки владельца не проходит
await post({ callback_query: { id: "q", from: { id: 777 }, data: "ok:x", message: { message_id: 1, chat: { id: 777, type: "private" }, text: "x" } } });
// ───── ВК ─────
await msg(900, "Никита", "/vk секретный-ключ");
assert.ok(sent.some((x) => x.m === "deleteMessage" && x.chat_id === 900)); assert.match(last(900).text, /подключено: New\.работа/);
assert.equal(vkc.find((x) => x.m === "groups.addCallbackServer").url, "https://sb.test/functions/v1/tg-bot?vk=1");
assert.equal(vkc.find((x) => x.m === "groups.setCallbackSettings").message_event, "1");
const vpost = (u) => handler(new Request("https://sb.test/functions/v1/tg-bot?vk=1", { method: "POST", body: JSON.stringify(u) }));
let r = await vpost({ type: "confirmation", group_id: 42 }); assert.equal(await r.text(), "abc123");
const vsec = crypto.createHash("sha256").update("vk:k").digest("hex").slice(0, 32);
r = await vpost({ type: "message_new", secret: "плохой", object: { message: { id: 1, from_id: 5, peer_id: 5, text: "привет" } } }); assert.equal(r.status, 403);
const vmsg = (id, text, extra = {}) => vpost({ type: "message_new", secret: vsec, group_id: 42, object: { message: { id: ++seq, from_id: id, peer_id: id, text, ...extra } } });
const vsent = (id) => vkc.filter((x) => x.m === "messages.send" && x.peer_ids === String(id));
await vmsg(5, "Начать", { payload: '{"command":"start"}' });
assert.match(vsent(5).at(-2).message, /Запоминаю/); assert.match(vsent(5).at(-1).message, /Привет, Петя/);
assert.equal(JSON.parse(vsent(5).at(-1).keyboard).buttons[0][0].action.label, "🔎 Найти работу");
const E2 = "22222222-2222-3333-4444-555555555555";
T.events.push({ id: E2, title: "Промо", starts_at: new Date(Date.now() + 2 * 3600e3).toISOString(), capacity: 1, published: true });
await vmsg(5, "", { ref: "ev_" + E2 });
assert.match(vsent(5).at(-1).message, /Записала тебя: «Промо»/);
const kbv = JSON.parse(vsent(5).at(-1).keyboard); assert.equal(kbv.inline, true); assert.equal(kbv.buttons.length, 1, "без «позвать друга» через t.me");
assert.equal(JSON.parse(kbv.buttons[0][0].action.payload).d, "evx:" + E2);
assert.equal(T.event_signups.find((x) => x.event_id === E2).contact, "vk.com/id5");
assert.ok(to(900).some((t) => /Запись на «Промо».*vk\.com\/id5/.test(t)));
await vmsg(6, "", { ref: "ev_" + E2 }); assert.match(vsent(6).at(-1).message, /резерве/);
const vev = (id, d) => vpost({ type: "message_event", secret: vsec, object: { user_id: id, peer_id: id, event_id: "e" + (++seq), conversation_message_id: 77, payload: { d } } });
await vev(5, "evx:" + E2); assert.ok(vkc.some((x) => x.m === "messages.edit" && /evy:/.test(x.keyboard)));
await vev(5, "evy:" + E2); assert.ok(!T.event_signups.some((x) => x.event_id === E2 && x.chat_id === 8e15 + 5));
assert.match(vsent(6).at(-1).message, /Освободилось место/);
// 30 минут молчит → следующему (никого) и сообщение ему; напоминание за 2 часа
T.event_signups.find((x) => x.chat_id === 8e15 + 6).offered_at = new Date(Date.now() - 40 * 60e3).toISOString();
await post({ tick: 1 });
assert.match(vsent(6).at(-1).message, /не ответил\(а\) за 30 минут/);
await vmsg(7, "у меня странный вопрос про налоги"); const qid = T.bot_questions.at(-1).id ?? null;
assert.ok(to(900).some((t) => /ВК vk\.com\/id7/.test(t))); assert.equal(T.bot_questions.at(-1).escalated, true, "помощник на телефоне ВК-вопросы не берёт");
// кнопки от бота на телефоне (evr:<запись>:<событие>) тоже работают на сервере
const E3 = "33333333-2222-3333-4444-555555555555";
T.events.push({ id: E3, title: "Склад", starts_at: new Date(Date.now() + 5 * 86400e3).toISOString(), capacity: 1, published: true });
T.event_signups.push({ id: "r1", event_id: E3, name: "Зоя", contact: "@zoya", status: "reserve", chat_id: 301, created_at: ++seq, offered_at: new Date().toISOString() });
await cb(301, "evr:r1:" + E3); assert.equal(T.event_signups.find((x) => x.id === "r1").status, "main"); assert.equal(T.event_signups.find((x) => x.id === "r1").offered_at, null);
// одно предложение за раз: пока первый думает, второму не предлагаю; отказ — сразу следующему
T.event_signups.push({ id: "r2", event_id: E3, name: "Ян", contact: "@yan", status: "reserve", chat_id: 302, created_at: ++seq, offered_at: null });
T.event_signups.push({ id: "r3", event_id: E3, name: "Ия", contact: "@iya", status: "reserve", chat_id: 303, created_at: ++seq, offered_at: null });
await cb(301, "evy:" + E3); assert.match(last(302).text, /Освободилось место/); assert.ok(!to(303).length, "второму пока не предлагаю");
await cb(302, "evz:" + E3); assert.match(last(303).text, /Освободилось место/);
// ───── «🎯 Подбор под меня» и подборка недели ─────
T.vacancies.push(
  { id: "v1", title: "Бариста", city: "Саратов", age_min: 16, remote: false, status: "approved", description: "кофейня", created_at: new Date().toISOString(), contact: "@cafe" },
  { id: "v2", title: "Курьер", city: "Саратов", age_min: 18, remote: false, status: "approved", description: "доставка", created_at: new Date().toISOString(), contact: "@c" },
  { id: "v3", title: "Промоутер", city: "Москва", age_min: 14, remote: false, status: "approved", description: "листовки", created_at: new Date().toISOString(), contact: "@p" },
  { id: "v4", title: "Официант", city: "Саратов", age_min: 14, adult: true, remote: false, status: "approved", description: "кафе", created_at: new Date().toISOString(), contact: "@o" });
await msg(401, "Лиза", "🎯 Подбор под меня"); assert.match(last(401).text, /1\/3/);
await msg(401, "Лиза", "Саратов"); assert.match(last(401).text, /2\/3. Сколько тебе лет/); assert.equal(T.bot_users.find((x) => x.chat_id === 401).step, "p_age");
await msg(401, "Лиза", "16"); assert.equal(T.bot_users.find((x) => x.chat_id === 401).age, 16);
assert.ok(to(401).some((t) => /согласие родителя/.test(t))); let pk = last(401).reply_markup.inline_keyboard;
assert.equal(pk[0][0].callback_data, "pi:food"); assert.equal(pk.at(-1)[0].callback_data, "pi:done");
await cb(401, "pi:food"); assert.deepEqual(T.bot_users.find((x) => x.chat_id === 401).ints, ["food"]);
assert.match(sent.at(-1).reply_markup.inline_keyboard[0][0].text, /^✅ /);
await cb(401, "pi:courier"); await cb(401, "pi:courier"); assert.deepEqual(T.bot_users.find((x) => x.chat_id === 401).ints, ["food"]);
const b0 = to(401).length; await cb(401, "pi:done");
const got = to(401).slice(b0).filter((t) => /^💼/.test(t)); assert.equal(got.length, 1, "только бариста: курьер 18+, Москва и «для взрослых» не подходят"); assert.match(got[0], /Бариста/);
assert.match(last(401).text, /Раз в неделю пришлю/);
await cb(402, "pi:food");   // нет профиля — тихо
await msg(401, "Лиза", "/weekly"); assert.equal(T.bot_users.find((x) => x.chat_id === 401).weekly, false); assert.match(last(401).text, /выключила/);
await msg(401, "Лиза", "/weekly"); assert.equal(T.bot_users.find((x) => x.chat_id === 401).weekly, true);
// ответ не про возраст на шаге «возраст» — обычный разговор, шаг сбрасывается
await msg(403, "Тим", "🎯"); await msg(403, "Тим", "удалённо"); await msg(403, "Тим", "как не попасть на обман?"); assert.equal(T.bot_users.find((x) => x.chat_id === 403).step, null);
// владелец: /people Саратов 16
await msg(900, "Никита", "/people Саратов 16"); assert.match(last(900).text, /Лиза.*16 лет/); assert.doesNotMatch(last(900).text, /Тим/);
// подборка недели — только в воскресенье после 12 по Саратову
const RealDate = Date; const sunday = new RealDate("2026-11-22T10:00:00Z").getTime();   // 14:00 Саратов
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [sunday])); } static now() { return sunday; } };
T.vacancies.push({ id: "v5", title: "Помощник повара", city: "Саратов", age_min: 16, status: "approved", description: "кухня", created_at: new RealDate(sunday - 86400e3).toISOString(), contact: "@k" });
const before = to(401).length; await post({ tick: 1 });
const wk = to(401).slice(before).filter((t) => !/^🆕/.test(t)); assert.match(wk[0], /Подборка недели для тебя — 2 вакансии/); assert.ok(wk.some((t) => /Помощник повара/.test(t)));
assert.deepEqual([...T.bot_users.find((x) => x.chat_id === 401).wk_ids].sort(), ["v1", "v5"]);
const wkn = () => to(401).filter((t) => !/^🆕/.test(t)).length; const n2 = wkn(); await post({ tick: 1 }); assert.equal(wkn(), n2, "второй раз за неделю не шлю");
globalThis.Date = RealDate;
console.log("OK", sent.length, "вызовов Telegram");
