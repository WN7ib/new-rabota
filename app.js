(function(){
  const $=s=>document.querySelector(s);
  const list=$("#list"), statusEl=$("#status");
  const cfg=window.NR_CONFIG||{};
  const configured=cfg.supabaseUrl&&!/ВСТАВЬ/.test(cfg.supabaseUrl)&&cfg.supabaseKey&&!/ВСТАВЬ/.test(cfg.supabaseKey);
  const sb=configured&&window.supabase?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:false}}):null;
  const state={items:[],q:"",city:"",remote:false,age:0,type:"",fav:false,favs:new Set(),open:new Set(),ready:false};
  try{state.favs=new Set(JSON.parse(localStorage.getItem("nr-favs")||"[]"))}catch(e){}
  function saveFavs(){try{localStorage.setItem("nr-favs",JSON.stringify([...state.favs]))}catch(e){}}

  const norm=s=>(s||"").toString().toLowerCase().replace(/ё/g,"е").trim();
  function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,3000)}
  function ago(ts){if(!ts)return"";const t=new Date(ts).getTime();const d=Math.floor((Date.now()-t)/86400000);return d<=0?"сегодня":d===1?"вчера":d<5?d+" дня назад":d<21?d+" дней назад":new Date(t).toLocaleDateString("ru-RU")}
  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}

  function filtered(){
    const q=norm(state.q), c=norm(state.city);
    return state.items.filter(v=>{
      if(state.fav&&!state.favs.has(v.id))return false;
      if(state.type&&v.type!==state.type)return false;
      if(state.age&&(+v.age_min||14)>state.age)return false;
      if(state.remote&&!v.remote)return false;
      if(c&&!v.remote&&!norm(v.city).includes(c))return false;
      if(q){const hay=norm([v.title,v.company,v.description,v.city,v.type].join(" "));if(!q.split(/\s+/).every(w=>hay.includes(w)))return false}
      return true;
    });
  }

  function render(){
    const items=filtered();
    list.textContent="";
    if(!state.ready)return;
    if(!items.length){
      const box=el("div","empty");
      if(!state.items.length){
        box.append(el("h3",null,"Вакансий пока нет"),el("p",null,"Здесь появятся предложения от работодателей. Знаешь кафе, магазин или проект, которому нужны люди? Размести первую вакансию, это займёт минуту."));
        const b=el("button","btn btn-primary","＋ Разместить вакансию");b.type="button";b.onclick=openForm;box.append(b);
      }else{
        box.append(el("h3",null,"Ничего не нашлось"),el("p",null,"Попробуй убрать часть фильтров или поискать в другом городе."));
        const b=el("button","btn btn-ghost","Сбросить фильтры");b.type="button";b.onclick=resetFilters;box.append(b);
      }
      list.append(box);return;
    }
    for(const v of items){
      const c=el("article","card"+(state.open.has(v.id)?" open":""));
      const left=el("div");left.style.minWidth="0";
      left.append(el("h3",null,v.title||"Без названия"),el("div","where",[v.company,v.remote&&!v.city?"Удалённо":v.city].filter(Boolean).join(" · ")));
      c.append(left,el("div","pay",v.pay||"по договорённости"));
      const tags=el("div","tags");
      tags.append(el("span","t t-age","с "+(v.age_min||14)+" лет"),el("span","t",v.type||"Подработка"));
      if(v.remote)tags.append(el("span","t t-remote","удалённо"));
      tags.append(el("span","date",ago(v.created_at)));
      c.append(tags);
      if(v.description)c.append(el("p","desc",v.description));
      const ct=el("div","contact");
      ct.append(el("span","lbl","Отклик"),el("code",null,v.contact||"не указан"));
      if(v.contact){const cp=el("button","fav","Скопировать");cp.type="button";cp.onclick=()=>copy(v.contact);ct.append(cp)}
      c.append(ct);
      const a=el("div","actions");
      const more=el("button","link",state.open.has(v.id)?"Свернуть":"Подробнее и отклик");more.type="button";
      more.onclick=()=>{state.open.has(v.id)?state.open.delete(v.id):state.open.add(v.id);render()};
      const f=el("button","fav",state.favs.has(v.id)?"★ В избранном":"☆ В избранное");f.type="button";f.setAttribute("aria-pressed",state.favs.has(v.id));
      f.onclick=()=>{state.favs.has(v.id)?state.favs.delete(v.id):state.favs.add(v.id);saveFavs();render()};
      a.append(more,f);c.append(a);list.append(c);
    }
  }

  function countText(){const n=filtered().length;const m=n%10,h=n%100;return n+" "+(m===1&&h!==11?"вакансия":m>=2&&m<=4&&(h<12||h>14)?"вакансии":"вакансий")}
  function refreshMeta(msg){statusEl.textContent=msg||(state.ready?countText():"Загружаю вакансии…")}

  function copy(t){
    try{navigator.clipboard.writeText(t).then(()=>toast("Скопировано: "+t),()=>toast("Выдели контакт и скопируй вручную"))}catch(e){toast("Выдели контакт и скопируй вручную")}
  }

  function resetFilters(){
    state.q=state.city="";state.remote=false;state.age=0;state.type="";state.fav=false;
    $("#q").value="";$("#city").value="";$("#remote").checked=false;
    document.querySelectorAll("#ageGroup .chip").forEach(b=>b.setAttribute("aria-pressed",b.dataset.age==="0"));
    document.querySelectorAll("#typeGroup .chip").forEach(b=>b.setAttribute("aria-pressed",b.dataset.type===""&&!b.dataset.fav));
    render();refreshMeta();
  }

  $("#searchForm").addEventListener("submit",e=>e.preventDefault());
  $("#q").addEventListener("input",e=>{state.q=e.target.value;render();refreshMeta()});
  $("#city").addEventListener("input",e=>{state.city=e.target.value;render();refreshMeta();try{localStorage.setItem("nr-city",e.target.value)}catch(_){}});
  $("#remote").addEventListener("change",e=>{state.remote=e.target.checked;render();refreshMeta()});
  document.querySelectorAll("#ageGroup .chip").forEach(b=>b.onclick=()=>{state.age=+b.dataset.age;document.querySelectorAll("#ageGroup .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));render();refreshMeta()});
  document.querySelectorAll("#typeGroup .chip").forEach(b=>b.onclick=()=>{
    if(b.dataset.fav){state.fav=!state.fav;b.setAttribute("aria-pressed",state.fav)}
    else{state.type=b.dataset.type;document.querySelectorAll("#typeGroup .chip:not([data-fav])").forEach(x=>x.setAttribute("aria-pressed",x===b))}
    render();refreshMeta()});
  try{const c=localStorage.getItem("nr-city");if(c){$("#city").value=c;state.city=c}}catch(e){}

  // форма
  const sheet=$("#sheet"),err=$("#formErr");
  function openForm(){
    if(!sb){toast("Сайт ещё не подключён к базе");return}
    err.hidden=true;sheet.hidden=false;$("#f-title").focus();
  }
  function closeForm(){sheet.hidden=true}
  $("#openForm").onclick=openForm;$("#cancelForm").onclick=closeForm;
  sheet.addEventListener("click",e=>{if(e.target===sheet)closeForm()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!sheet.hidden)closeForm()});
  $("#vacForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if($("#f-website").value)return; // ловушка для спам-ботов
    try{const last=+localStorage.getItem("nr-last")||0;if(Date.now()-last<60000){err.textContent="Подожди минуту перед следующей вакансией.";err.hidden=false;return}}catch(_){}
    const v=id=>$(id).value.trim();
    const data={title:v("#f-title"),company:v("#f-company")||null,city:v("#f-city")||null,type:$("#f-type").value,age_min:+$("#f-age").value,pay:v("#f-pay")||null,remote:$("#f-remote").checked,description:v("#f-desc")||null,contact:v("#f-contact"),status:"pending"};
    const miss=[];if(data.title.length<2)miss.push("должность");if(!data.city&&!data.remote)miss.push("город или «удалённо»");if(data.contact.length<3)miss.push("контакт для отклика");
    if(miss.length){err.textContent="Заполни: "+miss.join(", ")+".";err.hidden=false;return}
    const btn=$("#submitForm");btn.disabled=true;btn.textContent="Отправляю…";
    const {error}=await sb.from("vacancies").insert(data);
    btn.disabled=false;btn.textContent="Отправить на проверку";
    if(error){err.textContent="Не получилось отправить. Проверь интернет и попробуй ещё раз.";err.hidden=false;return}
    try{localStorage.setItem("nr-last",Date.now())}catch(_){}
    closeForm();$("#vacForm").reset();toast("Отправлено. Вакансия появится после проверки");
  });

  async function load(){
    if(!sb){state.ready=true;render();refreshMeta("Сайт ещё не подключён к базе");return}
    const timer=setTimeout(()=>{if(!state.ready)refreshMeta("Не удаётся загрузить вакансии. Проверь интернет.")},10000);
    const {data,error}=await sb.from("vacancies").select("id,created_at,title,company,city,type,age_min,pay,remote,description,contact").eq("status","approved").order("created_at",{ascending:false}).limit(500);
    clearTimeout(timer);state.ready=true;
    if(error){render();refreshMeta("Вакансии сейчас недоступны");return}
    state.items=data||[];render();refreshMeta();
  }
  load();
})();
