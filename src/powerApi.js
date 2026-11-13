/* Клієнт серверного Power. Баланс Power веде лише сервер (api/_game/power.js, ключі pwr:<id> закриті для запису).
   Без Telegram initData (браузер для розробки) сервер недоступний: гра працює локально, як раніше. */
import { sbStorageListEntries } from "./supabaseStorage";

export const hasServerPower = () => typeof window !== "undefined" && !!window.Telegram?.WebApp?.initData;

async function call(op, body = {}) {
  try {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return { ok: false, reason: "Відкрий гру через бота в Telegram", offline: true };
    const r = await fetch("/api/game?action=power", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, op, ...body }) });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, reason: "Немає відповіді сервера" };
    return j.ok ? j : { ok: false, reason: j.error || "Не вдалося", status: r.status };
  } catch {
    return { ok: false, reason: "Немає зв'язку з сервером" };
  }
}

/* pow — кліки, що дають Power; war — кліки, що пішли на шкалу битви (лише списують енергію) */
export const powerSync = (pow = 0, war = 0, warId = null) => call("sync", { pow, war, warId });
/* kind: war_declare | free_capture | city_def. Повертає { ok, power, receipt } */
export const powerSpend = (kind) => call("spend", { kind });
export const powerRefund = (receipt) => call("refund", { receipt });
export const powerAdminSet = (playerId, power, resetEnergy = false) => call("admin-set", { playerId, power, resetEnergy });

/* Power усіх гравців: { [playerId]: число } — для рейтингів; null — помилка мережі */
export async function loadPowerMap() {
  const rows = await sbStorageListEntries("pwr:", true);
  if (!rows) return null;
  const map = {};
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      if (v && Number.isFinite(v.p)) map[String(r.key).replace(/^pwr:/, "")] = v.p;
    } catch {
      /* пошкоджений запис */
    }
  }
  return map;
}

/* Адмінські дії над гравцем (Premium, блокування, імунітет): виконує лише сервер. op: premium | block | immunity */
export async function adminPlayerOp(playerId, op, value, reason = "") {
  try {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return { ok: false, reason: "Відкрий гру через бота в Telegram" };
    const r = await fetch("/api/game?action=admin-player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, playerId, op, value, reason }) });
    const j = await r.json().catch(() => null);
    return j && j.ok ? j : { ok: false, reason: (j && j.error) || "Не вдалося" };
  } catch {
    return { ok: false, reason: "Немає зв'язку з сервером" };
  }
}

/* Лідерство й прив'язка Telegram: виконує сервер (api/_game/leader.js) */
async function leaderCall(op, body = {}) {
  try {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return { ok: false, reason: "Відкрий гру через бота в Telegram" };
    const r = await fetch("/api/game?action=leader", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, op, ...body }) });
    const j = await r.json().catch(() => null);
    return j && j.ok ? j : { ok: false, reason: (j && j.error) || "Не вдалося" };
  } catch {
    return { ok: false, reason: "Немає зв'язку з сервером" };
  }
}
export const linkTelegram = (playerId) => leaderCall("link", { playerId });
/* Повертає { ok, leader: true|false } — чи став гравець лідером країни */
export const claimLeader = (countryCode) => leaderCall("claim", { countryCode });
export const releaseLeader = (countryCode) => leaderCall("release", { countryCode });
export const adminSetLeader = (countryCode, playerId) => leaderCall("admin-set", { countryCode, playerId });

/* Дії у світі (захоплення, війни, дипломатія, кордони, адмін-карта): виконує сервер (api/_game/world.js) */
export async function worldOp(op, body = {}) {
  try {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return { ok: false, reason: "Відкрий гру через бота в Telegram" };
    const r = await fetch("/api/game?action=world", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, op, ...body }) });
    const j = await r.json().catch(() => null);
    return j && j.ok ? j : { ok: false, reason: (j && j.error) || "Не вдалося" };
  } catch {
    return { ok: false, reason: "Немає зв'язку з сервером" };
  }
}
