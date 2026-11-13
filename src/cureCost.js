/* Ціна знищення вірусу (чистий модуль: його використовують і клієнт, і сервер api/_game/bank.js) */
/* Ціна = знімок × (30% + частка хворих × A + частка померлих × B), але не більше 150% знімка */
export const CURE_BASE = 0.3;
export const CURE_PER_INFECTED = 2;
export const CURE_PER_DEATH = 30;
export const CURE_MAX = 1.5;

export function cureCost(snapPower, infected, deaths) {
  const snap = Math.max(0, Math.round(snapPower || 0));
  const base = Math.round(snap * CURE_BASE);
  const byInf = Math.round(snap * Math.min(CURE_MAX - CURE_BASE, infected * CURE_PER_INFECTED));
  const byDead = Math.min(Math.round(snap * (CURE_MAX - CURE_BASE)) - byInf, Math.round(snap * deaths * CURE_PER_DEATH));
  return { snap, base, byInf, byDead: Math.max(0, byDead), total: base + byInf + Math.max(0, byDead) };
}

