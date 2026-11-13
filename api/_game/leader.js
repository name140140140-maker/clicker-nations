// Лідерство й прив'язка Telegram → гравець тепер веде сервер: POST /api/game?action=leader { initData, op, ... }
// Ключі leader:<країна> і tgmap:<telegramId> закриті для анонімного запису (RLS), тож їх неможливо підробити з клієнта.
//   link   { playerId }     — прив'язати свій Telegram до свого запису гравця (запис має містити твій telegramId)
//   claim  { countryCode }  — стати лідером своєї країни, якщо в неї немає (чинного) лідера
//   release{ countryCode }  — скласти лідерство (лише чинний лідер)
//   admin-set { countryCode, playerId } — лише адмін (службова кнопка «Стати лідером»)

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, SUPABASE_URL, serviceHeaders, fail } from "../_security.js";

const enc = encodeURIComponent;
const rest = (p) => `${SUPABASE_URL}/rest/v1/kv_store${p}`;
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
async function sbGet(key) {
  const res = await fetch(rest(`?key=eq.${enc(key)}&select=value&limit=1`), { headers: serviceHeaders() });
  const rows = res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(rows) && rows[0] ? rows[0].value : null;
}
async function sbUpsert(key, value) {
  const res = await fetch(rest("?on_conflict=key"), {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value, shared: true }),
  });
  return res.ok;
}
const validCode = (c) => /^[\w-]{2,40}$/.test(String(c || ""));

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("leader:" + clientIp(req), 40, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const body = req.body || {};
  const user = verifyTelegramInitData(body.initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");
  const tg = String(user.id);

  try {
    if (body.op === "link") {
      const pid = String(body.playerId || "");
      if (!/^[\w-]{3,64}$/.test(pid)) return fail(res, 400, "Невірний гравець");
      const rec = parse(await sbGet("players:" + pid));
      if (!rec || String(rec.telegramId) !== tg) return fail(res, 403, "Запис гравця не належить цьому Telegram");
      const cur = await sbGet("tgmap:" + tg);
      if (cur && cur !== pid) return fail(res, 409, "Цей Telegram уже прив'язаний до іншого гравця");
      if (!cur && !(await sbUpsert("tgmap:" + tg, pid))) return fail(res, 500, "Не вдалося зберегти");
      return res.status(200).json({ ok: true });
    }

    if (body.op === "admin-set") {
      if (!adminIds().includes(tg)) return fail(res, 403, "Недостатньо прав");
      if (!validCode(body.countryCode) || !/^[\w-]{3,64}$/.test(String(body.playerId || ""))) return fail(res, 400, "Невірні дані");
      if (!(await sbUpsert("leader:" + body.countryCode, String(body.playerId)))) return fail(res, 500, "Не вдалося зберегти");
      return res.status(200).json({ ok: true });
    }

    const pid = await sbGet("tgmap:" + tg);
    const me = pid ? parse(await sbGet("players:" + pid)) : null;
    if (!me || me.id !== pid) return fail(res, 403, "Гравця не знайдено");
    const code = String(body.countryCode || "");
    if (!validCode(code)) return fail(res, 400, "Невірна країна");

    if (body.op === "claim") {
      if (me.countryCode !== code) return fail(res, 403, "Ти граєш не за цю країну");
      const cur = await sbGet("leader:" + code);
      if (cur && cur !== pid) {
        const other = parse(await sbGet("players:" + cur));
        if (other && other.countryCode === code) return res.status(200).json({ ok: true, leader: false }); // лідер є й досі в країні
      }
      if (!(await sbUpsert("leader:" + code, pid))) return fail(res, 500, "Не вдалося зберегти");
      return res.status(200).json({ ok: true, leader: true });
    }

    if (body.op === "release") {
      const cur = await sbGet("leader:" + code);
      if (cur === pid) await sbUpsert("leader:" + code, "");
      return res.status(200).json({ ok: true });
    }

    return fail(res, 400, "Невідома дія");
  } catch (err) {
    console.error("leader error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
