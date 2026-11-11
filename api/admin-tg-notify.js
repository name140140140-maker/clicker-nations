// Vercel Serverless Function: POST /api/admin-tg-notify
// Адмін вмикає/вимикає Telegram-сповіщення про війни для всіх гравців (ключ cfg:tgnotify).
// Ключ закритий для анонімного запису (supabase/hardening.sql): змінює його лише сервер після
// перевірки підпису Telegram initData і ADMIN_TELEGRAM_IDS.

import { verifyTelegramInitData } from "./_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "./_security.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-tgnotify:" + clientIp(req), 20, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, off } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");
  if (typeof off !== "boolean") return fail(res, 400, "Некоректний запит");

  try {
    const up = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?on_conflict=key`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ key: "cfg:tgnotify", value: off ? "off" : "on", shared: true }),
    });
    if (!up.ok) return fail(res, 500, "Не вдалося зберегти налаштування");
    res.status(200).json({ ok: true, off });
  } catch {
    fail(res, 500, "Помилка сервера");
  }
}
