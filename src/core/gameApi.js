/* Єдиний клієнтський виклик серверної логіки: POST /api/game?action=<action> { initData, op, ...body }.
   Замінює п'ять майже однакових копій у powerApi.js. Поведінка та тексти помилок збережені.
   Нічого секретного: лише Telegram initData поточного користувача (його ж перевіряє сервер). */

export const hasInitData = () => typeof window !== "undefined" && !!window.Telegram?.WebApp?.initData;

/** @param {string} action @param {object} body @param {{offlineFlag?: boolean, extra?: boolean, timeoutMs?: number}} [opts] */
export async function gameCall(action, body = {}, opts = {}) {
  const initData = typeof window !== "undefined" ? window.Telegram?.WebApp?.initData : null;
  if (!initData) return { ok: false, reason: "Відкрий гру через бота в Telegram", ...(opts.offlineFlag ? { offline: true } : {}) };
  /* Таймаут лише за явним запитом (читання). Для змінюючих дій його НЕ ставимо: обрив після того, як сервер
     уже виконав дію, дав би хибну помилку й повторне списання/зарахування. */
  const ctrl = opts.timeoutMs && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    const r = await fetch("/api/game?action=" + encodeURIComponent(action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, ...body }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, reason: "Немає відповіді сервера" };
    if (j.ok) return j;
    return { ok: false, reason: j.error || "Не вдалося", ...(opts.extra ? { status: r.status } : {}) };
  } catch {
    return { ok: false, reason: "Немає зв'язку з сервером" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Усі гравці одним запитом (білий список публічних полів). Повертає масив або null при помилці. */
export async function fetchPlayersSnapshot() {
  const r = await gameCall("state", { op: "players-snapshot" }, { timeoutMs: 20000 });
  return r.ok && Array.isArray(r.players) ? r.players : null;
}
