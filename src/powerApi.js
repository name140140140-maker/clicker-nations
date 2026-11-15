/* Клієнт серверного Power. Баланс Power веде лише сервер (api/_game/power.js, ключі pwr:<id> закриті для запису).
   Без Telegram initData (браузер для розробки) сервер недоступний: гра працює локально, як раніше. */
import { sbStorageListEntries } from "./supabaseStorage";
import { gameCall, hasInitData } from "./core/gameApi.js";

export const hasServerPower = hasInitData;

const call = (op, body = {}) => gameCall("power", { op, ...body }, { offlineFlag: true, extra: true });

/* pow — кліки, що дають Power; war — кліки, що пішли на шкалу битви (лише списують енергію) */
export const powerSync = (pow = 0, war = 0, warId = null) => call("sync", { pow, war, warId });
/* kind: war_declare | free_capture | city_def. Повертає { ok, power, receipt } */
export const powerSpend = (kind) => call("spend", { kind });
export const powerRefund = (receipt) => call("refund", { receipt });
export const powerAdminSet = (playerId, power, resetEnergy = false, tc = null) => call("admin-set", { playerId, power, resetEnergy, tc });
/* Points, покращення, Battle Pass: виконує сервер (api/_game/progress.js) */
export const progressOp = (op, body = {}) => gameCall("progress", { op, ...body });

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
export const adminPlayerOp = (playerId, op, value, reason = "") => gameCall("admin-player", { playerId, op, value, reason });

/* Лідерство й прив'язка Telegram: виконує сервер (api/_game/leader.js) */
const leaderCall = (op, body = {}) => gameCall("leader", { op, ...body });
export const linkTelegram = (playerId) => leaderCall("link", { playerId });
/* Повертає { ok, leader: true|false } — чи став гравець лідером країни */
export const claimLeader = (countryCode) => leaderCall("claim", { countryCode });
export const releaseLeader = (countryCode) => leaderCall("release", { countryCode });
export const adminSetLeader = (countryCode, playerId) => leaderCall("admin-set", { countryCode, playerId });

/* Дії у світі (захоплення, війни, дипломатія, кордони, адмін-карта): виконує сервер (api/_game/world.js) */
export const worldOp = (op, body = {}) => gameCall("world", { op, ...body });

/* Загальний стан гри, пошта, журнал оновлень: виконує сервер (api/_game/state.js) */
export const stateOp = (op, body = {}) => gameCall("state", { op, ...body });
