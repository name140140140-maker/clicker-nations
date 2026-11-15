/* Єдиний планувальник періодичних завдань застосунку (обгортка над schedulerCore з реальними таймерами).
   setTick / clearTick замінюють setInterval / clearInterval; у згорнутому стані завдання не виконуються. */
import { createScheduler } from "./schedulerCore.js";

const hasDoc = typeof document !== "undefined";
const scheduler = createScheduler({
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h),
  isVisible: () => !hasDoc || !document.hidden,
});
if (hasDoc) {
  document.addEventListener("visibilitychange", () => scheduler.wake());
  // Telegram WebApp на деяких Android не завжди шле visibilitychange при згортанні
  if (typeof window !== "undefined") window.addEventListener("focus", () => scheduler.wake());
}

/** @param {Function} fn @param {number} ms @param {{always?: boolean}} [opts] @returns {number} */
export const setTick = (fn, ms, opts) => scheduler.every(fn, ms, opts);
export const clearTick = (id) => scheduler.cancel(id);
export const tickerSize = () => scheduler.size();
