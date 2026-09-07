// Vercel Serverless Function: POST /api/create-invoice
// Створює посилання на оплату через Telegram Stars (валюта "XTR").
// Токен бота НІКОЛИ не потрапляє у код фронтенду — він читається
// лише тут, на сервері, зі змінної середовища BOT_TOKEN.

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
          prices: [{ label: "Premium Pass", amount: 50 }],
        }),
      }
    );

    const data = await tgRes.json();

    if (!data.ok) {
      res.status(500).json({ error: data.description || "Помилка Telegram API" });
      return;
    }

    res.status(200).json({ link: data.result });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Невідома помилка сервера" });
  }
}
