// Адмінські дії над гравцем, які клієнт більше не може робити сам (тригер у Supabase забороняє анонімному ключу змінювати
// hasPremiumPass, blocked, blockedReason, timeImmunity): POST /api/game?action=admin-player { initData, playerId, op, value, reason }
//   op: "premium" | "block" | "immunity"

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";

const enc = encodeURIComponent;

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-player:" + clientIp(req), 30, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, playerId, op, value, reason } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");
  if (!["premium", "block", "immunity"].includes(op)) return fail(res, 400, "Невідома дія");
  if (!/^[\w-]{3,64}$/.test(String(playerId || ""))) return fail(res, 400, "Невірний гравець");

  try {
    const key = "players:" + playerId;
    const got = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${enc(key)}&select=value&limit=1`, { headers: serviceHeaders() });
    const rows = got.ok ? await got.json().catch(() => null) : null;
    if (!Array.isArray(rows) || !rows[0]) return fail(res, 404, "Гравця не знайдено");
    const rec = JSON.parse(rows[0].value);
    const on = value === true;
    let next;
    if (op === "premium") next = { ...rec, hasPremiumPass: on };
    else if (op === "immunity") next = { ...rec, timeImmunity: on };
    else next = { ...rec, blocked: on, blockedReason: on ? String(reason || "Заблоковано адміністрацією").slice(0, 200) : "" };
    const up = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${enc(key)}`, {
      method: "PATCH",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ value: JSON.stringify(next) }),
    });
    if (!up.ok) return fail(res, 500, "Не вдалося зберегти");
    res.status(200).json({ ok: true, record: next });
  } catch (err) {
    console.error("admin-player error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
