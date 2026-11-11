/* Досягнення гравця. Лічильники лежать у записі гравця: me.ach = {
     cities, destroyed, defended, warsWon,   — підсумки війн, у яких брала участь країна гравця
     streak, bestStreak, lastDay,            — серія щоденних входів
     warTs,                                  — час завершення останньої врахованої війни
     seasonTop                               — найкраще місце країни в сезоні (1 — найкраще)
   }. Чисті функції без доступу до бази, тож їх легко перевіряти. */

export const WAR_ACHIEVEMENTS = [
  { id: "first_city", name: "Перше місто", desc: "Допоможи своїй країні захопити місто", icon: "🏙️", prog: (a) => [a.cities, 1] },
  { id: "conqueror", name: "Завойовник", desc: "Бери участь у захопленні 10 міст", icon: "🚩", prog: (a) => [a.cities, 10] },
  { id: "destroyer", name: "Знищувач країн", desc: "Допоможи знищити країну, що втратила всі міста", icon: "💥", prog: (a) => [a.destroyed, 1] },
  { id: "defender", name: "Незламний", desc: "Відіб'є напад на місто своєї країни", icon: "🛡️", prog: (a) => [a.defended, 1] },
  { id: "veteran", name: "Ветеран війн", desc: "Здобудь перемогу в 5 війнах", icon: "🎖️", prog: (a) => [a.warsWon, 5] },
  { id: "streak3", name: "Три дні поспіль", desc: "Заходь у гру 3 дні підряд", icon: "🔥", prog: (a) => [a.bestStreak, 3] },
  { id: "streak7", name: "Тиждень у строю", desc: "Заходь у гру 7 днів підряд", icon: "📅", prog: (a) => [a.bestStreak, 7] },
  { id: "streak30", name: "Місяць у строю", desc: "Заходь у гру 30 днів підряд", icon: "🏅", prog: (a) => [a.bestStreak, 30] },
  { id: "podium", name: "Призер сезону", desc: "Твоя країна в топ-3 рейтингу сезону", icon: "🥉", prog: (a) => [a.seasonTop && a.seasonTop <= 3 ? 1 : 0, 1] },
  { id: "champion", name: "Чемпіон сезону", desc: "Твоя країна — перша в рейтингу сезону", icon: "🏆", prog: (a) => [a.seasonTop === 1 ? 1 : 0, 1] },
  { id: "clicks10k", name: "Клікер", desc: "Зроби 10 000 кліків", icon: "👆", prog: (a, me) => [me?.totalClicks || 0, 10000] },
  { id: "clicks100k", name: "Клікер-майстер", desc: "Зроби 100 000 кліків", icon: "⚡", prog: (a, me) => [me?.totalClicks || 0, 100000] },
];

export const EMPTY_ACH = { cities: 0, destroyed: 0, defended: 0, warsWon: 0, streak: 0, bestStreak: 0, lastDay: "", warTs: 0, seasonTop: null };

export const normalizeAch = (a) => ({ ...EMPTY_ACH, ...(a || {}) });

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/* Серія входів: той самий день не змінює нічого, наступний день додає 1, пропуск скидає до 1 */
export function withLoginStreak(ach, now = Date.now()) {
  const a = normalizeAch(ach);
  const today = dayKey(now);
  if (a.lastDay === today) return a;
  const yesterday = dayKey(now - 86400000);
  const streak = a.lastDay === yesterday ? a.streak + 1 : 1;
  return { ...a, streak, bestStreak: Math.max(a.bestStreak, streak), lastDay: today };
}

/* Підсумки завершених воєн, у яких була країна гравця (кожну війну враховуємо один раз) */
export function withWarResults(ach, me, wars) {
  const a = normalizeAch(ach);
  if (!me?.countryCode || !((me.totalClicks || 0) > 0)) return a;
  let { cities, destroyed, defended, warsWon, warTs } = a;
  const ended = (wars || [])
    .filter((w) => w && w.status === "ended" && w.result && w.result.winner && (w.result.endedAt || 0) > a.warTs)
    .sort((x, y) => x.result.endedAt - y.result.endedAt);
  for (const w of ended) {
    const att = [w.attacker, ...(w.attAllies || [])].includes(me.countryCode);
    const def = [w.defender, ...(w.defAllies || [])].includes(me.countryCode);
    if (att && w.result.winner === w.attacker) {
      cities += 1;
      warsWon += 1;
      if (w.result.eliminated) destroyed += 1;
    } else if (def && w.result.winner === w.defender) {
      defended += 1;
      warsWon += 1;
    }
    warTs = Math.max(warTs, w.result.endedAt);
  }
  return { ...a, cities, destroyed, defended, warsWon, warTs };
}

export const unlockedIds = (ach, me) =>
  WAR_ACHIEVEMENTS.filter((x) => {
    const [cur, need] = x.prog(normalizeAch(ach), me);
    return cur >= need;
  }).map((x) => x.id);
