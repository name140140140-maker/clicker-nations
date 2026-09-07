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
