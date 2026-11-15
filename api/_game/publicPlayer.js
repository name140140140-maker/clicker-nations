// Публічна проєкція запису гравця для read-only знімка (state.js, op "players-snapshot").
// Чисті функції без доступу до мережі: легко тестувати (tests/publicPlayer.test.mjs).
//
// ВАЖЛИВО: це БІЛИЙ список. Нове поле потрапляє до відповіді лише якщо його явно додано сюди.
// Не додавати: telegramId, tgId, енергію, upg, passClaimed*, unlocked*, blockedReason, будь-що з tgmap/leader/mail.

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const PUBLIC_PLAYER_FIELDS = [
  "id", "username", "countryCode", "power", "totalClicks", "points", "hasPremiumPass", "createdAt",
  "equippedIcon", "equippedBanner", "equippedTitle", "equippedBadges", "nickColor", "nickFx",
];

/* power — значення з pwr:<id> (джерело істини для Power); якщо його немає — з самого запису */
export function publicPlayer(rec, power, isAdmin = false) {
  const out = {
    id: str(rec.id, 64),
    username: str(rec.username, 40),
    countryCode: str(rec.countryCode, 40),
    power: Number.isFinite(power) ? power : num(rec.power),
    totalClicks: num(rec.totalClicks),
    points: num(rec.points),
    hasPremiumPass: !!rec.hasPremiumPass,
    createdAt: num(rec.createdAt),
    equippedIcon: rec.equippedIcon == null ? null : str(String(rec.equippedIcon), 64),
    equippedBanner: rec.equippedBanner == null ? null : str(String(rec.equippedBanner), 64),
    equippedTitle: rec.equippedTitle == null ? null : str(String(rec.equippedTitle), 64),
    equippedBadges: Array.isArray(rec.equippedBadges) ? rec.equippedBadges.slice(0, 6).map((x) => str(String(x), 64)) : [],
    nickColor: rec.nickColor == null ? null : str(String(rec.nickColor), 32),
    nickFx: rec.nickFx == null ? null : str(String(rec.nickFx), 32),
  };
  /* Адмінські екрани показують Telegram ID (раніше його й так читали напряму з бази) */
  if (isAdmin && rec.telegramId != null) out.telegramId = rec.telegramId;
  return out;
}
