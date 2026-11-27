// Проверка «на чём доехать» (karta.html → transitPlan) без сети: прямой маршрут, пересадка, обратное направление.
import fs from "node:fs";
import assert from "node:assert";
const s = fs.readFileSync(new URL("../karta.html", import.meta.url), "utf8");
const kmSrc = s.match(/function km\(a,b\)\{[^\n]*\}/)[0];
const src = s.slice(s.indexOf("  const TR_KIND="), s.indexOf("  function transit(from,to)"));
const transitPlan = new Function(kmSrc + ";" + src + ";return transitPlan;")();
const n = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });
const rel = (id, route, ref, ids) => ({ type: "relation", id, tags: { route, ref }, members: ids.map((r) => ({ type: "node", ref: r })) });
const home = [51.500, 46.000], work = [51.560, 46.080];
// 1 — у дома, 2..4 — по пути, 5 — у работы; 6 — пересадка рядом с 3 (≈ 100 м), 7 — у работы для второго номера
const nodes = [n(1, 51.5005, 46.0005, "Дом"), n(2, 51.52, 46.02, "Рынок"), n(3, 51.53, 46.04, "Стадион Волга"), n(4, 51.55, 46.07, "Центр"), n(5, 51.5595, 46.0795, "Работа"),
  n(6, 51.5309, 46.0401, "Стадион Волга (2)"), n(7, 51.5598, 46.0798, "Консерватория")];
// без прямого: 226к едет от дома до стадиона, 110 — от стадиона до работы; 99 — обратно
let j = { elements: [...nodes, rel(10, "bus", "226к", [1, 2, 3]), rel(11, "share_taxi", "110", [6, 4, 7]), rel(12, "bus", "99", [5, 4, 3, 2, 1])] };
let l = transitPlan(j, home, work, 700);
assert.ok(l.length >= 1, "нашёл вариант с пересадкой");
assert.deepEqual(l[0].legs.map((x) => x.ref), ["226к", "110"]);
assert.equal(l[0].legs[0].off, "Стадион Волга"); assert.equal(l[0].legs[1].on, "Стадион Волга (2)");
assert.ok(!l.some((o) => o.legs.some((x) => x.ref === "99")), "в обратную сторону не предлагаю");
// прямой маршрут — первым, он быстрее
j.elements.push(rel(13, "trolleybus", "2", [1, 2, 3, 4, 5]));
l = transitPlan(j, home, work, 700);
assert.equal(l[0].legs.length, 1); assert.equal(l[0].legs[0].ref, "2"); assert.ok(l[0].min > 0 && l[0].legs[0].path.length === 5);
console.log("transit: все проверки прошли", JSON.stringify(l.map((o) => [o.min, o.legs.map((x) => x.ref).join(">")])));
