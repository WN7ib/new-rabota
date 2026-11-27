// Восстановление входа в админку (Никита 27.11: «в ТГ и ВК бесплатно, или SMS — 5 ₽ не много»).
// Страница входа просит код → он приходит владельцу в Telegram (бот New.работа), в ВК (сообщения сообщества) или SMS (sms.ru).
// Код верный → отдаю одноразовую ссылку восстановления Supabase → admin.html просит новый пароль.
// Чужой человек, нажав кнопку, ничего не получает: код уходит только владельцу, пароль сам не меняется.
// Номер телефона и ключ sms.ru — только в секретах сервера (OWNER_PHONE, SMSRU_API_ID), в репозитории их нет.

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TG_TOKEN") ?? "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const ALLOWED = [/^https:\/\/wn7ib\.github\.io\/new-rabota\//, /^https:\/\/(?:www\.)?new-rabota\.ru\//];

async function db(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); if (!r.ok) { console.error("db", path, r.status, t.slice(0, 200)); return null }
  try { return t ? JSON.parse(t) : null } catch { return null }
}
async function cfg(k: string): Promise<string> { return (await db("GET", `bot_config?select=value&key=eq.${encodeURIComponent(k)}`))?.[0]?.value ?? "" }
async function setCfg(k: string, v: string) { await db("POST", "bot_config", { key: k, value: v }, "resolution=merge-duplicates,return=minimal") }
async function sha(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, "0")).join("") }
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function isAdminEmail(email: string): Promise<boolean> {
  const r = await db("POST", "rpc/admin_email_ok", { em: email });
  return r === true;
}
async function sendTg(text: string): Promise<boolean> {
  const owner = Number(Deno.env.get("OWNER_ID") ?? await cfg("owner_id")) || 0;
  if (!TG || !owner) return false;
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: owner, text }) }).then(r => r.json()).catch(() => null);
  return r?.ok === true;
}
async function sendVk(text: string): Promise<boolean> {
  const tok = Deno.env.get("VK_TOKEN") ?? await cfg("vk_token"); if (!tok) return false;
  const call = async (m: string, p: Record<string, string>) => { const b = new URLSearchParams({ access_token: tok, v: "5.199", ...p }); return await fetch(`https://api.vk.com/method/${m}`, { method: "POST", body: b }).then(r => r.json()).catch(() => null) };
  let uid = await cfg("owner_vk_id");
  if (!uid) { const r = await call("utils.resolveScreenName", { screen_name: (await cfg("owner_vk")) || "nw7ib" }); if (r?.response?.type === "user") { uid = String(r.response.object_id); await setCfg("owner_vk_id", uid) } }
  if (!uid) return false;
  const r = await call("messages.send", { user_id: uid, random_id: String(Math.floor(Math.random() * 2e9)), message: text });
  return !!r?.response;
}
async function sendSms(text: string): Promise<boolean> {
  const id = Deno.env.get("SMSRU_API_ID") ?? "", ph = (Deno.env.get("OWNER_PHONE") ?? "").replace(/\D/g, "").replace(/^8/, "7");
  if (!id || ph.length < 11) return false;
  const r = await fetch(`https://sms.ru/sms/send?api_id=${encodeURIComponent(id)}&to=${ph}&msg=${encodeURIComponent(text)}&json=1`).then(r => r.json()).catch(() => null);
  return r?.status === "OK" && r?.sms?.[ph]?.status === "OK";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: any = {}; try { b = await req.json() } catch {}
  const email = String(b.email ?? "").trim().toLowerCase(), via = String(b.via ?? ""), now = Date.now();
  const st = JSON.parse((await cfg("recover")) || "{}");

  if (b.code) {   // проверка кода → ссылка восстановления
    if (!st.h || now > st.exp || (st.tries ?? 0) >= 5) return out({ ok: false, error: "Код устарел — запроси новый." });
    if (await sha(String(b.code).trim() + st.salt) !== st.h) { st.tries = (st.tries ?? 0) + 1; await setCfg("recover", JSON.stringify(st)); return out({ ok: false, error: `Неверный код (осталось попыток: ${5 - st.tries}).` }) }
    await setCfg("recover", "{}");
    const redirect = ALLOWED.some(r => r.test(String(b.redirect ?? ""))) ? String(b.redirect) : "https://wn7ib.github.io/new-rabota/admin.html";
    const g = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "recovery", email: st.email, redirect_to: redirect }) }).then(r => r.json()).catch(() => null);
    const link = g?.action_link ?? g?.properties?.action_link;
    return link ? out({ ok: true, link }) : out({ ok: false, error: "Не получилось сделать ссылку: " + JSON.stringify(g).slice(0, 120) });
  }

  // запрос кода: не чаще раза в минуту и 10 раз в сутки
  if (!["tg", "vk", "sms"].includes(via) || !/.+@.+\..+/.test(email)) return out({ ok: false, error: "Впиши почту админа и выбери, куда прислать код." });
  if (st.at && now - st.at < 60_000) return out({ ok: false, error: "Код уже отправлен — подожди минуту." });
  const day = new Date().toISOString().slice(0, 10); const cnt = st.day === day ? (st.n ?? 0) : 0;
  if (cnt >= 10) return out({ ok: false, error: "Слишком много попыток сегодня — попробуй завтра или через письмо на почту." });
  const okMsg = { ok: true, msg: via === "sms" ? "Если это почта админа — код придёт по SMS." : via === "vk" ? "Если это почта админа — код придёт в сообщения ВК от сообщества New.работа." : "Если это почта админа — код придёт в Telegram от бота New.работа." };
  if (!(await isAdminEmail(email))) { await setCfg("recover", JSON.stringify({ ...st, at: now, day, n: cnt + 1 })); return out(okMsg) }   // не говорю, есть ли такой админ
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)), salt = crypto.randomUUID();
  const text = `Код для входа в админку New.работа: ${code}\nДействует 10 минут. Если это не ты — ничего не делай, пароль не изменится.`;
  const sent = via === "tg" ? await sendTg(text) : via === "vk" ? await sendVk(text) : await sendSms(`New.rabota kod: ${code}`);
  if (!sent) return out({ ok: false, error: via === "sms" ? "SMS не настроены (нужен ключ sms.ru на сервере) — выбери Telegram или ВК." : via === "vk" ? "Не смогла написать в ВК: напиши сообществу New.работа любое сообщение (чтобы оно могло тебе отвечать) и попробуй снова." : "Не смогла написать в Telegram: бот New.работа не знает владельца." });
  await setCfg("recover", JSON.stringify({ h: await sha(code + salt), salt, exp: now + 10 * 60_000, tries: 0, email, at: now, day, n: cnt + 1 }));
  return out(okMsg);
});
