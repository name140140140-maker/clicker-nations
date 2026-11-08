// Одноразове (і безпечне) налаштування вебхука основного бота (оплата Premium Pass).
// Відкрий у браузері: https://<твій-домен>/api/webhook-setup?key=<TELEGRAM_WEBHOOK_SECRET>
// Бот підключиться до /api/webhook ІЗ секретним токеном — після цього сервер приймає
// тільки справжні запити від Telegram. Токен бота нікуди не виводиться.
import { safeEqual } from "./_security.js";

export default async function handler(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const token = process.env.BOT_TOKEN;
  if (!secret || !token) {
    res.status(500).json({ error: "Не задано TELEGRAM_WEBHOOK_SECRET або BOT_TOKEN" });
    return;
  }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    res.status(500).json({ error: "TELEGRAM_WEBHOOK_SECRET: лише літери, цифри, _ і -, довжина 16–256" });
    return;
  }
  if (!safeEqual(req.query?.key, secret)) {
    res.status(401).json({ error: "Невірний ключ" });
    return;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `https://${host}/api/webhook`;
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "pre_checkout_query"] }),
  });
  const data = await r.json().catch(() => ({}));
  res.status(200).json({ webhookUrl: url, telegram: data });
}
