// Power гравця живе лише на сервері: POST /api/game?action=power  { initData, op, ... }
//   sync    { pow, war }  — клієнт надсилає кількість кліків (pow — у Power, war — у битву); сервер перевіряє енергію
//   spend   { kind }      — списання за дію з фіксованою ціною; повертає чек
//   refund  { receipt }   — повернення, якщо дія після списання не вдалась (чек діє один раз, 3 хвилини)
//   admin-set { playerId, power, resetEnergy } — лише адмін
// Енергія (макс. і відновлення) рахується на сервері, тому Power не можна накрутити швидше, ніж дозволяє гра.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, fail } from "../_security.js";
import { sbGet, parse, getRecord, mutatePwr, energyNow, publicState, maxEnergyOf } from "./pwrStore.js";
import { getJson, sbUpsert } from "./kv.js";
import { warSide, warPhase } from "./world.js";

const COSTS = { war_declare: 5000, free_capture: 5000, city_def: 5000 }; // тримай синхронно з константами в src/App.jsx
const TOLERANCE = 2; // запас на розбіжність годинників клієнта й сервера

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("power:" + clientIp(req), 120, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");

  const body = req.body || {};
  const user = verifyTelegramInitData(body.initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");

  try {
    const playerId = await sbGet("tgmap:" + user.id);
    const rec = playerId ? await getRecord(playerId) : null;
    if (!rec || rec.id !== playerId) return fail(res, 403, "Гравця не знайдено");
    if (rec.blocked) return fail(res, 403, "Гравця заблоковано");
    const op = body.op;

    if (op === "sync") {
      if (!rateLimit("power-sync:" + playerId, 1, 1_200)) return fail(res, 429, "Не так швидко");
      const clamp = (v) => Math.max(0, Math.min(3000, Math.floor(Number(v) || 0)));
      const pow = clamp(body.pow);
      const war = clamp(body.war);
      const r = await mutatePwr(playerId, (st, now) => {
        const cur = energyNow(st, rec, now);
        const allow = Math.floor(cur) + (pow + war > 0 ? TOLERANCE : 0);
        const cp = Math.min(pow, allow);
        const cw = Math.min(war, Math.max(0, allow - cp));
        const left = Math.max(0, cur - cp - cw);
        return { st: { ...st, p: st.p + cp, e: Math.min(left, maxEnergyOf(rec)), t: now }, out: { cp, cw } };
      }, rec);
      if (!r.ok) return fail(res, 500, r.error);
      // кліки в битву зараховує лише сервер: війна має бути в фазі битви, а країна гравця — на одному з боків
      if (r.out.cw > 0 && body.warId) {
        const w = await getJson("war:" + String(body.warId));
        const side = w ? warSide(w, rec.countryCode) : null;
        if (side && warPhase(w) === "battle") {
          const key = "warc:" + w.id + ":" + playerId;
          const prev = parse(await sbGet(key)) || {};
          await sbUpsert(key, JSON.stringify({ side, c: rec.countryCode, n: (Number(prev.n) || 0) + r.out.cw }));
        } else r.out.cw = 0;
      }
      return res.status(200).json({ ok: true, ...publicState(r.st, rec, Date.now()), creditedPow: r.out.cp, creditedWar: r.out.cw });
    }

    if (op === "spend") {
      const cost = COSTS[body.kind];
      if (!cost) return fail(res, 400, "Невідома витрата");
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const r = await mutatePwr(playerId, (st, now) => (st.p < cost ? { error: `Потрібно ${cost} Power` } : { st: { ...st, p: st.p - cost, rc: { id, a: cost, ts: now, used: false } } }), rec);
      if (!r.ok) return fail(res, 400, r.error);
      return res.status(200).json({ ok: true, power: r.st.p, receipt: id });
    }

    if (op === "refund") {
      const receipt = String(body.receipt || "");
      const r = await mutatePwr(playerId, (st, now) => {
        const rc = st.rc;
        if (!rc || rc.id !== receipt || rc.used || now - rc.ts > 3 * 60_000) return { error: "Повернення недоступне" };
        return { st: { ...st, p: st.p + rc.a, rc: { ...rc, used: true } } };
      }, rec);
      if (!r.ok) return fail(res, 400, r.error);
      return res.status(200).json({ ok: true, power: r.st.p });
    }

    if (op === "admin-set") {
      if (!adminIds().includes(String(user.id))) return fail(res, 403, "Недостатньо прав");
      const target = String(body.playerId || "");
      const trec = await getRecord(target);
      if (!trec) return fail(res, 404, "Гравця не знайдено");
      const power = Math.max(0, Math.floor(Number(body.power) || 0));
      const r = await mutatePwr(target, (st, now) => ({ st: { ...st, p: power, ...(body.resetEnergy ? { e: maxEnergyOf(trec), t: now } : {}) } }), trec);
      if (!r.ok) return fail(res, 500, r.error);
      return res.status(200).json({ ok: true, power });
    }

    return fail(res, 400, "Невідома дія");
  } catch (err) {
    console.error("power error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
