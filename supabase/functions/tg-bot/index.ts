// Бот New.работа в Telegram — круглосуточно на сервере Supabase (Edge Function).
// Telegram присылает сюда каждое сообщение (webhook). Без телефона работает всё, кроме ответов нейросети Неви:
// свободные вопросы бот сначала сверяет с частыми вопросами, остальные сохраняет — их разбирает Неви на телефоне,
// когда он в сети, или Никита (ответ реплаем в чате с ботом).

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TG_TOKEN") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://new-rabota.ru/";

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
  if (isVk(p.chat_id) || String(p.callback_query_id ?? "").startsWith("vk:")) return vkTg(method, p);
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  try { return await r.json(); } catch { return null; }
}
// ───────── ВКонтакте: тот же бот в сообщениях сообщества (Callback API → эта же функция, ?vk=1) ─────────
// Люди из ВК живут в тех же таблицах с chat_id = VK0 + id ВК — так работают подписки, тикеты, записи и ответы владельца.
const VK0 = 8e15;
const isVk = (c: unknown) => typeof c === "number" ? c >= VK0 : /^\d{16}$/.test(String(c ?? "")) && Number(c) >= VK0;
const vkId = (c: number) => c - VK0;
const vkLink = (c: number) => `vk.com/id${vkId(c)}`;
let vkTok = "";
async function vkToken(): Promise<string> { return vkTok || (vkTok = Deno.env.get("VK_TOKEN") ?? (await cfg("vk_token"))); }
async function vk(method: string, params: Record<string, unknown>): Promise<any> {
  const tok = await vkToken(); if (!tok) return null;
  const body = new URLSearchParams({ access_token: tok, v: "5.199" });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const r = await fetch(`https://api.vk.com/method/${method}`, { method: "POST", body });
  const j = await r.json().catch(() => null);
  if (j?.error) console.error("vk", method, j.error.error_code, j.error.error_msg);
  return j;
}
function vkKb(m: any): any {
  if (!m) return undefined;
  const lbl = (t: string) => String(t).slice(0, 40);
  if (m.keyboard) return { one_time: false, buttons: m.keyboard.map((r: any[]) => r.map((b) => ({ action: { type: "text", label: lbl(b.text) }, color: "secondary" }))) };
  if (m.inline_keyboard) {
    const rows = m.inline_keyboard.map((r: any[]) => r.filter((b) => !String(b.url ?? "").startsWith("https://t.me/")).map((b) =>
      b.url || b.web_app ? { action: { type: "open_link", link: b.web_app ? SITE : b.url, label: lbl(b.text) } }
        : { action: { type: "callback", label: lbl(b.text), payload: JSON.stringify({ d: b.callback_data }) } })).filter((r: any[]) => r.length);
    return rows.length ? { inline: true, buttons: rows } : undefined;
  }
  return undefined;
}
async function vkText(peer: number, cmid: number): Promise<string> {
  return (await vk("messages.getByConversationMessageId", { peer_id: peer, conversation_message_ids: cmid }))?.response?.items?.[0]?.text ?? "";
}
async function vkTg(method: string, p: any): Promise<any> {
  if (method === "answerCallbackQuery") {
    const [, ev, user, peer] = String(p.callback_query_id).split(":");
    await vk("messages.sendMessageEventAnswer", { event_id: ev, user_id: user, peer_id: peer, event_data: p.text ? { type: "show_snackbar", text: String(p.text).slice(0, 90) } : undefined });
    return { ok: true };
  }
  const peer = vkId(Number(p.chat_id));
  if (method === "sendMessage") {
    const r = await vk("messages.send", { peer_ids: peer, random_id: Math.floor(Math.random() * 2e9), message: p.text, keyboard: vkKb(p.reply_markup), dont_parse_links: 1 });
    const x = r?.response?.[0];
    return x && !x.error ? { ok: true, result: { message_id: x.conversation_message_id } } : null;
  }
  if (method === "editMessageText" || method === "editMessageReplyMarkup") {
    const text = method === "editMessageText" ? p.text : await vkText(peer, p.message_id);
    const r = await vk("messages.edit", { peer_id: peer, conversation_message_id: p.message_id, message: text, keyboard: method === "editMessageReplyMarkup" ? (vkKb(p.reply_markup) ?? { inline: true, buttons: [] }) : undefined, dont_parse_links: 1 });
    return { ok: !!r?.response };
  }
  return null;   // остального (кнопка меню, удаление) в ВК нет
}
async function vkSecret(): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("vk:" + KEY)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
// подключение сообщества: код подтверждения, Callback-сервер (эта функция), события «сообщение» и «нажата кнопка», сообщения и кнопка «Начать»
async function vkSetup(force = false): Promise<string> {
  if (!(await vkToken())) return "нет ключа ВК";
  const url = `${SB}/functions/v1/tg-bot?vk=1`;
  if (!force && (await cfg("vk_setup")) === url) return "уже подключено";
  const g = await vk("groups.getById", {});
  const gr = g?.response?.groups?.[0] ?? g?.response?.[0];
  if (!gr?.id) return "ключ не подошёл: " + (g?.error?.error_msg ?? "нет ответа ВК");
  const code = (await vk("groups.getCallbackConfirmationCode", { group_id: gr.id }))?.response?.code;
  if (!code) return "ВК не дал код подтверждения — у ключа нет права «Управление сообществом»";
  await setCfg("vk_group", String(gr.id)); await setCfg("vk_confirm", String(code));
  const secret = await vkSecret();
  const list: any[] = (await vk("groups.getCallbackServers", { group_id: gr.id }))?.response?.items ?? [];
  let sid = list.find((x) => x.url === url)?.id;
  if (sid) await vk("groups.editCallbackServer", { group_id: gr.id, server_id: sid, url, title: "New.работа", secret_key: secret });
  else sid = (await vk("groups.addCallbackServer", { group_id: gr.id, url, title: "New.работа", secret_key: secret }))?.response?.server_id;
  if (!sid) return "ВК не добавил Callback-сервер";
  const st = await vk("groups.setCallbackSettings", { group_id: gr.id, server_id: sid, api_version: "5.199", message_new: 1, message_event: 1 });
  if (!st?.response) return "ВК не включил события: " + (st?.error?.error_msg ?? "");
  await vk("groups.setSettings", { group_id: gr.id, messages: 1, bots_capabilities: 1, bots_start_button: 1 });
  await setCfg("vk_setup", url);
  return `подключено: ${gr.name ?? "сообщество"} (vk.com/club${gr.id})`;
}
async function vkUpdate(u: any): Promise<Response> {
  if (u.type === "confirmation") return new Response(String(await cfg("vk_confirm")) || "no");
  if (u.secret !== (await vkSecret())) return new Response("forbidden", { status: 403 });
  const o = u.object ?? {};
  if (u.type === "message_new") {
    const m = o.message ?? {};
    if (!m.from_id || m.from_id <= 0 || m.peer_id !== m.from_id) return new Response("ok");   // только личные сообщения людей
    if (await seen(`vkm:${m.id ?? m.conversation_message_id}:${m.from_id}`)) return new Response("ok");   // ВК повторяет событие, если ответ задержался
    await markSeen(`vkm:${m.id ?? m.conversation_message_id}:${m.from_id}`);
    let text = String(m.text ?? "").trim();
    let pl: any = null; try { pl = m.payload ? JSON.parse(m.payload) : null; } catch { pl = null; }
    if (pl?.command === "start") text = "/start" + (m.ref ? " " + m.ref : "");
    else if (m.ref && !text) text = "/start " + m.ref;
    const who = (await vk("users.get", { user_ids: m.from_id }))?.response?.[0] ?? {};
    const id = VK0 + m.from_id;
    await onMessage({ chat: { id, type: "private" }, from: { id, first_name: who.first_name ?? "", username: "", vk: m.from_id }, text });
  } else if (u.type === "message_event") {
    let d = o.payload?.d; if (typeof o.payload === "string") { try { d = JSON.parse(o.payload).d; } catch { d = ""; } }
    if (!o.user_id || o.peer_id !== o.user_id || !d) return new Response("ok");
    const id = VK0 + o.user_id;
    await moderate({ id: `vk:${o.event_id}:${o.user_id}:${o.peer_id}`, from: { id }, data: d,
      message: { message_id: o.conversation_message_id, chat: { id, type: "private" }, text: await vkText(o.peer_id, o.conversation_message_id) } });
  }
  return new Response("ok");
}

const MENU = { resize_keyboard: true, keyboard: [
  [{ text: "🔎 Найти работу" }, { text: "📢 Разместить вакансию" }],
  [{ text: "⚖️ Права 14–17" }, { text: "🛡 Как не попасть на обман" }],
  [{ text: "✉️ Написать команде" }],
] };
// Mini App New.работа (сайт tg.html): кнопка «Вакансии» слева от поля ввода у всех + /app
const APP = SITE + "tg.html";
const appButton = (city = "") => ({ inline_keyboard: [[{ text: "📱 Открыть вакансии", web_app: { url: APP + (city ? "?city=" + encodeURIComponent(city) : "") } }]] });
async function menuApp() {
  if ((await cfg("menu_app")) === APP) return;
  const r = await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Вакансии", web_app: { url: APP } } });
  if (r?.ok) await setCfg("menu_app", APP);
}
async function send(chat: number | string, text: string, markup?: unknown): Promise<number> {
  const r = await tg("sendMessage", { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
  return r?.result?.message_id ?? 0;
}

// ───────── тексты ─────────
const RIGHTS = "⚖️ Если тебе 14–17 (Трудовой кодекс РФ):\n• Работать можно с 14 лет — лёгкий труд, без вреда здоровью и учёбе. До 16 нужно согласие родителя и органа опеки.\n• 14–15 лет: до 24 ч в неделю, в каникулы до 4 ч в день.\n• 16–17 лет: до 35 ч в неделю, в каникулы до 7 ч в день.\n• Если совмещаешь со школой — норма вдвое меньше: 12 и 17,5 ч в неделю.\n• Нельзя: ночью, сверхурочно, в выходные и праздники, на вредной работе, с алкоголем и табаком.\n• Отпуск 31 день, испытательный срок не ставится.\nСт. 63, 92, 94, 265, 267, 268 ТК РФ.";
const SCAM = "🛡 Как не попасть на обман:\n• Не плати за «обучение», форму или «бронь» вакансии.\n• Не отдавай паспорт и банковскую карту работодателю.\n• Не оформляй карты «на себя» для чужих денег и не переводи чужие деньги — это дропперство, уголовная статья.\n• «Курьер документов», «закладки», «лёгкие деньги за час» — почти всегда преступление.\n• Договор лучше подписать до первого рабочего дня.\nСомневаешься — нажми «✉️ Написать команде», проверим.";

const DOCS = "Для устройства понадобятся:\n• паспорт;\n• СНИЛС (номер можно посмотреть на Госуслугах);\n• медицинское заключение — направление даёт работодатель, медосмотр за его счёт;\n• для 14–15 лет — письменное согласие одного из родителей и органа опеки и попечительства;\n• банковская карта на твоё имя для зарплаты (свою карту никому не передавай).\nТрудовая книжка сейчас электронная, бумажную заводить не обязательно.";
const HELP = "Если что-то не так:\n• не платят или нарушают права — Государственная инспекция труда, сайт онлайнинспекция.рф;\n• трудно, страшно, давят — детский телефон доверия 8-800-2000-122, бесплатно;\n• втягивают в дропперство или закладки — полиция, 102 или 112, и расскажи взрослым, которым доверяешь.\nПодозрительную вакансию на сайте отправь модератору кнопкой «Пожаловаться».";
const CONSENT = "Если тебе 14–15 лет, нужно письменное согласие одного из родителей и органа опеки и попечительства (с заявлением в опеку идёт родитель). С 16 лет согласие родителей не нужно. Готовый бланк можно заполнить и распечатать — родитель подпишет: " + SITE + "consent.html";
const EMP = "Вакансию работодатель добавляет через «📢 Разместить вакансию» — перед публикацией её проверяет модератор. Правила: работа законная и подходит по возрасту (для 14–17 лет — только то, что разрешает Трудовой кодекс); нельзя брать с соискателя деньги за обучение, форму, медкнижку или «бронь»; нельзя предлагать работу с переводом чужих денег, оформлением карт, закладками, алкоголем, табаком и вейпами для несовершеннолетних; указывай реальную оплату, график и рабочий контакт. Вакансия снимается сама, когда истекает выбранный срок. Полные правила: " + SITE + "about.html#rules";
const PRIVACY_SHORT = "ℹ️ Запоминаю твоё имя (и ник) из Telegram или ВКонтакте, город и подписку на вакансии. Телефон или почту — только если сам оставишь (/contact). Подробнее: /privacy, удалить всё: /forget.";
const PRIVACY_LONG = "🔒 Что я о тебе храню: имя и ник из Telegram или ВКонтакте, город для подборок вакансий, а контакт (телефон или почта) — только если ты сам его оставил командой /contact. Зачем: присылать вакансии и, если ты хочешь, связать тебя с работодателем. Данные видит только команда New.работа. Отписаться от подборок: /stop. Удалить всё: /forget. Подробнее: " + SITE + "about.html#privacy";
const ABOUT = "New.работа — бесплатный сайт вакансий для молодёжи от 14 лет: подработка, стажировки, проекты и волонтёрство по всей России и удалённо. Каждую вакансию перед публикацией проверяет модератор. Делает молодёжная команда из Саратова. Ответы Неви — подсказки, а не юридическая консультация.";

// частые вопросы: отвечаю сразу, без нейросети
const FAQ: [RegExp, string][] = [
  [/не платят|не заплатил|не выплат|нарушают прав|инспекци|куда обращ|куда жаловат|телефон доверия|давят на меня/i, HELP],
  [/согласие родител|разрешение родител|бланк|опек/i, CONSENT],
  [/документ|снилс|паспорт|медосмотр|медкомисс|медкниж|трудов\S* книжк/i, DOCS],
  [/разместить вакансию|опубликовать вакансию|добавить вакансию|выложить вакансию|я работодатель|для работодател/i, EMP],
  [/персональн|удалить (мои )?данные|мои данные|конфиденц|политик/i, PRIVACY_LONG],
  [/кто вы|кто делает|о проекте|что за сайт/i, ABOUT],
  [/(как|где).{0,20}(разместить|добавить|опубликовать|подать).{0,20}ваканси|хочу разместить/i, "Нажми «📢 Разместить вакансию» — 6 коротких шагов. Вакансию проверит команда, потом она появится в поиске и на сайте. Это бесплатно."],
  [/(сколько|платно|бесплатно|цена|стоит).{0,25}(размещ|публикац|ваканси|сервис)|это платно/i, "New.работа бесплатный: и искать работу, и размещать вакансии. Если кто-то просит деньги от имени сервиса — это обман."],
  [/(с какого|со скольки|сколько).{0,10}(возраст|лет).{0,20}(работ|брать|устро)|можно ли работать в (14|15|16)/i, "Работать можно с 14 лет — лёгкий труд с согласия родителя и органа опеки. Подробнее — кнопка «⚖️ Права 14–17». В поиске указано, с какого возраста берут на каждую вакансию."],
  [/(как|где).{0,15}(найти|искать|посмотреть).{0,15}(работ|ваканси|подработ)/i, "Нажми «🔎 Найти работу» и напиши город (или «удалённо»). Новые вакансии в твоём городе я буду присылать сама. Все вакансии есть и на сайте: " + SITE],
  [/(как|куда).{0,15}(откликнуться|связаться с работодател|написать работодател)/i, "Связывайся с работодателем по контакту из вакансии (телеграм или телефон). Сервис посредником не выступает."],
  [/удал[её]нн|из дома|онлайн работ/i, "Удалённые вакансии ищи так: «🔎 Найти работу» → напиши «удалённо». Будь осторожен: на удалёнке больше всего мошенников — не плати за обучение и не давай данные карты."],
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
      await markSeen("pend:" + v.id);
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
  if (own && id) await send(own, `❓ #q${id} · ${from.first_name ?? ""}${from.username ? " (@" + from.username + ")" : ""}${isVk(chat) ? " (ВК " + vkLink(chat) + ")" : ""} ${why}:\n«${q.slice(0, 800)}»\n\nОтветь реплаем на это сообщение — перешлю. Если телефон с Неви в сети, она может ответить раньше.`);
}

// ───────── запись на смену по ссылке t.me/бот?start=ev_<id>[_f<chat друга>] ─────────
// Запись идёт через RPC event_signup — та же логика мест, что на сайте (резерв, места, которые держат для друга).
async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; val: any; err: string }> {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text(); let val: any = null; try { val = t ? JSON.parse(t) : null; } catch { val = t; }
  if (!r.ok) console.error("rpc", fn, r.status, t.slice(0, 300));
  return { ok: r.ok, val, err: r.ok ? "" : String(val?.message ?? t).slice(0, 200) };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const evWhen = (e: any) => new Date(e.starts_at).toLocaleString("ru-RU", { timeZone: "Europe/Saratov", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
async function evGet(id: string): Promise<any> { return UUID.test(id) ? (await db("GET", `events?select=*&id=eq.${id}&published=eq.true`))?.[0] ?? null : null; }
async function botName(): Promise<string> {
  let n = await cfg("bot_username");
  if (!n) { n = (await tg("getMe", {}))?.result?.username ?? ""; if (n) await setCfg("bot_username", n); }
  return n;
}
async function friendBtn(chat: number, e: any): Promise<any[]> {
  const bot = await botName(); const param = `ev_${e.id}_f${chat}`;
  if (!bot || param.length > 64 || isVk(chat)) return [];
  const link = `https://t.me/${bot}?start=${param}`;
  return [[{ text: "👫 Позвать друга", url: `https://t.me/share/url?url=${enc(link)}&text=${enc(`Пойдём вместе на «${String(e.title).slice(0, 60)}»? Запись в один клик 👇`)}` }]];
}
async function tellOrganizer(e: any, text: string) {
  const own = await ownerId();
  const ec = e?.employer_id ? Number((await db("GET", `employers?select=tg_chat&id=eq.${enc(e.employer_id)}`))?.[0]?.tg_chat ?? 0) : 0;
  if (ec) await send(ec, text);
  if (own && ec !== own) await send(own, text);
}
async function taken(e: any): Promise<number> {
  const r = await rpc("event_taken", { eid: e.id });
  if (r.ok && typeof r.val === "number") return r.val;
  return ((await db("GET", `event_signups?select=id&event_id=eq.${e.id}&status=eq.main`)) ?? []).length;   // база без шага 18
}

async function eventJoin(chat: number, from: any, arg: string) {
  const [id, inv] = arg.split("_f");
  const e = await evGet(id);
  if (!e || new Date(e.starts_at).getTime() < Date.now()) { await send(chat, "Эта запись уже закрыта.", MENU); return; }
  const name = String(from.first_name ?? "Участник").slice(0, 60).padEnd(2, ".");
  const who = name + (from.username ? " @" + from.username : "") + (isVk(chat) ? " " + vkLink(chat) : "");
  const contact = from.username ? "@" + from.username : isVk(chat) ? vkLink(chat) : "tg:" + chat;
  const mine = (await db("GET", `event_signups?select=id,status&event_id=eq.${e.id}&chat_id=eq.${chat}`))?.[0];
  if (mine) { await send(chat, mine.status === "reserve" ? `Ты уже в резерве на «${e.title}». Освободится место — сразу напишу.` : `Ты уже записан(а) на «${e.title}», ${evWhen(e)} ✅`, MENU); return; }
  // «пойти с другом»: ссылка работает, только если пригласивший сам записан на это событие (без спама чужим)
  const invId = Number(inv) || 0;
  const fr = invId && invId !== chat ? (await db("GET", `event_signups?select=name&event_id=eq.${e.id}&chat_id=eq.${invId}`))?.[0] : null;
  const friend = fr ? invId : 0; const friendName = fr ? String(fr.name || "друг") : "";
  let r = await rpc("event_signup", { eid: e.id, p_name: name, p_contact: contact, p_age: null, p_with: friendName || null });
  if (!r.ok && /function|p_with/i.test(r.err)) r = await rpc("event_signup", { eid: e.id, p_name: name, p_contact: contact, p_age: null });   // база без шага 16
  if (!r.ok) {
    await send(chat, /full/.test(r.err) ? `На «${e.title}» мест больше нет 😔` : /closed/.test(r.err) ? "Эта запись уже закрыта." : `Не получилось записать, попробуй на сайте: ${SITE}events.html#e-${e.id}`, MENU);
    return;
  }
  await db("PATCH", `event_signups?event_id=eq.${e.id}&contact=eq.${enc(contact)}&chat_id=is.null`, { chat_id: chat }, "return=minimal");
  if (r.val === -1) {
    const res: any[] = (await db("GET", `event_signups?select=chat_id&event_id=eq.${e.id}&status=eq.reserve&order=created_at.asc`)) ?? [];
    const pos = res.findIndex((x) => Number(x.chat_id) === chat) + 1; const n = pos > 0 ? ` (№${pos})` : "";
    await send(chat, `Мест на «${e.title}» (${evWhen(e)}) пока нет — ты в резерве${n}.\nЕсли кто-то отменит — сразу напишу, место будет твоё 🙌`, MENU);
    if (friend) await send(friend, `👫 ${name} перешёл(ла) по твоей ссылке на «${e.title}», но мест уже нет — он(а) в резерве${n}.`);
    await tellOrganizer(e, `🕓 В резерв на «${e.title}»: ${who}. Сделать основным — в кабинете: ${SITE}cabinet.html`);
    return;
  }
  await send(chat, `✅ Записала тебя: «${e.title}»${friend ? ` — вместе с ${friendName} 👫` : ""}\n🗓 ${evWhen(e)}${e.place ? "\n📍 " + e.place : ""}\nЗа день напомню. Если планы поменяются — нажми «Отменить запись», я предупрежу организатора.`,
    { inline_keyboard: [[{ text: "❌ Отменить запись", callback_data: `evx:${e.id}` }], ...(await friendBtn(chat, e))] });
  if (friend) await send(friend, `👫 ${name} записался(ась) по твоей ссылке на «${e.title}» (${evWhen(e)}). Идёте вместе!`);
  await tellOrganizer(e, `🙋 Запись на «${e.title}» (${evWhen(e)}): ${who}${friend ? ` — вместе с другом (${friendName}), ставьте в одну смену` : ""}`);
}

// освободилось место → предлагаю первому из резерва (кому ещё не предлагали); «Не могу» → следующему
async function offerReserve(e: any) {
  if (!e?.capacity || (await taken(e)) >= e.capacity) return;
  const r = (await db("GET", `event_signups?select=id,chat_id&event_id=eq.${e.id}&status=eq.reserve&chat_id=not.is.null&offered_at=is.null&order=created_at.asc&limit=1`))?.[0];
  if (!r) return;
  await db("PATCH", `event_signups?id=eq.${r.id}`, { offered_at: new Date().toISOString() }, "return=minimal");
  await send(r.chat_id, `🎉 Освободилось место на «${e.title}», ${evWhen(e)}${e.place ? ", " + e.place : ""}. Берёшь? Кто первый нажмёт — того и место.`,
    { inline_keyboard: [[{ text: "✅ Беру", callback_data: `evt:${e.id}` }, { text: "Не могу", callback_data: `evz:${e.id}` }]] });
}

async function eventBtn(cbq: any, data: string) {
  const msg = cbq.message; const chat = Number(msg?.chat?.id ?? 0);
  if (!msg || msg.chat?.type !== "private" || cbq.from?.id !== chat) { await tg("answerCallbackQuery", { callback_query_id: cbq.id }); return; }
  const [act, id] = data.split(":");
  const say = (t: string) => tg("answerCallbackQuery", { callback_query_id: cbq.id, text: t });
  const edit = (t: string) => tg("editMessageText", { chat_id: chat, message_id: msg.message_id, text: t });
  if (act === "evx") {   // сначала спрашиваю, чтобы не отменить случайно
    await say("");
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: "Да, отменить", callback_data: `evy:${id}` }, { text: "Нет, иду ✅", callback_data: `evn:${id}` }]] } });
    return;
  }
  if (act === "evn") { await say("Отлично, ждём!"); await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: "❌ Отменить запись", callback_data: `evx:${id}` }]] } }); return; }
  if (!UUID.test(id)) { await say(""); return; }
  const e = (await db("GET", `events?select=*&id=eq.${id}`))?.[0];
  const title = e?.title ?? "мероприятие";
  const row = (await db("GET", `event_signups?select=id,status,name&event_id=eq.${id}&chat_id=eq.${chat}`))?.[0];
  const who = String(cbq.from.first_name || row?.name || "Участник") + (cbq.from.username ? " @" + cbq.from.username : "") + (isVk(chat) ? " " + vkLink(chat) : "");
  if (act === "evy") {
    await say("");
    if (!row) { await edit(`${msg.text}\n\nЗаписи уже нет.`); return; }
    await db("DELETE", `event_signups?id=eq.${row.id}`, undefined, "return=minimal");
    await edit(`${String(msg.text).split("\nЗа день напомню")[0]}\n\n❌ Запись отменена`);
    await send(chat, `❌ Запись на «${title}» отменена. Организатора предупредила. Спасибо, что сказал(а) заранее 🙏`, MENU);
    await tellOrganizer(e, `❌ Отмена записи на «${title}»${e ? " (" + evWhen(e) + ")" : ""}: ${who}`);
    if (row.status === "main" && e && new Date(e.starts_at).getTime() > Date.now()) await offerReserve(e);
    return;
  }
  if (!e || new Date(e.starts_at).getTime() < Date.now()) { await say("Уже не актуально"); await edit(`${msg.text}\n\nЗапись уже закрыта.`); return; }
  if (act === "evz") {
    if (row) await markSeen("rto:" + row.id);
    await say("Хорошо, предложу другому");
    await edit(`${msg.text}\n\nОк, предложила место следующему. Ты остаёшься в резерве.`);
    await offerReserve(e); return;
  }
  if (act === "evt") {
    if (!row) { await say(""); await edit(`${msg.text}\n\nТвоей записи в резерве уже нет.`); return; }
    if (row.status === "main") { await say("Место уже твоё ✅"); return; }
    if ((await taken(e)) >= (e.capacity ?? 1e9)) { await say("Не успел(а) 😔"); await edit(`${msg.text}\n\nМесто уже заняли — ты остаёшься в резерве. Освободится ещё — напишу.`); return; }
    await db("PATCH", `event_signups?id=eq.${row.id}`, { status: "main" }, "return=minimal");
    await say("Место твоё ✅");
    await edit(`✅ Место твоё: «${title}», ${evWhen(e)}${e.place ? "\n📍 " + e.place : ""}\nЗа день напомню.`);
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: "❌ Отменить запись", callback_data: `evx:${id}` }]] } });
    await tellOrganizer(e, `🔁 Замена на «${title}» (${evWhen(e)}): место занял(а) ${who} из резерва.`);
    return;
  }
  await say("");
}

// ───────── публикация: канал + подписчики города ─────────
async function seen(key: string): Promise<boolean> { return !!(await db("GET", `bot_seen?select=key&key=eq.${enc(key)}`))?.[0]; }
async function markSeen(key: string) { await db("POST", "bot_seen", { key }, "resolution=ignore-duplicates,return=minimal"); }
async function announce(v: any, skipChat?: number): Promise<number> {
  if (await seen("post:" + v.id)) return 0;
  await markSeen("post:" + v.id);
  const link = `${SITE}vacancy.html?id=${v.id}`;
  const ch = await cfg("channel");
  if (ch) await send(ch, card(v) + `\n🔗 ${link}\n\n#вакансия` + (v.city ? " #" + String(v.city).replace(/[^\p{L}\d]/gu, "") : "") + (v.remote ? " #удалённо" : ""),
    { inline_keyboard: [[{ text: "Открыть на сайте", url: link }], [{ text: "⚡ Нужен человек на смену? Смена под ключ", url: `${SITE}business.html#shift` }]] });
  const c5 = (v.city ?? "").toLowerCase().slice(0, 5);
  // «всем»: по умолчанию новая вакансия уходит ВСЕМ подписчикам бота (у кого выбран город; кто нажал /stop — не получает).
  // Владелец может сузить до «только свой город» командой /all off.
  const toAll = (await cfg("broadcast_all")) !== "0";
  const subs: any[] = (await db("GET", `bot_users?select=chat_id,city&city=not.is.null&limit=1000`)) ?? [];
  let n = 0;
  for (const s of subs) {
    const sc = String(s.city).toLowerCase();
    if (toAll || (c5 && sc.startsWith(c5)) || (v.remote && sc.startsWith("удал"))) { if (s.chat_id !== skipChat) { await send(s.chat_id, "🆕 Новая вакансия:\n" + card(v) + `\n🔗 ${link}`); n++; } }
    if (n >= 200) break;
  }
  return n;
}

// ───────── обход по расписанию (GitHub Actions раз в ~10 минут) ─────────
// вакансии, одобренные в админке сайта → в канал и подписчикам; новые заявки и жалобы с сайта → владельцу с кнопками
async function tick() {
  const own = await ownerId();
  if (!(await cfg("tick_init"))) {
    // первый запуск: всё, что уже на сайте, считаем опубликованным, чтобы не завалить канал старыми вакансиями
    const old: any[] = (await db("GET", "vacancies?select=id,status&status=in.(approved,pending)&limit=2000")) ?? [];
    for (const v of old) await markSeen((v.status === "approved" ? "post:" : "pend:") + v.id);
    const reps: any[] = (await db("GET", "reports?select=id&status=eq.new&limit=500")) ?? [];
    for (const r of reps) await markSeen("rep:" + r.id);
    await setCfg("tick_init", new Date().toISOString());
    return "init";
  }
  await menuApp();
  if (await vkToken()) await vkSetup();
  const since = new Date(Date.now() - 4 * 86400_000).toISOString();
  const appr: any[] = (await db("GET", `vacancies?select=*&status=eq.approved&created_at=gte.${enc(since)}&order=created_at.asc&limit=30`)) ?? [];
  let posted = 0;
  for (const v of appr) { if (posted >= 4) break; if (!(await seen("post:" + v.id))) { await announce(v); posted++; } }
  if (own) {
    const pend: any[] = (await db("GET", `vacancies?select=*&status=eq.pending&order=created_at.asc&limit=20`)) ?? [];
    for (const v of pend) {
      if (await seen("pend:" + v.id)) continue;
      await markSeen("pend:" + v.id);
      const risk = scamFlags(v);
      await send(own, `📢 Новая вакансия с сайта\n\n${card(v)}${risk.length ? "\n\n⚠ Неви: " + risk.join("; ") : ""}`,
        { inline_keyboard: [[{ text: "✅ Опубликовать", callback_data: `ok:${v.id}` }, { text: "❌ Отклонить", callback_data: `no:${v.id}` }]] });
    }
    const reps: any[] = (await db("GET", `reports?select=id,reason,vacancy_id,vacancies(title,city,contact)&status=eq.new&order=created_at.asc&limit=20`)) ?? [];
    for (const r of reps) {
      if (await seen("rep:" + r.id)) continue;
      await markSeen("rep:" + r.id);
      const v = r.vacancies ?? {};
      await send(own, `⚠ Жалоба на вакансию «${v.title ?? "?"}»${v.city ? " (" + v.city + ")" : ""}\nПричина: ${String(r.reason).slice(0, 500)}\nКонтакт работодателя: ${v.contact ?? "—"}`,
        { inline_keyboard: [[{ text: "🗑 Снять вакансию", callback_data: `rm:${r.vacancy_id}` }, { text: "👌 Всё в порядке", callback_data: `rk:${r.id}` }],
          [{ text: "Открыть", url: `${SITE}vacancy.html?id=${r.vacancy_id}` }]] });
    }
  }
  // заказы продвижения из кабинета работодателя
  if (own) {
    const ords: any[] = (await db("GET", `orders?select=id,product,price,contact,vacancy_id,vacancies(title,city)&status=eq.new&order=created_at.asc&limit=20`)) ?? [];
    const PROD: Record<string, string> = { top7: "В топ на 7 дней", urgent: "Срочно + пост в канале", verify: "Проверка ✓ на год", business: "Бизнес на месяц" };
    for (const o of ords) {
      if (await seen("ord:" + o.id)) continue;
      await markSeen("ord:" + o.id);
      await send(own, `💰 Заказ ${String(o.id).slice(0, 8)}: ${PROD[o.product] ?? o.product} — ${o.price} ₽\nВакансия: «${o.vacancies?.title ?? "?"}»${o.vacancies?.city ? ", " + o.vacancies.city : ""}\nСвязь: ${o.contact || "—"}\n\nПришли, как оплатить; когда деньги придут — пробей чек в «Мой налог» и нажми «Оплачено».`,
        { inline_keyboard: [[{ text: "✅ Оплачено", callback_data: `opd:${o.id}` }, { text: "✖ Отменить", callback_data: `ocx:${o.id}` }]] });
    }
  }
  // напоминание записавшимся через бота: мероприятие завтра
  const tmr0 = new Date(Date.now() + 20 * 3600_000).toISOString(), tmr1 = new Date(Date.now() + 28 * 3600_000).toISOString();
  const evs: any[] = (await db("GET", `events?select=id,title,starts_at,place&published=eq.true&starts_at=gte.${enc(tmr0)}&starts_at=lt.${enc(tmr1)}`)) ?? [];
  for (const e of evs) {
    if (await seen("evr:" + e.id)) continue;
    await markSeen("evr:" + e.id);
    const ss: any[] = (await db("GET", `event_signups?select=chat_id&event_id=eq.${e.id}&chat_id=not.is.null&status=eq.main`)) ?? [];
    const when = new Date(e.starts_at).toLocaleString("ru-RU", { timeZone: "Europe/Saratov", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    for (const s of ss) await send(s.chat_id, `⏰ Напоминаю: завтра «${e.title}», ${when}${e.place ? ", " + e.place : ""}. Ждём!`);
  }
  // за 2 часа до начала — ещё раз основным участникам
  const h0 = new Date(Date.now() + 100 * 60_000).toISOString(), h1 = new Date(Date.now() + 130 * 60_000).toISOString();
  const soon: any[] = (await db("GET", `events?select=id,title,starts_at,place&published=eq.true&starts_at=gte.${enc(h0)}&starts_at=lt.${enc(h1)}`)) ?? [];
  for (const e of soon) {
    if (await seen("ev2:" + e.id)) continue;
    await markSeen("ev2:" + e.id);
    const ss: any[] = (await db("GET", `event_signups?select=chat_id&event_id=eq.${e.id}&chat_id=not.is.null&status=eq.main`)) ?? [];
    for (const s of ss) await send(s.chat_id, `⏰ Через 2 часа: «${e.title}», ${evWhen(e)}${e.place ? ", " + e.place : ""}. Выходи заранее 🙌`);
  }
  // место из резерва предложили, а человек 30 мин молчит — предлагаю следующему
  const t30 = new Date(Date.now() - 30 * 60_000).toISOString(), t1d = new Date(Date.now() - 86400_000).toISOString();
  const late: any[] = (await db("GET", `event_signups?select=id,event_id,chat_id&status=eq.reserve&offered_at=lt.${enc(t30)}&offered_at=gt.${enc(t1d)}&limit=20`)) ?? [];
  for (const r of late) {
    if (await seen("rto:" + r.id)) continue;
    await markSeen("rto:" + r.id);
    const e = await evGet(r.event_id);
    if (!e || new Date(e.starts_at).getTime() < Date.now()) continue;
    if (r.chat_id) await send(r.chat_id, `Ты не ответил(а) за 30 минут — место на «${e.title}» предложила следующему. Ты остаёшься в резерве.`);
    await offerReserve(e);
  }
  return `ok posted=${posted}`;
}

async function moderate(cbq: any) {
  const data = String(cbq.data ?? "");
  if (/^ev[xyntz]:/.test(data)) { await eventBtn(cbq, data); return; }
  await tg("answerCallbackQuery", { callback_query_id: cbq.id });
  const own = await ownerId();
  if (!own || cbq.from?.id !== own) return;
  const [act, id] = String(cbq.data ?? "").split(":");
  const msg = cbq.message;
  const mark = async (t: string) => { if (msg) await tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text: `${msg.text}\n\n${t}` }); };
  if (act === "opd" || act === "ocx") {
    await db("PATCH", `orders?id=eq.${enc(id)}`, { status: act === "opd" ? "paid" : "cancelled" }, "return=minimal");
    await mark(act === "opd" ? "✅ Оплачено — услуга включена" : "✖ Заказ отменён"); return;
  }
  if (act === "rk") { await db("PATCH", `reports?id=eq.${enc(id)}`, { status: "done" }, "return=minimal"); await mark("👌 Жалоба закрыта"); return; }
  if (act === "rm") {
    await db("PATCH", `vacancies?id=eq.${enc(id)}`, { status: "rejected" }, "return=minimal");
    await db("PATCH", `reports?vacancy_id=eq.${enc(id)}`, { status: "done" }, "return=minimal");
    await mark("🗑 Вакансия снята, жалобы закрыты"); return;
  }
  const v = (await db("GET", `vacancies?select=*&id=eq.${enc(id)}`))?.[0];
  if (!v) { await mark("Вакансия уже удалена."); return; }
  if (v.status !== "pending") { await mark(v.status === "approved" ? "Уже опубликована." : "Уже отклонена."); return; }
  const fromChat = (await db("GET", `bot_vacancy_from?select=chat_id&vacancy_id=eq.${enc(id)}`))?.[0]?.chat_id;
  if (act === "ok") {
    await db("PATCH", `vacancies?id=eq.${enc(id)}`, { status: "approved" }, "return=minimal");
    if (fromChat) await send(fromChat, `✅ Твоя вакансия «${v.title}» опубликована в New.работа!\n${SITE}vacancy.html?id=${v.id}`);
    const n = await announce(v, fromChat);
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
  if (text === "/people" || text.startsWith("/people ")) {
    const city = text.slice(7).trim();
    const f = city ? `&city=ilike.*${enc(city)}*` : "";
    const rows: any[] = (await db("GET", `bot_users?select=name,username,city,contact,chat_id&order=last_at.desc&limit=40${f}`)) ?? [];
    await send(chat, rows.length ? `В базе ${rows.length}:\n` + rows.filter((r) => r.chat_id !== chat).map((r) => `• ${r.name || "?"}${r.username ? " @" + r.username : ""}${r.city ? " · " + r.city : ""}${r.contact ? " · ☎ " + r.contact : ""} · id ${r.chat_id}`).join("\n") : "В базе таких нет."); return true;
  }
  if (text === "/stats") {
    const users = (await db("GET", "bot_users?select=chat_id", undefined, "count=exact"))?.length ?? 0;
    const open: any[] = (await db("GET", "bot_questions?select=id,name,q&answered_at=is.null&order=created_at.desc&limit=8")) ?? [];
    const pend: any[] = (await db("GET", "vacancies?select=id&status=eq.pending")) ?? [];
    await send(chat, `Бот на сервере, работает 24/7.\nПодписчиков: ${users}, вакансий на проверке: ${pend.length}.\n` + (open.length ? "Без ответа:\n" + open.map((q) => `#q${q.id} ${q.name}: «${String(q.q).slice(0, 80)}»`).join("\n") : "Все вопросы отвечены."));
    return true;
  }
  if (text === "/all" || text.startsWith("/all ")) { const on = !/\boff\b|выкл|нет|0/i.test(text.slice(4)); await setCfg("broadcast_all", on ? "1" : "0"); await send(chat, on ? "Новые вакансии теперь буду присылать ВСЕМ подписчикам (кто не нажимал /stop)." : "Новые вакансии — только подписчикам своего города и по удалёнке."); return true; }
  if (text === "/vk" || text.startsWith("/vk ")) {
    const t = text.slice(3).trim();
    if (t) { await tg("deleteMessage", { chat_id: chat, message_id: m.message_id }); await setCfg("vk_token", t); vkTok = ""; await setCfg("vk_setup", ""); }
    await send(chat, "ВК: " + (t ? "ключ сохранила, сообщение с ключом удалила. " : "") + await vkSetup(!!t)); return true;
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
  if (!u) { await db("POST", "bot_users", { chat_id: chat, name: from.first_name ?? "", username: from.username ?? "" }, "resolution=merge-duplicates,return=minimal"); u = { chat_id: chat }; if (!(own && from.id === own)) await send(chat, PRIVACY_SHORT); }
  else await setUser(chat, { last_at: new Date().toISOString(), name: from.first_name ?? u.name, username: from.username ?? u.username });
  if (own && from.id === own && await ownerCmd(chat, m, text)) return;

  const menuWord = /^(🔎|📢|⚖️|🛡|✉️|\/)/.test(text);
  if (u.step === "city" && !menuWord) { await setUser(chat, { step: null }); await findJobs(chat, text); return; }
  if (u.step === "contact" && !menuWord) {
    await setUser(chat, { step: null });
    if (/^\s*(нет|не хочу|отмена|стоп)/i.test(text)) { await send(chat, "Хорошо, контакт не сохраняю 👌", MENU); return; }
    const c = text.trim().slice(0, 100);
    if (!/[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}/.test(c)) { await setUser(chat, { step: "contact" }); await send(chat, "Не вижу ни телефона, ни почты. Напиши номер или адрес, либо «нет».", MENU); return; }
    await setUser(chat, { contact: c, contact_at: new Date().toISOString() });
    await send(chat, "Сохранила 👌 Изменить или удалить: /contact, /forget.", MENU); return;
  }
  if (u.step === "ticket" && !menuWord) { await setUser(chat, { step: null }); await ticket(chat, from, text, "написал(а) команде"); return; }
  if (u.step?.startsWith("v_") && !menuWord) { await vacancyStep(chat, u, text, from); return; }
  if (u.step) await setUser(chat, { step: null, draft: null });

  if (text.startsWith("/start")) {
    const arg = text.slice(6).trim();
    if (arg.startsWith("c_")) {
      const raw = arg.slice(2); let city = "";
      try { const b = raw.replace(/-/g, "+").replace(/_/g, "/"); city = new TextDecoder().decode(Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0))); } catch { city = ""; }
      if (!city || /[\u0000-\u001f]/.test(city)) city = decodeURIComponent(raw).replace(/_/g, " ");
      city = city.trim().slice(0, 40);
      await setUser(chat, { city }); await send(chat, `Подписала на новые вакансии: ${city} 🔔\nОтписаться — /stop`, MENU); return;
    }
    if (arg.startsWith("login_")) {
      const r = await fetch(`${SB}/rest/v1/rpc/emp_login_confirm`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_nonce: arg.slice(6), p_chat: chat, p_name: from.first_name ?? "", p_username: from.username ?? "" }) });
      const ok = r.ok && (await r.text()).trim() !== "null";
      await send(chat, ok ? "✅ Вход в кабинет работодателя подтверждён. Вернись на сайт — всё уже открыто.\nСюда буду присылать новые анкеты и отмены записей на твои смены." : "Ссылка входа устарела. Нажми «Войти через Telegram» на сайте ещё раз.", MENU);
      return;
    }
    if (arg.startsWith("ev_")) { await eventJoin(chat, from, arg.slice(3)); return; }
    await send(chat, `Привет, ${from.first_name ?? "друг"}! Я Неви, помощница New.работа 🤖\nПомогу найти работу или подработку с 14 лет, разместить вакансию и разобраться с правами.\nВыбери кнопку внизу или просто задай вопрос.\n🌐 Сайт: ${SITE}`, MENU); return;
  }
  if ((text === "/app" || text.startsWith("/app@")) && isVk(chat)) { await send(chat, "Все вакансии с фильтрами по городу и возрасту: " + SITE, MENU); return; }
  if (text === "/app" || text.startsWith("/app@")) { await send(chat, "Все вакансии с фильтрами по городу и возрасту — прямо в Telegram 👇", appButton(u.city && u.city !== "удалённо" ? u.city : "")); return; }
  if (text.startsWith("/privacy")) { await send(chat, PRIVACY_LONG, MENU); return; }
  if (text.startsWith("/forget")) {
    await db("DELETE", `bot_questions?chat_id=eq.${chat}`, undefined, "return=minimal");
    await db("DELETE", `bot_users?chat_id=eq.${chat}`, undefined, "return=minimal");
    await send(chat, "Удалила всё, что запомнила о тебе: профиль, подписку, контакт и твои вопросы. Если напишешь снова, начнём с нуля.", MENU); return;
  }
  if (text.startsWith("/contact")) {
    await setUser(chat, { step: "contact" });
    await send(chat, "Хочешь, чтобы работодатель или команда могли связаться с тобой напрямую? Напиши телефон или почту — по желанию. Данные видит только команда New.работа, удалить можно командой /forget. Если тебе меньше 18, лучше оставь контакт родителей или предупреди их.\nЕсли не хочешь, напиши «нет».", MENU); return;
  }
  if (text === "/stop") { await setUser(chat, { city: null }); await send(chat, "Отписала от новых вакансий. Подписаться снова — «🔎 Найти работу».", MENU); return; }
  if (text.startsWith("/help")) { await send(chat, "Что я умею:\n🔎 найти вакансии по городу\n📢 принять вакансию на проверку\n⚖️ рассказать про права подростков\n📱 /app — все вакансии прямо в Telegram\n🛡 предупредить о мошенниках\n✉️ передать вопрос команде\nА ещё можно просто спросить меня словами.", MENU); return; }
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
  if (new URL(req.url).searchParams.get("vk") === "1") { try { return await vkUpdate(await req.json()); } catch (e) { console.error(e); return new Response("ok"); } }
  // Telegram присылает секрет, который мы задали при setWebhook (sha256 от токена) — чужие запросы отбрасываем
  const want = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TG)))).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  if (req.headers.get("x-telegram-bot-api-secret-token") !== want) return new Response("forbidden", { status: 403 });
  try {
    const u = await req.json();
    if (u.tick) return new Response(await tick());
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await moderate(u.callback_query);
  } catch (e) { console.error(e); }
  return new Response("ok");
});
