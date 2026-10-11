import { createClient } from "@supabase/supabase-js";

/* --- Дані підключення до бази Supabase --- */
const SUPABASE_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const SUPABASE_KEY = "sb_publishable_Kp13ZD0NtWypUYegahB35g_X2nOWmzn";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* --- Простір імен для "приватних" (не shared) ключів ---
   Кожен гравець має власний Telegram id — саме ним відокремлюємо
   його особисті налаштування (мова, тема, свій ID тощо) від чужих. */
function getNamespace() {
  try {
    const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (tgId) return "tg_" + String(tgId);
  } catch {
    /* ignore */
  }
  // Якщо гру відкрито поза Telegram (наприклад тест у звичайному браузері) —
  // прив'язуємось до локального ідентифікатора цього браузера.
  let id = null;
  try {
    id = window.localStorage.getItem("cn_local_ns");
  } catch {
    /* ignore */
  }
  if (!id) {
    id = "local_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    try {
      window.localStorage.setItem("cn_local_ns", id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

function fullKey(key, shared) {
  return shared ? key : `${getNamespace()}::${key}`;
}

/* --- Публічний API, повторює форму window.storage --- */

export async function sbStorageGet(key, shared) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("key", fullKey(key, shared))
      .maybeSingle();
    if (error || !data) return null;
    return data.value;
  } catch {
    return null;
  }
}

export async function sbStorageSet(key, value, shared) {
  try {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key: fullKey(key, shared), value, shared: !!shared });
    return !error;
  } catch {
    return false;
  }
}

export async function sbStorageListKeys(prefix, shared) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("key")
      .like("key", `${prefix}%`)
      .eq("shared", !!shared);
    if (error || !data) return [];
    return data.map((r) => r.key);
  } catch {
    return [];
  }
}

/* --- Додатково для країн гравців і територій --- */

/* Усі записи з префіксом (ключ + значення). Supabase віддає максимум 1000 рядків за запит,
   тому читаємо сторінками. */
export async function sbStorageListEntries(prefix, shared) {
  const PAGE = 1000;
  const out = [];
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("kv_store")
        .select("key,value")
        .like("key", `${prefix}%`)
        .eq("shared", !!shared)
        .order("key", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data) return error ? null : out;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  } catch {
    return null; // null = помилка мережі/бази (на відміну від порожнього списку)
  }
}

/* Атомарно створює запис, лише якщо такого ключа ще немає (перший, хто встиг, виграє).
   Повертає "ok" | "exists" | "error". Використовується для захоплення вільної області:
   дві людини не можуть одночасно зайняти одну й ту саму територію. */
export async function sbStorageInsertIfAbsent(key, value, shared) {
  try {
    const { error } = await supabase.from("kv_store").insert({ key: fullKey(key, shared), value, shared: !!shared });
    if (!error) {
      // страховка на випадок, якщо в таблиці немає унікального обмеження на key
      const { data } = await supabase.from("kv_store").select("value").eq("key", fullKey(key, shared)).limit(2);
      if (data && data.length === 1 && data[0].value === value) return "ok";
      if (data && data.length > 1) return "error";
      return data && data[0] && data[0].value !== value ? "exists" : "ok";
    }
    if (error.code === "23505" || /duplicate key/i.test(error.message || "")) return "exists";
    return "error";
  } catch {
    return "error";
  }
}
