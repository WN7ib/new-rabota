// Общие функции страниц New.работа: база, настройки сайта, отклик, жалобы, Метрика.
(function(){
  const cfg = window.NR_CONFIG || {};
  const ok = cfg.supabaseUrl && cfg.supabaseKey && window.supabase;
  const sb = ok ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {auth:{persistSession:false}}) : null;

  function el(tag, cls, text){ const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e }
  function toast(t){ let e=document.getElementById("toast"); if(!e){e=el("div","toast");e.id="toast";document.body.append(e)} e.textContent=t; e.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>e.hidden=true,3000) }
  const today = () => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0") };

  let settingsP = null;
  function settings(){
    if(!settingsP) settingsP = sb ? sb.from("settings").select("data").eq("id",1).maybeSingle().then(r=>(r.data&&r.data.data)||{}, ()=>({})) : Promise.resolve({});
    return settingsP;
  }

  // Яндекс.Метрика, если в админке указан номер счётчика
  settings().then(s=>{
    const id = String(s.metrika_id||"").replace(/\D/g,""); if(!id) return;
    window.ym = window.ym || function(){ (window.ym.a=window.ym.a||[]).push(arguments) }; window.ym.l=+new Date();
    const sc=document.createElement("script"); sc.async=true; sc.src="https://mc.yandex.ru/metrika/tag.js"; document.head.append(sc);
    window.ym(+id,"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});
  });
  // контакт поддержки в подвале
  settings().then(s=>{ const e=document.getElementById("support"); if(e&&s.support) e.textContent=" · Поддержка: "+s.support });

  /** Куда ведёт отклик: Telegram, телефон, почта, ВК или просто текст для копирования. */
  function contactLink(c){
    const t=(c||"").trim();
    let m=t.match(/(?:t\.me\/|telegram\.me\/|@)([A-Za-z0-9_]{4,32})/); if(m) return {href:"https://t.me/"+m[1], label:"Написать в Telegram"};
    m=t.match(/vk\.com\/([A-Za-z0-9_.]+)/i); if(m) return {href:"https://vk.com/"+m[1], label:"Написать во ВКонтакте"};
    m=t.match(/[\w.+-]+@[\w-]+\.[\w.]+/); if(m) return {href:"mailto:"+m[0], label:"Написать на почту", copy:m[0]};
    const d=t.replace(/[^\d+]/g,""); if(d.replace(/\D/g,"").length>=10){ let p=d.replace(/\D/g,""); if(p.length===11&&p[0]==="8")p="7"+p.slice(1); if(p.length===10)p="7"+p; return {href:"tel:+"+p, label:"Позвонить", copy:"+"+p} }
    return {href:null, label:"Скопировать контакт", copy:t};
  }
  function copy(t){ try{ navigator.clipboard.writeText(t).then(()=>toast("Скопировано: "+t),()=>toast("Выдели контакт и скопируй вручную")) }catch(e){ toast("Выдели контакт и скопируй вручную") } }
  /** Кнопка «Откликнуться»: открывает контакт и считает отклик. */
  function respondButton(v){
    const c=contactLink(v.contact);
    const a=el(c.href?"a":"button","respond","✉ Откликнуться");
    if(c.href){ a.href=c.href; if(/^https/.test(c.href)){a.target="_blank";a.rel="noopener"} } else a.type="button";
    a.title=c.label;
    a.addEventListener("click",()=>{ if(sb&&v.id) sb.rpc("vacancy_click",{vid:v.id}).then(()=>{},()=>{}); if(c.copy) copy(c.copy) });
    return a;
  }

  /** Жалоба на вакансию. */
  function reportDialog(v){
    if(!sb){toast("Сайт не подключён к базе");return}
    const sh=el("div","sheet"); const f=el("form","form"); f.noValidate=true;
    f.append(el("h2",null,"Пожаловаться на вакансию"));
    const p=el("p","hint full","«"+(v.title||"")+"». Модератор проверит и уберёт вакансию, если что-то не так."); f.append(p);
    const reasons=["Мошенничество, дропы, «лёгкие деньги»","Просят заплатить за обучение или форму","Не подходит для подростков","Контакты не работают","Другое"];
    const box=el("div","field full"); reasons.forEach((r,i)=>{ const l=el("label","check"); const inp=document.createElement("input"); inp.type="radio"; inp.name="rr"; inp.value=r; inp.id="rr"+i; if(i===0)inp.checked=true; l.append(inp,document.createTextNode(" "+r)); box.append(l) }); f.append(box);
    const ta=document.createElement("textarea"); ta.maxLength=400; ta.placeholder="Подробности (необязательно)"; const fd=el("div","field full"); fd.append(ta); f.append(fd);
    const err=el("p","err"); err.hidden=true; f.append(err);
    const row=el("div","row"); const cancel=el("button","btn btn-ghost","Отмена"); cancel.type="button"; const send=el("button","btn btn-primary","Отправить"); send.type="submit"; row.append(cancel,send); f.append(row);
    sh.append(f); document.body.append(sh);
    const close=()=>sh.remove(); cancel.onclick=close; sh.addEventListener("click",e=>{if(e.target===sh)close()});
    f.addEventListener("submit",async e=>{ e.preventDefault(); send.disabled=true;
      const r=(f.querySelector("input[name=rr]:checked")||{}).value||"Другое"; const reason=(r+(ta.value.trim()?": "+ta.value.trim():"")).slice(0,500);
      const {error}=await sb.from("reports").insert({vacancy_id:v.id,reason});
      send.disabled=false; if(error){err.textContent="Не получилось отправить. Попробуй позже.";err.hidden=false;return}
      close(); toast("Спасибо! Жалоба у модератора.") });
  }

  /** Ссылка подписки в бот на конкретный город (Telegram принимает только латиницу, поэтому город кодируем). */
  function botLink(bot, city){
    const u=String(bot||"").replace(/^@/,"").trim(); if(!u) return null;
    if(!city) return "https://t.me/"+u;
    const b=btoa(unescape(encodeURIComponent(city.trim().slice(0,30)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    return "https://t.me/"+u+"?start=c_"+b;
  }

  function ageWord(n){ return "с "+n+" лет" }
  function expiryText(d){ if(!d) return ""; const t=new Date(d+"T23:59:59"); const days=Math.ceil((t-Date.now())/864e5); return days<=0?"последний день":days<=7?"ещё "+days+" дн.":"до "+t.toLocaleDateString("ru-RU",{day:"numeric",month:"long"}) }

  window.NR = {sb, el, toast, today, settings, contactLink, respondButton, reportDialog, botLink, copy, ageWord, expiryText};
})();
