// api/_security.js
// Спільні засоби безпеки для серверних функцій (файл з "_" — не ендпоінт).

import crypto from "crypto";

/* Порівняння секретів за постійний час (захист від timing-атак) */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  if (x.length !== y.length) {
    // порівнюємо з самим собою, щоб час відповіді не залежав від довжини
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

/* Простий обмежувач частоти запитів (у межах одного інстансу функції).
   Не заміна повноцінного rate-limit на рівні платформи, але відсікає найпростіший спам. */
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.t > windowMs) {
    buckets.set(key, { t: now, n: 1 });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.t > windowMs) buckets.delete(k);
    }
    return true;
  }
  b.n += 1;
  return b.n <= max;
}

export function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || String(req.headers["x-real-ip"] || "") || req.socket?.remoteAddress || "unknown";
}

/* Адміни (Telegram ID) для серверних адмін-дій: змінна ADMIN_TELEGRAM_IDS="123,456".
   Якщо не задана — використовується основний адмін гри. */
export function adminIds() {
  const raw = String(process.env.ADMIN_TELEGRAM_IDS || "6667421162");
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/* Налаштування Supabase для сервера: URL з env (або дефолт), ключ — лише service_role з env */
export const SUPABASE_URL = process.env.SUPABASE_URL || "https://zrpwgavfploiaqrqpcvv.supabase.co";
export function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/* Не віддаємо клієнту внутрішні тексти помилок */
export function fail(res, code, publicMessage) {
  res.status(code).json({ error: publicMessage });
}
