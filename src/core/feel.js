/* Тактильний відгук (Telegram HapticFeedback) і налаштування «відчуття» гри: вібрація, звук, зменшення руху.
   Усе зберігається лише локально й не впливає на ігрову логіку. Кожен виклик у try/catch: на слабких пристроях
   і в старих клієнтах Telegram API може бути відсутнім. */

const PREF_KEY = "cn-feel-prefs";
let prefs = { haptic: true, sound: true };
try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREF_KEY) : null;
  if (raw) prefs = { ...prefs, ...JSON.parse(raw) };
} catch { /* без сховища працюємо зі значеннями за замовчуванням */ }

export const getFeelPrefs = () => ({ ...prefs });
export function setFeelPref(key, value) {
  prefs = { ...prefs, [key]: !!value };
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

export const prefersReducedMotion = () => {
  try { return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

let lastImpact = 0;
/** kind: light | soft | medium | heavy | rigid | success | warning | error | select */
export function haptic(kind = "light") {
  if (!prefs.haptic) return;
  const h = typeof window !== "undefined" ? window.Telegram?.WebApp?.HapticFeedback : null;
  if (!h) return;
  try {
    if (kind === "success" || kind === "warning" || kind === "error") h.notificationOccurred(kind);
    else if (kind === "select") h.selectionChanged();
    else {
      // міст Telegram недешевий: не частіше ~20 разів/с
      const now = Date.now();
      if (now - lastImpact < 50) return;
      lastImpact = now;
      h.impactOccurred(kind);
    }
  } catch { /* ignore */ }
}
