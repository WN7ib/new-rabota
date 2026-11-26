// Сайт «Новые» без сервера Арсения: содержимое — из базы (таблица novye_cms, правится в админке мессенджера),
// если базы нет/недоступна — из api/*.json рядом. Заявки «Вступить» — в novye_join. Чат-виджет — в Telegram.
(function(){
  var C=window.NR_CONFIG||{}, F=window.fetch.bind(window);
  function ok(o){return Promise.resolve(new Response(JSON.stringify(o),{headers:{'Content-Type':'application/json'}}))}
  function local(t){return F('api/'+t+'.json?v='+Date.now()).then(function(r){return r.json()}).catch(function(){return t==='settings'||t==='site'?{}:[]})}
  function cms(t){
    if(!C.supabaseUrl) return local(t).then(ok);
    return F(C.supabaseUrl+'/rest/v1/novye_cms?select=data&type=eq.'+encodeURIComponent(t),{headers:{apikey:C.supabaseKey,Authorization:'Bearer '+C.supabaseKey}})
      .then(function(r){return r.ok?r.json():[]}).then(function(a){return a&&a.length?a[0].data:local(t)}).catch(function(){return local(t)}).then(ok);
  }
  function join(body){
    if(C.supabaseUrl) F(C.supabaseUrl+'/rest/v1/novye_join',{method:'POST',headers:{apikey:C.supabaseKey,Authorization:'Bearer '+C.supabaseKey,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({data:JSON.parse(body||'{}')})}).catch(function(){});
    return ok({ok:true});
  }
  window.fetch=function(u,o){
    if(typeof u==='string'){
      var m=u.match(/^\/api\/cms\?type=(\w+)/);
      if(m&&m[1]==='settings') return cms('settings').then(function(r){return r.clone().json().then(function(st){
        // телефон не указан в админке — номер со старого сайта не показываем
        if(!st.phone){var h=function(){document.querySelectorAll('a[href^="tel:"]').forEach(function(a){a.style.display='none'})};h();document.addEventListener('DOMContentLoaded',h)}
        return r})});
      if(m) return cms(m[1]);
      if(u.indexOf('/api/admin?action=join')===0) return join(o&&o.body);
      if(u.indexOf('/api/admin?action=verify_captcha')===0) return ok({ok:true});
      if(u.indexOf('/tg-posts.php')===0){var s=document.querySelector('[data-sec="tg"]'); if(s) s.style.display='none'; return ok({ok:false,posts:[]});}
      if(u.indexOf('/chat-api.php')===0) return ok({ok:false});
    }
    return F(u,o);
  };
  // кнопка чата → Telegram движения
  document.addEventListener('DOMContentLoaded',function(){
    window.chatToggle=function(){local('settings').then(function(st){var t=(st.join_tg||'NW7ib').replace(/^@/,'');window.open('https://t.me/'+t,'_blank')})};
    var p=document.getElementById('chat-panel'); if(p) p.remove();
  });
})();
