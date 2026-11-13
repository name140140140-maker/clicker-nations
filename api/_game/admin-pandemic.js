// Адмін запускає пандемію в будь-якій країні або одразу припиняє всі пандемії у світі.
// Налаштування лежать у cfg:pandemic = { manual: [{ id, code, disease, start, dur }], cancelAt }.
// Ключ cfg:* закритий для анонімного запису: змінює його лише сервер після перевірки initData і ADMIN_TELEGRAM_IDS.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";

const KEY = "cfg:pandemic";
const DAY = 864e5;

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("admin-pandemic:" + clientIp(req), 20, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const { initData, op, code, disease } = req.body || {};
  const user = verifyTelegramInitData(initData, BOT_TOKEN);
  if (!user || !adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");
  if (op !== "start" && op !== "cancel") return fail(res, 400, "Невідома дія");
  if (op === "start" && !/^[A-Z]{2}$/.test(String(code || ""))) return fail(res, 400, "Обери країну");

  try {
    const got = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(KEY)}&select=value`, { headers: serviceHeaders() });
    const rows = got.ok ? await got.json() : [];
    let cfg = {};
    try { cfg = rows[0]?.value ? JSON.parse(rows[0].value) : {}; } catch { cfg = {}; }
    const now = Date.now();
    let manual = (Array.isArray(cfg.manual) ? cfg.manual : []).filter((m) => m && typeof m.start === "number" && now - m.start < 60 * DAY);
    let cancelAt = Number(cfg.cancelAt) || 0;

    if (op === "start") {
      if (manual.length >= 8) manual = manual.slice(-7);
      manual.push({ id: "m" + now.toString(36), code: String(code), disease: String(disease || "").slice(0, 40), start: now, dur: 12 });
    } else {
      cancelAt = now;
    }
    const value = JSON.stringify({ manual, cancelAt });
    const up = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?on_conflict=key`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ key: KEY, value, shared: true }),
    });
    if (!up.ok) return fail(res, 500, "Не вдалося зберегти");
    res.status(200).json({ ok: true, cfg: JSON.parse(value) });
  } catch {
    fail(res, 500, "Помилка сервера");
  }
}
