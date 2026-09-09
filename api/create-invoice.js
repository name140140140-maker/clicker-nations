// Vercel Serverless Function: POST /api/create-invoice
// Створює посилання на оплату через Telegram Stars (валюта "XTR").
// Токен бота НІКОЛИ не потрапляє у код фронтенду — він читається
// лише тут, на сервері, зі змінної середовища BOT_TOKEN.

const SUPABASE_URL = "https://zrpwgavfploiaqrqpcvv.supabase.co";
const SUPABASE_KEY = "sb_publishable_Kp13ZD0NtWypUYegahB35g_X2nOWmzn";
const DEFAULT_PREMIUM_PRICE = 50;

async function getPremiumPassPrice() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=eq.premium_pass_price_stars&select=value`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0]?.value) {
      const parsed = Number(JSON.parse(rows[0].value));
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
  } catch {
    /* якщо запит не вдався — використовуємо ціну за замовчуванням */
  }
  return DEFAULT_PREMIUM_PRICE;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    res.status(500).json({ error: "BOT_TOKEN не налаштований на сервері" });
    return;
  }

  try {
    const price = await getPremiumPassPrice();
    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Premium Pass",
          description: "2× сили, ексклюзивні аватарки, титули та значки на весь сезон",
          payload: "premium_pass_purchase",
          provider_token: "", // порожній рядок обов'язковий для оплати Telegram Stars
          currency: "XTR",
          prices: [{ label: "Premium Pass", amount: price }],
        }),
      }
    );

    const data = await tgRes.json();

    if (!data.ok) {
      res.status(500).json({ error: data.description || "Помилка Telegram API" });
      return;
    }

    res.status(200).json({ link: data.result, price });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Невідома помилка сервера" });
  }
}
