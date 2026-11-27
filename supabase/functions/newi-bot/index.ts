// Серверная Неви (Никита 27.11: «пускай Неви может всё делать, когда телефон выключен»).
// Обычно личный бот Неви живёт на телефоне (мессенджер опрашивает Telegram). Телефон раз в 5 минут отмечается здесь (op=sync)
// и присылает ближайшие напоминания. Не отмечался 30 минут — сервер забирает бота себе (webhook) и:
//   • отвечает Никите на вопросы (Gemini с поиском, вопросы — обезличенно), в том числе «@бот вопрос» в любом чате (гостевой режим);
//   • присылает напоминания в срок;
//   • всем остальным: «Я Неви — личный помощник Никиты, отвечаю только ему».
// Телефон вернулся (sync или 409 от Telegram) — webhook снимается, бот снова на телефоне. Досье, переписки, деньги,
// отправка от имени Никиты и всё на экране — только на телефоне, сюда не переносятся.

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const STALE_MIN = 30;

async function db(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) { console.error("db", method, path, r.status, t.slice(0, 300)); return null; }
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}
const enc = encodeURIComponent;
async function get(key: string): Promise<string> { const r = await db("GET", `newi_cfg?select=value&key=eq.${enc(key)}`); return r?.[0]?.value ?? ""; }
async function set(key: string, value: string) { await db("POST", "newi_cfg", { key, value }, "resolution=merge-duplicates,return=minimal"); }
async function botCfg(key: string): Promise<string> { const r = await db("GET", `bot_config?select=value&key=eq.${enc(key)}`); return r?.[0]?.value ?? ""; }

async function tg(method: string, p: Record<string, unknown>): Promise<any> {
  const tok = await get("token"); if (!tok) return null;
  try { const r = await fetch(`https://api.telegram.org/bot${tok}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }); return await r.json(); }
  catch (e) { console.error("tg", method, e); return null; }
}
async function toOwner(text: string, quiet = false) {
  const chat = await get("owner_chat"); if (!chat) return;
  await tg("sendMessage", { chat_id: Number(chat), text: text.slice(0, 4000), disable_notification: quiet, link_preview_options: { is_disabled: true } });
}

// ───────── Gemini: вопросы обезличенно (телефоны, почты, ники, ссылки, длинные числа) ─────────
const anon = (t: string) => t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[почта]").replace(/https?:\/\/\S+/gi, "[ссылка]")
  .replace(/@\w{3,}/g, "[ник]").replace(/\+?\d[\d\s().-]{8,}\d/g, "[телефон]").replace(/\d{6,}/g, "[число]");
const RULES = `Ты — Неви, тёплая и спокойная помощница Никиты (15 лет, Саратов, глава молодёжного движения «Новые», делает сайт вакансий New.работа).
Сейчас его телефон выключен или не на связи, и ты отвечаешь с сервера: без его досье, переписок и календаря.
Отвечай по-русски, коротко и по делу, без markdown. Нужны свежие факты (погода, новости, курсы, события) — используй поиск.
Не выдумывай. Про деньги, сделки, отправку сообщений от его имени, удаление — скажи, что сделаешь, когда телефон снова будет на связи.`;
async function answer(q: string): Promise<string> {
  const k = Deno.env.get("GEMINI_API_KEY") ?? (await botCfg("gemini_key"));
  if (!k) return "Телефон не на связи, а ключа Gemini на сервере нет — отвечу, когда телефон включится. (Ключ: /gemini <ключ> рабочему боту New.работа.)";
  const model = (await botCfg("gemini_model")) || "gemini-2.5-flash";
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: RULES }] }, contents: [{ role: "user", parts: [{ text: anon(q).slice(0, 2000) }] }],
        tools: [{ google_search: {} }], generationConfig: { temperature: 0.4, maxOutputTokens: 900 } }) });
    const j = await r.json().catch(() => null);
    const a = String(j?.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? "").join("") ?? "").replace(/[*#`]+/g, "").trim();
    return a || "Не получилось ответить сейчас — спроси ещё раз чуть позже.";
  } catch { return "Нет связи с нейросетью — спроси ещё раз чуть позже."; }
}

// ответы без телефона — телефону в учёбу Неви (Никита 27.11 «план Б»); здесь лежат только до следующей связи, потом стираются
async function logQA(q: string, a: string) { try { await db("POST", "newi_log", { q: q.slice(0, 1500), a: a.slice(0, 3000) }, "return=minimal"); } catch { /* без таблицы — просто не копим */ } }

// ───────── переключение телефон ⇄ сервер ─────────
async function takeOver() {
  const secret = await get("hook_secret") || crypto.randomUUID().replace(/-/g, "");
  await set("hook_secret", secret);
  const r = await tg("setWebhook", { url: `${SB}/functions/v1/newi-bot`, secret_token: secret,
    allowed_updates: ["message", "callback_query", "guest_message"], drop_pending_updates: false });
  if (!r?.ok) { console.error("setWebhook", JSON.stringify(r).slice(0, 200)); return; }
  try { await tg("setMySettings", { supports_guest_queries: true }); } catch { /* старый Bot API — без гостевого режима */ }
  await set("mode", "server");
  await toOwner("📴 Телефон не на связи — я на сервере. Отвечаю на вопросы (и «@бот вопрос» в чатах) и напомню о делах. Досье, переписки и действия на телефоне — когда он включится.", true);
}
async function giveBack(): Promise<boolean> {
  if (await get("mode") !== "server") return false;
  await tg("deleteWebhook", { drop_pending_updates: false });
  await set("mode", "phone");
  return true;
}

// ───────── напоминания: шлю только когда телефон молчит ─────────
async function dueReminders(): Promise<number> {
  const now = new Date(), from = new Date(now.getTime() - 6 * 3600e3);
  const rows = await db("GET", `newi_rem?select=id,at,text&sent_at=is.null&at=lte.${enc(now.toISOString())}&at=gte.${enc(from.toISOString())}&order=at.asc&limit=20`) ?? [];
  for (const r of rows) {
    const late = now.getTime() - new Date(r.at).getTime() > 10 * 60e3;
    await toOwner("⏰ Напоминаю: " + r.text + (late ? "\n(с сервера, с опозданием: телефон был не на связи)" : "\n(с сервера: телефон не на связи)"));
    await db("PATCH", `newi_rem?id=eq.${enc(r.id)}`, { sent_at: now.toISOString() }, "return=minimal");
  }
  return rows.length;
}

async function tick(): Promise<string> {
  if (!(await get("token"))) return "no token";
  const seen = Number(await get("phone_seen")) || 0;
  const stale = Date.now() - seen > STALE_MIN * 60e3;
  if (stale && await get("mode") !== "server") await takeOver();
  const sent = stale || Date.now() - seen > 10 * 60e3 ? await dueReminders() : 0;
  return `ok stale=${stale} sent=${sent}`;
}

// ───────── телефон отмечается: токен бота, кто владелец, ближайшие напоминания ─────────
async function isAdmin(jwt: string): Promise<boolean> {
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON || KEY, Authorization: `Bearer ${jwt}` } }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!u?.id) return false;
  const a = await db("GET", `admins?select=user_id&user_id=eq.${enc(u.id)}`);
  return Array.isArray(a) && a.length > 0;
}
async function sync(b: any): Promise<Response> {
  if (b.token) await set("token", String(b.token));
  if (b.owner_chat) await set("owner_chat", String(b.owner_chat));
  if (b.owner_id) await set("owner_id", String(b.owner_id));
  await set("phone_seen", String(Date.now()));
  const back = await giveBack();
  // что сервер уже напомнил, пока телефон молчал, — телефон уберёт у себя, чтобы не было дублей
  const done = (await db("GET", `newi_rem?select=id&sent_at=not.is.null`) ?? []).map((r: any) => r.id);
  const rems = Array.isArray(b.rems) ? b.rems.slice(0, 100) : [];
  await db("DELETE", `newi_rem?sent_at=is.null`, undefined, "return=minimal");
  await db("DELETE", `newi_rem?at=lt.${enc(new Date(Date.now() - 2 * 86400e3).toISOString())}`, undefined, "return=minimal");
  const fresh = rems.filter((r: any) => r?.id && r?.at && r?.t && !done.includes(String(r.id)))
    .map((r: any) => ({ id: String(r.id).slice(0, 80), at: new Date(Number(r.at)).toISOString(), text: String(r.t).slice(0, 500) }));
  if (fresh.length) await db("POST", "newi_rem", fresh, "resolution=merge-duplicates,return=minimal");
  const learned = (await db("GET", "newi_log?select=id,q,a&order=id.asc&limit=100")) ?? [];
  if (learned.length) await db("DELETE", `newi_log?id=lte.${learned[learned.length - 1].id}`, undefined, "return=minimal");
  return Response.json({ ok: true, back, sent: done, learned: learned.map((r: any) => ({ q: r.q, a: r.a })) });
}

// ───────── Telegram пишет сюда, пока бот на сервере ─────────
async function onUpdate(u: any) {
  const owner = Number(await get("owner_id")) || 0;
  if (u.message) {
    const m = u.message, from = m.from?.id ?? 0, text = String(m.text ?? m.caption ?? "").trim();
    if (m.chat?.type !== "private") return;
    if (from !== owner) { await tg("sendMessage", { chat_id: m.chat.id, text: "🤖 Я Неви — личный помощник Никиты, отвечаю только ему." }); return; }
    if (!text) { await tg("sendMessage", { chat_id: m.chat.id, text: "Телефон не на связи — файлы и голосовые разберу, когда он включится." }); return; }
    if (text === "/status") { await tg("sendMessage", { chat_id: m.chat.id, text: "📴 Я на сервере: телефон не отмечался больше " + STALE_MIN + " мин. Отвечаю на вопросы и напоминаю. Включишь телефон — вернусь туда сама." }); return; }
    await tg("sendChatAction", { chat_id: m.chat.id, action: "typing" });
    const ans = await answer(text);
    await tg("sendMessage", { chat_id: m.chat.id, text: ans.slice(0, 4000) + "\n\n📴 с сервера — телефон не на связи", link_preview_options: { is_disabled: true } });
    await logQA(text, ans);
  } else if (u.guest_message) {
    const m = u.guest_message, qid = m.guest_query_id; if (!qid) return;
    const art = (t: string) => ({ type: "article", id: String(qid).slice(-60), title: "Неви", input_message_content: { message_text: t.slice(0, 4000), link_preview_options: { is_disabled: true } } });
    if ((m.from?.id ?? 0) !== owner) { await tg("answerGuestQuery", { guest_query_id: qid, result: art("🤖 Я Неви — личный помощник Никиты, отвечаю только ему.") }); return; }
    const bot = (await tg("getMe", {}))?.result?.username ?? "";
    let q = String(m.text ?? m.caption ?? "").replace(new RegExp("@" + bot, "ig"), "").trim();
    const rep = String(m.reply_to_message?.text ?? m.reply_to_message?.caption ?? "").trim();
    if (rep) q = q.length < 3 ? `Ответь на это сообщение или объясни его: «${rep.slice(0, 1500)}»` : `Сообщение в чате: «${rep.slice(0, 1500)}»\nВопрос к нему: ${q}`;
    if (q.length < 2) { await tg("answerGuestQuery", { guest_query_id: qid, result: art("🤖 Напиши вопрос после @" + bot) }); return; }
    const s = await tg("answerGuestQuery", { guest_query_id: qid, result: art("🤖 Думаю…") });
    const imid = s?.result?.inline_message_id;
    const a = await answer(q);
    if (imid) await tg("editMessageText", { inline_message_id: imid, text: a.slice(0, 3900), link_preview_options: { is_disabled: true } });
    await logQA(q, a);
  } else if (u.callback_query) {
    await tg("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "Телефон не на связи — нажми, когда он включится.", show_alert: true });
  }
}

Deno.serve(async (req) => {
  const tk = req.headers.get("x-tick-key");
  if (tk) { const want = await botCfg("tick_key"); return tk.length >= 32 && tk === want ? new Response(await tick().catch((e) => { console.error(e); return "err"; })) : new Response("forbidden", { status: 403 }); }
  const hook = req.headers.get("x-telegram-bot-api-secret-token");
  if (hook) {
    const want = await get("hook_secret");
    if (!want || hook !== want) return new Response("forbidden", { status: 403 });
    const u = await req.json().catch(() => null);
    if (u) await onUpdate(u).catch((e) => console.error("update", e));
    return new Response("ok");
  }
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const b = await req.json().catch(() => null);
  if (b?.op === "sync") { if (!jwt || !(await isAdmin(jwt))) return new Response("forbidden", { status: 403 }); return await sync(b); }
  return new Response("Неви на сервере. Здесь нечего смотреть.", { status: 404 });
});
