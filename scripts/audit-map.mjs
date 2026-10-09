// Автоматична перевірка даних карти: прапори ↔ ISO ↔ країни/області.
//   npm run audit:map
// Що перевіряє:
//   1. кожен ISO з геометрії (world-topology.json) і кожна країна гри мають SVG-прапор;
//   2. усі посилання всередині SVG-прапорів (<use href="#cn-a">, clip-path="url(#np-a)") мають ціль після відновлення id;
//   3. які країни гри не мають власних полігонів на карті;
//   4. яка частка областей гри (REGION_DATA) прив'язана до полігонів карти — від цього залежить,
//      чи зможе захоплена область змінити колір/кордон на карті (живі кордони).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restoreIds } from "../src/map/flagAssets.js";
import { matchAll } from "../src/map/regionMatch.js";
import { REGION_MATCH_OVERRIDES } from "../src/map/regionOverrides.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appLines = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8").split("\n");
const grab = (name) => {
  const line = appLines.find((l) => l.startsWith(`const ${name} =`));
  if (!line) throw new Error(`У App.jsx не знайдено const ${name}`);
  return new Function(`${line}; return ${name};`)();
};
const flags = JSON.parse(grab("FLAG_SVG_JSON"));
const regionData = JSON.parse(grab("REGION_DATA_JSON"));
const countries = grab("COUNTRIES_RAW");
const topology = JSON.parse(fs.readFileSync(path.join(root, "public/data/world-topology.json"), "utf8"));
const geoms = topology.objects[Object.keys(topology.objects)[0]].geometries;

let problems = 0;
const report = (title, items) => { console.log(`\n${title}: ${items.length}`); if (items.length) console.log("  " + items.join(", ")); };

// 1. ISO ↔ прапор
const topoIso = [...new Set(geoms.map((g) => g.properties.iso))];
const noFlagTopo = topoIso.filter((c) => !flags[c.toLowerCase()]);
const noFlagGame = countries.map((c) => c.code).filter((c) => !flags[c.toLowerCase()]);
report("ISO з геометрії без прапора", noFlagTopo);
report("Країни гри без прапора", noFlagGame);
problems += noFlagTopo.length + noFlagGame.length;

// 2. посилання всередині SVG після відновлення id
const dangling = [];
for (const [iso, inner] of Object.entries(flags)) {
  const fixed = restoreIds(iso, inner);
  const ids = new Set([...fixed.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const refs = new Set([...fixed.matchAll(/(?:xlink:)?href="#([^"]+)"/g)].map((m) => m[1]).concat([...fixed.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])));
  const missing = [...refs].filter((r) => !ids.has(r));
  if (missing.length) dangling.push(`${iso}(${missing.length})`);
}
report("Прапори з незакритими внутрішніми посиланнями (не критично: частина елементів емблеми не малюється)", dangling);

// 3. країни гри без власних полігонів
const gameNoPolygons = countries.map((c) => c.code).filter((c) => !topoIso.includes(c));
report("Країни гри без власних полігонів на карті (їхні території — у складі суверенної держави в геометрії)", gameNoPolygons);

// 4. області гри ↔ полігони
const topoByIso = {};
geoms.forEach((g, i) => (topoByIso[g.properties.iso] ||= []).push({ i, name: g.properties.name }));
const { hit, total, perCountry } = matchAll(topoByIso, regionData, REGION_MATCH_OVERRIDES);
console.log(`\nОбласті гри, прив'язані до полігонів карти: ${hit}/${total} (${((100 * hit) / total).toFixed(1)}%)`);
const weak = Object.entries(perCountry).filter(([, v]) => v.game >= 3 && v.hit / v.game < 0.6).sort((a, b) => b[1].game - b[1].hit - (a[1].game - a[1].hit));
console.log(`Країни, де прив'язано <60% областей (у геометрії грубіший поділ, ніж у грі): ${weak.length}`);
console.log("  " + weak.slice(0, 25).map(([k, v]) => `${k} ${v.hit}/${v.game} (на карті ${v.topo})`).join(", "));

console.log(problems ? `\n❌ Знайдено проблем: ${problems}` : "\n✅ Прапори й ISO узгоджені");
process.exit(problems ? 1 : 0);
