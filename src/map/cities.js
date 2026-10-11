/* Реальні міста для карти (public/data/cities.json, будується скриптом scripts/build-cities.mjs).
   Формат файлу: { v:1, cities: [[name, nameUk, lng, lat, pop, cap, rid, fallback, gid], …] }
     cap: 2 — столиця країни, 1 — центр адмінобласті, 0 — звичайне місто
     fallback: 1 — немає реального міста в області, точка названа за областю */

export const CITIES_URL = "/data/cities.json";

/* Важливість 0–100 за населенням (логарифмічна шкала: 1 тис. → 0, ≈20 млн → 100) + бонус столиці. */
export function cityImportance(pop, cap) {
  const p = Math.max(1000, pop || 0);
  const base = ((Math.log10(p) - 3) / (7.3 - 3)) * 100;
  const bonus = cap === 2 ? 12 : cap === 1 ? 6 : 0;
  return Math.max(0, Math.min(100, Math.round(base + bonus)));
}

/* Стабільний ключ міста (для майбутніх записів про володіння містами в базі). */
export function cityKey(c) {
  return c.gid ? "g" + c.gid : c.rid + ":" + c.n.toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/g, "-");
}

let cache = null;

/* Завантажує й нормалізує міста. Повертає { list, byRid } або порожній результат, якщо файлу немає. */
export async function loadCities(url = CITIES_URL) {
  if (cache) return cache;
  const empty = { list: [], byRid: new Map() };
  try {
    const res = await fetch(url);
    if (!res.ok) return empty;
    const data = await res.json();
    const list = (data.cities || []).map((a, i) => {
      const c = { i, n: a[0], u: a[1] || "", x: a[2], y: a[3], p: a[4] || 0, cap: a[5] || 0, rid: a[6], f: a[7] ? 1 : 0, gid: a[8] || "" };
      c.imp = cityImportance(c.p, c.cap);
      return c;
    });
    const byRid = new Map();
    for (const c of list) {
      let arr = byRid.get(c.rid);
      if (!arr) byRid.set(c.rid, (arr = []));
      arr.push(c);
    }
    cache = { list, byRid };
    return cache;
  } catch {
    return empty;
  }
}

/* GeoJSON точок міст для карти. id = індекс міста (feature-state). */
export function citiesGeoJson(list) {
  return {
    type: "FeatureCollection",
    features: list.map((c) => ({
      type: "Feature",
      id: c.i,
      properties: { n: c.n, u: c.u || c.n, imp: c.imp, cap: c.cap, p: c.p, f: c.f },
      geometry: { type: "Point", coordinates: [c.x, c.y] },
    })),
  };
}

/* Людський формат населення: 320K, 1.2M */
export function fmtPopulation(p) {
  if (!p) return "—";
  if (p >= 1e6) return (p / 1e6).toFixed(p >= 1e7 ? 0 : 1) + "M";
  if (p >= 1e3) return Math.round(p / 1e3) + "K";
  return String(p);
}
