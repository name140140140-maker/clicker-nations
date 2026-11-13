// Адмін ставить таймер тестового випуску телепередачі WC NEWS (ключ cfg:tvtest).
// Коли таймер спливає, у вкладці «ТБ» 30 хвилин іде випуск, незалежно від ранку чи вечора.
// Ключ cfg:* закритий для анонімного запису: змінює його лише сервер після перевірки initData і ADMIN_TELEGRAM_IDS.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";

const AIR_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-tvtimer:" + clientIp(req), 20, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, minutes, clear } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");

  let value = "";
  if (!clear) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < 0 || m > 180) return fail(res, 400, "Некоректний час");
    const at = Date.now() + Math.round(m * 60_000);
    value = JSON.stringify({ at, until: at + AIR_MS });
  }
  try {
    const up = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?on_conflict=key`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ key: "cfg:tvtest", value, shared: true }),
    });
    if (!up.ok) return fail(res, 500, "Не вдалося зберегти таймер");
    res.status(200).json({ ok: true, value: value ? JSON.parse(value) : null });
  } catch {
    fail(res, 500, "Помилка сервера");
  }
}
