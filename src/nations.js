/* Країни гравців і володіння територіями.

   Усе зберігається в тій самій таблиці Supabase `kv_store`, що й решта гри:
     country:<id>   — JSON країни { id, name, color, leaderId, createdAt, regionIds[] }
     terr:<regionId> — id країни, яка володіє областю (запис створюється атомарно,
                       тож одну вільну область не можуть зайняти двоє одночасно)
   Нові таблиці чи міграції в Supabase не потрібні. */

import { sbStorageGet, sbStorageSet, sbStorageListEntries, sbStorageInsertIfAbsent } from "./supabaseStorage";

export const COUNTRY_PREFIX = "country:";
export const TERRITORY_PREFIX = "terr:";
export const CHANGELOG_KEY = "changelog";

/* Обмежена палітра кольорів країн (кожна країна має свій колір; лідер може змінити в Панелі управління). */
export const COUNTRY_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#b91c1c", "#c2410c",
  "#a16207", "#4d7c0f", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9",
];

export const NAME_MIN = 2;
export const NAME_MAX = 24;

export const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

export function newCountryId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* Завантажує всі країни й володіння. Повертає null, якщо база недоступна. */
export async function loadNations() {
  const [cEntries, tEntries] = await Promise.all([
    sbStorageListEntries(COUNTRY_PREFIX, true),
    sbStorageListEntries(TERRITORY_PREFIX, true),
  ]);
  if (!cEntries || !tEntries) return null;
  const countries = [];
  for (const e of cEntries) {
    try {
      const c = JSON.parse(e.value);
      if (c && c.id) countries.push(c);
    } catch {
      /* пошкоджений запис — пропускаємо */
    }
  }
  const owners = {};
  for (const e of tEntries) owners[e.key.slice(TERRITORY_PREFIX.length)] = e.value;
  // Кількість областей рахуємо з фактичного володіння (джерело істини — terr:*)
  const counts = {};
  for (const rid in owners) counts[owners[rid]] = (counts[owners[rid]] || 0) + 1;
  for (const c of countries) c.regionCount = counts[c.id] || 0;
  countries.sort((a, b) => (b.regionCount || 0) - (a.regionCount || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return { countries, owners };
}

export function pickFreeColor(countries) {
  const used = new Set((countries || []).map((c) => c.color));
  const free = COUNTRY_COLORS.filter((c) => !used.has(c));
  const pool = free.length ? free : COUNTRY_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function validateCountryName(name, countries) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (n.length < NAME_MIN) return `Назва має містити щонайменше ${NAME_MIN} символи`;
  if (n.length > NAME_MAX) return `Назва не може бути довшою за ${NAME_MAX} символів`;
  const key = normName(n);
  if ((countries || []).some((c) => normName(c.name) === key)) return "Країна з такою назвою вже існує";
  return "";
}

/* Створює країну: атомарно займає вільну область, потім записує країну.
   Повертає { ok:true, country } або { ok:false, reason, taken? } */
export async function createCountry({ name, color, leaderId, regionId }) {
  const id = newCountryId();
  const claim = await sbStorageInsertIfAbsent(TERRITORY_PREFIX + regionId, id, true);
  if (claim === "exists") return { ok: false, taken: true, reason: "Цю територію щойно зайняла інша країна. Обери іншу." };
  if (claim !== "ok") return { ok: false, reason: "Не вдалося зв'язатися з базою даних. Спробуй ще раз." };
  const country = { id, name: String(name).trim().replace(/\s+/g, " "), color, leaderId, createdAt: Date.now(), regionIds: [regionId] };
  const saved = await sbStorageSet(COUNTRY_PREFIX + id, JSON.stringify(country), true);
  if (!saved) return { ok: false, reason: "Не вдалося зберегти країну. Спробуй ще раз." };
  return { ok: true, country };
}

/* Лише лідер змінює колір (перевірка на боці інтерфейсу). */
export async function updateCountryColor(countryId, color) {
  if (!COUNTRY_COLORS.includes(color)) return { ok: false, reason: "Недопустимий колір" };
  const raw = await sbStorageGet(COUNTRY_PREFIX + countryId, true);
  if (!raw) return { ok: false, reason: "Країну не знайдено" };
  let c;
  try { c = JSON.parse(raw); } catch { return { ok: false, reason: "Пошкоджені дані країни" }; }
  c.color = color;
  const ok = await sbStorageSet(COUNTRY_PREFIX + countryId, JSON.stringify(c), true);
  return ok ? { ok: true, country: c } : { ok: false, reason: "Не вдалося зберегти" };
}

/* --- Список оновлень (для адмін-панелі) --- */
export async function loadChangelog() {
  const raw = await sbStorageGet(CHANGELOG_KEY, true);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveChangelog(list) {
  return sbStorageSet(CHANGELOG_KEY, JSON.stringify(list), true);
}
