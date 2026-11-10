(function(){
  const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
  const {sb, el, toast, today} = window.NR;
  const list=$("#list"), statusEl=$("#status");
  const PROJ=["Стажировка","Проект","Волонтёрство"];
  const state={settings:{},items:[],q:"",city:"",remote:false,age:0,type:"",fav:false,favs:new Set(),open:new Set(),ready:false};
  const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  state.favs=new Set(ls.get("nr-favs",[]));
  const saveFavs=()=>ls.set("nr-favs",[...state.favs]);
  const norm=s=>(s||"").toString().toLowerCase().replace(/ё/g,"е").trim();
  function ago(ts){if(!ts)return"";const t=new Date(ts).getTime();const d=Math.floor((Date.now()-t)/86400000);return d<=0?"сегодня":d===1?"вчера":d<5?d+" дня назад":d<21?d+" дней назад":new Date(t).toLocaleDateString("ru-RU")}
  const vacUrl=v=>"vacancy.html?id="+encodeURIComponent(v.id);

  // ═════════ фильтры ═════════
  function filtered(){
    const q=norm(state.q), c=norm(state.city);
    const days=+state.settings.hide_after_days||0, edge=days?Date.now()-days*864e5:0;
    return state.items.filter(v=>{
      if(edge&&!v.pinned&&!v.expires_at&&new Date(v.created_at).getTime()<edge)return false;
      if(state.fav&&!state.favs.has(v.id))return false;
      if(state.type==="__proj"){if(!PROJ.includes(v.type))return false}
      else if(state.type&&v.type!==state.type)return false;
      if(state.age&&(+v.age_min||14)>state.age)return false;
      if(state.remote&&!v.remote)return false;
      if(c&&!v.remote&&!norm(v.city).includes(c))return false;
      if(q){const hay=norm([v.title,v.company,v.description,v.city,v.type].join(" "));if(!q.split(/\s+/).every(w=>hay.includes(w)))return false}
      return true;
    }).sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0));
  }

  // ═════════ карточки ═════════
  function card(v){
    const c=el("article","card"+(state.open.has(v.id)?" open":""));
    const left=el("div");left.style.minWidth="0";
    const h=el("h3");const a=el("a",null,v.title||"Без названия");a.href=vacUrl(v);a.style.color="inherit";a.style.textDecoration="none";h.append(a);
    left.append(h,el("div","where",[v.company,v.remote&&!v.city?"Удалённо":v.city].filter(Boolean).join(" · ")));
    c.append(left,el("div","pay",v.pay||"по договорённости"));
    const tags=el("div","tags");
    if(v.pinned)tags.append(el("span","t t-pin","📌 закреплена"));
    if(v.verified)tags.append(el("span","t t-ok","✓ работодатель проверен"));
    tags.append(el("span","t t-age","с "+(v.age_min||14)+" лет"),el("span","t",v.type||"Подработка"));
    if(v.remote)tags.append(el("span","t t-remote","удалённо"));
    if(v.expires_at)tags.append(el("span","date t-exp",NR.expiryText(v.expires_at)));
    tags.append(el("span","date",ago(v.created_at)));
    c.append(tags);
    if(v.description)c.append(el("p","desc",v.description));
    const ct=el("div","contact");ct.append(el("span","lbl","Отклик"),el("code",null,v.contact||"не указан"));c.append(ct);
    const act=el("div","actions");
    act.append(NR.respondButton(v));
    const more=el("button","link",state.open.has(v.id)?"Свернуть":"Подробнее");more.type="button";
    more.onclick=()=>{state.open.has(v.id)?state.open.delete(v.id):state.open.add(v.id);render()};
    const f=el("button","fav",state.favs.has(v.id)?"★ В избранном":"☆ В избранное");f.type="button";f.setAttribute("aria-pressed",state.favs.has(v.id));
    f.onclick=()=>{state.favs.has(v.id)?state.favs.delete(v.id):state.favs.add(v.id);saveFavs();render()};
    const rep=el("button","subtle","Пожаловаться");rep.type="button";rep.style.marginLeft="auto";rep.onclick=()=>NR.reportDialog(v);
    act.append(more,f,rep);c.append(act);
    return c;
  }
  function render(){
    const items=filtered(); list.textContent="";
    if(!state.ready)return;
    if(!items.length){
      const box=el("div","empty");
      if(!state.items.length){
        box.append(el("h3",null,"Вакансий пока нет"),el("p",null,"Здесь появятся предложения от работодателей. Знаешь кафе, магазин или проект, которому нужны люди? Размести первую вакансию, это займёт минуту."));
        if(state.settings.submissions_open!==false){const b=el("button","btn btn-primary","＋ Разместить вакансию");b.type="button";b.onclick=openForm;box.append(b)}
      }else{
        box.append(el("h3",null,"Ничего не нашлось"),el("p",null,"Попробуй убрать часть фильтров или поискать в другом городе."));
        const b=el("button","btn btn-ghost","Сбросить фильтры");b.type="button";b.onclick=resetFilters;box.append(b);
      }
      list.append(box);
    } else items.forEach(v=>list.append(card(v)));
    updateSub();
  }
  function countText(){const n=filtered().length;const m=n%10,h=n%100;return n+" "+(m===1&&h!==11?"вакансия":m>=2&&m<=4&&(h<12||h>14)?"вакансии":"вакансий")}
  function refreshMeta(msg){statusEl.textContent=msg||(state.ready?countText():"Загружаю вакансии…")}
  function updateSub(){
    const link=NR.botLink(state.settings.bot_username,state.city);
    $("#subCta").hidden=!link; if(!link)return;
    $("#subLink").href=link;
    $("#subText").textContent=state.city.trim()?"🔔 Новые вакансии в «"+state.city.trim()+"» — бот пришлёт в Telegram":"🔔 Новые вакансии в Telegram — бот пришлёт сам";
  }

  function setAge(a){state.age=a;$$("#ageGroup .chip").forEach(x=>x.setAttribute("aria-pressed",+x.dataset.age===a))}
  function resetFilters(){
    state.q=state.city="";state.remote=false;state.type="";state.fav=false;setAge(0);
    $("#q").value="";$("#city").value="";$("#remote").checked=false;
    $$("#typeGroup .chip").forEach(b=>b.setAttribute("aria-pressed",b.dataset.type===""&&!b.dataset.fav));
    render();refreshMeta();
  }
  $("#searchForm").addEventListener("submit",e=>e.preventDefault());
  $("#q").addEventListener("input",e=>{state.q=e.target.value;render();refreshMeta()});
  $("#city").addEventListener("input",e=>{state.city=e.target.value;ls.set("nr-city",e.target.value);render();refreshMeta()});
  $("#remote").addEventListener("change",e=>{state.remote=e.target.checked;render();refreshMeta()});
  $$("#ageGroup .chip").forEach(b=>b.onclick=()=>{setAge(+b.dataset.age);render();refreshMeta()});
  $$("#typeGroup .chip").forEach(b=>b.onclick=()=>{
    if(b.dataset.fav){state.fav=!state.fav;b.setAttribute("aria-pressed",state.fav)}
    else{state.type=b.dataset.type;$$("#typeGroup .chip:not([data-fav])").forEach(x=>x.setAttribute("aria-pressed",x===b))}
    render();refreshMeta()});
  {const c=ls.get("nr-city","");if(c){$("#city").value=c;state.city=c}}
  {const q=new URLSearchParams(location.search);const qc=q.get("city");if(qc){$("#city").value=qc;state.city=qc;ls.set("nr-chosen",1)}if(q.get("remote")==="1"){state.remote=true;$("#remote").checked=true;ls.set("nr-chosen",1)}}

  // ═════════ форма вакансии ═════════
  const sheet=$("#sheet"),err=$("#formErr");
  function openForm(){ if(!sb){toast("Сайт ещё не подключён к базе");return} err.hidden=true;sheet.hidden=false;$("#f-title").focus() }
  function closeForm(){sheet.hidden=true}
  $("#openForm").onclick=openForm;$("#cancelForm").onclick=closeForm;
  sheet.addEventListener("click",e=>{if(e.target===sheet)closeForm()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!sheet.hidden)closeForm()});
  $("#vacForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if($("#f-website").value)return;
    if(Date.now()-ls.get("nr-last",0)<60000){err.textContent="Подожди минуту перед следующей вакансией.";err.hidden=false;return}
    const v=id=>$(id).value.trim();
    const exp=new Date(Date.now()+(+$("#f-exp").value)*864e5);
    const data={title:v("#f-title"),company:v("#f-company")||null,city:v("#f-city")||null,type:$("#f-type").value,age_min:+$("#f-age").value,pay:v("#f-pay")||null,remote:$("#f-remote").checked,description:v("#f-desc")||null,contact:v("#f-contact"),status:"pending",expires_at:exp.toISOString().slice(0,10)};
    const miss=[];if(data.title.length<2)miss.push("должность");if(!data.city&&!data.remote)miss.push("город или «удалённо»");if(data.contact.length<3)miss.push("контакт для отклика");
    if(miss.length){err.textContent="Заполни: "+miss.join(", ")+".";err.hidden=false;return}
    const btn=$("#submitForm");btn.disabled=true;btn.textContent="Отправляю…";
    // сначала через submit_vacancy: она возвращает личную ссылку управления (кабинет без регистрации)
    let mine=null,error=null;
    {const r=await sb.rpc("submit_vacancy",{p:data});
     if(!r.error&&r.data&&r.data[0])mine=r.data[0];
     else if(r.error&&/function|schema cache|PGRST202|404/i.test((r.error.message||"")+(r.error.code||""))){
       ({error}=await sb.from("vacancies").insert(data));
       if(error&&/expires_at|column/i.test(error.message||"")){delete data.expires_at;if(!["Проект","Волонтёрство"].includes(data.type)) ({error}=await sb.from("vacancies").insert(data))}
     } else error=r.error}
    btn.disabled=false;btn.textContent="Отправить на проверку";
    if(error){err.textContent=state.settings.submissions_open===false||/closed/.test(error.message||"")?"Приём вакансий сейчас закрыт.":/too many/.test(error.message||"")?"Слишком много заявок сразу. Попробуй через 10 минут.":"Не получилось отправить. Проверь интернет и попробуй ещё раз.";err.hidden=false;return}
    ls.set("nr-last",Date.now());
    closeForm();$("#vacForm").reset();
    if(mine){
      const my=ls.get("nr-my",[]);my.unshift({id:mine.id,k:mine.manage_key,t:data.title,at:Date.now()});ls.set("nr-my",my.slice(0,30));
      manageDialog(mine.id,mine.manage_key,data.title);
    } else toast("Отправлено. Вакансия появится после проверки");
  });

  function manageDialog(id,key,title){
    const url=new URL("cabinet.html#v="+id+"."+key,location.href).href;
    const sh=el("div","sheet"),f=el("div","form");
    f.append(el("h2",null,"Вакансия отправлена ✅"),el("p","hint full","«"+title+"» появится на сайте после проверки модератором — обычно в течение дня."),
      el("p","full","Это твоя личная ссылка для управления вакансией: посмотреть статус и отклики, продлить, исправить или закрыть. Сохрани её — она работает без регистрации, и восстановить её нельзя."));
    const box=el("div","field full");const inp=document.createElement("input");inp.readOnly=true;inp.value=url;inp.onclick=()=>inp.select();box.append(inp);f.append(box);
    const row=el("div","row");const cp=el("button","btn btn-primary","Скопировать ссылку");cp.type="button";cp.onclick=()=>NR.copy(url);
    const go=el("a","btn btn-ghost","Открыть кабинет");go.href=url;go.style.textDecoration="none";
    const ok=el("button","btn btn-ghost","Готово");ok.type="button";ok.onclick=()=>sh.remove();row.append(cp,go,ok);f.append(row);
    sh.append(f);document.body.append(sh);sh.addEventListener("click",e=>{if(e.target===sh)sh.remove()});
  }

  // ═════════ загрузка ═════════
  function applySettings(s){
    state.settings=s||{};
    if(s.tagline)$("#tagline").textContent=s.tagline;
    const bn=$("#banner");if(s.banner_on&&s.banner){bn.textContent=s.banner;bn.hidden=false}else bn.hidden=true;
    if(s.submissions_open===false)$("#openForm").hidden=true;
  }
  async function load(){
    if(!sb){state.ready=true;render();refreshMeta("Сайт ещё не подключён к базе");return}
    NR.settings().then(s=>{applySettings(s);render();refreshMeta()});
    const timer=setTimeout(()=>{if(!state.ready)refreshMeta("Не удаётся загрузить вакансии. Проверь интернет.")},10000);
    const base="id,created_at,title,company,city,type,age_min,pay,remote,description,contact";
    let {data,error}=await sb.from("vacancies").select(base+",pinned,verified,expires_at").eq("status","approved").or("expires_at.is.null,expires_at.gte."+today()).order("created_at",{ascending:false}).limit(500);
    if(error)({data,error}=await sb.from("vacancies").select(base).eq("status","approved").order("created_at",{ascending:false}).limit(500));
    clearTimeout(timer);state.ready=true;
    if(error){render();refreshMeta("Вакансии сейчас недоступны");return}
    state.items=data||[];render();refreshMeta();
  }

  // ═════════ режимы: официальный / с Newi ═════════
  let panelOpen=false;
  function setMode(m,open){
    const on=m==="newi"; ls.set("nr-mode",m);
    $("#modeNewi").setAttribute("aria-pressed",on);$("#modeOff").setAttribute("aria-pressed",!on);
    $("#drone").hidden=!on;
    if(!on)openPanel(false); else if(open)openPanel(true);
  }
  function openPanel(o){
    panelOpen=o;$("#newiWrap").hidden=!o;$("#drone").setAttribute("aria-expanded",o);
    if(o){Mascot.flash("alert",900);Mascot.wake();showView("chat");$("#droneBadge").hidden=true;renderChat();resumeWaiting();if(ls.get("nr-voice","")==="")$("#voicePick").hidden=false;else $("#voicePick").hidden=true}
    else stopSpeak();
  }
  $("#modeOff").onclick=()=>setMode("off");$("#modeNewi").onclick=()=>setMode("newi",true);
  $("#drone").onclick=()=>openPanel(!panelOpen);$("#newiClose").onclick=()=>openPanel(false);
  // стартовый выбор режима
  $("#gOff").onclick=()=>{ls.set("nr-chosen",1);$("#gate").hidden=true;setMode("off")};
  $("#gNewi").onclick=()=>{ls.set("nr-chosen",1);$("#gate").hidden=true;setMode("newi",true)};

  // ═════════ озвучка ═════════
  const synth=window.speechSynthesis;
  function voiceOn(){return ls.get("nr-voice","")==="on"}
  function paintVoice(){const b=$("#voiceBtn");b.textContent=voiceOn()?"🔊":"🔇";b.setAttribute("aria-pressed",voiceOn());if(!synth)b.hidden=true}
  function setVoice(v){ls.set("nr-voice",v?"on":"off");paintVoice();$("#voicePick").hidden=true;if(!v)stopSpeak();else speak("Отлично, буду говорить вслух.")}
  function stopSpeak(){try{synth&&synth.cancel()}catch(_){}if(Mascot.face==="speak")Mascot.set("happy")}
  let pendingFace=null;
  function speak(t){
    const txt=String(t).replace(/[•\n]+/g," ").slice(0,600);
    const after=()=>{const f=pendingFace;pendingFace=null;if(f)Mascot.flash(f,3500);else Mascot.set("happy")};
    if(!synth||!voiceOn()){const d=Math.min(4000,txt.length*35);Mascot.set("speak");clearTimeout(speak.t);speak.t=setTimeout(after,d);return}
    try{synth.cancel();const u=new SpeechSynthesisUtterance(txt);u.lang="ru-RU";
      const v=synth.getVoices().find(x=>/^ru/i.test(x.lang));if(v)u.voice=v;u.rate=+ls.get("nr-rate",1)||1;
      u.onstart=()=>Mascot.set("speak");u.onend=u.onerror=after;synth.speak(u)}catch(_){}
  }
  $("#voiceBtn").onclick=()=>setVoice(!voiceOn());
  $("#vOn").onclick=()=>setVoice(true);$("#vOff").onclick=()=>setVoice(false);
  paintVoice();
  // голосовой ввод
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SR){const mb=$("#micBtn");mb.hidden=false;let rec=null;
    mb.onclick=()=>{ if(rec){rec.stop();return}
      rec=new SR();rec.lang="ru-RU";rec.interimResults=false;mb.classList.add("rec");
      rec.onresult=e=>{const t=e.results[0][0].transcript;if(t)userSays(t)};
      rec.onend=()=>{rec=null;mb.classList.remove("rec")};rec.onerror=()=>{};
      try{rec.start()}catch(_){rec=null;mb.classList.remove("rec")} } }

  // ═════════ профиль и настройки ═════════
  const prof=()=>ls.get("nr-profile",{});
  function showView(v){$("#viewChat").hidden=v!=="chat";$("#viewProf").hidden=v!=="prof";$("#newiSub").textContent=v==="prof"?"профиль и настройки":"помощница New.работа"}
  function applyPrefs(){
    document.body.classList.toggle("noanim",ls.get("nr-anim",true)===false);
    const w=$("#newiWrap");w.classList.remove("ts-s","ts-l");const s=ls.get("nr-size","m");if(s==="s")w.classList.add("ts-s");if(s==="l")w.classList.add("ts-l");
  }
  function fillProf(){const p=prof();$("#pName").value=p.name||"";$("#pAge").value=p.age||"";$("#pCity").value=p.city||"";
    $("#sVoice").checked=voiceOn();$("#sRate").value=ls.get("nr-rate",1);$("#sAnim").checked=ls.get("nr-anim",true)!==false;$("#sSize").value=ls.get("nr-size","m");$("#sVoice").disabled=!synth}
  $("#profBtn").onclick=()=>{if($("#viewProf").hidden){fillProf();showView("prof")}else showView("chat")};
  $("#sSave").onclick=()=>{
    const age=parseInt($("#pAge").value,10),p={name:$("#pName").value.trim().slice(0,30),age:age>=13&&age<=30?age:0,city:$("#pCity").value.trim().slice(0,40)};
    ls.set("nr-profile",Object.assign({},prof(),p));ls.set("nr-voice",$("#sVoice").checked?"on":"off");ls.set("nr-rate",+$("#sRate").value);ls.set("nr-anim",$("#sAnim").checked);ls.set("nr-size",$("#sSize").value);
    paintVoice();applyPrefs();$("#voicePick").hidden=true;
    if(p.age>=14){setAge(p.age>=18?18:p.age>=16?16:14)}
    if(p.city&&!/^удал/i.test(p.city)){state.city=p.city;$("#city").value=p.city;ls.set("nr-city",p.city)}
    render();refreshMeta();showView("chat");renderChat();Mascot.flash("happy",800);
    say(p.name?"Сохранила, "+p.name+"! Список вакансий подстроила под твой профиль.":"Настройки сохранены.");
  };
  $("#sTest").onclick=()=>{ls.set("nr-rate",+$("#sRate").value);const was=voiceOn();ls.set("nr-voice","on");speak("Привет! Так я буду говорить.");if(!was)ls.set("nr-voice","off")};
  $("#sOffMode").onclick=()=>{setMode("off")};
  $("#sClear").onclick=()=>{msgs=[];saveMsgs();flow=null;showView("chat");renderChat()};
  $("#sForget").onclick=()=>{["nr-profile","nr-chat","nr-voice","nr-rate","nr-anim","nr-size","nr-chosen","nr-mode","nr-city"].forEach(k=>{try{localStorage.removeItem(k)}catch(_){}});location.reload()};
  Mascot.mount();Mascot.wake();applyPrefs();

  // ═════════ Newi на сайте ═════════
  const chatEl=$("#chat");
  let session=ls.get("nr-sess","");
  if(!session){session=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");ls.set("nr-sess",session)}
  let msgs=ls.get("nr-chat",[]); let flow=null;
  const saveMsgs=()=>{msgs=msgs.slice(-60);ls.set("nr-chat",msgs)};
  function push(m){msgs.push(m);saveMsgs();renderChat();if(m.who==="nw"&&!m.wait){speak(m.text);notify()}}
  function notify(){if(!panelOpen&&!$("#drone").hidden){const b=$("#droneBadge");b.hidden=false}}
  function renderChat(){
    chatEl.textContent="";
    const all=msgs.length?msgs:[{who:"nw",text:"Привет"+(prof().name?", "+prof().name:"")+"! Я Newi, помощница New.работа. Подберу работу, расскажу о правах и помогу не попасть на обман. Нажми кнопку или спроси своими словами."}];
    for(const m of all){
      const d=el("div","msg "+(m.who==="me"?"me":"nw")+(m.wait?" wait":""),m.text);
      (m.links||[]).forEach(l=>{const a=el("a","mini");a.href=l.href;a.append(el("b",null,l.title));if(l.sub)a.append(el("span",null,l.sub));d.append(a)});
      chatEl.append(d);
    }
    chatEl.scrollTop=chatEl.scrollHeight;
  }
  const say=(text,links,face)=>{if(face!==undefined||!pendingFace)pendingFace=face||null;push({who:"nw",text,links})};

  const RIGHTS="По Трудовому кодексу работать можно с 14 лет — лёгкий труд в свободное от учёбы время.\n• 14–15 лет: нужно согласие родителя и органа опеки; до 24 ч в неделю, во время учёбы — до 12 ч.\n• 16–17 лет: можно без согласия; до 35 ч в неделю, во время учёбы — до 17,5 ч.\n• До 18 нельзя: ночью, сверхурочно, в выходные, на вредной работе, с алкоголем и табаком.\n• Перед работой — бесплатный медосмотр, испытательный срок не ставят, отпуск 31 день.";
  const SCAM="Как не попасть на обман:\n• Не плати за обучение, форму или «бронь» вакансии.\n• Не отдавай паспорт и банковскую карту.\n• Не оформляй карты «на себя» и не переводи чужие деньги — это дропперство, уголовная статья.\n• «Курьер документов», «закладки», «лёгкие деньги за час» — почти всегда преступление.\nСомневаешься в вакансии — нажми «Пожаловаться» под ней, модератор проверит.";
  const RESUME="Резюме для первой работы — на полстраницы:\n1. Имя, возраст, город, контакт.\n2. Чего хочешь: «подработка по выходным, курьер или бариста».\n3. Учёба: школа, класс.\n4. Опыт: волонтёрство, помощь на мероприятиях, кружки, олимпиады — всё считается.\n5. Навыки: общительность, ответственность, компьютер, языки.\nПодробнее с примером — в гиде.";

  // ── тренажёр собеседования: вопросы и что в ответе хорошо
  const IVQ=[
    ["Расскажи немного о себе.","Хорошо: 3–4 предложения — учёба, чем увлекаешься, почему ищешь работу. Без биографии с детского сада."],
    ["Почему хочешь работать именно у нас?","Хорошо: покажи, что знаешь, куда пришёл, — что делает компания и что тебе в этом интересно."],
    ["Какой у тебя опыт? Даже если не работал(а) раньше.","Хорошо: волонтёрство, школьные мероприятия, кружки, помощь родственникам — это тоже опыт. Дай конкретный пример."],
    ["Сколько часов в неделю сможешь работать и когда?","Хорошо: точный график. До 16 лет — до 24 ч в неделю, в учебное время вдвое меньше."],
    ["Как поступишь, если клиент недоволен и грубит?","Хорошо: сохраню спокойствие, выслушаю, извинюсь за неудобство, позову старшего, если не могу решить сам(а)."],
    ["Какие у тебя есть вопросы к нам?","Хорошо: спроси про обучение, график, оплату и когда её выдают, нужен ли договор. «Вопросов нет» — слабый ответ."]];
  function ivFeedback(q,a){
    const t=norm(a),tips=[];let pts=0;
    if(a.length>=60)pts++;else tips.push("Ответ коротковат — добавь подробностей или пример.");
    if(/например|когда|однажды|был|была|помогал|организ|волонт|участв|делал/.test(t))pts++;else if(q>0&&q<5)tips.push("Добавь конкретный пример из жизни.");
    if(/не знаю|без понятия|наверно|хз|пофиг/.test(t)){pts--;tips.push("Избегай «не знаю» и «наверное» — звучит неуверенно.");}
    if(q===5&&/нет|никаких/.test(t)&&a.length<20){pts--;tips.push("Лучше задать 1–2 вопроса: это показывает интерес.");}
    return {pts:Math.max(0,pts),tips};
  }

  function intent(t){
    t=norm(t);
    if(/собеседов|интервью|тренаж/.test(t))return "interview";
    if(/подбер|найди|ищу|хочу работ|вакансии|работу|подработк/.test(t))return "pick";
    if(/прав|закон|сколько час|трудов|согласи|с 14|с 15|с 16/.test(t))return "rights";
    if(/обман|мошен|дроп|развод|безопас/.test(t))return "scam";
    if(/резюме/.test(t))return "resume";
    return null;
  }
  function run(k){
    if(k==="interview"){flow={step:"iv",i:0,score:0};say("Давай потренируемся! Я задам "+IVQ.length+" вопросов, как на настоящем собеседовании. Отвечай так, как ответил бы работодателю. Напиши «стоп», чтобы закончить.\n\nВопрос 1: "+IVQ[0][0]);return}
    if(k==="rights")say(RIGHTS,[{href:"guide.html#law",title:"Гид: работа с 14 лет",sub:"документы, часы, что нельзя"}]);
    else if(k==="scam")say(SCAM);
    else if(k==="resume")say(RESUME,[{href:"resume.html",title:"📄 Собрать резюме за 2 минуты",sub:"конструктор с подсказками Newi"},{href:"guide.html#resume",title:"Гид: резюме и собеседование",sub:"пример и вопросы работодателю"}]);
    else if(k==="pick"){const p=prof();if(p.age>=14&&p.city){say("Беру из профиля: "+p.age+" лет, "+p.city+". Поменять можно в ⚙.");pickResult(p.age,p.city)}else{flow={step:"age"};say("Сколько тебе лет?")}}
  }
  function pickResult(age,city){
    setAge(age>=18?18:age>=16?16:14);
    if(city&&!/^удал/i.test(city)){state.city=city;$("#city").value=city;ls.set("nr-city",city)} else if(/^удал/i.test(city||"")){state.remote=true;$("#remote").checked=true}
    render();refreshMeta();
    const hit=filtered().slice(0,5);
    if(!hit.length){pendingFace="sad";say("Пока под тебя ничего нет"+(city?" в «"+city+"»":"")+". Новые вакансии появляются каждый день."+(state.settings.bot_username?" Подпишись на бота — он пришлёт, как только появится.":""),state.settings.bot_username?[{href:NR.botLink(state.settings.bot_username,city),title:"🔔 Подписаться в Telegram",sub:city||"все города"}]:[]);return}
    say("Вот что подходит"+(city?" в «"+city+"»":"")+". Я ещё отфильтровала список ниже.",hit.map(v=>({href:vacUrl(v),title:v.title,sub:[v.pay||"по договорённости",v.city||(v.remote?"удалённо":""),"с "+v.age_min+" лет"].filter(Boolean).join(" · ")})));
  }
  async function askServer(q){
    if(!sb||state.settings.chat_on===false){say("Сейчас я отвечаю только на готовые вопросы — кнопки ниже. Свободные вопросы скоро снова включат.");return}
    const {data,error}=await sb.rpc("chat_ask",{p_session:session,p_q:q});
    if(error){say(/too many/.test(error.message||"")?"Слишком много вопросов подряд. Подожди минутку.":"Не получилось отправить вопрос. Попробуй ещё раз.");return}
    push({who:"nw",text:"Newi думает…",wait:true,id:data,at:Date.now()});Mascot.set("think");
    poll();
  }
  let pollT=null;
  async function poll(){
    clearTimeout(pollT);
    const waiting=msgs.filter(m=>m.wait&&m.id); if(!waiting.length||!sb)return;
    const {data}=await sb.rpc("chat_get",{p_session:session});
    let changed=false;
    (data||[]).forEach(r=>{const m=msgs.find(x=>x.id===r.id);if(m&&m.wait&&r.a){m.text=r.a;m.wait=false;changed=true;speak(r.a);notify()}});
    const now=Date.now();
    msgs.forEach(m=>{if(m.wait&&now-m.at>90000&&!m.late){m.late=true;m.text="Newi сейчас не на связи с сайтом. Ответ появится здесь, когда она прочитает, — можно вернуться позже.";changed=true}});
    if(changed){saveMsgs();renderChat()}
    if(!msgs.some(m=>m.wait&&!m.late)&&Mascot.face==="think")Mascot.set("happy");
    if(msgs.some(m=>m.wait&&m.id))pollT=setTimeout(poll,msgs.some(m=>m.wait&&!m.late)?4000:20000);
  }
  function resumeWaiting(){if(msgs.some(m=>m.wait))poll()}

  function userSays(t){
    t=t.trim();if(!t)return;Mascot.wake();push({who:"me",text:t});
    if(flow&&flow.step==="iv"){
      if(/^(стоп|хватит|выход|закончить)/i.test(t)){flow=null;say("Хорошо, закончили. Возвращайся потренироваться перед настоящим собеседованием!");return}
      const i=flow.i,fb=ivFeedback(i,t);flow.score+=fb.pts;
      const good=fb.pts>=2;
      let msg=(good?"👍 Хороший ответ.":fb.pts===1?"Неплохо.":"Можно сильнее.")+(fb.tips.length?" "+fb.tips.join(" "):"")+"\n💡 "+IVQ[i][1];
      if(i+1<IVQ.length){flow.i=i+1;say(msg+"\n\nВопрос "+(i+2)+": "+IVQ[i+1][0],null,good?"happy":"think")}
      else{const max=IVQ.length*2,sc=flow.score;flow=null;
        say(msg+"\n\nИтог: "+sc+" из "+max+". "+(sc>=max*0.7?"Ты готов(а) к собеседованию! 🎉":sc>=max*0.4?"Неплохо! Потренируйся ещё раз — и будет отлично.":"Перечитай подсказки и попробуй снова — с каждым разом проще.")+"\nЕщё: приходи на 5–10 минут раньше, возьми паспорт, спроси про договор.",[{href:"resume.html",title:"📄 Собрать резюме",sub:"за 2 минуты, с подсказками Newi"}],sc>=max*0.7?"alert":"happy")}
      return}
    if(flow&&flow.step==="age"){const n=parseInt(t,10);if(!(n>=13&&n<=30)){say("Напиши возраст числом, например 15.");return}if(n<14){flow=null;say("Работать по договору можно с 14 лет. Пока можно попробовать волонтёрство и проекты — загляни в фильтр «проекты и волонтёрство».");return}flow={step:"city",age:n};say("В каком городе ищешь? Или напиши «удалённо».");return}
    if(flow&&flow.step==="city"){const a=flow.age;flow=null;pickResult(a,t);return}
    const k=intent(t); if(k&&t.length<60){run(k);return}
    askServer(t);
  }
  $$("#quick .chip").forEach(b=>b.onclick=()=>{push({who:"me",text:b.textContent});run(b.dataset.q)});
  $("#askForm").addEventListener("submit",e=>{e.preventDefault();const i=$("#askInput");userSays(i.value);i.value=""});

  if(location.hash==="#add"){ls.set("nr-chosen",1);setMode(ls.get("nr-mode","off"));setTimeout(openForm,300)}
  else if(location.hash==="#newi"){ls.set("nr-chosen",1);setMode("newi",true)}
  else if(ls.get("nr-chosen",0)){setMode(ls.get("nr-mode","off"))}
  else{setMode("off");$("#gate").hidden=false}
  load();
})();
