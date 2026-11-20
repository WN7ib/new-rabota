// New.работа: точка на карте по адресу (OpenStreetMap / Nominatim) и ссылка «как добраться».
// Отдельный файл без базы и Метрики — его подключают и кабинет, и админка, и страницы событий/карты.
(function(){
  // ── адрес → точка на карте (OpenStreetMap / Nominatim). Зовётся только по нажатию «Сохранить» (не чаще раза в секунду —
  // правило сервиса), в Nominatim уходят только город и адрес смены. Нашёлся лишь сам город/область — null
  // (точнее кружка города это не будет). Сеть/сервис недоступны — тоже null: смена сохранится и без точки.
  async function geoAddr(city, place){
    city=String(city||"").trim();place=String(place||"").replace(/[«»"]/g," ").replace(/\s+/g," ").trim();
    if(place.length<4)return null;
    const parts=place.split(",").map(s=>s.trim()).filter(Boolean);
    const qs=[[city,place].filter(Boolean).join(", ")];
    if(parts.length>2)qs.push([city,parts.slice(0,2).join(", ")].filter(Boolean).join(", "));
    for(let i=0;i<qs.length;i++){
      if(i)await new Promise(r=>setTimeout(r,1100));
      const ac=typeof AbortController!=="undefined"?new AbortController():null,tm=ac&&setTimeout(()=>ac.abort(),6000);
      try{
        const r=await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ru&accept-language=ru&q="+encodeURIComponent(qs[i]),{headers:{"Accept":"application/json"},signal:ac&&ac.signal});
        if(!r.ok)return null;
        const p=(await r.json()||[])[0];if(!p)continue;
        if(p.class==="boundary"||(p.class==="place"&&/^(city|town|village|hamlet|municipality|county|state|region|country|province)$/.test(p.type)))continue;
        const lat=+p.lat,lng=+p.lon;
        if(lat>41&&lat<82&&(lng>19||lng<-168))return {lat:+lat.toFixed(6),lng:+lng.toFixed(6),label:p.display_name||""};
      }catch(e){return null}finally{if(tm)clearTimeout(tm)}
    }
    return null;
  }
  /** Ссылка «как добраться» в Яндекс Картах (маршрут до точки). */
  const routeLink=(lat,lng)=>"https://yandex.ru/maps/?rtext=~"+lat+","+lng+"&rtt=mt";

  window.NRGeo={addr:geoAddr,route:routeLink};
})();
