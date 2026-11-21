/* Копилка на цель (Mini App tg.html): разбор строки оплаты вакансии и «сколько работать до цели».
   Чистые функции, без DOM — проверяются тестом tools/piggy.test.js (node). */
(function(root){
  "use strict";
  const MAX=10000000;
  /** Число из куска текста: «1 500», «1500,5», «1.5к», «25 тыс», «2 млн» (млн отбрасываем — нереально). */
  function num(s){
    const m=String(s).match(/^(\d{1,3}(?:[   ]\d{3})+(?!\d)|\d+(?:[.,]\d+)?(?![\d.,]))(?:\s*(тыс|т\.р)|(к|k))?(?![а-яa-z])/i);
    // «1500р»: суффикс не подошёл — берём число как есть
    if(!m){const m2=String(s).match(/^(\d{1,3}(?:[   ]\d{3})+(?!\d)|\d+(?:[.,]\d+)?)/);if(!m2)return null;return parseFloat(m2[1].replace(/[   ]/g,"").replace(",","."))}
    let n=parseFloat(m[1].replace(/[   ]/g,"").replace(",","."));
    if(!isFinite(n))return null;
    if(m[2]||m[3])n*=1000;
    return n;
  }
  /** Ставка из строки оплаты: {amount, unit:'hour'|'shift'|'week'|'month'|'task'} или null.
      Берём НИЖНЮЮ границу («от 300», «300–500») — честнее для подростка. Непонятное — null (лучше промолчать). */
  function payRate(pay){
    let s=String(pay||"").toLowerCase().replace(/ё/g,"е");
    if(!s||/договор|сдельн|процент|%|бесплатн|волонт/.test(s))return null;
    // единица: смотрим на слова после чисел
    // \b в JS не работает с кириллицей — границы слова через (?<![а-я]) / (?![а-я])
    const unit=/(?<![а-я])час|почасов|(\/|в|за)\s*ч(?![а-я])/.test(s)?"hour":
      /смен|(?<![а-я])выход|(?<![а-я])(день|дн(?![а-я])|сутк)/.test(s)?"shift":
      /недел/.test(s)?"week":
      /месяц|(?<![а-я])мес(?![а-я])|оклад|зарплат|з\/п/.test(s)?"month":
      /заказ|доставк|задани|(?<![а-я])пост(?![а-я])|видео|ролик|штук|(?<![а-я])шт(?![а-я])|анкет/.test(s)?"task":null;
    if(!unit)return null;
    // первое число в строке (нижняя граница); номер вроде «18+» или «с 14 лет» пропускаем
    s=s.replace(/(?<!\d)1[4-8]\s*(лет|\+)/g," ");
    const re=/\d/g;let m,n=null;
    while((m=re.exec(s))){ if(m.index>0&&/\d/.test(s[m.index-1]))continue; const v=num(s.slice(m.index)); if(v!=null&&v>0){n=v;break} }
    if(n==null)return null;
    // правдоподобие: «300 ₽/час» да, «3 ₽/час» нет
    const lim={hour:[50,10000],shift:[200,50000],week:[500,200000],month:[1000,MAX],task:[10,50000]}[unit];
    if(n<lim[0]||n>lim[1])return null;
    return {amount:Math.round(n),unit};
  }
  const plural=(n,a,b,c)=>{const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c};
  const W={hour:["час","часа","часов"],shift:["смена","смены","смен"],week:["неделя","недели","недель"],month:["месяц","месяца","месяцев"],task:["заказ","заказа","заказов"]};
  /** Сколько единиц работы до цели. goal={need,have}. null — посчитать нельзя или цель уже собрана (left<=0 → {done:true}). */
  function toGoal(pay,goal){
    const r=payRate(pay);if(!r||!goal)return null;
    const left=Math.max(0,(+goal.need||0)-(+goal.have||0));
    if(!(+goal.need>0))return null;
    if(left<=0)return {done:true};
    const n=Math.ceil(left/r.amount);
    return {n,unit:r.unit,text:"≈ "+n+" "+plural(n,...W[r.unit]),rate:r};
  }
  /** Цель из хранилища: чистим и ограничиваем. */
  function cleanGoal(g){
    if(!g||typeof g!=="object")return null;
    const name=String(g.name||"").replace(/[\u0000-\u001f<>]/g,"").trim().slice(0,40);
    const need=Math.round(+g.need||0), have=Math.max(0,Math.round(+g.have||0));
    if(!(need>0&&need<=MAX))return null;
    return {name:name||"цель",need,have:Math.min(have,MAX)};
  }
  const api={payRate,toGoal,cleanGoal,num};
  if(typeof module!=="undefined"&&module.exports)module.exports=api; else root.Piggy=api;
})(typeof window!=="undefined"?window:globalThis);
