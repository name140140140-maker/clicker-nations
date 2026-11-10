/* Реальні країни світу: реєстр, прапори, автоматичні кольори.

   Країна має id = двобуквений ISO-код ("UA", "PL"…). Стартове володіння областей беремо з
   public/data/region-owners.json (будується scripts/build-region-owners.mjs з топології карти):
     r: { <id області>: "<ISO країни>" },  c: { "<ISO>": індекс кольору в COUNTRY_PALETTE }
   Кольори не обирає ні гравець, ні лідер: вони розфарбовані так, щоб сусіди завжди відрізнялись. */

export const REAL_ID_RE = /^[A-Z]{2}$/;
export const REGION_OWNERS_URL = "/data/region-owners.json";

export const COUNTRY_PALETTE = [
  "#e05260", "#f2994a", "#f2c94c", "#8bc34a", "#27ae60", "#1abc9c", "#7c6ff0", "#9b51e0",
  "#d65db1", "#eb6f92", "#b5835a", "#c9a45c", "#4fb3a9", "#cc5a3c", "#9a8fb5", "#7aa33a",
];

/* Назви, яких немає в Intl.DisplayNames у деяких середовищах */
const NAME_FALLBACK = { XK: { uk: "Косово", en: "Kosovo" }, TW: { uk: "Тайвань", en: "Taiwan" } };

let cache = null;
let inflight = null;

/* Завантажує стартове володіння. Повертає { r, c } або null, якщо файл недоступний. */
export function loadRegionOwners(url = REGION_OWNERS_URL) {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const d = await res.json();
      if (!d || !d.r || !d.c) return null;
      cache = d;
      return d;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function flagEmoji(iso) {
  if (!REAL_ID_RE.test(String(iso))) return "";
  return String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const dnCache = {};
export function countryName(iso, lang = "uk") {
  try {
    if (!dnCache[lang]) dnCache[lang] = new Intl.DisplayNames([lang, "en"], { type: "region" });
    const n = dnCache[lang].of(iso);
    if (n && n !== iso) return n;
  } catch { /* Intl недоступний */ }
  const fb = NAME_FALLBACK[iso];
  return (fb && (fb[lang] || fb.en)) || iso;
}

export function countryColor(iso, owners) {
  const idx = owners && owners.c ? owners.c[iso] : undefined;
  return COUNTRY_PALETTE[(idx === undefined ? 0 : idx) % COUNTRY_PALETTE.length];
}

/* Повний список реальних країн, що мають області на карті: [{ id, name, nameEn, flag, color }] */
export function buildRealCountries(owners, lang = "uk") {
  const ids = [...new Set(Object.values(owners.r))];
  const list = ids.map((id) => ({
    id,
    name: NAME_FALLBACK[id]?.[lang] || countryName(id, lang),
    nameEn: NAME_FALLBACK[id]?.en || countryName(id, "en"),
    flag: flagEmoji(id),
    color: countryColor(id, owners),
  }));
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), lang));
  return list;
}
