/* Будує public/data/region-owners.json — стартове володіння областей за реальними країнами.
   Джерело: public/data/world-topology.json (кожна область має ISO країни).
   Формат: { v:1, r: { <rid>: "UA", … }, c: { "UA": <індекс кольору>, … } }
   Індекс кольору рахується жадібним розфарбуванням графа сусідніх країн (спільні арки кордону),
   тож сусіди завжди мають різні кольори. Палітра лежить у src/realCountries.js (COUNTRY_PALETTE).
   Запуск: node scripts/build-region-owners.mjs */

import fs from "node:fs";

const PALETTE_SIZE = 16;
const topo = JSON.parse(fs.readFileSync("public/data/world-topology.json", "utf8"));
const geoms = topo.objects[Object.keys(topo.objects)[0]].geometries;

const normIso = (s) => {
  const v = String(s || "").toUpperCase();
  if (v === "CN-TW") return "TW";
  return /^[A-Z]{2}$/.test(v) ? v : "";
};

const r = {};
const arcOwner = new Map(); // арка → множина ISO
const collect = (node, iso) => {
  if (typeof node === "number") {
    const a = node < 0 ? ~node : node;
    let s = arcOwner.get(a);
    if (!s) arcOwner.set(a, (s = new Set()));
    s.add(iso);
  } else if (Array.isArray(node)) node.forEach((n) => collect(n, iso));
};
for (const g of geoms) {
  const p = g.properties || {};
  const iso = normIso(p.cn_region_iso || p.iso);
  const rid = String(p.cn_region_id || "");
  if (!rid || !iso) continue;
  r[rid] = iso;
  collect(g.arcs, iso);
}

const isos = [...new Set(Object.values(r))].sort();
const adj = new Map(isos.map((i) => [i, new Set()]));
for (const set of arcOwner.values()) {
  if (set.size < 2) continue;
  const list = [...set];
  for (const a of list) for (const b of list) if (a !== b) adj.get(a).add(b);
}

// DSATUR: спершу країни з найбільшою кількістю сусідів / вже зайнятих кольорів.
const color = {};
const used = new Array(PALETTE_SIZE).fill(0);
const sat = (i) => new Set([...adj.get(i)].filter((n) => color[n] !== undefined).map((n) => color[n])).size;
const left = new Set(isos);
while (left.size) {
  let best = null, bs = -1, bd = -1;
  for (const i of left) {
    const s = sat(i), d = adj.get(i).size;
    if (s > bs || (s === bs && d > bd)) { best = i; bs = s; bd = d; }
  }
  const taken = new Set([...adj.get(best)].map((n) => color[n]).filter((x) => x !== undefined));
  // серед дозволених беремо найрідше вживаний колір — палітра використовується рівномірно
  let pick = -1;
  for (let k = 0; k < PALETTE_SIZE; k++) if (!taken.has(k) && (pick < 0 || used[k] < used[pick])) pick = k;
  if (pick < 0) pick = 0; // не повинно траплятись
  color[best] = pick; used[pick]++;
  left.delete(best);
}

let bad = 0;
for (const [a, ns] of adj) for (const n of ns) if (color[a] === color[n]) bad++;
fs.writeFileSync("public/data/region-owners.json", JSON.stringify({ v: 1, r, c: color }));
console.log("regions", Object.keys(r).length, "countries", isos.length, "colour clashes", bad, "usage", used.join(","));
