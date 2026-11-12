// Vercel Serverless Function: POST /api/claim-season-reward
// Гравець забирає нагороду за місце своєї країни в сезоні. Запис seasonrew:<playerId> створює лише
// сервер (api/admin-season-reset.js), а анонімний ключ клієнта його змінювати не може (RLS), тому
// відмітку «забрано» ставить теж сервер. Нагорода видається один раз: атомарна умовна зміна запису.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";

async function sbGet(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value&limit=1`, { headers: serviceHeaders() });
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("claim-reward:" + clientIp(req), 20, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const user = verifyTelegramInitData((req.body || {}).initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");

  try {
    const playerId = await sbGet("tgmap:" + user.id);
    if (!playerId) return res.status(200).json({ ok: true, points: 0 });
    const key = "seasonrew:" + playerId;
    const raw = await sbGet(key);
    if (!raw) return res.status(200).json({ ok: true, points: 0 });
    const rec = JSON.parse(raw);
    if (rec.claimed || !(rec.points > 0)) return res.status(200).json({ ok: true, points: 0 });

    // Умовна зміна: спрацює лише якщо запис досі в тому ж (незабраному) вигляді
    const patch = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&value=eq.${encodeURIComponent(raw)}`, {
      method: "PATCH",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ value: JSON.stringify({ ...rec, claimed: true }) }),
    });
    const rows = patch.ok ? await patch.json().catch(() => []) : [];
    if (!Array.isArray(rows) || rows.length !== 1) return res.status(200).json({ ok: true, points: 0 });

    res.status(200).json({ ok: true, points: rec.points, rank: rec.rank, season: rec.season, countryCode: rec.countryCode });
  } catch (err) {
    console.error("claim-season-reward error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
