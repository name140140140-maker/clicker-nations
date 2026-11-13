// Статичні дані карти для сервера: початкові власники областей і список міст (лише читання файлів public/data).
// Файли підключає vercel.json (functions → includeFiles).
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cache = null;
function readJson(name) {
  const dirs = [join(process.cwd(), "public", "data"), join(process.cwd(), "dist", "data")];
  for (const d of dirs) {
    try { return JSON.parse(readFileSync(join(d, name), "utf8")); } catch { /* наступний шлях */ }
  }
  return null;
}
/* Той самий ключ міста, що й на клієнті (src/map/cities.js) */
export const cityKeyOf = (c) => (c.gid ? "g" + c.gid : c.rid + ":" + c.n.toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/g, "-"));

/* { base: { rid → країна }, countries: Set, cities: Map(key → { key, n, rid }), byRid: Map(rid → [key]) } або null */
export function mapData() {
  if (cache) return cache;
  const ro = readJson("region-owners.json");
  const ci = readJson("cities.json");
  if (!ro || !ro.r || !ci || !Array.isArray(ci.cities)) return null;
  const cities = new Map();
  const byRid = new Map();
  for (const a of ci.cities) {
    const c = { n: a[0], rid: a[6], gid: a[8] || "" };
    const key = cityKeyOf(c);
    cities.set(key, { key, n: c.n, u: a[1] || "", rid: c.rid });
    if (!byRid.has(c.rid)) byRid.set(c.rid, []);
    byRid.get(c.rid).push(key);
  }
  cache = { base: ro.r, countries: new Set(Object.values(ro.r)), cities, byRid };
  return cache;
}
