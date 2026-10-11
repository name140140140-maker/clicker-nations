/* Будує public/data/cities.json: реальні міста, прив'язані до адміністративних областей карти.

   Джерело: Natural Earth «populated places» (суспільне надбання, https://www.naturalearthdata.com).
   Використання:
     node scripts/build-cities.mjs                 # завантажує набір з GitHub
     node scripts/build-cities.mjs <файл|URL>      # свій файл ne_10m_populated_places*.geojson
     node scripts/build-cities.mjs --fallback-only # без набору: по одній точці на область (назва області)
   Краще брати повний набір ne_10m_populated_places.geojson — у ньому є українські назви (name_uk).
   Кожна область отримує щонайменше одну точку: якщо в ній немає жодного реального міста, точка
   ставиться всередині області й називається за областю. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegionModel } from "../src/map/regionsModel.js";
import { ringBBox, ringArea, pointInPolygon, interiorPoint } from "../src/map/geo.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(root, "public/data/cities.json");
const TOPO = path.join(root, "public/data/world-topology.json");
const DEFAULT_URLS = [
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
];
const SNAP_MAX_DEG = 0.25; // місто трохи «у воді» через спрощені межі — підтягуємо до області не далі ніж на ~25 км
const SKIP_CLASS = /station|historic|scientific|meteorolog/i;

const args = process.argv.slice(2);
const fallbackOnly = args.includes("--fallback-only");
const source = args.find((a) => !a.startsWith("--"));

const get = (p, k) => p[k] ?? p[k.toUpperCase()] ?? p[k.toLowerCase()];

async function readSource() {
  if (fallbackOnly) return { features: [] };
  const tryRead = async (s) => {
    if (/^https?:/.test(s)) {
      const r = await fetch(s);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    }
    return JSON.parse(fs.readFileSync(s, "utf8"));
  };
  if (source) return tryRead(source);
  let lastErr;
  for (const u of DEFAULT_URLS) {
    try {
      console.log("Завантажую", u);
      return await tryRead(u);
    } catch (e) {
      lastErr = e;
      console.warn("  не вдалося:", e.message);
    }
  }
  throw new Error("Не вдалося завантажити набір міст (" + (lastErr?.message || "?") + "). Завантаж файл вручну й передай шлях як аргумент.");
}

function parseCities(geo) {
  const out = [];
  for (const f of geo.features || []) {
    const p = f.properties || {};
    const cls = String(get(p, "featurecla") || "");
    if (SKIP_CLASS.test(cls)) continue;
    const name = get(p, "name") || get(p, "nameascii");
    if (!name) continue;
    const coords = f.geometry?.coordinates;
    const lng = coords ? coords[0] : get(p, "longitude");
    const lat = coords ? coords[1] : get(p, "latitude");
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const pop = Math.max(Number(get(p, "pop_max")) || 0, Number(get(p, "pop_min")) || 0);
    const cap = Number(get(p, "adm0cap")) === 1 || /admin-0 capital/i.test(cls) ? 2 : /admin-1.*capital|region capital/i.test(cls) ? 1 : 0;
    out.push({
      name: String(name),
      nameUk: String(get(p, "name_uk") || ""),
      lng, lat, pop, cap,
      gid: String(get(p, "geonameid") || ""),
    });
  }
  return out;
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

async function main() {
  console.log("Читаю топологію…");
  const topology = JSON.parse(fs.readFileSync(TOPO, "utf8"));
  const model = await buildRegionModel(topology);
  const nRegions = model.regions.length;

  // Полігони областей + сітка 2° для швидкого пошуку
  const polys = []; // { r, rings, bbox }
  const grid = new Map();
  const cellKey = (cx, cy) => cx * 1000 + cy;
  for (let r = 0; r < nRegions; r++) {
    for (const rings of model.regionPolygons(r)) {
      const bbox = ringBBox(rings[0]);
      const id = polys.length;
      polys.push({ r, rings, bbox });
      for (let cx = Math.floor(bbox[0] / 2); cx <= Math.floor(bbox[2] / 2); cx++)
        for (let cy = Math.floor(bbox[1] / 2); cy <= Math.floor(bbox[3] / 2); cy++) {
          const k = cellKey(cx, cy);
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(id);
        }
    }
  }
  const candidates = (x, y, pad = 0) => {
    const set = new Set();
    for (let cx = Math.floor((x - pad) / 2); cx <= Math.floor((x + pad) / 2); cx++)
      for (let cy = Math.floor((y - pad) / 2); cy <= Math.floor((y + pad) / 2); cy++) for (const id of grid.get(cellKey(cx, cy)) || []) set.add(id);
    return set;
  };

  const geo = await readSource();
  const parsed = parseCities(geo);
  console.log("Міст у наборі:", parsed.length);

  const perRegion = new Map(); // r → [city]
  let inside = 0, snapped = 0, dropped = 0;
  for (const c of parsed.sort((a, b) => b.pop - a.pop)) {
    let hit = -1;
    for (const id of candidates(c.lng, c.lat)) {
      const P = polys[id];
      if (c.lng < P.bbox[0] || c.lng > P.bbox[2] || c.lat < P.bbox[1] || c.lat > P.bbox[3]) continue;
      if (pointInPolygon(c.lng, c.lat, P.rings)) { hit = id; break; }
    }
    let x = c.lng, y = c.lat, r;
    if (hit >= 0) { r = polys[hit].r; inside++; }
    else {
      // найближча вершина межі в радіусі SNAP_MAX_DEG
      let best = null;
      const kx = Math.cos((c.lat * Math.PI) / 180) || 1;
      for (const id of candidates(c.lng, c.lat, SNAP_MAX_DEG)) {
        const P = polys[id];
        for (const [vx, vy] of P.rings[0]) {
          const d = Math.hypot((vx - c.lng) * kx, vy - c.lat);
          if (d < SNAP_MAX_DEG && (!best || d < best.d)) best = { d, id, vx, vy };
        }
      }
      if (!best) { dropped++; continue; }
      // трохи в бік внутрішньої точки, щоб місто опинилось усередині області
      const ip = interiorPoint(polys[best.id].rings);
      const k = 0.15;
      const nx = best.vx + (ip[0] - best.vx) * k, ny = best.vy + (ip[1] - best.vy) * k;
      r = polys[best.id].r;
      if (pointInPolygon(nx, ny, polys[best.id].rings)) { x = nx; y = ny; } else { x = best.vx; y = best.vy; }
      snapped++;
    }
    const list = perRegion.get(r) || [];
    if (list.some((o) => o.name === c.name && Math.hypot(o.x - x, o.y - y) < 0.1)) continue; // дублікат
    list.push({ ...c, x, y });
    perRegion.set(r, list);
  }

  // Області без жодного міста — одна точка з назвою області
  let fallbacks = 0;
  for (let r = 0; r < nRegions; r++) {
    if (perRegion.has(r)) continue;
    const regionPolys = model.regionPolygons(r);
    if (!regionPolys.length) continue;
    let big = regionPolys[0];
    for (const p of regionPolys) if (ringArea(p[0]) > ringArea(big[0])) big = p;
    const [x, y] = interiorPoint(big);
    perRegion.set(r, [{ name: model.regions[r].name, nameUk: "", x, y, pop: 0, cap: 0, gid: "", fallback: 1 }]);
    fallbacks++;
  }

  const cities = [];
  for (const [r, list] of [...perRegion].sort((a, b) => a[0] - b[0])) {
    const rid = model.regions[r].rid;
    for (const c of list.sort((a, b) => b.pop - a.pop)) {
      cities.push([c.name, c.nameUk, round4(c.x), round4(c.y), c.pop || 0, c.cap || 0, rid, c.fallback ? 1 : 0, c.gid || ""]);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, src: fallbackOnly ? "fallback" : "natural-earth", cities }));
  const real = cities.filter((c) => !c[7]).length;
  console.log(`Усередині областей: ${inside}, підтягнуто до берега: ${snapped}, відкинуто (далеко від суші): ${dropped}`);
  console.log(`Областей із реальними містами: ${perRegion.size - fallbacks} / ${perRegion.size}; запасних точок: ${fallbacks}`);
  console.log(`Записано ${cities.length} точок (реальних міст ${real}) → ${path.relative(root, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} КБ)`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
