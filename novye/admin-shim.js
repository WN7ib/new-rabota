// Старая админка novye.site (дизайн Арсения) поверх нашей базы: вместо его сервера /api/admin — Supabase.
// Содержимое — таблица novye_cms (settings/team/events/news/site), заявки — novye_join. Вход — почта и пароль админа New.работа.
(function(){
  var C=window.NR_CONFIG, sb=window.supabase.createClient(C.supabaseUrl,C.supabaseKey), F=window.fetch.bind(window);
  var DEF={settings:{},team:[],events:[],news:[],site:{hidden:[]}};
  function J(o){return Promise.resolve(new Response(JSON.stringify(o),{headers:{"Content-Type":"application/json"}}))}
  async function get(t){var r=await sb.from("novye_cms").select("data").eq("type",t).maybeSingle();
    if(r.data&&r.data.data!=null)return r.data.data;
    try{var x=await F("novye/api/"+t+".json?v="+Date.now());if(x.ok)return await x.json()}catch(e){}   // в базе пусто — то, что сейчас на сайте
    return JSON.parse(JSON.stringify(DEF[t]))}
  async function put(t,d){var r=await sb.from("novye_cms").upsert({type:t,data:d,updated_at:new Date().toISOString()});return r.error?{ok:false,error:r.error.message}:{ok:true}}
  async function can(){var u=(await sb.auth.getUser()).data.user;if(!u)return false;var r=await sb.rpc("is_admin");return !!r.data}
  async function list(t,body,del){
    var a=await get(t);if(!Array.isArray(a))a=[];
    if(del){a=a.filter(function(x){return String(x.id)!==String(body.id)});return put(t,a)}
    var o={};Object.keys(body).forEach(function(k){if(k!=="id")o[k]=body[k]});
    ["img_pos_x","img_pos_y"].forEach(function(k){if(o[k]!==undefined)o[k]=+o[k]||50});
    if(body.id){var i=a.findIndex(function(x){return String(x.id)===String(body.id)});if(i>=0){a[i]=Object.assign(a[i],o);return put(t,a)}}
    o.id=a.reduce(function(m,x){return Math.max(m,+x.id||0)},0)+1;a.push(o);return put(t,a)}
  async function api(action,body){
    switch(action){
      case "me": return {ok:await can()};
      case "login": {var em=(document.getElementById("nv-email")||{}).value||"";
        var r=await sb.auth.signInWithPassword({email:em.trim(),password:body.password||""});
        if(r.error)return {ok:false,error:"Неверная почта или пароль"};
        return (await can())?{ok:true}:{ok:false,error:"У этого аккаунта нет прав админа"}}
      case "logout": await sb.auth.signOut();return {ok:true};
      case "get_settings": return await get("settings");
      case "save_settings": {var s=await get("settings");Object.keys(body).forEach(function(k){s[k]=body[k]});return put("settings",s)}
      case "get_team": return await get("team");
      case "get_events": return await get("events");
      case "get_news": return await get("news");
      case "get_site": return await get("site");
      case "save_site": return put("site",body);
      case "save_team": return list("team",body);   case "delete_team": return list("team",body,true);
      case "save_event": return list("events",body); case "delete_event": return list("events",body,true);
      case "save_news": return list("news",body);   case "delete_news": return list("news",body,true);
      case "get_submissions": {var r2=await sb.from("novye_join").select("*").order("id",{ascending:true}).limit(500);
        if(r2.error)return {ok:false,error:r2.error.message};
        return {ok:true,submissions:(r2.data||[]).map(function(x){var d=x.data||{};return {id:x.id,name:d.name,phone:d.phone,district:d.district,message:d.message,ts:Date.parse(x.created_at)/1000}})}}
      case "delete_submission": {var r3=await sb.from("novye_join").delete().eq("id",+body.id);return {ok:!r3.error}}
      case "clear_submissions": {var r4=await sb.from("novye_join").delete().gt("id",0);return {ok:!r4.error}}
      case "get_dashboard": {var ev=await get("events"),nw=await get("news"),tm=await get("team"),sb2=await sb.from("novye_join").select("id",{count:"exact",head:true});
        return {ok:true,stats:{events:ev.length||0,news:nw.length||0,team:tm.length||0,subs:sb2.count||0,chats:0,unread:0},recent_chats:[],recent_subs:[]}}
      case "get_chat_sessions": return {ok:true,sessions:[]};
      case "get_chat_messages": return {ok:true,messages:[]};
      case "upload_media": return {ok:false,error:"Загрузка файлов пока не работает — вставь ссылку на картинку"};
      default: return {ok:false,error:"Нет такого действия: "+action};
    }
  }
  window.fetch=function(u,o){
    if(typeof u==="string"&&u.indexOf("/api/admin?action=")===0){
      var action=decodeURIComponent(u.split("action=")[1].split("&")[0]),body={};
      try{if(o&&o.body&&typeof o.body==="string")body=JSON.parse(o.body)}catch(e){}
      return api(action,body).then(J,function(e){return J({ok:false,error:String(e&&e.message||e)})});
    }
    return F(u,o);
  };
  document.addEventListener("DOMContentLoaded",function(){
    // вход: почта + пароль (у Арсения был один пароль)
    var p=document.getElementById("pwd");if(p&&!document.getElementById("nv-email")){var d=document.createElement("div");d.innerHTML='<label>Почта</label><input type="email" id="nv-email" autocomplete="username" placeholder="Почта админа New.работа">';p.parentNode.parentNode.insertBefore(d,p.parentNode)}
    // чата поддержки у нас нет (на сайте кнопка ведёт в Telegram)
    var ch=document.querySelector('.nav-lnk[data-s="chat"]');if(ch)ch.style.display="none";
  });
})();
