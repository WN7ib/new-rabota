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
      const args={vid:v.id,p_name:name.value.trim(),p_age:a||null,p_contact:contact.value.trim(),p_message:msg.value.trim()};
      let {data:vcode,error}=await sb.rpc("apply_v",args);
      if(error&&/function|schema/.test(error.message||"")){vcode=null;({error}=await sb.rpc("apply",args))}   // база ещё без шага 19
      send.disabled=false;
      if(error){err.textContent=/closed/.test(error.message)?"Вакансия уже закрыта.":/function|schema/.test(error.message)?"Анкеты скоро заработают. Пока откликнись по контакту.":"Не получилось отправить. Попробуй позже.";err.hidden=false;return}
      try{pr.name=name.value.trim();if(a)pr.age=a;pr.contact=contact.value.trim();localStorage.setItem("nr-profile",JSON.stringify(pr))}catch(_){}
      try{const h=JSON.parse(localStorage.getItem("nr-applied")||"[]").filter(x=>x.id!==v.id);h.unshift({id:v.id,t:v.title,c:v.city||(v.remote?"удалённо":""),at:Date.now(),form:1});localStorage.setItem("nr-applied",JSON.stringify(h.slice(0,50)))}catch(_){}
      close(); toast("Анкета отправлена! Работодатель свяжется с тобой.");
      // переписка с работодателем в приложении (шаг 26): ключ только у тебя в телефоне
      if(vcode)try{const {data:tok}=await sb.rpc("app_chat_start",{p_vcode:vcode});if(tok){const c=JSON.parse(localStorage.getItem("nr-chats")||"[]");c.unshift({tok,t:v.title,co:v.company||"",at:Date.now()});localStorage.setItem("nr-chats",JSON.stringify(c.slice(0,50)));setTimeout(()=>toast("💬 Переписка с работодателем — в «Сообщениях»"),3200)}}catch(_){}
      if(vcode)settings().then(s=>{if(s.video_card)videoOffer(s.bot_username,vcode,v.title)}) });
  }
  /** После анкеты: по желанию кружок-визитка через бота — бот перешлёт его работодателю в Telegram. */
  function videoOffer(bot,code,title){
    bot=String(bot||"").replace(/^@/,"").trim(); if(!/^[A-Za-z0-9_]{4,40}$/.test(bot)||!/^[a-f0-9]{8,32}$/.test(String(code)))return;
    const sh=el("div","sheet"); const f=el("div","form");
    f.append(el("h2",null,"📹 Добавить кружок-визитку?"),
      el("p","hint full","Запиши в Telegram кружок до минуты: как зовут, сколько лет, почему хочешь на «"+(title||"эту работу")+"». Бот перешлёт его только работодателю этой вакансии — так тебя запомнят быстрее. Это по желанию."));
    const row=el("div","row"); const no=el("button","btn btn-ghost","Не надо"); no.type="button";
    const go=el("a","btn btn-primary","Записать в боте"); go.href="https://t.me/"+bot+"?start=vv_"+code; go.target="_blank"; go.rel="noopener"; go.style.textDecoration="none";
    row.append(no,go); f.append(row); sh.append(f); document.body.append(sh);
    const close=()=>sh.remove(); no.onclick=close; go.addEventListener("click",()=>setTimeout(close,300)); sh.addEventListener("click",e=>{if(e.target===sh)close()});
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
    const u=String(bot||"New_Net_rabota_bot").replace(/^@/,"").trim(); if(!u) return null;
    if(!city) return "https://t.me/"+u;
    const b=btoa(unescape(encodeURIComponent(city.trim().slice(0,30)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    return "https://t.me/"+u+"?start=c_"+b;
  }

  function ageWord(n){ return "с "+n+" лет" }
  // шаг 31: «🔥 Срочно» действует до urgent_until; надбавка — bonus ₽
  function isUrgent(v){ return !!(v&&v.urgent_until&&new Date(v.urgent_until)>new Date()) }
  function urgentText(v){ return isUrgent(v)?"🔥 Срочно"+(v.bonus?" · +"+Number(v.bonus).toLocaleString("ru-RU")+" ₽ сверху":""):"" }
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

  // ── согласие на обработку персональных данных (152-ФЗ, с 01.09.2025 — отдельным документом): перед первой отправкой
  // формы с именем или контактом показываю окно с галочкой и ссылкой на текст согласия. Формы кода не меняются.
  const PD_VER="pd-2026-11-25";
  let pdMem=false;   // если хранилище браузера закрыто — согласие помню до перезагрузки страницы
  const pdOk=()=>{if(pdMem)return true;try{return localStorage.getItem("nr-pd")===PD_VER}catch(_){return false}};
  const PD_RX=/контакт|телефон|telegram|телеграм|почт|e-?mail|имя|как к тебе|фио|name|contact|phone/i;
  const pdForm=f=>{if(!f||f.dataset.nopd!=null||/^(login|newpass|searchForm|askForm)$/.test(f.id||"")||/admin\.html/.test(location.pathname))return false;
    return [...f.querySelectorAll("input,textarea")].some(i=>i.type!=="hidden"&&i.type!=="checkbox"&&i.name!=="website"&&PD_RX.test([i.name,i.id,i.placeholder,i.getAttribute("aria-label")].join(" ")))};
  function pdDialog(onYes){
    const sh=el("div","sheet"); const f=el("form","form"); f.dataset.nopd="";
    f.append(el("h2",null,"Согласие на обработку данных"),el("p","hint full","Чтобы отправить форму, нужно твоё согласие на обработку указанных в ней данных (имя, контакт и т.п.). Они нужны только для этой цели: передать отклик, опубликовать вакансию или ответить тебе."));
    const lab=el("label","full"); lab.style.cssText="display:flex;gap:10px;align-items:flex-start;margin:6px 0";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.style.cssText="margin-top:4px;width:20px;height:20px;flex:none";
    const t=el("span"); t.innerHTML='Согласен(на) на обработку персональных данных по <a href="soglasie.html" target="_blank">тексту согласия</a> и <a href="privacy.html" target="_blank">политике</a>. Если мне нет 18 — с ведома родителей.';
    lab.append(cb,t); f.append(lab);
    const err=el("p","err","Поставь галочку — без согласия отправить нельзя."); err.hidden=true; f.append(err);
    const row=el("div","row"); const no=el("button","btn btn-ghost","Отмена"); no.type="button"; const yes=el("button","btn btn-primary","Согласен(на), отправить"); yes.type="submit"; row.append(no,yes); f.append(row);
    sh.append(f); document.body.append(sh);
    no.onclick=()=>sh.remove();
    f.addEventListener("submit",e=>{e.preventDefault(); if(!cb.checked){err.hidden=false;return}
      pdMem=true; try{localStorage.setItem("nr-pd",PD_VER);localStorage.setItem("nr-pd-at",new Date().toISOString())}catch(_){}
      sh.remove(); onYes()});
  }
  document.addEventListener("submit",e=>{const f=e.target; if(pdOk()||!pdForm(f))return;
    e.preventDefault(); e.stopImmediatePropagation();
    pdDialog(()=>{ try{f.requestSubmit()}catch(_){f.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))} });
  },true);

  window.NR = {sb, el, toast, today, settings, contactLink, respondButton, applyButton, reportDialog, botLink, copy, ageWord, expiryText, isUrgent, urgentText, syncKey, syncPush, syncPull, syncBundle, pdOk};
})();
