// Vercel Serverless Function: POST /api/webhook
// Telegram надсилає сюди події бота. Найважливіша подія для оплати —
// pre_checkout_query: бот МУСИТЬ підтвердити її протягом ~10 секунд,
// інакше Telegram вважає платіж невдалим і показує нескінченну загрузку.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const update = req.body || {};

  try {
    if (update.pre_checkout_query && BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre_checkout_query_id: update.pre_checkout_query.id,
          ok: true,
        }),
      });
    }
    // update.message?.successful_payment — тут прилетить підтвердження вже
    // ПІСЛЯ успішної оплати. Наразі премій видається на фронтенді через
    // колбек openInvoice, тому додаткова дія тут не обов'язкова.
  } catch (err) {
    console.error("webhook error:", err?.message || err);
  }

  res.status(200).send("ok");
}
