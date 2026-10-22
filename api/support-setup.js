// Одноразове налаштування вебхука бота підтримки.
// Відкрий у браузері: https://<твій-домен>/api/support-setup?key=<SUPPORT_WEBHOOK_SECRET>
// Бот підключиться до /api/support-webhook. Токен нікуди не виводиться.

export default async function handler(req, res) {
  const secret = process.env.SUPPORT_WEBHOOK_SECRET;
  const token = process.env.SUPPORT_BOT_TOKEN;
  if (!secret || !token) {
    res.status(500).json({ error: "Не задано SUPPORT_WEBHOOK_SECRET або SUPPORT_BOT_TOKEN" });
    return;
  }
  if (req.query?.key !== secret) {
    res.status(401).json({ error: "Невірний ключ" });
    return;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `https://${host}/api/support-webhook`;
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }),
  });
  const data = await r.json().catch(() => ({}));
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((x) => x.json()).catch(() => ({}));
  res.status(200).json({ webhookUrl: url, telegram: data, bot: me?.result?.username || null });
}
