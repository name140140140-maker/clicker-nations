/* Банк країни та знищення вірусу.
   bank:<країна>:<id>   — запис руху коштів { t: "dep"|"wd"|"cure", p, n, a, ts }; баланс = внески − зняття − витрати на лікування
   cure:<пандемія>:<країна> — вірус у країні знищено { id, code, ts, by, cost }
   virussnap:<пандемія>:<країна> — знімок сумарного Power гравців країни на момент появи вірусу { power, ts } */
import { sbStorageListEntries } from "./supabaseStorage";

export const BANK_PREFIX = "bank:";
export const CURE_PREFIX = "cure:";
export const SNAP_PREFIX = "virussnap:";

import { cureCost, CURE_BASE } from "./cureCost.js";
export { cureCost, CURE_BASE };

const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

/* Баланс і журнал банку країни; null — помилка мережі */
export async function loadBank(code) {
  const rows = await sbStorageListEntries(BANK_PREFIX + code + ":", true);
  if (!rows) return null;
  const list = [];
  for (const r of rows) {
    const v = parse(r.value);
    if (v && Number(v.a) > 0 && ["dep", "wd", "cure"].includes(v.t)) list.push({ t: v.t, p: v.p, n: v.n || "", a: Math.floor(Number(v.a)), ts: Number(v.ts) || 0 });
  }
  list.sort((a, b) => b.ts - a.ts);
  let balance = 0;
  const top = {};
  for (const x of list) {
    if (x.t === "dep") { balance += x.a; top[x.p] = { n: x.n, a: (top[x.p]?.a || 0) + x.a }; }
    else balance -= x.a;
  }
  return { balance: Math.max(0, balance), list, top: Object.values(top).sort((a, b) => b.a - a.a) };
}

/* Усі зміни банку робить лише сервер (api/_game/bank.js): перевіряє Telegram-підпис, лідера й баланс.
   Клієнт лише читає журнал (bank:*, cure:*, virussnap:* закриті для анонімного запису). */
async function callBank(body) {
  try {
    const initData = typeof window !== "undefined" ? window.Telegram?.WebApp?.initData : "";
    if (!initData) return { ok: false, reason: "Відкрий гру через бота в Telegram" };
    const r = await fetch("/api/game?action=bank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, ...body }) });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, reason: "Немає відповіді сервера" };
    return j.ok ? j : { ok: false, reason: j.error || j.reason || "Не вдалося" };
  } catch {
    return { ok: false, reason: "Немає зв'язку з сервером" };
  }
}
export const bankDeposit = (amount) => callBank({ op: "deposit", amount });
export const bankWithdraw = (amount) => callBank({ op: "withdraw", amount });
/* maxCost — ціна, яку бачив гравець: якщо сервер порахує помітно більше, він відмовить */
export const cureVirus = (eventId, maxCost) => callBank({ op: "cure", eventId, maxCost });
/* Сервер сам фіксує знімок Power країни для вірусів, що вже дійшли; повертає { [id пандемії]: power } */
export async function ensureSnaps() {
  const r = await callBank({ op: "snaps" });
  return r.ok ? r.snaps || {} : null;
}

/* Усі знищені віруси: [{ id, code, ts }] */
export async function loadCures() {
  const rows = await sbStorageListEntries(CURE_PREFIX, true);
  if (!rows) return null;
  const out = [];
  for (const r of rows) {
    const v = parse(r.value);
    if (v && v.id && v.code && Number(v.ts)) out.push({ id: v.id, code: v.code, ts: Number(v.ts) });
  }
  return out;
}
