// Прогрес гравця на сервері: Points, покращення, Battle Pass.
// POST /api/game?action=progress  { initData, op, ... }
// Поля points, upg, passClaimed*, passBase/passRev, unlockedTitles/Icons/PassBanners/Badges у записі гравця
// клієнт змінити не може (тригер бази повертає старі значення). Їх змінює лише цей обробник.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, fail } from "../_security.js";
import { sbGet, casJson, parse } from "./kv.js";
import { readPwr } from "./pwrStore.js";
import { PASS_REV, PASS_MAX_LEVEL, UPG_MAX_LEVEL, UPG_PRICES, currentPassLevel, PASS_REWARD_TABLE, passReward } from "../../src/progressData.js";

const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (a, x) => (a.includes(x) ? a : [...a, x]);
const lvlOf = (rec, id) => Math.max(0, Math.min(UPG_MAX_LEVEL, Math.floor(Number(rec?.upg?.[id]) || 0)));
const PUBLIC = (r) => ({
  points: Math.max(0, Math.floor(Number(r.points) || 0)),
  upg: r.upg || {},
  passRev: r.passRev, passBaseClicks: r.passBaseClicks || 0,
  passClaimedFree: arr(r.passClaimedFree), passClaimedPremium: arr(r.passClaimedPremium),
  unlockedTitles: arr(r.unlockedTitles), unlockedIcons: arr(r.unlockedIcons), unlockedPassBanners: arr(r.unlockedPassBanners), unlockedBadges: arr(r.unlockedBadges),
});

/* Нова версія проходу (сезон): прогрес від поточних кліків, нагороди заново */
function migrate(rec, tc) {
  if (rec.passRev === PASS_REV) return rec;
  return { ...rec, passRev: PASS_REV, passBaseClicks: tc, passClaimedFree: [], passClaimedPremium: [] };
}
function applyReward(rec, r) {
  if (r.type === "points") rec.points = (Math.floor(Number(rec.points) || 0)) + r.amount;
  else if (r.type === "banner") rec.unlockedPassBanners = uniq(arr(rec.unlockedPassBanners), r.id);
  else if (r.type === "icon") rec.unlockedIcons = uniq(arr(rec.unlockedIcons), r.id);
  else if (r.type === "title") rec.unlockedTitles = uniq(arr(rec.unlockedTitles), r.id);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("progress:" + clientIp(req), 60, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");
  const b = req.body || {};
  const user = verifyTelegramInitData(b.initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");
  const isAdmin = adminIds().includes(String(user.id));

  try {
    const pid = await sbGet("tgmap:" + user.id);
    const rec0 = pid ? parse(await sbGet("players:" + pid)) : null;
    if (!rec0 || rec0.id !== pid) return fail(res, 403, "Гравця не знайдено");
    if (rec0.blocked) return fail(res, 403, "Гравця заблоковано");
    if (!rateLimit("progress-p:" + pid, 30, 60_000)) return fail(res, 429, "Забагато дій, зачекай хвилину");
    const op = b.op;
    let err = null, out = null;
    const update = async (id, fn) => {
      const ok = await casJson("players:" + id, (r) => {
        if (!r || r.id !== id) { err = "Гравця не знайдено"; return undefined; }
        const next = fn({ ...r });
        if (next === null) return undefined;
        out = next;
        return next;
      });
      return ok;
    };

    if (op === "buy-upgrade") {
      const id = String(b.id || "");
      if (!UPG_PRICES[id]) return fail(res, 400, "Невідоме покращення");
      const ok = await update(pid, (r) => {
        const l = lvlOf(r, id);
        if (l >= UPG_MAX_LEVEL) { err = "Максимальний рівень"; return null; }
        const price = UPG_PRICES[id][l];
        if ((Number(r.points) || 0) < price) { err = "Не вистачає Points"; return null; }
        return { ...r, points: Math.floor(r.points) - price, upg: { ...(r.upg || {}), [id]: l + 1 } };
      });
      if (!ok && !err) err = "Сервер зайнятий, спробуй ще раз";
      if (err) return fail(res, 400, err);
      return res.status(200).json({ ok: true, ...PUBLIC(out) });
    }

    if (op === "claim-pass") {
      const { st } = await readPwr(pid, rec0);
      const tc = Math.max(0, Math.floor(st.tc ?? (Number(rec0.totalClicks) || 0)));
      const only = b.all ? null : { track: b.track === "premium" ? "premium" : "free", level: Math.floor(Number(b.level)) };
      if (only && !(only.level >= 0 && only.level <= PASS_MAX_LEVEL)) return fail(res, 400, "Невірний рівень");
      const ok = await update(pid, (r0) => {
        const r = migrate(r0, tc);
        const lvl = currentPassLevel(Math.max(0, tc - (Number(r.passBaseClicks) || 0)));
        const free = new Set(arr(r.passClaimedFree)), prem = new Set(arr(r.passClaimedPremium));
        let changed = r !== r0;
        const tryClaim = (track, level) => {
          const set = track === "premium" ? prem : free;
          if (set.has(level) || level > lvl) return;
          if (track === "premium" && !r.hasPremiumPass) return;
          const rw = passReward(track, level);
          if (!rw) return;
          set.add(level);
          applyReward(r, rw);
          changed = true;
        };
        if (only) tryClaim(only.track, only.level);
        else for (let l = 0; l < PASS_REWARD_TABLE.length; l++) { tryClaim("free", l); tryClaim("premium", l); }
        if (!changed) { err = only ? "Нагорода недоступна" : "Немає нагород для отримання"; return null; }
        r.passClaimedFree = [...free];
        r.passClaimedPremium = [...prem];
        return r;
      });
      if (!ok && !err) err = "Сервер зайнятий, спробуй ще раз";
      if (err) return fail(res, 400, err);
      return res.status(200).json({ ok: true, ...PUBLIC(out) });
    }

    if (op === "admin-set" || op === "admin-reset") {
      if (!isAdmin) return fail(res, 403, "Недостатньо прав");
      const target = String(b.playerId || "");
      if (!/^[\w-]{3,64}$/.test(target)) return fail(res, 400, "Невірний гравець");
      const ok = await update(target, (r) => {
        if (op === "admin-reset") return { ...r, points: 0, upg: {}, passBaseClicks: 0, totalClicks: 0, passClaimedFree: [], passClaimedPremium: [] };
        const pts = Math.max(0, Math.floor(Number(b.points) || 0));
        return { ...r, points: pts };
      });
      if (!ok && !err) err = "Не вдалося";
      if (err) return fail(res, 400, err);
      return res.status(200).json({ ok: true, ...PUBLIC(out) });
    }

    return fail(res, 400, "Невідома дія");
  } catch (e) {
    console.error("progress error:", e?.message || e);
    fail(res, 500, "Помилка сервера");
  }
}
