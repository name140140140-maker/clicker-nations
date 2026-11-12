// Єдина серверна функція для ігрових дій (на тарифі Hobby ліміт — 12 функцій на деплой).
// Виклик: POST /api/game?action=<назва>. Самі обробники лежать у api/_game/ (папки з "_" не стають окремими функціями).
import notifyWarEvent from "./_game/notify-war-event.js";
import adminSeasonReset from "./_game/admin-season-reset.js";
import adminTgNotify from "./_game/admin-tg-notify.js";
import adminMapSend from "./_game/admin-map-send.js";
import claimSeasonReward from "./_game/claim-season-reward.js";

const ACTIONS = {
  "notify-war-event": notifyWarEvent,
  "admin-season-reset": adminSeasonReset,
  "admin-tg-notify": adminTgNotify,
  "admin-map-send": adminMapSend,
  "claim-season-reward": claimSeasonReward,
};

export default async function handler(req, res) {
  let action = "";
  try {
    action = String(new URL(req.url, "http://x").searchParams.get("action") || "");
  } catch {
    /* ignore */
  }
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) {
    res.status(404).json({ ok: false, error: "unknown action" });
    return;
  }
  return fn(req, res);
}
