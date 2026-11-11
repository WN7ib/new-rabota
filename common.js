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
  function copy(t){ try{ navigator.clipboard.writeText(t).then(()=>toast(t.length>60?"Скопировано":"Скопировано: "+t),()=>toast("Выдели контакт и скопируй вручную")) }catch(e){ toast("Выдели контакт и скопируй вручную") } }
  /** Кнопка «Откликнуться»: открывает контакт и считает отклик. */
  function respondButton(v){
    const c=contactLink(v.contact);
    const a=el(c.href?"a":"button","respond","✉ Откликнуться");
    if(c.href){ a.href=c.href; if(/^https/.test(c.href)){a.target="_blank";a.rel="noopener"} } else a.type="button";
    a.title=c.label;
    a.addEventListener("click",()=>{ if(sb&&v.id) sb.rpc("vacancy_click",{vid:v.id}).then(()=>{},()=>{}); if(c.copy) copy(c.copy);
      // история откликов — для профиля (только в этом браузере)
      try{const h=JSON.parse(localStorage.getItem("nr-applied")||"[]").filter(x=>x.id!==v.id);h.unshift({id:v.id,t:v.title,c:v.city||(v.remote?"удалённо":""),at:Date.now()});localStorage.setItem("nr-applied",JSON.stringify(h.slice(0,50)))}catch(_){} });
    return a;
  }

  /** Анкета-отклик: уходит работодателю в кабинет и в Telegram (если у вакансии есть кабинет). */
  function applyButton(v){
    const b=el("button","btn btn-ghost btn-sm","📝 Отправить анкету"); b.type="button";
    b.addEventListener("click",()=>applyDialog(v)); return b;
  }
  function applyDialog(v){
    if(!sb){toast("Сайт не подключён к базе");return}
    let pr={}; try{pr=JSON.parse(localStorage.getItem("nr-profile")||"{}")||{}}catch(_){}
    const sh=el("div","sheet"); const f=el("form","form"); f.noValidate=true;
    f.append(el("h2",null,"Анкета на «"+(v.title||"")+"»"),el("p","hint full","Работодатель увидит её в кабинете и получит уведомление. Ответит по твоему контакту."));
    const fld=(lab,node,full)=>{const d=el("div","field"+(full?" full":""));d.append(el("label",null,lab),node);f.append(d);return node};
    const inp=(val,max,ph)=>{const i=document.createElement("input");i.type="text";i.maxLength=max;i.value=val||"";if(ph)i.placeholder=ph;return i};
    const name=fld("Имя",inp(pr.name,60,"Как к тебе обращаться")),age=fld("Возраст",inp(pr.age,2,"16"));age.inputMode="numeric";
    const contact=fld("Контакт",inp(pr.contact||pr.tg,120,"@telegram или телефон"),true);
    const msg=document.createElement("textarea");msg.maxLength=600;msg.placeholder="Пара слов о себе: когда можешь работать, опыт";msg.value=pr.about||"";fld("О себе",msg,true);
    const err=el("p","err"); err.hidden=true; f.append(err);
    const row=el("div","row"); const cancel=el("button","btn btn-ghost","Отмена"); cancel.type="button"; const send=el("button","btn btn-primary","Отправить анкету"); send.type="submit"; row.append(cancel,send); f.append(row);
    sh.append(f); document.body.append(sh);
    const close=()=>sh.remove(); cancel.onclick=close; sh.addEventListener("click",e=>{if(e.target===sh)close()});
    f.addEventListener("submit",async e=>{ e.preventDefault();
      const a=parseInt(age.value,10);
      if(name.value.trim().length<2||contact.value.trim().length<3){err.textContent="Укажи имя и контакт.";err.hidden=false;return}
      if(a&&a<(v.age_min||14)){err.textContent="На эту вакансию берут "+ageWord(v.age_min||14)+".";err.hidden=false;return}
      send.disabled=true;
      const {error}=await sb.rpc("apply",{vid:v.id,p_name:name.value.trim(),p_age:a||null,p_contact:contact.value.trim(),p_message:msg.value.trim()});
      send.disabled=false;
      if(error){err.textContent=/closed/.test(error.message)?"Вакансия уже закрыта.":/function|schema/.test(error.message)?"Анкеты скоро заработают. Пока откликнись по контакту.":"Не получилось отправить. Попробуй позже.";err.hidden=false;return}
      try{pr.name=name.value.trim();if(a)pr.age=a;pr.contact=contact.value.trim();localStorage.setItem("nr-profile",JSON.stringify(pr))}catch(_){}
      try{const h=JSON.parse(localStorage.getItem("nr-applied")||"[]").filter(x=>x.id!==v.id);h.unshift({id:v.id,t:v.title,c:v.city||(v.remote?"удалённо":""),at:Date.now(),form:1});localStorage.setItem("nr-applied",JSON.stringify(h.slice(0,50)))}catch(_){}
      close(); toast("Анкета отправлена! Работодатель свяжется с тобой.") });
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

  // ── синхронизация профиля между устройствами (по секретной ссылке, без регистрации)
  const SYNC_KEYS=["nr-profile","nr-favs","nr-applied","nr-events","nr-resume","nr-my","nr-mode","nr-voice","nr-anim","nr-city"];
  const syncKey=()=>{try{return localStorage.getItem("nr-sync-key")||""}catch(_){return ""}};
  function syncBundle(){const b={};SYNC_KEYS.forEach(k=>{try{const v=localStorage.getItem(k);if(v!=null)b[k]=v}catch(_){}});return b}
  function syncApply(b){Object.keys(b||{}).forEach(k=>{if(SYNC_KEYS.includes(k))try{localStorage.setItem(k,b[k])}catch(_){}})}
  async function syncPush(){const k=syncKey();if(!sb||!k)return null;const {data,error}=await sb.rpc("profile_save",{k,p:syncBundle()});if(error)return null;try{localStorage.setItem("nr-sync-at",data)}catch(_){}return data}
  async function syncPull(force){const k=syncKey();if(!sb||!k)return false;const {data,error}=await sb.rpc("profile_load",{k});const r=!error&&data&&data[0];if(!r)return false;
    let local="";try{local=localStorage.getItem("nr-sync-at")||""}catch(_){}
    if(force||!local||new Date(r.updated_at)>new Date(local)){syncApply(r.data);try{localStorage.setItem("nr-sync-at",r.updated_at)}catch(_){}return true}return false}
  // уходя со страницы — отправить изменения (избранное, отклики и т.д.)
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&syncKey())syncPush()});

  window.NR = {sb, el, toast, today, settings, contactLink, respondButton, applyButton, reportDialog, botLink, copy, ageWord, expiryText, syncKey, syncPush, syncPull, syncBundle};
})();
