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
    let {error}=await sb.from("vacancies").insert(data);
    if(error&&/expires_at|column/i.test(error.message||"")){delete data.expires_at;if(!["Проект","Волонтёрство"].includes(data.type)) ({error}=await sb.from("vacancies").insert(data))}
    btn.disabled=false;btn.textContent="Отправить на проверку";
    if(error){err.textContent=state.settings.submissions_open===false?"Приём вакансий сейчас закрыт.":"Не получилось отправить. Проверь интернет и попробуй ещё раз.";err.hidden=false;return}
    ls.set("nr-last",Date.now());
    closeForm();$("#vacForm").reset();toast("Отправлено. Вакансия появится после проверки");
  });

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

  // ═════════ режимы: обычный / с Newi ═════════
  function setMode(m){
    const on=m==="newi"; ls.set("nr-mode",m);
    $("#newiWrap").hidden=!on;$("#modeNewi").setAttribute("aria-pressed",on);$("#modeOff").setAttribute("aria-pressed",!on);
    if(on){renderChat();resumeWaiting()}
  }
  $("#modeOff").onclick=()=>setMode("off");$("#modeNewi").onclick=()=>setMode("newi");

  // ═════════ Newi на сайте ═════════
  const chatEl=$("#chat");
  let session=ls.get("nr-sess","");
  if(!session){session=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");ls.set("nr-sess",session)}
  let msgs=ls.get("nr-chat",[]); let flow=null;
  const saveMsgs=()=>{msgs=msgs.slice(-60);ls.set("nr-chat",msgs)};
  function push(m){msgs.push(m);saveMsgs();renderChat()}
  function renderChat(){
    chatEl.textContent="";
    const all=msgs.length?msgs:[{who:"nw",text:"Привет! Я Newi, помощница New.работа. Подберу работу под твой возраст и город, расскажу о правах и помогу не попасть на обман. Нажми кнопку внизу или спроси своими словами."}];
    for(const m of all){
      const d=el("div","msg "+(m.who==="me"?"me":"nw")+(m.wait?" wait":""),m.text);
      (m.links||[]).forEach(l=>{const a=el("a","mini");a.href=l.href;a.append(el("b",null,l.title));if(l.sub)a.append(el("span",null,l.sub));d.append(a)});
      chatEl.append(d);
    }
    chatEl.scrollTop=chatEl.scrollHeight;
  }
  const say=(text,links)=>push({who:"nw",text,links});

  const RIGHTS="По Трудовому кодексу работать можно с 14 лет — лёгкий труд в свободное от учёбы время.\n• 14–15 лет: нужно согласие родителя и органа опеки; до 24 ч в неделю, во время учёбы — до 12 ч.\n• 16–17 лет: можно без согласия; до 35 ч в неделю, во время учёбы — до 17,5 ч.\n• До 18 нельзя: ночью, сверхурочно, в выходные, на вредной работе, с алкоголем и табаком.\n• Перед работой — бесплатный медосмотр, испытательный срок не ставят, отпуск 31 день.";
  const SCAM="Как не попасть на обман:\n• Не плати за обучение, форму или «бронь» вакансии.\n• Не отдавай паспорт и банковскую карту.\n• Не оформляй карты «на себя» и не переводи чужие деньги — это дропперство, уголовная статья.\n• «Курьер документов», «закладки», «лёгкие деньги за час» — почти всегда преступление.\nСомневаешься в вакансии — нажми «Пожаловаться» под ней, модератор проверит.";
  const RESUME="Резюме для первой работы — на полстраницы:\n1. Имя, возраст, город, контакт.\n2. Чего хочешь: «подработка по выходным, курьер или бариста».\n3. Учёба: школа, класс.\n4. Опыт: волонтёрство, помощь на мероприятиях, кружки, олимпиады — всё считается.\n5. Навыки: общительность, ответственность, компьютер, языки.\nПодробнее с примером — в гиде.";

  function intent(t){
    t=norm(t);
    if(/подбер|найди|ищу|хочу работ|вакансии|работу|подработк/.test(t))return "pick";
    if(/прав|закон|сколько час|трудов|согласи|с 14|с 15|с 16/.test(t))return "rights";
    if(/обман|мошен|дроп|развод|безопас/.test(t))return "scam";
    if(/резюме|собеседов/.test(t))return "resume";
    return null;
  }
  function run(k){
    if(k==="rights")say(RIGHTS,[{href:"guide.html#law",title:"Гид: работа с 14 лет",sub:"документы, часы, что нельзя"}]);
    else if(k==="scam")say(SCAM);
    else if(k==="resume")say(RESUME,[{href:"guide.html#resume",title:"Гид: резюме и собеседование",sub:"пример и вопросы работодателю"}]);
    else if(k==="pick"){flow={step:"age"};say("Сколько тебе лет?")}
  }
  function pickResult(age,city){
    setAge(age>=18?18:age>=16?16:14);
    if(city&&!/^удал/i.test(city)){state.city=city;$("#city").value=city;ls.set("nr-city",city)} else if(/^удал/i.test(city||"")){state.remote=true;$("#remote").checked=true}
    render();refreshMeta();
    const hit=filtered().slice(0,5);
    if(!hit.length){say("Пока под тебя ничего нет"+(city?" в «"+city+"»":"")+". Новые вакансии появляются каждый день."+(state.settings.bot_username?" Подпишись на бота — он пришлёт, как только появится.":""),state.settings.bot_username?[{href:NR.botLink(state.settings.bot_username,city),title:"🔔 Подписаться в Telegram",sub:city||"все города"}]:[]);return}
    say("Вот что подходит"+(city?" в «"+city+"»":"")+". Я ещё отфильтровала список ниже.",hit.map(v=>({href:vacUrl(v),title:v.title,sub:[v.pay||"по договорённости",v.city||(v.remote?"удалённо":""),"с "+v.age_min+" лет"].filter(Boolean).join(" · ")})));
  }
  async function askServer(q){
    if(!sb||state.settings.chat_on===false){say("Сейчас я отвечаю только на готовые вопросы — кнопки ниже. Свободные вопросы скоро снова включат.");return}
    const {data,error}=await sb.rpc("chat_ask",{p_session:session,p_q:q});
    if(error){say(/too many/.test(error.message||"")?"Слишком много вопросов подряд. Подожди минутку.":"Не получилось отправить вопрос. Попробуй ещё раз.");return}
    push({who:"nw",text:"Newi думает…",wait:true,id:data,at:Date.now()});
    poll();
  }
  let pollT=null;
  async function poll(){
    clearTimeout(pollT);
    const waiting=msgs.filter(m=>m.wait&&m.id); if(!waiting.length||!sb)return;
    const {data}=await sb.rpc("chat_get",{p_session:session});
    let changed=false;
    (data||[]).forEach(r=>{const m=msgs.find(x=>x.id===r.id);if(m&&m.wait&&r.a){m.text=r.a;m.wait=false;changed=true}});
    const now=Date.now();
    msgs.forEach(m=>{if(m.wait&&now-m.at>90000&&!m.late){m.late=true;m.text="Newi сейчас не на связи с сайтом. Ответ появится здесь, когда она прочитает, — можно вернуться позже.";changed=true}});
    if(changed){saveMsgs();renderChat()}
    if(msgs.some(m=>m.wait&&m.id))pollT=setTimeout(poll,msgs.some(m=>m.wait&&!m.late)?4000:20000);
  }
  function resumeWaiting(){if(msgs.some(m=>m.wait))poll()}

  function userSays(t){
    t=t.trim();if(!t)return;push({who:"me",text:t});
    if(flow&&flow.step==="age"){const n=parseInt(t,10);if(!(n>=13&&n<=30)){say("Напиши возраст числом, например 15.");return}if(n<14){flow=null;say("Работать по договору можно с 14 лет. Пока можно попробовать волонтёрство и проекты — загляни в фильтр «проекты и волонтёрство».");return}flow={step:"city",age:n};say("В каком городе ищешь? Или напиши «удалённо».");return}
    if(flow&&flow.step==="city"){const a=flow.age;flow=null;pickResult(a,t);return}
    const k=intent(t); if(k&&t.length<60){run(k);return}
    askServer(t);
  }
  $$("#quick .chip").forEach(b=>b.onclick=()=>{push({who:"me",text:b.textContent});run(b.dataset.q)});
  $("#askForm").addEventListener("submit",e=>{e.preventDefault();const i=$("#askInput");userSays(i.value);i.value=""});

  setMode(location.hash==="#newi"?"newi":ls.get("nr-mode","off"));
  load();
})();
