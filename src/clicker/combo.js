/* Комбо клікера (чиста логіка без React і DOM).
   ВАЖЛИВО: комбо — суто візуальний і тактильний відгук. Воно не змінює кількість Power за клік:
   Power, енергію й нагороди веде сервер (api/_game/power.js), клієнт лише малює. */

export const COMBO_WINDOW_MS = 1100; // пауза між тапами, після якої комбо згасає

/** Рівні комбо: з якого числа тапів поспіль вони вмикаються */
export const COMBO_LEVELS = [
  { at: 0, name: "", color: "#ffffff" },
  { at: 10, name: "Розгін", color: "#ffd54a" },
  { at: 25, name: "Жарко!", color: "#ff9f43" },
  { at: 50, name: "Шалено!", color: "#ff6b6b" },
  { at: 100, name: "ЛЕГЕНДА!", color: "#b388ff" },
];

export const comboLevelIndex = (count) => {
  let lvl = 0;
  for (let i = 0; i < COMBO_LEVELS.length; i++) if (count >= COMBO_LEVELS[i].at) lvl = i;
  return lvl;
};

export const newCombo = () => ({ count: 0, last: 0, best: 0 });

/** Реєструє тап. Повертає { state, levelUp } (levelUp = новий індекс рівня, якщо щойно досягнуто). */
export function comboTap(state, now) {
  const alive = state.last && now - state.last <= COMBO_WINDOW_MS;
  const count = (alive ? state.count : 0) + 1;
  const before = comboLevelIndex(alive ? state.count : 0);
  const after = comboLevelIndex(count);
  return { state: { count, last: now, best: Math.max(state.best, count) }, levelUp: after > before ? after : 0 };
}

/** Поточне значення з урахуванням згасання (без мутації) */
export function comboAlive(state, now) {
  return !!state.last && state.count > 0 && now - state.last <= COMBO_WINDOW_MS;
}

/** Прогрес до наступного рівня: { level, next, pct } (pct 0..100; на максимальному рівні 100) */
export function comboProgress(count) {
  const level = comboLevelIndex(count);
  const cur = COMBO_LEVELS[level];
  const nxt = COMBO_LEVELS[level + 1];
  if (!nxt) return { level, next: null, pct: 100 };
  return { level, next: nxt, pct: Math.max(0, Math.min(100, ((count - cur.at) / (nxt.at - cur.at)) * 100)) };
}
