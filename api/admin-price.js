// Vercel Serverless Function: POST /api/admin-price
// Зміна ціни Premium Pass (у Telegram Stars). Дозволено ЛИШЕ адміну: сервер перевіряє
// підпис Telegram initData і порівнює Telegram ID з ADMIN_TELEGRAM_IDS.
// Запис іде через service_role, тому в самій базі ключ premium_pass_price_stars
// закритий для анонімного запису (див. supabase/hardening.sql).

import { verifyTelegramInitData } from "./_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "./_security.js";

const PRICE_KEY = "premium_pass_price_stars";
const MIN_PRICE = 1;
const MAX_PRICE = 10000;

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-price:" + clientIp(req), 20, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, price } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");

  const n = Math.round(Number(price));
  if (!Number.isFinite(n) || n < MIN_PRICE || n > MAX_PRICE) return fail(res, 400, `Ціна має бути від ${MIN_PRICE} до ${MAX_PRICE} Stars`);

  try {
    const url = `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(PRICE_KEY)}`;
    const patch = await fetch(url, {
      method: "PATCH",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ value: JSON.stringify(n) }),
    });
    const rows = patch.ok ? await patch.json().catch(() => []) : [];
    if (!(Array.isArray(rows) && rows.length > 0)) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({ key: PRICE_KEY, value: JSON.stringify(n), shared: true }),
      });
      if (!ins.ok) return fail(res, 500, "Не вдалося зберегти ціну");
    }
    res.status(200).json({ ok: true, price: n });
  } catch {
    fail(res, 500, "Помилка сервера");
  }
}
