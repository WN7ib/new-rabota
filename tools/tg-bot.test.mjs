import assert from "node:assert";
const T = { bot_config: [], bot_users: [], events: [], event_signups: [], employers: [{ id: "emp1", tg_chat: 500 }], bot_questions: [], bot_seen: [], bot_shifts: [] };
const sent = [], vkc = [], gem = []; let seq = 0;
const EID = "11111111-2222-3333-4444-555555555555";
T.events.push({ id: EID, title: "Раздача листовок", starts_at: new Date(Date.now() + 3 * 86400e3).toISOString(), place: "Саратов", capacity: 2, published: true, employer_id: "emp1" });
T.bot_config.push({ key: "owner_id", value: "900" }, { key: "publish", value: "server" });   // режим «всё делает сервер»; режим телефона — в конце
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
  if (u.host === "generativelanguage.googleapis.com") {
    gem.push({ model: u.pathname.split("/").pop(), key: o.headers?.["x-goog-api-key"], body });
    if (u.pathname.includes("image")) return ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: btoa("PNGDATA") } }] } }] });
    const q = body.contents[0].parts[0].text;
    return ok({ candidates: [{ content: { parts: [{ text: /страшно/.test(q) ? "Позвони 8-800-2000-122. ESCALATE" : /погода/.test(q) ? "ESCALATE" : "В 16 лет — до 35 часов в неделю. **Подробнее** https://evil.example/x" }] } }] });
  }
  if (u.host === "upload.vk.test") return ok(u.pathname === "/story" ? { response: { upload_result: "UR" } } : { server: 1, photo: "[]", hash: "h" });
  if (u.host === "api.vk.com") {
    const m = u.pathname.split("/").pop(); const b = Object.fromEntries(new URLSearchParams(o.body)); vkc.push({ m, ...b });
    const R = {
      "groups.getById": { groups: [{ id: 42, name: "New.работа" }] },
      "groups.getCallbackConfirmationCode": { code: "abc123" },
      "groups.getCallbackServers": { items: [] }, "groups.addCallbackServer": { server_id: 7 }, "groups.setCallbackSettings": 1, "groups.setSettings": 1,
      "messages.send": [{ peer_id: +b.peer_ids, conversation_message_id: ++seq }], "users.get": [{ first_name: "Петя" }],
      "messages.getByConversationMessageId": { items: [{ text: "✅ Записала тебя: «Раздача листовок»\nЗа день напомню." }] }, "messages.edit": 1, "messages.sendMessageEventAnswer": 1,
      "photos.getWallUploadServer": { upload_url: "https://upload.vk.test/x" }, "photos.saveWallPhoto": [{ owner_id: -42, id: 9 }], "wall.post": { post_id: 1 }, "stories.getPhotoUploadServer": { upload_url: "https://upload.vk.test/story" }, "stories.save": { count: 1 },
    };
    if (m === "wall.post" && globalThis.WALL_DENIED) return ok({ error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth." } });
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
  if (p === "rpc/person_rel") { const h = T.event_signups.filter((x) => x.attended != null && x.chat_id === body.p_chat); return ok([{ came: h.filter((x) => x.attended).length, missed: h.filter((x) => !x.attended).length, reliable: h.length >= 3 && h.slice(-3).every((x) => x.attended) }]); }
  if (p.startsWith("rpc/")) return ok({ message: "function not found" }, 404);
  const qs = new URLSearchParams(u.search);
  if (o.method === "GET") return ok(rows(p, qs));
  if (o.method === "POST") { if (o.headers?.Prefer?.includes("ignore-duplicates") && T[p].some((x) => x.key === body.key)) return ok(undefined); if (p === "bot_config") { T.bot_config = T.bot_config.filter((x) => x.key !== body.key); } const row = { id: ++seq, ...body, created_at: seq }; T[p].push(row); return ok([row]); }
  if (o.method === "PATCH") { const hit = rows(p, qs); for (const r of hit) Object.assign(r, body); return ok(/representation/.test(o.headers?.Prefer ?? "") ? hit : undefined); }
  if (o.method === "DELETE") { const del = new Set(rows(p, qs)); T[p] = T[p].filter((x) => !del.has(x)); return ok(undefined); }
};
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", TG_TOKEN: "tok", OWNER_ID: "900" })[k] }, serve: (h) => { handler = h; } };
const BOT = await import(process.env.BOT_JS);
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
assert.equal(sent.filter((s) => s.m === "setChatMenuButton").length, 1); assert.equal(sent.find((s) => s.m === "setChatMenuButton").menu_button.web_app.url, "https://newrabota.site/karta.html"); assert.equal(sent.find((s) => s.m === "setChatMenuButton").menu_button.text, "New.работа");
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
// пока всё в Саратове: кнопки «Саратов/Удалённо», чужой город — честно + удалёнка
T.vacancies.push({ id: "s1", title: "Сборщик", city: "Саратов", status: "approved", created_at: new Date().toISOString(), remote: false, contact: "@x" },
  { id: "s2", title: "Модератор чата", city: null, status: "approved", created_at: new Date().toISOString(), remote: true, contact: "@y" });
await msg(701, "Лена", "🔎 Найти работу"); assert.match(last(701).text, /пока работаем в Саратове/); assert.deepEqual(last(701).reply_markup.keyboard[0].map((b) => b.text), ["Саратов", "Удалённо"]);
await msg(701, "Лена", "Москва"); const ms = to(701);
assert.ok(ms.some((x) => /В «Москва» вакансий ещё нет — подписала/.test(x))); assert.ok(ms.some((x) => /Модератор чата/.test(x))); assert.ok(!ms.some((x) => /Сборщик/.test(x)), "саратовские москвичу не показываю");
assert.equal(T.bot_users.find((x) => x.chat_id === 701).city, "Москва");
await msg(702, "Олег", "🔎 Найти работу"); await msg(702, "Олег", "Саратов"); assert.ok(to(702).some((x) => /Сборщик/.test(x)) && !to(702).some((x) => /ещё нет/.test(x)));
await msg(703, "Аня", "а вы в каких городах работаете?"); assert.match(to(703).at(-1), /работает в Саратове/);
// ───── Gemini: ответы 24/7 и картинки ─────
await msg(705, "Ира", "а сколько платят за склад если мне 16, мой номер +7 917 123-45-67?");
assert.ok(to(900).some((x) => /#q\d+/.test(x) && /склад/.test(x)), "без ключа Gemini — как раньше, тикет владельцу");
await msg(900, "Никита", "/gemini AIza-тестовый");
assert.ok(sent.some((x) => x.m === "deleteMessage" && x.chat_id === 900)); assert.match(last(900).text, /Gemini: ключ сохранила.*работает ✅/s);
assert.equal(gem.at(-1).key, "AIza-тестовый");
await msg(706, "Петя", "можно ли мне работать 30 часов, мой номер +7 917 123-45-67, пиши @petya");
const ga = to(706).at(-1); assert.match(ga, /до 35 часов/); assert.ok(!/evil\.example|\*\*/.test(ga), "чужие ссылки и markdown вырезаны");
const sentQ = gem.at(-1).body.contents[0].parts[0].text; assert.ok(!/917|petya/.test(sentQ), "в Gemini уходит обезличенно: " + sentQ);
assert.equal(T.bot_questions.at(-1).answered_by, "gemini");
await msg(707, "Оля", "мне страшно, работодатель кричит");
assert.match(to(707).at(-1), /8-800-2000-122/); assert.ok(!/ESCALATE/.test(to(707).at(-1))); assert.match(last(900).text, /просит взглянуть/);
await msg(708, "Дэн", "какая завтра погода?"); assert.match(to(708).at(-1), /Передала вопрос/);
// новая вакансия: картинка от Gemini → в канал фото, в ВК на стену с фото
T.bot_config.push({ key: "channel", value: "@NEWIrabota" });
T.vacancies.push({ id: "art1", title: "Бариста", city: "Саратов", pay: "250 ₽/ч", age_min: 16, status: "approved", created_at: new Date().toISOString(), contact: "@b" });
await post({ tick: 1 });
assert.ok(gem.some((x) => /image/.test(x.model) && /Бариста/.test(x.body.contents[0].parts[0].text)), "картинку просили у Gemini");
assert.ok(sent.some((x) => x.m === "sendPhoto"), "в канал ушло фото");
const wp = vkc.findLast((x) => x.m === "wall.post"); assert.ok(wp && /photo-42_9/.test(wp.attachments) && /Бариста/.test(wp.message), "в ВК на стену с картинкой");
// ВК не пускает на стену ключом сообщества → история с картинкой + владельцу один раз
globalThis.WALL_DENIED = true;
T.vacancies.push({ id: "art2", title: "Промоутер", city: "Саратов", age_min: 14, status: "approved", created_at: new Date().toISOString(), contact: "@p" });
await post({ tick: 1 });
assert.ok(vkc.some((x) => x.m === "stories.save" && x.upload_results === "UR"), "ушло историей"); assert.match(last(900).text, /пост на стену не прошёл.*историями/s);
// обход из базы по ключу x-tick-key (pg_cron), чужой ключ — 403
T.bot_config.push({ key: "tick_key", value: "k".repeat(64) });
const tickReq = (k) => handler(new Request("https://x/", { method: "POST", headers: { "x-tick-key": k }, body: '{"tick":true}' }));
assert.equal((await tickReq("x".repeat(64))).status, 403);
assert.match(await (await tickReq("k".repeat(64))).text(), /^ok/);
// ───── новые анкеты → работодателю, отметки явки → человеку ─────
T.applications = [
  { id: "a1", created_at: new Date().toISOString(), name: "Маша", age: 16, contact: "@masha", message: "Хочу летом", vacancy_id: "v1", notified: false, vacancies: { title: "Бариста", employer_id: "11111111-0000-0000-0000-000000000001" } },
  { id: "a2", created_at: new Date().toISOString(), name: "Коля", age: 19, contact: "+7900", vacancy_id: "v2", notified: false, vacancies: { title: "Курьер", employer_id: null } },
  { id: "a3", created_at: new Date(Date.now() - 10 * 86400e3).toISOString(), name: "Старый", contact: "@old", vacancy_id: "v2", notified: false, vacancies: { title: "Курьер" } }];
T.employers.push({ id: "11111111-0000-0000-0000-000000000001", tg_chat: 510 });
await post({ tick: 1 });
assert.match(to(510).at(-1), /Новая анкета на «Бариста».*Маша, 16 лет.*@masha.*Хочу летом.*ст\. 63/s);
assert.ok(to(900).some((t) => /Новая анкета на «Курьер».*Коля.*пишу тебе/s), "без работодателя — владельцу");
assert.ok(!sent.some((x) => /Старый/.test(x.text ?? "")), "старые анкеты не шлю");
assert.ok(T.applications.every((x) => x.notified), "все отмечены");
const n510 = to(510).length; await post({ tick: 1 }); assert.equal(to(510).length, n510, "без дублей");
const E4 = "44444444-2222-3333-4444-555555555555";
for (let i = 0; i < 3; i++) T.event_signups.push({ id: "at" + i, event_id: E4, chat_id: 601, contact: "@sasha", status: "main", attended: true, att_notified: i < 2 ? true : null, events: { title: "Склад " + i } });
T.event_signups.push({ id: "at9", event_id: E4, chat_id: 602, contact: "@no", status: "main", attended: false, att_notified: null, events: { title: "Промо" } });
await post({ tick: 1 });
assert.match(to(602).at(-1), /не пришёл\(ла\) на «Промо»/); assert.match(to(601).at(-1), /значок «✓ Надёжный»/);
T.event_signups.push({ id: "at4", event_id: E4, chat_id: 601, contact: "@sasha", status: "main", attended: true, att_notified: null, events: { title: "Ещё" } });
const n601 = to(601).length; await post({ tick: 1 }); assert.equal(to(601).length, n601, "значок — один раз");
assert.ok(T.event_signups.filter((x) => x.attended != null).every((x) => x.att_notified));

// «⏰ Мои смены» (шаг 24): смена словами → bot_shifts, напоминание за 2 часа и накануне, кнопки, удаление, /forget
await msg(801, "Даша", "⏰ Мои смены"); assert.match(last(801).text, /Смен пока нет/); assert.equal(T.bot_users.find((x) => x.chat_id === 801).step, "shift");
await msg(801, "Даша", "абракадабра"); assert.match(last(801).text, /Не поняла дату/); assert.equal(T.bot_users.find((x) => x.chat_id === 801).step, "shift");
await msg(801, "Даша", "15.12 18:30–22:00 ТЦ Триумф"); assert.match(last(801).text, /Записала: 15 декабря, \S+, 18:30 — ТЦ Триумф\n/);
await msg(801, "Даша", "смена 3 января в 9 утра промо у ТЦ"); assert.match(last(801).text, /Записала: 3 января, \S+, 09:00 — промо у ТЦ/);
await msg(801, "Даша", "/shifts"); await msg(801, "Даша", "в субботу с 10 до 18 склад"); assert.match(last(801).text, /Записала: \d+ \S+, суббота, 10:00 — склад/);
await msg(801, "Даша", "/shifts"); await msg(801, "Даша", "завтра в 7 вечера кафе"); assert.match(last(801).text, /, 19:00 — кафе/);
await msg(801, "Даша", "/shifts"); await msg(801, "Даша", "21.10.2026 10:00 прошлое"); assert.match(last(801).text, /2027|октября/);
assert.equal(T.bot_shifts.filter((x) => x.chat_id === 801).length, 5);
await msg(801, "Даша", "⏰"); { const l = last(801); assert.match(l.text, /Твои смены:\n• /); assert.ok(l.reply_markup.inline_keyboard.every((r) => /^sh:del:\d+$/.test(r[0].callback_data))); }
await msg(801, "Даша", "отмена"); assert.equal(last(801).text, "Хорошо.");
const shDel = T.bot_shifts.find((x) => /склад/.test(x.text)).id;
await cb(802, `sh:del:${shDel}`); assert.ok(T.bot_shifts.some((x) => x.id === shDel), "чужую смену не удалить");
await cb(801, `sh:del:${shDel}`); assert.ok(!T.bot_shifts.some((x) => x.id === shDel)); assert.match(last(801).text, /Удалила смену/);
T.bot_shifts.push({ id: 9901, chat_id: 801, at: new Date(Date.now() + 70 * 60_000).toISOString(), text: "раздача", r1: false, r2: false, answer: null },
  { id: 9902, chat_id: 801, at: new Date(Date.now() - 7 * 3600_000).toISOString(), text: "старая", r1: true, r2: true, answer: null });
const n801 = to(801).length; await post({ tick: 1 });
assert.match(to(801).at(-1), /Скоро смена — в \d\d:\d\d \(через 70 мин\): раздача/); assert.equal(last(801).reply_markup.inline_keyboard[0][0].callback_data, "sh:ok:9901");
assert.ok(!T.bot_shifts.some((x) => x.id === 9902), "старые смены удаляются"); assert.ok(T.bot_shifts.find((x) => x.id === 9901).r2);
await post({ tick: 1 }); assert.equal(to(801).slice(n801).filter((t) => /раздача/.test(t)).length, 1, "напоминание — один раз");
await cb(801, "sh:no:9901", "⏰ Скоро смена"); assert.equal(T.bot_shifts.find((x) => x.id === 9901).answer, "no");
assert.match(sent.filter((x) => x.m === "editMessageText").at(-1).text, /Предупреди работодателя/);
await msg(801, "Даша", "/forget"); assert.equal(T.bot_shifts.filter((x) => x.chat_id === 801).length, 0);

// кружок-визитка (шаг 19): vv_КОД → кружок только работодателю (copyMessage, protect_content), отметка video_at; флаг video_card на сайте
const VAPP = "aaaaaaaa-bbbb-cccc-dddd-000000000001", VVAC = "aaaaaaaa-bbbb-cccc-dddd-000000000002", EMP2 = "aaaaaaaa-bbbb-cccc-dddd-000000000003";
T.employers.push({ id: EMP2, tg_chat: 555 }); T.vacancies.push({ id: VVAC, title: "Бариста", employer_id: EMP2 });
T.applications = [{ id: VAPP, name: "Оля", age: 16, video_at: null, vacancy_id: VVAC, vcode: "0123456789abcdef" }];
T.settings = [{ id: 1, data: { tagline: "x" } }];
await post({ tick: 1 }); assert.equal(T.settings[0].data.video_card, true); assert.equal(T.settings[0].data.bot_username, "newrabota_bot"); assert.equal(T.settings[0].data.tagline, "x");
await msg(901, "Оля", "/start vv_badcode"); assert.match(last(901).text, /устарела/);
await post({ message: { message_id: 77, chat: { id: 902, type: "private" }, from: { id: 902, first_name: "Чужой" }, video_note: { duration: 20 } } }); assert.match(last(902).text, /после анкеты/);
await msg(901, "Оля", "/start vv_0123456789ABCDEF"); assert.match(last(901).text, /Кружок-визитка к анкете на «Бариста»[\s\S]*адрес и номер школы/); assert.equal(T.bot_users.find((x) => x.chat_id === 901).step, "vv:" + VAPP);
await msg(901, "Оля", "привет"); assert.match(last(901).text, /Жду кружок/);
await post({ message: { message_id: 78, chat: { id: 901, type: "private" }, from: { id: 901, first_name: "Оля" }, video: { duration: 300 } } }); assert.match(last(901).text, /до 2 минут/);
await post({ message: { message_id: 79, chat: { id: 901, type: "private" }, from: { id: 901, first_name: "Оля" }, video_note: { duration: 30 } } });
assert.match(last(555).text, /Кружок-визитка от Оля, 16 лет к анкете на «Бариста»/);
{ const c = sent.filter((x) => x.m === "copyMessage").at(-1); assert.deepEqual([c.chat_id, c.from_chat_id, c.message_id, c.protect_content], [555, 901, 79, true]); }
assert.ok(T.applications[0].video_at); assert.match(last(901).text, /Переслала кружок/); assert.equal(T.bot_users.find((x) => x.chat_id === 901).step, null);
await msg(901, "Оля", "/start vv_0123456789abcdef"); assert.match(last(901).text, /уже отправлен/);
T.applications.push({ id: "aaaaaaaa-bbbb-cccc-dddd-000000000009", name: "Ян", age: 18, video_at: null, vacancy_id: VVAC, vcode: "fedcba9876543210" });
await msg(903, "Ян", "/start vv_fedcba9876543210"); await msg(903, "Ян", "отмена"); assert.match(last(903).text, /без кружка/);

// режим «публикует телефон» (по умолчанию, Никита 21.11): сервер не постит в канал/ВК и не шлёт вакансии и жалобы на проверку, подписчикам — шлёт
await msg(900, "Никита", "/publish phone"); assert.match(last(900).text, /Публикует телефон/); assert.equal(T.bot_config.find((x) => x.key === "publish").value, "phone");
T.bot_config = T.bot_config.filter((x) => x.key !== "publish");   // ключа нет — тоже телефон
const ph0 = sent.length, vk0 = vkc.length, own0 = to(900).length;
T.bot_users.push({ chat_id: 950, city: "Саратов", step: null }, { chat_id: 951, city: null, step: null }, { chat_id: 952, city: null, step: null, stopped: true });
T.vacancies.push({ id: "ph1", title: "Курьер", city: "Саратов", age_min: 16, status: "approved", created_at: new Date().toISOString(), contact: "@c" },
  { id: "ph2", title: "Ждёт проверки", city: "Саратов", age_min: 16, status: "pending", created_at: new Date().toISOString(), contact: "@d" });
T.reports.push({ id: "rp1", reason: "обман", vacancy_id: "ph1", status: "new" });
await post({ tick: 1 });
assert.ok(!sent.slice(ph0).some((x) => x.chat_id === "@NEWIrabota"), "в канал не постит"); assert.ok(!vkc.slice(vk0).some((x) => x.m === "wall.post" || x.m === "stories.save"), "в ВК не постит");
assert.ok(to(950).some((t) => /Новая вакансия:\n[\s\S]*Курьер/.test(t)), "подписчику — да");
assert.ok(to(951).some((t) => /Новая вакансия:\n[\s\S]*Курьер/.test(t)), "без города — тоже (всем, шаг 28)");
assert.ok(!to(952).some((t) => /Курьер/.test(t)), "нажавшему /stop — нет");
assert.ok(!to(900).slice(own0).some((t) => /Ждёт проверки|Жалоба/.test(t)), "на проверку — только с телефона");
await msg(900, "Никита", "/publish server"); assert.match(last(900).text, /Публикует сервер/);
// ── признаки обмана: сервер = scam.js сайта, ловит схемы и не трогает обычные вакансии ──
{
  const { createRequire } = await import("node:module"); const siteScam = createRequire(import.meta.url)("../scam.js");
  const V = (title, description, pay, age_min = 16, remote = false) => ({ title, description, pay, age_min, remote });
  const cases = [
    [V("Бариста", "Кофейня в центре, обучение бесплатно, график 2/2 по 4 часа", "250 ₽/час"), []],
    [V("Оператор call-центра", "Звонки по скрипту, офис, официальное оформление", "300 ₽/час", 18), []],
    [V("Промоутер", "Раздача листовок у ТЦ, выходные", "от 1 500 ₽ за смену"), []],
    [V("Курьер", "Забери пакет у человека и передай по адресу, оплата наличными", "3000 в день"), [/забери пакет/]],
    [V("Лёгкий заработок", "Оформи карту на себя и дай данные карты, за каждого приглашённого бонус", "до 100 000"), [/дропперство|карту\/симку/, /пирамиду/, /высокая оплата/]],
    [V("Отзывы", "Ставить лайки и писать отзывы, нужна предоплата за доступ", "500"), [/предоплатой|деньги с соискателя/]],
    [V("Помощник", "Работа ночью до утра", "1 руб/час", 14), [/ТК 96/, /ниже МРОТ/]],
    [V("Грузчик", "Склад, пиши только в личку, без договора", "200 ₽/час", 14), [/14–15/, /в личку/]],
    [V("Официант", "Кафе", "250 ₽/ч", 16, true), [/очная/]],
    [V("Пункт выдачи", "Сотрудник ПВЗ 24/7", "220 ₽/час", 16), [/круглосуточно/]],
    [V("Крипто", "Арбитраж трафика, пассивный доход", "от 30 000 в неделю", 18), [/лайки|задания/, /пирамиду/]],
  ];
  for (const [v, want] of cases) {
    const got = BOT.scamFlags(v); const site = siteScam(v);
    assert.deepStrictEqual(site, got, "scam.js и сервер расходятся: " + v.title);
    if (!want.length) assert.deepStrictEqual(got, [], "ложная тревога: " + v.title + " → " + got.join("; "));
    for (const re of want) assert.ok(got.some((x) => re.test(x)), `${v.title}: нет ${re} в ${JSON.stringify(got)}`);
  }
  console.log("OK scamFlags", cases.length, "примеров");
}
// шаг 30: подозрительное сообщение работодателя задержано — владельцу с кнопками, «Пропустить» открывает его соискателю
T.app_messages = [{ id: 77, held: true, notified: false, from_emp: true, from_mod: false, body: "оплати форму", application_id: VAPP, created_at: new Date().toISOString() }];
await post({ tick: 1 });
assert.ok(to(900).some((t) => /Подозрительное сообщение[\s\S]*оплати форму/.test(t)), "владельцу — задержанное сообщение");
await cb(900, "cmok:77"); assert.equal(T.app_messages[0].held, false, "Пропустить — видно соискателю");
// шаг 31: «🔥 срочно» с надбавкой — всем подписчикам ровно один раз, нажавшему /stop — нет
T.vacancies.push({ id: "ur1", title: "Бариста срочно", company: "Кофейня", city: "Саратов", age_min: 16, status: "approved", created_at: new Date().toISOString(), contact: "@k",
  urgent_pay: 2000, urgent_until: new Date(Date.now() + 6 * 3600_000).toISOString(), urgent_sent_at: null, urgent_last: new Date().toISOString() });
{
  const u0 = to(950).length, u1 = to(951).length;
  await post({ tick: 1 });
  assert.ok(to(950).slice(u0).some((t) => /СРОЧНО[\s\S]*Бариста срочно[\s\S]*Заплатят за смену: 2\s000 ₽/.test(t)), "подписчику — срочно с оплатой за смену");
  assert.ok(to(951).slice(u1).some((t) => /СРОЧНО/.test(t)), "без города — тоже");
  assert.ok(!to(952).some((t) => /СРОЧНО/.test(t)), "нажавшему /stop — нет");
  assert.ok(T.vacancies.find((x) => x.id === "ur1").urgent_sent_at, "отметка «разослано»");
  const n0 = to(950).length; await post({ tick: 1 });
  assert.equal(to(950).slice(n0).filter((t) => /СРОЧНО/.test(t)).length, 0, "второй обход не дублирует");
}
console.log("OK", sent.length, "вызовов Telegram");
