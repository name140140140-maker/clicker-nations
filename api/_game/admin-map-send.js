// Адмін надсилає собі зображення карти документом у Telegram (бот → особистий чат адміна).
// Збереження blob-файлу всередині Telegram WebView ненадійне, тому файл іде через бота.
// Тіло запиту — сирі байти зображення (application/octet-stream), initData — у заголовку x-init-data.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, fail } from "../_security.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-mapsend:" + clientIp(req), 10, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return fail(res, 500, "Сервер не налаштований");

  const user = verifyTelegramInitData(String(req.headers["x-init-data"] || ""), BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");

  const body = req.body;
  const buf = Buffer.isBuffer(body) ? body : null;
  if (!buf || buf.length < 1000) return fail(res, 400, "Порожній файл");
  if (buf.length > 4_300_000) return fail(res, 413, "Файл завеликий");
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (!isJpg && !isPng) return fail(res, 400, "Потрібне зображення PNG або JPEG");

  try {
    const form = new FormData();
    form.append("chat_id", String(user.id));
    form.append("caption", "🗺 Карта світу World Clicker");
    form.append("document", new Blob([buf], { type: isPng ? "image/png" : "image/jpeg" }), "world-clicker-map." + (isPng ? "png" : "jpg"));
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return fail(res, 502, "Telegram не прийняв файл. Спершу напиши боту /start.");
    res.status(200).json({ ok: true });
  } catch {
    fail(res, 500, "Помилка сервера");
  }
}
