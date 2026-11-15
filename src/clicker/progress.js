/* Прогрес для екрана клікера: шлях сезону та цілі на сьогодні (чисті функції, лише читання даних гравця).
   Нагороди за ці цілі не видаються: нагороди (Points, Battle Pass) веде тільки сервер. */
import { PASS_MAX_LEVEL, PASS_LEVEL_THRESHOLDS, PASS_REV, currentPassLevel, passReward } from "../progressData.js";

/** Кліки, зараховані в Battle Pass поточного сезону (та сама формула, що в екрані «Сезон») */
export function seasonClicks(me) {
  if (!me || me.passRev !== PASS_REV) return 0;
  return Math.max(0, (me.totalClicks || 0) - (me.passBaseClicks || 0));
}

const rewardLabel = (r) => {
  if (!r) return "";
  if (r.type === "points") return `+${Number(r.amount).toLocaleString("uk-UA")} Points`;
  if (r.type === "title") return "новий титул";
  if (r.type === "icon") return "новий аватар";
  return "новий банер";
};

/** { level, max, pct, toNext, nextReward } */
export function seasonPath(me) {
  const clicks = seasonClicks(me);
  const level = currentPassLevel(clicks);
  if (level >= PASS_MAX_LEVEL) return { level, max: PASS_MAX_LEVEL, pct: 100, toNext: 0, nextReward: "" };
  const prev = PASS_LEVEL_THRESHOLDS[level];
  const next = PASS_LEVEL_THRESHOLDS[level + 1];
  return {
    level,
    max: PASS_MAX_LEVEL,
    pct: Math.max(0, Math.min(100, ((clicks - prev) / (next - prev)) * 100)),
    toNext: Math.max(0, next - clicks),
    nextReward: rewardLabel(passReward("free", level + 1)),
  };
}

export const DAILY_GOALS = [
  { id: "d100", target: 100, label: "100 кліків" },
  { id: "d500", target: 500, label: "500 кліків" },
  { id: "d1500", target: 1500, label: "1 500 кліків" },
];

/** Ключ доби за локальним часом гравця */
export const dayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Цілі дня: baseline — totalClicks на початок доби. Повертає масив { ...goal, done, pct, have } */
export function dailyGoals(totalClicks, baseline) {
  const have = Math.max(0, (totalClicks || 0) - (baseline || 0));
  return DAILY_GOALS.map((g) => ({ ...g, have: Math.min(have, g.target), done: have >= g.target, pct: Math.min(100, (have / g.target) * 100) }));
}

/** Оновлює збережений baseline: нова доба -> baseline = поточні кліки. Повертає { day, baseline } */
export function rollBaseline(saved, totalClicks, now = Date.now()) {
  const day = dayKey(now);
  if (saved && saved.day === day && Number.isFinite(saved.baseline) && saved.baseline <= totalClicks) return saved;
  return { day, baseline: totalClicks || 0 };
}
