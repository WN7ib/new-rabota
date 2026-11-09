// Бот New.работа в Telegram — круглосуточно на сервере Supabase (Edge Function).
// Telegram присылает сюда каждое сообщение (webhook). Без телефона работает всё, кроме ответов нейросети Неви:
// свободные вопросы бот сначала сверяет с частыми вопросами, остальные сохраняет — их разбирает Неви на телефоне,
// когда он в сети, или Никита (ответ реплаем в чате с ботом).

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TG_TOKEN") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://wn7ib.github.io/new-rabota/";

// ───────── база ─────────
async function db(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) { console.error("db", method, path, r.status, t.slice(0, 300)); return null; }
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}
const enc = encodeURIComponent;

async function cfg(key: string): Promise<string> {
  const r = await db("GET", `bot_config?select=value&key=eq.${enc(key)}`);
  return r?.[0]?.value ?? "";
}
async function setCfg(key: string, value: string) {
  await db("POST", "bot_config", { key, value }, "resolution=merge-duplicates,return=minimal");
}
async function ownerId(): Promise<number> {
  const e = Deno.env.get("OWNER_ID"); if (e) return Number(e);
  return Number(await cfg("owner_id")) || 0;
}

// ───────── Telegram ─────────
async function tg(method: string, p: Record<string, unknown>): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  try { return await r.json(); } catch { return null; }
}
const MENU = { resize_keyboard: true, keyboard: [
  [{ text: "🔎 Найти работу" }, { text: "📢 Разместить вакансию" }],
  [{ text: "⚖️ Права 14–17" }, { text: "🛡 Как не попасть на обман" }],
  [{ text: "✉️ Написать команде" }],
] };
async function send(chat: number | string, text: string, markup?: unknown): Promise<number> {
  const r = await tg("sendMessage", { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
  return r?.result?.message_id ?? 0;
}

// ───────── тексты ─────────
const RIGHTS = "⚖️ Если тебе 14–17 (Трудовой кодекс РФ):\n• Работать можно с 14 лет — лёгкий труд, без вреда здоровью и учёбе. До 16 нужно согласие родителя и органа опеки.\n• 14–15 лет: до 24 ч в неделю, в каникулы до 4 ч в день.\n• 16–17 лет: до 35 ч в неделю, в каникулы до 7 ч в день.\n• Если совмещаешь со школой — норма вдвое меньше: 12 и 17,5 ч в неделю.\n• Нельзя: ночью, сверхурочно, в выходные и праздники, на вредной работе, с алкоголем и табаком.\n• Отпуск 31 день, испытательный срок не ставится.\nСт. 63, 92, 94, 265, 267, 268 ТК РФ.";
const SCAM = "🛡 Как не попасть на обман:\n• Не плати за «обучение», форму или «бронь» вакансии.\n• Не отдавай паспорт и банковскую карту работодателю.\n• Не оформляй карты «на себя» для чужих денег и не переводи чужие деньги — это дропперство, уголовная статья.\n• «Курьер документов», «закладки», «лёгкие деньги за час» — почти всегда преступление.\n• Договор лучше подписать до первого рабочего дня.\nСомневаешься — нажми «✉️ Написать команде», проверим.";

// частые вопросы: отвечаю сразу, без нейросети
const FAQ: [RegExp, string][] = [
  [/(как|где).{0,20}(разместить|добавить|опубликовать|подать).{0,20}ваканси|хочу разместить/i, "Нажми «📢 Разместить вакансию» — 6 коротких шагов. Вакансию проверит команда, потом она появится в поиске и на сайте. Это бесплатно."],
  [/(сколько|платно|бесплатно|цена|стоит).{0,25}(размещ|публикац|ваканси|сервис)|это платно/i, "New.работа бесплатный: и искать работу, и размещать вакансии. Если кто-то просит деньги от имени сервиса — это обман."],
  [/(с какого|со скольки|сколько).{0,10}(возраст|лет).{0,20}(работ|брать|устро)|можно ли работать в (14|15|16)/i, "Работать можно с 14 лет — лёгкий труд с согласия родителя и органа опеки. Подробнее — кнопка «⚖️ Права 14–17». В поиске указано, с какого возраста берут на каждую вакансию."],
  [/(как|где).{0,15}(найти|искать|посмотреть).{0,15}(работ|ваканси|подработ)/i, "Нажми «🔎 Найти работу» и напиши город (или «удалённо»). Новые вакансии в твоём городе я буду присылать сама. Все вакансии есть и на сайте: " + SITE],
  [/(как|куда).{0,15}(откликнуться|связаться с работодател|написать работодател)/i, "Связывайся с работодателем по контакту из вакансии (телеграм или телефон). Сервис посредником не выступает."],
  [/удал[её]нн|из дома|онлайн работ/i, "Удалённые вакансии ищи так: «🔎 Найти работу» → напиши «удалённо». Будь осторожен: на удалёнке больше всего мошенников — не плати за обучение и не давай данные карты."],
  [/документ|паспорт|снилс|инн|медкнижк|трудов(ая|ую) книжк/i, "Обычно для работы нужны паспорт, СНИЛС, ИНН, иногда медкнижка; до 16 лет — согласие родителя и органа опеки. Паспорт и карту работодателю в руки не отдавай."],
  [/(мошенни|обман|кинули|развод|не заплатил|не платят)/i, SCAM + "\n\nЕсли тебя обманули по вакансии с New.работа — нажми «✉️ Написать команде» и опиши, что случилось."],
  [/^(привет|здравств|добр(ое|ый) (утро|день|вечер)|хай(?=[\s!,.]|$)|hi\b|hello)/i, "Привет! Я Неви, помощница New.работа 🤖 Найти работу, разместить вакансию или задать вопрос — выбирай кнопку внизу."],
  [/^(спасибо|спс|благодарю|thanks)/i, "Пожалуйста! Удачи с работой 🙌"],
];

const card = (v: any) =>
  `💼 ${v.title}${v.company ? " — " + v.company : ""}\n📍 ${v.city || (v.remote ? "удалённо" : "")}${v.remote && v.city ? " · можно удалённо" : ""}\n🎂 с ${v.age_min ?? 16} лет · 💰 ${v.pay || "по договорённости"}\n📝 ${(v.description || "").slice(0, 600)}\n☎️ ${v.contact}`;

function scamFlags(d: any): string[] {
  const t = `${d.title} ${d.description} ${d.pay}`.toLowerCase(); const r: string[] = [];
  if (/дроп|обнал|карт[уы] на себя|оформи карт|курьер документ|забрать (деньги|наличн)|перевест\S* деньги|крипт|закладк/.test(t)) r.push("похоже на дропперство или закладки — опасно");
  if (/оплат\S* (обучени|форм|регистрац)|взнос|предоплат/.test(t)) r.push("просят деньги с соискателя");
  if ((d.age_min ?? 16) < 16 && /ноч|алког|табак|вейп|кальян|погруз|склад|охран/.test(t)) r.push("для 14–15 лет похоже на тяжёлую или запрещённую работу");
  return r;
}

// ───────── сценарии ─────────
async function user(chat: number): Promise<any> {
  return (await db("GET", `bot_users?select=*&chat_id=eq.${chat}`))?.[0] ?? null;
}
async function setUser(chat: number, patch: Record<string, unknown>) {
  await db("PATCH", `bot_users?chat_id=eq.${chat}`, patch, "return=minimal");
}

async function findJobs(chat: number, city0: string) {
  const city = city0.trim().toLowerCase(); const remote = city.startsWith("удал");
  await setUser(chat, { city: remote ? "удалённо" : city0.trim() });
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const f = remote ? "remote=eq.true" : `or=(city.ilike.${enc(city.slice(0, 5) + "*")},remote.eq.true)`;
  const rows: any[] = (await db("GET", `vacancies?select=*&status=eq.approved&created_at=gte.${enc(since)}&${f}&order=created_at.desc&limit=6`)) ?? [];
  if (!rows.length) { await send(chat, `Пока вакансий ${remote ? "на удалёнке" : "в «" + city0.trim() + "»"} нет. Я запомнила: как появится новая — сразу напишу 🔔\nСайт: ${SITE}`, MENU); return; }
  await send(chat, `Нашла ${rows.length}:`);
  for (const v of rows) await send(chat, card(v) + `\n🔗 ${SITE}vacancy.html?id=${v.id}`);
  await send(chat, "Новые по этому городу пришлю сама 🔔", MENU);
}

async function vacancyStep(chat: number, u: any, text: string, from: any) {
  const d = u.draft ?? {};
  if (/^(отмена|стоп|выход)/i.test(text)) { await setUser(chat, { step: null, draft: null }); await send(chat, "Отменила.", MENU); return; }
  const next = async (step: string, q: string) => { await setUser(chat, { step, draft: d }); await send(chat, q); };
  switch (u.step) {
    case "v_title": d.title = text.slice(0, 80); return next("v_city", "2/6. Город? Если можно из дома — напиши «удалённо».");
    case "v_city": d.remote = /удал/i.test(text); d.city = d.remote && /^удал/i.test(text) ? "" : text.slice(0, 40); return next("v_age", "3/6. С какого возраста берёте? 14, 16 или 18.");
    case "v_age": { const a = Number(text.match(/\d+/)?.[0] ?? 16); d.age_min = a < 16 ? 14 : a < 18 ? 16 : 18; return next("v_pay", "4/6. Оплата? (например: «250 ₽/час»)"); }
    case "v_pay": d.pay = text.slice(0, 40); return next("v_desc", "5/6. Что делать и какой график?");
    case "v_desc": d.description = text.slice(0, 1200); return next("v_contact", "6/6. Как откликнуться? Телеграм или телефон.");
    case "v_contact": {
      d.contact = text.slice(0, 120);
      if (d.contact.length < 3) return next("v_contact", "Контакт слишком короткий. Напиши телеграм или телефон.");
      await setUser(chat, { step: null, draft: null });
      const row = { title: d.title, city: d.city || null, type: "Подработка", age_min: d.age_min ?? 16, pay: d.pay, remote: !!d.remote, description: d.description, contact: d.contact, status: "pending" };
      const ins = await db("POST", "vacancies", row, "return=representation");
      const v = ins?.[0];
      if (!v) { await send(chat, "Не получилось сохранить вакансию. Попробуй ещё раз позже.", MENU); return; }
      await db("POST", "bot_vacancy_from", { vacancy_id: v.id, chat_id: chat }, "return=minimal");
      await send(chat, "Спасибо! Вакансия ушла на проверку команде New.работа. Как одобрят — она появится в поиске и на сайте, и я тебе напишу.", MENU);
      const risk = scamFlags(v);
      const own = await ownerId();
      if (own) await send(own, `📢 Новая вакансия от ${from.first_name ?? "?"}${from.username ? " (@" + from.username + ")" : ""}\n\n${card(v)}${risk.length ? "\n\n⚠ Неви: " + risk.join("; ") : ""}`,
        { inline_keyboard: [[{ text: "✅ Опубликовать", callback_data: `ok:${v.id}` }, { text: "❌ Отклонить", callback_data: `no:${v.id}` }]] });
      return;
    }
  }
}

async function ticket(chat: number, from: any, q: string, why: string) {
  const ins = await db("POST", "bot_questions", { chat_id: chat, name: from.first_name ?? "", username: from.username ?? "", q: q.slice(0, 1000) }, "return=representation");
  const id = ins?.[0]?.id;
  await send(chat, "Передала вопрос. Ответ придёт сюда же — обычно в течение дня 👌", MENU);
  const own = await ownerId();
  if (own && id) await send(own, `❓ #q${id} · ${from.first_name ?? ""}${from.username ? " (@" + from.username + ")" : ""} ${why}:\n«${q.slice(0, 800)}»\n\nОтветь реплаем на это сообщение — перешлю. Если телефон с Неви в сети, она может ответить раньше.`);
}

async function moderate(cbq: any) {
  await tg("answerCallbackQuery", { callback_query_id: cbq.id });
  const own = await ownerId();
  if (!own || cbq.from?.id !== own) return;
  const [act, id] = String(cbq.data ?? "").split(":");
  const v = (await db("GET", `vacancies?select=*&id=eq.${enc(id)}`))?.[0];
  const msg = cbq.message;
  const mark = async (t: string) => { if (msg) await tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text}\n\n${t}` }); };
  if (!v) { await mark("Вакансия уже удалена."); return; }
  if (v.status !== "pending") { await mark(v.status === "approved" ? "Уже опубликована." : "Уже отклонена."); return; }
  const fromChat = (await db("GET", `bot_vacancy_from?select=chat_id&vacancy_id=eq.${enc(id)}`))?.[0]?.chat_id;
  if (act === "ok") {
    await db("PATCH", `vacancies?id=eq.${enc(id)}`, { status: "approved" }, "return=minimal");
    if (fromChat) await send(fromChat, `✅ Твоя вакансия «${v.title}» опубликована в New.работа!\n${SITE}vacancy.html?id=${v.id}`);
    const ch = await cfg("channel"); if (ch) await send(ch, card(v) + `\n🔗 ${SITE}vacancy.html?id=${v.id}\n\n#вакансия`);
    // подписчикам этого города (и удалёнки)
    const c5 = (v.city ?? "").toLowerCase().slice(0, 5);
    const subs: any[] = (await db("GET", `bot_users?select=chat_id,city&city=not.is.null&limit=1000`)) ?? [];
    let n = 0;
    for (const s of subs) {
      const sc = String(s.city).toLowerCase();
      if ((c5 && sc.startsWith(c5)) || (v.remote && sc.startsWith("удал"))) { if (s.chat_id !== fromChat) { await send(s.chat_id, "🆕 Новая вакансия:\n" + card(v)); n++; } }
      if (n >= 200) break;
    }
    await mark(`✅ Опубликовано${n ? `, разослала ${n} подписчикам` : ""}`);
  } else {
    await db("PATCH", `vacancies?id=eq.${enc(id)}`, { status: "rejected" }, "return=minimal");
    if (fromChat) await send(fromChat, `Вакансию «${v.title}» не пропустили. Если думаешь, что это ошибка, нажми «✉️ Написать команде».`);
    await mark("❌ Отклонено");
  }
}

async function ownerCmd(chat: number, m: any, text: string): Promise<boolean> {
  const replied = m.reply_to_message?.text as string | undefined;
  const qm = replied?.match(/#q(\d+)/);
  if (qm) {
    const q = (await db("GET", `bot_questions?select=*&id=eq.${qm[1]}`))?.[0];
    if (!q) { await send(chat, "Не нашла этот вопрос."); return true; }
    await send(q.chat_id, `💬 Ответ команды New.работа:\n${text}`, MENU);
    await db("PATCH", `bot_questions?id=eq.${qm[1]}`, { a: text, answered_at: new Date().toISOString(), answered_by: "owner" }, "return=minimal");
    await send(chat, `Отправила ${q.name || "человеку"} ✅`); return true;
  }
  if (text.startsWith("/all ")) {
    const t = text.slice(5).trim(); const subs: any[] = (await db("GET", `bot_users?select=chat_id&limit=2000`)) ?? []; let n = 0;
    for (const s of subs) if (s.chat_id !== chat) { if (await send(s.chat_id, `📣 ${t}\n\n— New.работа`)) n++; }
    await send(chat, `Разослала ${n} подписчикам.`); return true;
  }
  if (text === "/stats") {
    const users = (await db("GET", "bot_users?select=chat_id", undefined, "count=exact"))?.length ?? 0;
    const open: any[] = (await db("GET", "bot_questions?select=id,name,q&answered_at=is.null&order=created_at.desc&limit=8")) ?? [];
    const pend: any[] = (await db("GET", "vacancies?select=id&status=eq.pending")) ?? [];
    await send(chat, `Бот на сервере, работает 24/7.\nПодписчиков: ${users}, вакансий на проверке: ${pend.length}.\n` + (open.length ? "Без ответа:\n" + open.map((q) => `#q${q.id} ${q.name}: «${String(q.q).slice(0, 80)}»`).join("\n") : "Все вопросы отвечены."));
    return true;
  }
  if (text === "/channel" || text.startsWith("/channel ")) { const c = text.slice(8).trim(); await setCfg("channel", c); await send(chat, c ? `Новые вакансии буду публиковать в ${c} (бот должен быть админом канала).` : "Публикация в канал выключена."); return true; }
  return false;
}

async function onMessage(m: any) {
  if (m.chat?.type !== "private") return;
  const chat: number = m.chat.id; const from = m.from ?? {}; const text: string = (m.text ?? "").trim();
  if (!text) { await send(chat, "Я пока понимаю только текст. Напиши словами 🙂", MENU); return; }
  // кто владелец: первый, кто напишет «/owner <код>» (код — в настройках мессенджера Newi), или задаёт мессенджер
  const own = await ownerId();
  if (text.startsWith("/owner ")) {
    const code = (await cfg("owner_code")) || "";
    if (code && text.slice(7).trim() === code) { await setCfg("owner_id", String(from.id)); await send(chat, "Готово: ты владелец бота. Сюда будут приходить вакансии на проверку и вопросы.", MENU); }
    else await send(chat, "Код не подошёл.", MENU);
    return;
  }
  let u = await user(chat);
  if (!u) { await db("POST", "bot_users", { chat_id: chat, name: from.first_name ?? "", username: from.username ?? "" }, "resolution=merge-duplicates,return=minimal"); u = { chat_id: chat }; }
  else await setUser(chat, { last_at: new Date().toISOString(), name: from.first_name ?? u.name, username: from.username ?? u.username });
  if (own && from.id === own && await ownerCmd(chat, m, text)) return;

  const menuWord = /^(🔎|📢|⚖️|🛡|✉️|\/)/.test(text);
  if (u.step === "city" && !menuWord) { await setUser(chat, { step: null }); await findJobs(chat, text); return; }
  if (u.step === "ticket" && !menuWord) { await setUser(chat, { step: null }); await ticket(chat, from, text, "написал(а) команде"); return; }
  if (u.step?.startsWith("v_") && !menuWord) { await vacancyStep(chat, u, text, from); return; }
  if (u.step) await setUser(chat, { step: null, draft: null });

  if (text.startsWith("/start")) {
    const arg = text.slice(6).trim();
    if (arg.startsWith("c_")) { const city = decodeURIComponent(arg.slice(2)).replace(/_/g, " "); await setUser(chat, { city }); await send(chat, `Подписала на новые вакансии: ${city} 🔔`, MENU); return; }
    await send(chat, `Привет, ${from.first_name ?? "друг"}! Я Неви, помощница New.работа 🤖\nПомогу найти работу или подработку с 14 лет, разместить вакансию и разобраться с правами.\nВыбери кнопку внизу или просто задай вопрос.\n🌐 Сайт: ${SITE}`, MENU); return;
  }
  if (text.startsWith("/help")) { await send(chat, "Что я умею:\n🔎 найти вакансии по городу\n📢 принять вакансию на проверку\n⚖️ рассказать про права подростков\n🛡 предупредить о мошенниках\n✉️ передать вопрос команде\nА ещё можно просто спросить меня словами.", MENU); return; }
  if (text.startsWith("🔎") || text.startsWith("/find") || text.startsWith("/jobs")) { await setUser(chat, { step: "city" }); await send(chat, "В каком городе ищешь? Или напиши «удалённо»."); return; }
  if (text.startsWith("📢") || text.startsWith("/add_job") || text.startsWith("/vacancy")) { await setUser(chat, { step: "v_title", draft: {} }); await send(chat, "Разместим вакансию. Отвечай по шагам, «отмена» — выйти.\n1/6. Какая должность? (например: «Бариста на выходные»)"); return; }
  if (text.startsWith("⚖️")) { await send(chat, RIGHTS, MENU); return; }
  if (text.startsWith("🛡")) { await send(chat, SCAM, MENU); return; }
  if (text.startsWith("✉️")) { await setUser(chat, { step: "ticket" }); await send(chat, "Напиши вопрос одним сообщением — передам команде, ответ придёт сюда."); return; }

  for (const [re, a] of FAQ) if (re.test(text)) {
    await send(chat, a + "\n\n— Неви 🤖", MENU);
    await db("POST", "bot_questions", { chat_id: chat, name: from.first_name ?? "", username: from.username ?? "", q: text.slice(0, 1000), a, answered_at: new Date().toISOString(), answered_by: "faq" }, "return=minimal");
    return;
  }
  // не знаю — вопрос ждёт Неви (телефон) или Никиту
  await ticket(chat, from, text, "спросил(а)");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  // Telegram присылает секрет, который мы задали при setWebhook (sha256 от токена) — чужие запросы отбрасываем
  const want = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TG)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  if (req.headers.get("x-telegram-bot-api-secret-token") !== want) return new Response("forbidden", { status: 403 });
  try {
    const u = await req.json();
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await moderate(u.callback_query);
  } catch (e) { console.error(e); }
  return new Response("ok");
});
