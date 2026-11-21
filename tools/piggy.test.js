// node tools/piggy.test.js — проверка копилки (разбор оплаты вакансий)
const P=require("../piggy.js");const assert=require("assert");
const R=(s,a,u)=>{const r=P.payRate(s);if(a==null){assert.strictEqual(r,null,s+" → "+JSON.stringify(r));return}
  assert.ok(r,s+" → null");assert.deepStrictEqual([r.amount,r.unit],[a,u],s+" → "+JSON.stringify(r))};
R("250 ₽/час",250,"hour");R("от 300 ₽ в час",300,"hour");R("300–500 ₽/ч",300,"hour");R("300 руб/ч",300,"hour");
R("1500 ₽ в смену",1500,"shift");R("1 500 ₽ за смену",1500,"shift");R("1500р/смена",1500,"shift");R("2000 в день",2000,"shift");
R("от 1.5к за выход",1500,"shift");R("до 40 000 ₽ в месяц",40000,"month");R("25 тыс/мес",25000,"month");R("зарплата 30000",30000,"month");
R("150 ₽ за заказ",150,"task");R("5000 в неделю",5000,"week");R("1500 ₽ в смену, выплата сейчас",1500,"shift");
R("по договорённости",null);R("",null);R("10% с продаж",null);R("3 ₽/час",null);R("1500",null);R("высокая",null);
R("16+ 400 ₽/час",400,"hour");R("с 14 лет, 200 ₽/час",200,"hour");R("1500 ₽",null);R("от 15000 в месяц",15000,"month");
const g={need:6000,have:1500};
assert.deepStrictEqual(P.toGoal("1500 ₽ в смену",g).text,"≈ 3 смены");
assert.deepStrictEqual(P.toGoal("250 ₽/час",g).text,"≈ 18 часов");
assert.deepStrictEqual(P.toGoal("250 ₽/час",{need:271,have:20}).text,"≈ 2 часа");
assert.deepStrictEqual(P.toGoal("1000 за смену",{need:1000,have:0}).text,"≈ 1 смена");
assert.deepStrictEqual(P.toGoal("1000 за смену",{need:5000,have:6000}),{done:true});
assert.strictEqual(P.toGoal("по договорённости",g),null);assert.strictEqual(P.toGoal("1000 за смену",null),null);
assert.deepStrictEqual(P.cleanGoal({name:"<b>Наушники</b>",need:"6000",have:-5}),{name:"bНаушники/b",need:6000,have:0});
assert.strictEqual(P.cleanGoal({name:"x",need:0}),null);assert.strictEqual(P.cleanGoal("x"),null);
assert.strictEqual(P.cleanGoal({need:5}).name,"цель");
console.log("piggy: всё ок");
